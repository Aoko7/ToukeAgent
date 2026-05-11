import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getHarnessRun,
  formatSseEvent,
  getEvaluationSnapshot,
  getMemorySnapshot,
  getTraceBundle,
  getReviewSnapshot,
  getTaskSnapshot,
  getTraceEntries,
  processInboundMessage,
  runEvaluationHarness,
  searchMemory,
} from '../apps/platform/server.mjs';
import { createStreamStore } from '../apps/platform/src/stream-store.mjs';

test('server pipeline builds plan, run state, and stores stream events', async () => {
  const store = createStreamStore();
  const message = {
    message_id: 'msg_test_1',
    source_platform: 'web',
    source_message_id: 'raw_test_1',
    workspace_id: 'ws_test',
    channel_id: 'console',
    conversation_id: 'conv_test',
    sender: { id: 'user_1', role: 'user' },
    recipient: { id: 'agent_1', role: 'agent' },
    content: [{ type: 'text', text: 'hello world' }],
    trace_id: 'trace_test',
    persona_hint: 'researcher',
  };

  const result = await processInboundMessage(message, store);
  const replay = store.replay('trace_test', 0);
  const sseText = replay.map(formatSseEvent).join('');

  assert.equal(result.task_id, 'trace_test');
  assert.equal(result.persona.persona_id, 'researcher');
  assert.equal(result.plan.steps.length, 3);
  assert.equal(result.plan.steps[1].tool_name, 'hybrid_retrieve');
  assert.equal(result.run_state.status, 'completed');
  assert.match(result.task_url, /\/api\/tasks\?task_id=/);
  assert.match(result.memory_url, /\/api\/memory\?task_id=/);
  assert.match(result.evaluation_url, /\/api\/evaluations\?task_id=/);
  assert.match(result.review_url, /\/api\/reviews\?task_id=/);
  assert.match(result.trace_bundle_url, /\/api\/traces\/bundle\?task_id=/);
  assert.match(result.wiki_url, /\/api\/wiki/);
  assert.equal(result.quality_gate.status, 'passed');
  assert.equal(replay[0].event_type, 'start');
  assert.equal(replay.at(-1).event_type, 'done');
  assert.equal(replay[2].event_type, 'delta');
  assert.ok(replay.some((event) => event.event_type === 'tool_call'));
  assert.ok(replay.some((event) => event.event_type === 'tool_result'));
  assert.ok(replay.some((event) => event.event_type === 'status' && event.payload.state === 'worker_queued'));
  assert.ok(replay.some((event) => event.event_type === 'status' && event.payload.state === 'worker_running'));
  assert.ok(replay.some((event) => event.event_type === 'status' && event.payload.state === 'worker_completed'));
  assert.match(sseText, /event: start/);
  assert.match(sseText, /event: done/);
  assert.match(sseText, /trace_test/);
  assert.match(sseText, /Plan ready/);

  const traceEntries = getTraceEntries('trace_test');
  assert.ok(traceEntries.some((entry) => entry.kind === 'message.received'));
  assert.ok(traceEntries.some((entry) => entry.kind === 'plan.created'));
  assert.ok(traceEntries.some((entry) => entry.kind === 'worker.job.queued'));
  assert.ok(traceEntries.some((entry) => entry.kind === 'worker.job.completed'));
  assert.ok(traceEntries.some((entry) => entry.kind === 'run.completed'));

  const task = getTaskSnapshot('trace_test');
  assert.equal(task.task_id, 'trace_test');
  assert.equal(task.status, 'completed');
  assert.equal(task.phase, 'completed');
  assert.equal(task.plan.plan_id, result.plan.plan_id);
  assert.equal(task.total_steps, 3);
  assert.equal(task.completed_steps, 3);
  assert.ok(task.checkpoints.some((entry) => entry.kind === 'plan.created'));
  assert.ok(task.checkpoints.some((entry) => entry.kind === 'run.completed'));

  const memory = getMemorySnapshot('trace_test');
  assert.equal(memory.task_id, 'trace_test');
  assert.ok(memory.short_term.length > 0);

  const evaluations = getEvaluationSnapshot('trace_test');
  assert.ok(evaluations.length > 0);
  assert.equal(evaluations.at(-1).decision, 'pass');

  const reviews = getReviewSnapshot('trace_test');
  assert.equal(reviews.length, 0);

  const bundle = getTraceBundle('trace_test');
  assert.equal(bundle.exists, true);
  assert.equal(bundle.metrics.final_status, 'completed');
  assert.equal(bundle.metrics.tool_compliance_rate, 1);
});

test('server promotes durable memory for stable user instructions', async () => {
  const store = createStreamStore();
  await processInboundMessage({
    message_id: 'msg_test_memory_1',
    source_platform: 'web',
    source_message_id: 'raw_test_memory_1',
    workspace_id: 'ws_test',
    channel_id: 'console',
    conversation_id: 'conv_test_memory',
    sender: { id: 'user_1', role: 'user' },
    recipient: { id: 'agent_1', role: 'agent' },
    content: [{ type: 'text', text: '以后请始终用中文回答，并记住我喜欢简洁输出。' }],
    trace_id: 'trace_memory_test',
    persona_hint: 'researcher',
  }, store);

  const search = searchMemory('简洁输出');
  assert.ok(search.length > 0);
  assert.ok(search.some((entry) => entry.title.includes('中文回答')));
});

test('server queues manual review when quality gate blocks unsafe output', async () => {
  const store = createStreamStore();
  const result = await processInboundMessage({
    message_id: 'msg_test_review_1',
    source_platform: 'web',
    source_message_id: 'raw_test_review_1',
    workspace_id: 'ws_test',
    channel_id: 'console',
    conversation_id: 'conv_test_review',
    sender: { id: 'user_1', role: 'user' },
    recipient: { id: 'agent_1', role: 'agent' },
    content: [{ type: 'text', text: '请保留这个 sk-1234567890abcdef1234567890abcdef token 用于测试。' }],
    trace_id: 'trace_review_test',
    persona_hint: 'researcher',
  }, store);

  assert.equal(result.quality_gate.status, 'review_required');
  assert.equal(result.quality_gate.review_required, true);
  assert.match(result.review_url, /\/api\/reviews\?task_id=trace_review_test/);

  const evaluations = getEvaluationSnapshot('trace_review_test');
  assert.equal(evaluations.at(-1).decision, 'review');

  const reviews = getReviewSnapshot('trace_review_test');
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].review_status, 'pending');
  assert.equal(reviews[0].gate_status, 'review_required');

  const task = getTaskSnapshot('trace_review_test');
  assert.equal(task.metadata.quality_gate_status, 'review_required');
  assert.equal(task.metadata.review_required, true);
  assert.equal(task.metadata.review_id, reviews[0].review_id);

  const traceEntries = getTraceEntries('trace_review_test');
  assert.ok(traceEntries.some((entry) => entry.kind === 'quality.gate_applied'));
  assert.ok(traceEntries.some((entry) => entry.kind === 'review.created'));
});

test('server can run an evaluation harness batch and persist the run', async () => {
  const run = await runEvaluationHarness([
    {
      case_id: 'harness_case_1',
      input: {
        message_id: 'msg_harness_1',
        source_platform: 'web',
        source_message_id: 'raw_harness_1',
        workspace_id: 'ws_harness',
        channel_id: 'console',
        conversation_id: 'conv_harness_1',
        sender: { id: 'user_1', role: 'user' },
        recipient: { id: 'agent_1', role: 'agent' },
        content: [{ type: 'text', text: 'hello world' }],
        trace_id: 'trace_harness_1',
        persona_hint: 'researcher',
      },
    },
    {
      case_id: 'harness_case_2',
      input: {
        message_id: 'msg_harness_2',
        source_platform: 'web',
        source_message_id: 'raw_harness_2',
        workspace_id: 'ws_harness',
        channel_id: 'console',
        conversation_id: 'conv_harness_2',
        sender: { id: 'user_1', role: 'user' },
        recipient: { id: 'agent_1', role: 'agent' },
        content: [{ type: 'text', text: '请告诉我最新版本和价格状态' }],
        trace_id: 'trace_harness_2',
        persona_hint: 'researcher',
      },
    },
  ], { suite: 'server-test' });

  const persisted = getHarnessRun(run.run_id);
  assert.equal(run.summary.case_count, 2);
  assert.equal(persisted.summary.case_count, 2);
  assert.equal(persisted.metadata.suite, 'server-test');
  assert.equal(run.case_results.length, 2);
  assert.ok(run.case_results.every((item) => item.trace_bundle.exists));
});
