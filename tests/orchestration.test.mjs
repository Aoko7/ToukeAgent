import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditStore } from '../apps/platform/src/audit-store.mjs';
import { createCompressionStore } from '../apps/platform/src/compression-store.mjs';
import { createContextBudgetManager } from '../apps/platform/src/context-budget-manager.mjs';
import { createDeadLetterStore } from '../apps/platform/src/dead-letter-store.mjs';
import { createHandoffStore } from '../apps/platform/src/handoff-store.mjs';
import { createMemoryStore } from '../apps/platform/src/memory-store.mjs';
import { createMultiAgentCoordinator } from '../apps/platform/src/multi-agent-coordinator.mjs';
import { createRecoveryDrillStore } from '../apps/platform/src/recovery-drill-store.mjs';
import { createRLStore } from '../apps/platform/src/rl-store.mjs';
import { createStreamStore } from '../apps/platform/src/stream-store.mjs';
import { createTaskStore } from '../apps/platform/src/task-store.mjs';

test('context budget manager creates compression snapshots and recovery payloads', () => {
  const taskStore = createTaskStore();
  const streamStore = createStreamStore();
  const auditStore = createAuditStore();
  const memoryStore = createMemoryStore();
  const handoffStore = createHandoffStore();
  const compressionStore = createCompressionStore();

  taskStore.upsert('task_budget_1', {
    trace_id: 'task_budget_1',
    status: 'running',
    phase: 'running',
    message: {
      content_preview: 'Please compress this long running task context for a later recovery step.',
    },
    plan: {
      goal: 'Keep the context tight',
      steps: [
        { step_id: 'step_1', title: 'Analyze request' },
        { step_id: 'step_2', title: 'Respond' },
      ],
    },
    current_step_id: 'step_1',
    step_results: [
      {
        step_id: 'step_0',
        status: 'failed',
      },
    ],
    metadata: {
      control_state: 'running',
    },
  });
  streamStore.append('task_budget_1', {
    event_type: 'tool_result',
    payload: {
      call_id: 'call_1',
      summary: 'tool ok',
    },
  });
  auditStore.append('task_budget_1', {
    trace_id: 'task_budget_1',
    kind: 'plan.created',
    payload: {},
  });
  memoryStore.appendShortTerm('task_budget_1', {
    trace_id: 'task_budget_1',
    title: 'current task',
    summary: 'short term note',
    content: 'keep this',
  });
  memoryStore.appendLongTerm({
    title: 'stable preference',
    summary: 'Prefer concise responses',
    source_task_id: 'task_budget_1',
  });

  const manager = createContextBudgetManager({
    taskStore,
    streamStore,
    auditStore,
    memoryStore,
    handoffStore,
    compressionStore,
  });

  const inspection = manager.inspectBudget({
    taskId: 'task_budget_1',
    modelName: 'deepseek-chat',
    tokenBudget: 10,
  });
  const snapshotBundle = manager.createSnapshot({
    taskId: 'task_budget_1',
    modelName: 'deepseek-chat',
    tokenBudget: 10,
  });
  const recovered = manager.recoverSnapshot(snapshotBundle.snapshot.snapshot_id);

  assert.equal(inspection.over_budget, true);
  assert.equal(snapshotBundle.snapshot.task_id, 'task_budget_1');
  assert.equal(compressionStore.list({ taskId: 'task_budget_1' }).length, 1);
  assert.match(recovered.prompt, /Summary:/);
  assert.ok(recovered.must_keep.includes('current step objective'));
});

test('multi-agent coordinator delegates, aggregates, and tracks fallback', () => {
  const taskStore = createTaskStore();
  const auditStore = createAuditStore();
  const handoffStore = createHandoffStore();
  const compressionStore = createCompressionStore();
  const contextBudgetManager = createContextBudgetManager({
    taskStore,
    streamStore: createStreamStore(),
    auditStore,
    memoryStore: createMemoryStore(),
    handoffStore,
    compressionStore,
  });

  taskStore.upsert('task_multi_1', {
    trace_id: 'task_multi_1',
    status: 'planning',
    phase: 'planning',
    plan: {
      goal: 'Delegate and review',
      steps: [
        { step_id: 'step_1', title: 'Route knowledge retrieval', tool_name: 'hybrid_retrieve' },
        { step_id: 'step_2', title: 'Compose response' },
      ],
    },
    message: {
      content_preview: 'Please review and delegate this request.',
    },
  });

  const coordinator = createMultiAgentCoordinator({
    handoffStore,
    auditStore,
    taskStore,
    contextBudgetManager,
  });

  const handoffs = coordinator.delegateSuggested({
    taskId: 'task_multi_1',
    plan: taskStore.get('task_multi_1').plan,
    messageText: 'please review this',
    inputSummary: 'Delegated specialist work',
  });
  const persistedHandoffs = handoffStore.list({ taskId: 'task_multi_1' });
  assert.equal(persistedHandoffs.length, 2);
  assert.ok(persistedHandoffs[0].handoff_id);
  assert.ok(persistedHandoffs[1].handoff_id);

  coordinator.submitResult({
    handoffId: persistedHandoffs[0].handoff_id,
    resultSummary: 'retrieval done',
    result: { citations: ['doc_1'] },
    adopted: true,
    evidenceRefs: ['doc_1'],
  });
  coordinator.submitResult({
    handoffId: persistedHandoffs[1].handoff_id,
    status: 'failed',
    resultSummary: 'review blocked',
    fallbackStrategy: 'single_agent_recovery',
    joinDecision: { decision: 'defer' },
  });

  const aggregate = coordinator.aggregate({ taskId: 'task_multi_1' });
  const coordination = coordinator.describeCoordination({
    taskId: 'task_multi_1',
    plan: taskStore.get('task_multi_1').plan,
    messageText: 'please review this',
  });

  assert.equal(handoffs.length, 2);
  assert.ok(handoffs.every((handoff) => handoff.context_snapshot_id));
  assert.ok(persistedHandoffs.some((handoff) => handoff.metadata.persona_id === 'retriever'));
  assert.ok(persistedHandoffs.some((handoff) => handoff.metadata.specialist_profile));
  assert.equal(aggregate.total_handoffs, 2);
  assert.equal(aggregate.failed_count, 1);
  assert.equal(aggregate.fallback.required, true);
  assert.equal(coordination.join_strategy.mode, 'best_effort_join');
  assert.equal(coordination.next_action.type, 'merge_partial_results');
  assert.ok(coordination.suggestions.some((item) => item.role === 'retriever'));
  assert.ok(auditStore.list('task_multi_1').some((entry) => entry.kind === 'handoff.aggregate'));
});

test('rl, dead-letter, and recovery drill stores keep lifecycle records', () => {
  const rlStore = createRLStore();
  const deadLetterStore = createDeadLetterStore();
  const drillStore = createRecoveryDrillStore();

  const reward = rlStore.appendReward('task_rl_1', {
    score: 0.82,
    signal: 'quality',
    source: 'evaluation',
  });
  const policyLog = rlStore.appendPolicyLog('task_rl_1', {
    action: 'finalize',
    decision: 'pass',
    rationale: 'gate passed',
  });
  const safetyGate = rlStore.appendSafetyGate('task_rl_1', {
    status: 'allow',
    allow_online_update: true,
    reward_eligible: true,
    reason: 'quality_gate_passed',
  });
  const deadLetter = deadLetterStore.create({
    task_id: 'task_rl_1',
    reason: 'worker_crash',
    payload: { step: 'step_1' },
  });
  const resolvedDeadLetter = deadLetterStore.resolve(deadLetter.dead_letter_id, {
    decision: 'replayed',
    operator_id: 'human',
  });
  const drill = drillStore.create({
    task_id: 'task_rl_1',
    scenario: 'worker_restart',
  });
  const completedDrill = drillStore.complete(drill.drill_id, {
    status: 'completed',
    summary: 'restart drill passed',
  });

  assert.equal(reward.score, 0.82);
  assert.equal(policyLog.decision, 'pass');
  assert.equal(safetyGate.status, 'allow');
  assert.equal(resolvedDeadLetter.status, 'resolved');
  assert.equal(completedDrill.status, 'completed');
  assert.equal(deadLetterStore.list({ taskId: 'task_rl_1' }).length, 1);
  assert.equal(drillStore.list({ taskId: 'task_rl_1' }).length, 1);
});
