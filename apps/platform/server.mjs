import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { createAgentPlan, createCanonicalMessage } from '../../packages/contracts/src/index.mjs';
import { createStreamStore } from './src/stream-store.mjs';
import { createPersonaRegistry } from './src/persona-registry.mjs';
import { createPlanner } from './src/planner.mjs';
import { resumeAgentTask, runAgentTask } from './src/runtime.mjs';
import { createToolRegistry, registerDefaultTools } from './src/tool-registry.mjs';
import { createRestrictedExecutionEnvironment } from './src/restricted-exec.mjs';
import { createDeepSeekClient } from './src/deepseek-client.mjs';
import { loadModelConfig } from './src/model-config.mjs';
import { createResponseComposer } from './src/response-composer.mjs';
import { createEventBus } from './src/event-bus.mjs';
import { createAsyncWorker } from './src/async-worker.mjs';
import { createPersistentJobQueueStore } from './src/job-queue-store.mjs';
import { createAlertStore } from './src/alert-store.mjs';
import { createAuditStore } from './src/audit-store.mjs';
import { createTaskStore } from './src/task-store.mjs';
import { createEvaluationStore } from './src/evaluation-store.mjs';
import { createEvaluationHarness } from './src/evaluation-harness.mjs';
import { createKnowledgeHarness } from './src/knowledge-harness.mjs';
import { createMemoryHarness } from './src/memory-harness.mjs';
import { createWikiHarness } from './src/wiki-harness.mjs';
import { createGovernanceMonitor, summarizeToolGovernance } from './src/governance-monitor.mjs';
import { createOutputEvaluator } from './src/output-evaluator.mjs';
import { createHarnessStore } from './src/harness-store.mjs';
import { createQualityGate } from './src/quality-gate.mjs';
import { createReviewStore } from './src/review-store.mjs';
import { createTraceCollector } from './src/trace-collector.mjs';
import { createSecretManager } from './src/secret-manager.mjs';
import { createWikiSubsystem } from './src/wiki-runtime.mjs';
import { buildWikiImportPayloadFromMarkdown } from './src/wiki-markdown-ingest.mjs';
import { createDeadLetterStore } from './src/dead-letter-store.mjs';
import { createRecoveryDrillStore } from './src/recovery-drill-store.mjs';
import { createRLStore } from './src/rl-store.mjs';
import { createHandoffStore } from './src/handoff-store.mjs';
import { createCompressionStore } from './src/compression-store.mjs';
import { createContextBudgetManager } from './src/context-budget-manager.mjs';
import { createMultiAgentCoordinator } from './src/multi-agent-coordinator.mjs';
import { createModelRouter } from './src/model-router.mjs';
import { createPlatformAdapterRegistry } from './src/platform-adapter-registry.mjs';
import { createPlatformDeliveryStore } from './src/delivery-store.mjs';
import { createPlatformDeliveryService } from './src/delivery-service.mjs';
import { createProviderGateway } from './src/provider-gateway.mjs';
import { createMemorySubsystem } from './src/memory-runtime.mjs';
import { callPythonCore } from './src/python-core-bridge.mjs';
import {
  buildMemoryHarnessDraftFromTraceBundle,
  createMemoryHarnessDraftArtifact,
  mergeMemoryHarnessDraftArtifactIntoSuite,
  applyMemoryCandidateCaseReview,
  applyMemoryCandidateBatchReview,
  compareMemoryCandidateCaseAgainstGold,
  compareMemoryCandidateSuiteAgainstGold,
  mergeApprovedMemoryCandidateIntoGold,
} from './src/memory-harness-draft.mjs';
import {
  buildWikiHarnessDraftFromTraceBundle,
  createWikiHarnessDraftArtifact,
  mergeWikiHarnessDraftArtifactIntoSuite,
  applyWikiCandidateCaseReview,
  applyWikiCandidateBatchReview,
  compareWikiCandidateCaseAgainstObservedRun,
  compareWikiCandidateSuiteAgainstObservedRun,
  summarizeWikiCandidateSuiteGovernance,
} from './src/wiki-harness-draft.mjs';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const streamStore = createStreamStore();
const auditStore = createAuditStore();
const taskStore = createTaskStore();
const platformConfig = loadModelConfig();
const {
  memoryStore,
  memoryProviderStrategy,
} = createMemorySubsystem({
  config: platformConfig.memory ?? {},
  env: process.env,
});
const {
  wikiStore,
  wikiProviderStrategy,
  describeWikiStrategy,
} = createWikiSubsystem({
  config: platformConfig.wiki ?? {},
  env: process.env,
});
const evaluationStore = createEvaluationStore();
const alertStore = createAlertStore();
const deadLetterStore = createDeadLetterStore();
const recoveryDrillStore = createRecoveryDrillStore();
const rlStore = createRLStore();
const handoffStore = createHandoffStore();
const compressionStore = createCompressionStore();
const deliveryStore = createPlatformDeliveryStore();
const outputEvaluator = createOutputEvaluator();
const governanceMonitor = createGovernanceMonitor({ alertStore });
const qualityGate = createQualityGate({
  sampleRate: Number(process.env.QUALITY_REVIEW_SAMPLE_RATE ?? 0) || 0,
});
const reviewStore = createReviewStore();
const harnessStore = createHarnessStore();
const contextBudgetManager = createContextBudgetManager({
  taskStore,
  streamStore,
  auditStore,
  memoryStore,
  handoffStore,
  compressionStore,
});
const multiAgentCoordinator = createMultiAgentCoordinator({
  handoffStore,
  auditStore,
  taskStore,
  contextBudgetManager,
});
const traceCollector = createTraceCollector({
  auditStore,
  streamStore,
  taskStore,
  evaluationStore,
  reviewStore,
  memoryStore,
  alertStore,
  deadLetterStore,
  handoffStore,
  compressionStore,
  rlStore,
  recoveryDrillStore,
  deliveryStore,
});
const secretManager = createSecretManager();
const evaluationHarness = createEvaluationHarness({
  executeTask: (input) => processInboundMessage(input, streamStore),
  collectTraceBundle: (taskId) => traceCollector.collect(taskId),
  harnessStore,
});
const memoryHarness = createMemoryHarness({
  harnessStore,
});
const knowledgeHarness = createKnowledgeHarness({
  harnessStore,
});
const wikiHarness = createWikiHarness({
  harnessStore,
});
const personaRegistry = createPersonaRegistry();
const planner = createPlanner();
const toolRegistry = createToolRegistry({
  executionEnvironment: createRestrictedExecutionEnvironment({ enforceApproval: true }),
});
const deepseekClient = createDeepSeekClient();
const routingConfig = deepseekClient.routingConfig ?? {};
const primaryProviderId = deepseekClient.providerId ?? 'deepseek';
const routingProviders = {
  ...(routingConfig.providers ?? {}),
  [primaryProviderId]: {
    ...(routingConfig.providers?.[primaryProviderId] ?? {}),
    provider: primaryProviderId,
    label: routingConfig.providers?.[primaryProviderId]?.label ?? 'deepseek primary',
    mode: 'remote',
    available: deepseekClient.isConfigured,
    model: routingConfig.providers?.[primaryProviderId]?.model ?? deepseekClient.model,
    reasoning_effort: routingConfig.providers?.[primaryProviderId]?.reasoning_effort
      ?? routingConfig.providers?.[primaryProviderId]?.reasoningEffort
      ?? deepseekClient.reasoningEffort,
  },
  local: {
    ...(routingConfig.providers?.local ?? {}),
    provider: 'local',
    label: routingConfig.providers?.local?.label ?? 'local compose',
    mode: routingConfig.providers?.local?.mode ?? 'local-compose',
    available: true,
    model: null,
    reasoning_effort: 'none',
  },
};
const modelRouter = createModelRouter({
  provider: routingConfig.provider ?? 'deepseek',
  primaryModel: routingConfig.primaryModel ?? deepseekClient.model,
  defaultReasoningEffort: routingConfig.defaultReasoningEffort ?? deepseekClient.reasoningEffort,
  isPrimaryConfigured: deepseekClient.isConfigured,
  profiles: routingConfig.profiles ?? null,
  providers: routingProviders,
  fallback: routingConfig.fallback ?? {
    provider: 'local',
    strategy: 'local-compose',
  },
  fallbackChain: routingConfig.fallbackChain ?? null,
});
const providerGateway = createProviderGateway({
  providers: {
    [deepseekClient.providerId]: deepseekClient,
  },
});
const responseComposer = createResponseComposer({ providerGateway, modelRouter });
const eventBus = createEventBus();
const workerQueueStore = createPersistentJobQueueStore({
  filePath: process.env.TOUKEAGENT_QUEUE_FILE ?? join(tmpdir(), 'toukeagent', 'platform-worker-queue.json'),
});

function extractExistingDeadLetter(error) {
  if (!error || typeof error !== 'object') {
    return null;
  }
  return error.dead_letter_record ?? error.dead_letter ?? null;
}

function buildReplayableWorkerDispatchInput(record, { replayId = null } = {}) {
  const workerJob = record?.payload?.worker_job ?? null;
  const workerInput = record?.payload?.worker_input ?? record?.payload?.worker_job?.payload ?? null;
  if (!workerJob?.job_type || workerInput === null) {
    return null;
  }

  const metadata = {
    ...(workerJob.metadata ?? {}),
    replay_dead_letter_id: record.dead_letter_id,
    replay_reason: record.reason,
    replay_source_job_id: workerJob.job_id ?? null,
    replay_source_dead_letter_status: record.status ?? null,
  };
  if (replayId) {
    metadata.replay_id = replayId;
  }

  return {
    job_type: workerJob.job_type,
    payload: structuredClone(workerInput),
    trace_id: workerJob.trace_id ?? record.trace_id ?? record.task_id ?? null,
    task_id: workerJob.task_id ?? record.task_id ?? null,
    run_id: workerJob.run_id ?? null,
    step_id: workerJob.step_id ?? null,
    persona_id: workerJob.persona_id ?? null,
    metadata,
    retry_limit: Number.isFinite(workerJob.metadata?.retry_limit)
      ? Number(workerJob.metadata.retry_limit)
      : null,
    dead_letter_on_failure: workerJob.metadata?.dead_letter_on_failure ?? false,
    dead_letter_reason: workerJob.metadata?.dead_letter_reason ?? 'worker_job_failed',
    dead_letter_replayable: workerJob.metadata?.dead_letter_replayable ?? true,
  };
}

function recordWorkerJobDeadLetter(job, error, { payload = null } = {}) {
  const reason = job?.metadata?.dead_letter_reason ?? 'worker_job_failed';
  return recordTaskDeadLetter(job.task_id ?? job.trace_id ?? `task_${Date.now()}`, {
    reason,
    error: {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'Error',
    },
    replayable: job?.metadata?.dead_letter_replayable ?? true,
    payload: {
      worker_job: job,
      worker_input: structuredClone(payload ?? {}),
      worker_error: {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Error',
      },
    },
    metadata: {
      worker_job_id: job.job_id ?? null,
      worker_job_type: job.job_type ?? null,
      worker_attempts: job.attempts ?? 0,
      worker_id: job.worker_id ?? null,
      retry_limit: job?.metadata?.retry_limit ?? null,
    },
  });
}

function getLatestTaskDeadLetter(taskId, {
  replayable = true,
  allowedStatuses = ['open', 'replayed'],
} = {}) {
  const items = deadLetterStore.list({ taskId, replayable });
  return items.find((item) => allowedStatuses.includes(item.status)) ?? items[0] ?? null;
}

function hydrateTaskFromSnapshot(taskId, snapshot = {}) {
  if (!snapshot || typeof snapshot !== 'object') {
    return taskStore.get(taskId);
  }

  return taskStore.upsert(taskId, {
    trace_id: snapshot.trace_id ?? taskId,
    status: snapshot.status ?? undefined,
    phase: snapshot.phase ?? undefined,
    persona_id: snapshot.persona_id ?? undefined,
    plan_id: snapshot.plan_id ?? snapshot.plan?.plan_id ?? undefined,
    message: snapshot.message ?? undefined,
    message_snapshot: snapshot.message_snapshot ?? undefined,
    plan: snapshot.plan ?? undefined,
    run_state: snapshot.run_state ?? undefined,
    current_step_id: snapshot.current_step_id ?? snapshot.run_state?.current_step_id ?? undefined,
    completed_steps: snapshot.completed_steps ?? snapshot.run_state?.completed_steps ?? undefined,
    total_steps: snapshot.total_steps ?? snapshot.run_state?.total_steps ?? undefined,
    step_results: snapshot.step_results ?? snapshot.run_state?.step_results ?? undefined,
    output: snapshot.output ?? snapshot.run_state?.output ?? undefined,
    metadata: snapshot.metadata ?? undefined,
  });
}

function hasRecoverableCheckpoint(task) {
  return Boolean(task?.message_snapshot && task?.plan && task?.run_state);
}

export async function replayDeadLetterExecution(deadLetterId, {
  operatorId = 'system',
  notes = null,
  metadata = {},
} = {}) {
  const record = deadLetterStore.get(deadLetterId);
  if (!record) {
    throw new Error(`Unknown dead-letter item: ${deadLetterId}`);
  }
  if (record.replayable === false) {
    throw new Error(`Dead-letter item is not replayable: ${deadLetterId}`);
  }

  const replayId = `replay_${randomUUID()}`;
  const replayInput = buildReplayableWorkerDispatchInput(record, { replayId });
  if (!replayInput) {
    throw new Error(`Dead-letter item lacks replayable worker input: ${deadLetterId}`);
  }

  deadLetterStore.update(deadLetterId, {
    metadata: {
      ...metadata,
      last_replay_attempt_at: new Date().toISOString(),
      last_replay_id: replayId,
      replay_operator_id: operatorId,
      replay_notes: notes,
      replay_status: 'running',
    },
  });

  try {
    const replayed = await dispatchPlatformWorkerJob(replayInput, { includeJob: true });
    const updated = deadLetterStore.markReplayed(deadLetterId, {
      replayId,
      metadata: {
        ...metadata,
        replay_operator_id: operatorId,
        replay_notes: notes,
        replay_status: 'completed',
        replay_job_id: replayed.job.job_id,
        replay_job_type: replayed.job.job_type,
        replay_job_status: replayed.job.status,
      },
    });

    if (record.task_id) {
      taskStore.upsert(record.task_id, {
        metadata: {
          dead_letter_replay_id: replayId,
          dead_letter_replay_status: 'completed',
          dead_letter_replay_job_id: replayed.job.job_id,
        },
        checkpoint: {
          kind: 'dead_letter.replayed',
          summary: 'Dead-letter replayed back into worker queue',
          metadata: {
            dead_letter_id: record.dead_letter_id,
            replay_id: replayId,
            replay_job_id: replayed.job.job_id,
          },
        },
      });
    }

    auditStore.append(record.task_id ?? record.trace_id ?? deadLetterId, {
      trace_id: record.trace_id ?? record.task_id ?? deadLetterId,
      kind: 'dead_letter.replayed',
      payload: {
        dead_letter_id: record.dead_letter_id,
        replay_id: replayId,
        replay_job: replayed.job,
        replay_result_summary: replayed.result?.summary ?? null,
      },
    });

    return {
      dead_letter: updated,
      replay: {
        replay_id: replayId,
        dead_letter_id: record.dead_letter_id,
        job: replayed.job,
        result: replayed.result,
      },
    };
  } catch (error) {
    const replayFailureDeadLetter = extractExistingDeadLetter(error);
    deadLetterStore.update(deadLetterId, {
      metadata: {
        ...metadata,
        last_replay_attempt_at: new Date().toISOString(),
        last_replay_id: replayId,
        replay_operator_id: operatorId,
        replay_notes: notes,
        replay_status: 'failed',
        last_replay_error: {
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : 'Error',
        },
        last_replay_dead_letter_id: replayFailureDeadLetter?.dead_letter_id ?? null,
      },
    });

    auditStore.append(record.task_id ?? record.trace_id ?? deadLetterId, {
      trace_id: record.trace_id ?? record.task_id ?? deadLetterId,
      kind: 'dead_letter.replay_failed',
      payload: {
        dead_letter_id: record.dead_letter_id,
        replay_id: replayId,
        error: {
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : 'Error',
        },
        replay_dead_letter_id: replayFailureDeadLetter?.dead_letter_id ?? null,
      },
    });
    throw error;
  }
}

async function recoverDeadLetterTaskFromCheckpoint({
  taskId,
  task,
  deadLetter,
  reviewerId = 'system',
  notes = null,
  overrides = {},
} = {}) {
  const message = normalizeResumeMessage(task, overrides);
  const plan = normalizeResumePlan(task, overrides);
  const persona = personaRegistry.get(overrides.persona_id ?? task.persona_id);
  const onTaskUpdate = createTaskUpdateHandler({ message, persona, plan });
  const replayId = `task_replay_${randomUUID()}`;
  const attemptAt = new Date().toISOString();

  deadLetterStore.update(deadLetter.dead_letter_id, {
    metadata: {
      last_task_recovery_attempt_at: attemptAt,
      task_recovery_id: replayId,
      task_recovery_mode: 'resume',
      task_recovery_status: 'running',
      task_recovery_operator_id: reviewerId,
      task_recovery_notes: notes,
    },
  });

  auditStore.append(taskId, {
    trace_id: task.trace_id ?? taskId,
    kind: 'dead_letter.recovery_started',
    payload: {
      dead_letter_id: deadLetter.dead_letter_id,
      replay_id: replayId,
      reviewer_id: reviewerId,
      notes,
      mode: 'resume',
    },
  });

  taskStore.upsert(taskId, {
    status: 'resuming',
    phase: 'dead_letter_recovery',
    message_snapshot: message,
    plan,
    metadata: {
      control_state: 'resuming',
      recovery_source: 'dead_letter',
      recovery_mode: 'resume',
      dead_letter_id: deadLetter.dead_letter_id,
      dead_letter_recovery_id: replayId,
      dead_letter_recovery_status: 'running',
      dead_letter_recovery_operator_id: reviewerId,
      dead_letter_recovery_notes: notes,
    },
    checkpoint: {
      kind: 'dead_letter.recovery_started',
      summary: 'Recovering dead-letter task from latest checkpoint',
      metadata: {
        dead_letter_id: deadLetter.dead_letter_id,
        replay_id: replayId,
      },
    },
  });

  try {
    const result = await resumeAgentTask({
      message,
      persona,
      plan,
      toolRegistry,
      store: streamStore,
      responseComposer,
      worker,
      eventBus,
      memoryStore,
      onTaskUpdate,
      resumeState: task.run_state,
      approvalContext: {
        approved: false,
      },
    });

    if (result.paused) {
      const pausedStep = plan.steps.find((step) => step.step_id === result.runState.current_step_id) ?? null;
      const approval = createApprovalReview({
        message,
        persona,
        plan,
        runState: result.runState,
        pausedStep,
        reason: 'approval_required',
      });
      const updatedDeadLetter = deadLetterStore.markReplayed(deadLetter.dead_letter_id, {
        replayId,
        metadata: {
          task_recovery_status: 'paused',
          task_recovery_phase: 'waiting_approval',
          task_recovery_operator_id: reviewerId,
          task_recovery_notes: notes,
          approval_review_id: approval.review_id,
        },
      });

      auditStore.append(taskId, {
        trace_id: task.trace_id ?? taskId,
        kind: 'dead_letter.recovered',
        payload: {
          dead_letter_id: deadLetter.dead_letter_id,
          replay_id: replayId,
          status: 'paused',
          approval_review_id: approval.review_id,
        },
      });

      taskStore.upsert(taskId, {
        metadata: {
          dead_letter_status: updatedDeadLetter.status,
          dead_letter_recovery_id: replayId,
          dead_letter_recovery_status: 'paused',
          recovered_dead_letter_id: deadLetter.dead_letter_id,
        },
        checkpoint: {
          kind: 'dead_letter.replayed',
          summary: 'Dead-letter task resumed to an approval checkpoint',
          metadata: {
            dead_letter_id: deadLetter.dead_letter_id,
            replay_id: replayId,
            approval_review_id: approval.review_id,
          },
        },
      });

      return {
        message,
        persona,
        plan,
        run_state: result.runState,
        task_id: taskId,
        approval_required: true,
        approval_review: approval,
        approval_url: `/api/approvals?task_id=${encodeURIComponent(taskId)}`,
        resume_url: `/api/tasks/resume?task_id=${encodeURIComponent(taskId)}`,
        stream_url: `/api/stream?task_id=${encodeURIComponent(taskId)}`,
        audit_url: `/api/traces?task_id=${encodeURIComponent(taskId)}`,
        trace_bundle_url: `/api/traces/bundle?task_id=${encodeURIComponent(taskId)}`,
        task_url: `/api/tasks?task_id=${encodeURIComponent(taskId)}`,
        memory_url: buildMemoryUrl(taskId, {
          workspaceId: message.workspace_id,
          personaId: persona.persona_id,
        }),
        evaluation_url: `/api/evaluations?task_id=${encodeURIComponent(taskId)}`,
        review_url: `/api/reviews?task_id=${encodeURIComponent(taskId)}`,
        alerts_url: `/api/alerts?task_id=${encodeURIComponent(taskId)}`,
        governance_url: `/api/governance?task_id=${encodeURIComponent(taskId)}`,
        quality_gate: null,
        wiki_url: '/api/wiki',
        events: result.events,
        resumed: true,
        recovered_from_dead_letter: true,
        dead_letter: updatedDeadLetter,
      };
    }

    const { evaluation, gate, review, governance, deliveries } = await finalizeSuccessfulRun({
      message,
      persona,
      plan,
      runState: result.runState,
    });
    const updatedDeadLetter = deadLetterStore.markReplayed(deadLetter.dead_letter_id, {
      replayId,
      metadata: {
        task_recovery_status: 'completed',
        task_recovery_phase: 'completed',
        task_recovery_operator_id: reviewerId,
        task_recovery_notes: notes,
        task_status: result.runState.status,
      },
    });

    auditStore.append(taskId, {
      trace_id: task.trace_id ?? taskId,
      kind: 'dead_letter.recovered',
      payload: {
        dead_letter_id: deadLetter.dead_letter_id,
        replay_id: replayId,
        status: 'completed',
      },
    });

    taskStore.upsert(taskId, {
      metadata: {
        dead_letter_status: updatedDeadLetter.status,
        dead_letter_recovery_id: replayId,
        dead_letter_recovery_status: 'completed',
        recovered_dead_letter_id: deadLetter.dead_letter_id,
      },
      checkpoint: {
        kind: 'dead_letter.replayed',
        summary: 'Dead-letter task resumed from latest checkpoint',
        metadata: {
          dead_letter_id: deadLetter.dead_letter_id,
          replay_id: replayId,
        },
      },
    });

    return {
      message,
      persona,
      plan,
      run_state: result.runState,
      task_id: taskId,
      stream_url: `/api/stream?task_id=${encodeURIComponent(taskId)}`,
      audit_url: `/api/traces?task_id=${encodeURIComponent(taskId)}`,
      trace_bundle_url: `/api/traces/bundle?task_id=${encodeURIComponent(taskId)}`,
      task_url: `/api/tasks?task_id=${encodeURIComponent(taskId)}`,
      memory_url: buildMemoryUrl(taskId, {
        workspaceId: message.workspace_id,
        personaId: persona.persona_id,
      }),
      evaluation_url: `/api/evaluations?task_id=${encodeURIComponent(taskId)}`,
      review_url: `/api/reviews?task_id=${encodeURIComponent(taskId)}`,
      alerts_url: `/api/alerts?task_id=${encodeURIComponent(taskId)}`,
      governance_url: `/api/governance?task_id=${encodeURIComponent(taskId)}`,
      deliveries_url: `/api/deliveries?task_id=${encodeURIComponent(taskId)}`,
      quality_gate: gate,
      governance,
      wiki_url: '/api/wiki',
      deliveries,
      approval_required: false,
      events: result.events,
      resumed: true,
      recovered_from_dead_letter: true,
      dead_letter: updatedDeadLetter,
      evaluation,
      review,
    };
  } catch (error) {
    deadLetterStore.update(deadLetter.dead_letter_id, {
      metadata: {
        last_task_recovery_attempt_at: new Date().toISOString(),
        task_recovery_id: replayId,
        task_recovery_mode: 'resume',
        task_recovery_status: 'failed',
        task_recovery_operator_id: reviewerId,
        task_recovery_notes: notes,
        task_recovery_error: {
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : 'Error',
        },
        task_recovery_dead_letter_id: extractExistingDeadLetter(error)?.dead_letter_id ?? null,
      },
    });

    auditStore.append(taskId, {
      trace_id: task.trace_id ?? taskId,
      kind: 'dead_letter.recovery_failed',
      payload: {
        dead_letter_id: deadLetter.dead_letter_id,
        replay_id: replayId,
        error: {
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : 'Error',
        },
        next_dead_letter_id: extractExistingDeadLetter(error)?.dead_letter_id ?? null,
      },
    });

    throw error;
  }
}

const worker = createAsyncWorker({
  bus: eventBus,
  queueStore: workerQueueStore,
  workerId: 'platform-worker',
  onDeadLetter: ({ job, payload, error }) => recordWorkerJobDeadLetter(job, error, { payload }),
});
const platformAdapterRegistry = createPlatformAdapterRegistry();
const deliveryService = createPlatformDeliveryService({
  registry: platformAdapterRegistry,
  deliveryStore,
  worker,
  eventBus,
  auditStore,
  taskStore,
});
registerDefaultTools(toolRegistry, { wikiStore });

worker.register('tool.invoke', async ({ request }) => toolRegistry.invoke(request));
worker.register('response.compose', async ({ persona, message, plan, retrievalResult, memorySnapshot }) => {
  const result = await responseComposer.compose({ persona, message, plan, retrievalResult, memorySnapshot });
  return {
    ...result,
    summary: 'Response composed',
  };
});

eventBus.subscribeAll((event) => {
  if (event.task_id) {
    auditStore.append(event.task_id, {
      trace_id: event.trace_id ?? event.task_id,
      kind: event.topic,
      payload: event,
    });
  }
});

function contentType(pathname) {
  switch (extname(pathname)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
  }
  return body ? JSON.parse(body) : {};
}

function sendJson(response, statusCode, payload, { headOnly = false, downloadName = null } = {}) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(downloadName ? { 'content-disposition': `attachment; filename="${downloadName}"` } : {}),
  });
  response.end(headOnly ? undefined : JSON.stringify(payload, null, 2));
}

function sanitizeDownloadStem(value) {
  return String(value ?? 'task')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'task';
}

function buildDownloadName(prefix, taskId) {
  return `${prefix}-${sanitizeDownloadStem(taskId)}.json`;
}

function buildMemoryDraftArtifactPath(taskId, {
  caseId = null,
  timestamp = new Date().toISOString(),
} = {}) {
  const day = String(timestamp).slice(0, 10) || 'draft';
  const taskStem = sanitizeDownloadStem(taskId);
  const caseStem = caseId ? `-${sanitizeDownloadStem(caseId)}` : '';
  return resolve(
    fileURLToPath(new URL('../../', import.meta.url)),
    `data/evals/memory/drafts/${day}/${taskStem}${caseStem}.json`,
  );
}

function buildWikiDraftArtifactPath(taskId, {
  caseId = null,
  timestamp = new Date().toISOString(),
} = {}) {
  const day = String(timestamp).slice(0, 10) || 'draft';
  const taskStem = sanitizeDownloadStem(taskId);
  const caseStem = caseId ? `-${sanitizeDownloadStem(caseId)}` : '';
  return resolve(
    fileURLToPath(new URL('../../', import.meta.url)),
    `data/evals/wiki/drafts/${day}/${taskStem}${caseStem}.json`,
  );
}

function buildWikiCandidateSuitePath({
  suiteName = 'wiki-benchmark-candidate',
  date = new Date().toISOString().slice(0, 10),
} = {}) {
  return resolve(
    getRepoRoot(),
    `data/evals/wiki/candidate_suites/${date}/${sanitizeDownloadStem(suiteName)}.json`,
  );
}

function getRepoRoot() {
  return fileURLToPath(new URL('../../', import.meta.url));
}

function buildMemoryCandidateSuitePath({
  suiteName = 'memory-benchmark-candidate',
  date = new Date().toISOString().slice(0, 10),
} = {}) {
  return resolve(
    getRepoRoot(),
    `data/evals/memory/candidate_suites/${date}/${sanitizeDownloadStem(suiteName)}.json`,
  );
}

function getMemoryCandidateSuiteRoot(rootPath = null) {
  if (rootPath) {
    return resolve(getRepoRoot(), rootPath);
  }
  return resolve(getRepoRoot(), 'data/evals/memory/candidate_suites');
}

function getWikiCandidateSuiteRoot(rootPath = null) {
  if (rootPath) {
    return resolve(getRepoRoot(), rootPath);
  }
  return resolve(getRepoRoot(), 'data/evals/wiki/candidate_suites');
}

function getMemoryGoldSuitePath() {
  return resolve(getRepoRoot(), 'config/memory-benchmark-cases.json');
}

function getMemoryGoldHistoryPath() {
  return resolve(getRepoRoot(), 'data/evals/memory/gold_history.json');
}

async function importWikiMarkdown({
  markdown = null,
  filePath = null,
  mode = 'proposal',
  entryId = null,
  baseVersion = null,
  sourceTraceId = null,
  metadata = {},
} = {}) {
  const resolvedMarkdown = typeof markdown === 'string' && markdown.trim()
    ? markdown
    : (filePath ? await readFile(resolve(getRepoRoot(), filePath), 'utf8') : null);

  if (!resolvedMarkdown) {
    throw new Error('markdown or file_path is required');
  }

  const payload = buildWikiImportPayloadFromMarkdown(resolvedMarkdown, {
    filePath,
    entryId,
    sourceTraceId,
    baseVersion,
    metadata,
  });

  if (mode === 'upsert') {
    const entry = wikiStore.upsert(payload);
    auditStore.append(entry.entry_id, {
      trace_id: sourceTraceId ?? entry.source_trace_id ?? entry.entry_id,
      kind: 'wiki.markdown_imported',
      payload: {
        mode,
        file_path: filePath,
        entry,
      },
    });
    return {
      mode,
      entry,
      proposal: null,
      imported_from: filePath ?? 'inline_markdown',
    };
  }

  if (mode === 'proposal') {
    const proposal = wikiStore.createProposal(payload);
    auditStore.append(proposal.entry_id, {
      trace_id: sourceTraceId ?? proposal.source_trace_id ?? proposal.entry_id,
      kind: 'wiki.markdown_imported',
      payload: {
        mode,
        file_path: filePath,
        proposal,
      },
    });
    return {
      mode,
      proposal,
      entry: null,
      imported_from: filePath ?? 'inline_markdown',
    };
  }

  throw new Error('mode must be proposal or upsert');
}

async function importWikiMarkdownBatch({
  directoryPath = null,
  filePaths = [],
  mode = 'proposal',
  sourceTraceId = null,
  metadata = {},
} = {}) {
  const collectedPaths = [];

  if (directoryPath) {
    const resolvedDirectoryPath = resolve(getRepoRoot(), directoryPath);
    const entries = await readdir(resolvedDirectoryPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) {
        continue;
      }
      collectedPaths.push(resolve(resolvedDirectoryPath, entry.name).replace(`${getRepoRoot()}/`, ''));
    }
  }

  for (const filePath of filePaths) {
    if (typeof filePath === 'string' && filePath.trim()) {
      collectedPaths.push(filePath.trim());
    }
  }

  const uniqueFilePaths = Array.from(new Set(collectedPaths));
  if (uniqueFilePaths.length === 0) {
    throw new Error('directory_path or file_paths with at least one markdown file is required');
  }

  const items = [];
  for (const filePath of uniqueFilePaths) {
    items.push(await importWikiMarkdown({
      filePath,
      mode,
      sourceTraceId,
      metadata: {
        ...metadata,
        wiki_batch_import: true,
        wiki_batch_directory: directoryPath,
      },
    }));
  }

  return {
    mode,
    directory_path: directoryPath,
    file_count: uniqueFilePaths.length,
    file_paths: uniqueFilePaths,
    items,
  };
}

async function loadJsonDocument(filePath, fallback = {}) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return cloneJson(fallback);
    }
    throw error;
  }
}

function cloneJson(value) {
  return structuredClone(value);
}

async function appendMemoryGoldHistoryRecord(record, historyPath = null) {
  const resolvedPath = historyPath ? resolve(getRepoRoot(), historyPath) : getMemoryGoldHistoryPath();
  const history = await loadJsonDocument(resolvedPath, { events: [] });
  const events = Array.isArray(history.events) ? history.events : [];
  events.push(record);
  const next = {
    events,
    updated_at: record.recorded_at ?? new Date().toISOString(),
  };
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return {
    history: next,
    file_path: resolvedPath,
    relative_path: resolvedPath.replace(`${getRepoRoot()}/`, ''),
  };
}

function buildMemoryUrl(taskId, {
  workspaceId = null,
  personaId = null,
} = {}) {
  const params = new URLSearchParams({
    task_id: taskId,
  });

  if (workspaceId) {
    params.set('workspace_id', workspaceId);
  }

  if (personaId) {
    params.set('persona_id', personaId);
  }

  return `/api/memory?${params.toString()}`;
}

export function formatSseEvent(event) {
  return `id: ${event.event_id}\n` +
    `event: ${event.event_type}\n` +
    `data: ${JSON.stringify(event)}\n\n`;
}

function sendSseEvent(response, event) {
  response.write(formatSseEvent(event));
}

function createExecutionStore(store) {
  if (!store || store === streamStore) {
    return streamStore;
  }

  return {
    append(taskId, event) {
      const stored = store.append(taskId, event);
      streamStore.append(taskId, stored);
      return stored;
    },
  };
}

function serveFile(response, filePath, { headOnly = false } = {}) {
  readFile(filePath)
    .then((body) => {
      response.writeHead(200, {
        'content-type': contentType(filePath),
        'cache-control': 'no-store',
      });
      response.end(headOnly ? undefined : body);
    })
    .catch(() => {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
    });
}

export async function processInboundMessage(input, store = streamStore) {
  const executionStore = createExecutionStore(store);
  const message = secretManager.sanitizeMessage(createCanonicalMessage(input));
  const persona = personaRegistry.get(message.persona_hint);
  const userText = message.content.find((part) => part.type === 'text')?.text ?? '';
  const taskSummary = {
    message_id: message.message_id,
    source_platform: message.source_platform,
    workspace_id: message.workspace_id,
    channel_id: message.channel_id,
    conversation_id: message.conversation_id,
    persona_hint: message.persona_hint,
    content_preview: message.content.find((part) => part.type === 'text')?.text ?? '',
  };
  memoryStore.appendShortTerm(message.trace_id, {
    trace_id: message.trace_id,
    role: 'user',
    phase: 'received',
    title: 'Inbound message',
    summary: summarizeTaskText(userText),
    content: userText,
    tags: ['message', 'inbound'],
    source: 'message',
    source_trace_id: message.trace_id,
    source_task_id: message.trace_id,
    workspace_id: message.workspace_id,
    persona_id: persona.persona_id,
    metadata: {
      source_platform: message.source_platform,
      channel_id: message.channel_id,
      workspace_id: message.workspace_id,
      persona_id: persona.persona_id,
    },
  });
  auditStore.append(message.trace_id, {
    trace_id: message.trace_id,
    kind: 'message.received',
    payload: {
      message_id: message.message_id,
      source_platform: message.source_platform,
      workspace_id: message.workspace_id,
      channel_id: message.channel_id,
      conversation_id: message.conversation_id,
      memory_provider: {
        requested_provider: memoryProviderStrategy.requested_provider,
        effective_provider: memoryProviderStrategy.effective_provider,
        fallback_applied: memoryProviderStrategy.fallback_applied,
        fallback_reason: memoryProviderStrategy.fallback_reason,
      },
    },
  });
  taskStore.upsert(message.trace_id, {
    trace_id: message.trace_id,
    status: 'received',
    phase: 'received',
    persona_id: persona.persona_id,
    message: taskSummary,
    message_snapshot: message,
    metadata: {
      source_platform: message.source_platform,
      workspace_id: message.workspace_id,
      channel_id: message.channel_id,
      conversation_id: message.conversation_id,
      memory_requested_provider: memoryProviderStrategy.requested_provider,
      memory_effective_provider: memoryProviderStrategy.effective_provider,
      memory_fallback_applied: memoryProviderStrategy.fallback_applied,
      memory_fallback_reason: memoryProviderStrategy.fallback_reason,
    },
    checkpoint: {
      kind: 'message.received',
      summary: 'Inbound message accepted',
    },
  });
  auditStore.append(message.trace_id, {
    trace_id: message.trace_id,
    kind: 'message.normalized',
    payload: {
      persona_hint: message.persona_hint,
      content_types: message.content.map((part) => part.type),
    },
  });
  memoryStore.appendShortTerm(message.trace_id, {
    trace_id: message.trace_id,
    role: 'system',
    phase: 'normalized',
    title: 'Normalized message',
    summary: `Persona hint: ${message.persona_hint ?? 'none'}`,
    content: `Canonical message contains ${message.content.length} parts`,
    tags: ['message', 'normalized'],
    source: 'normalization',
    source_trace_id: message.trace_id,
    source_task_id: message.trace_id,
    workspace_id: message.workspace_id,
    persona_id: persona.persona_id,
    metadata: {
      workspace_id: message.workspace_id,
      persona_id: persona.persona_id,
    },
  });
  taskStore.upsert(message.trace_id, {
    phase: 'normalized',
    checkpoint: {
      kind: 'message.normalized',
      summary: 'Canonical message normalized',
    },
  });
  const plan = planner.createPlan({ message, persona });
  auditStore.append(message.trace_id, {
    trace_id: message.trace_id,
    kind: 'plan.created',
    payload: {
      plan_id: plan.plan_id,
      persona_id: persona.persona_id,
      step_count: plan.steps.length,
      step_titles: plan.steps.map((step) => step.title),
    },
  });
  memoryStore.appendShortTerm(message.trace_id, {
    trace_id: message.trace_id,
    role: 'system',
    phase: 'planning',
    title: 'Plan created',
    summary: plan.summary,
    content: plan.goal,
    facts: [
      `plan_id=${plan.plan_id}`,
      `steps=${plan.steps.length}`,
    ],
    tags: ['plan', 'planning'],
    source: 'planning',
    source_trace_id: message.trace_id,
    source_task_id: message.trace_id,
    workspace_id: message.workspace_id,
    persona_id: persona.persona_id,
    metadata: {
      workspace_id: message.workspace_id,
      persona_id: persona.persona_id,
    },
  });
  taskStore.upsert(message.trace_id, {
    status: 'planning',
    phase: 'planning',
    plan_id: plan.plan_id,
    total_steps: plan.steps.length,
    metadata: {
      model_routing: modelRouter.getPolicy(),
    },
    plan: {
      plan_id: plan.plan_id,
      goal: plan.goal,
      summary: plan.summary,
      step_count: plan.steps.length,
      steps: plan.steps,
    },
    checkpoint: {
      kind: 'plan.created',
      summary: 'Plan created',
    },
  });
  const contextSnapshotBundle = createContextSnapshot(message.trace_id, {
    traceId: message.trace_id,
    scope: 'task',
    modelName: deepseekClient.model,
    tokenBudget: 12000,
    query: userText,
  });
  const delegatedHandoffs = delegateTaskWork(message.trace_id, {
    plan,
    messageText: userText,
    inputSummary: summarizeTaskText(userText),
  });
  taskStore.upsert(message.trace_id, {
    metadata: {
      context_snapshot_id: contextSnapshotBundle.snapshot.snapshot_id,
      context_token_estimate: contextSnapshotBundle.snapshot.token_estimate,
      context_token_budget: contextSnapshotBundle.snapshot.token_budget,
      context_over_budget: contextSnapshotBundle.over_budget,
      multi_agent_suggestion_count: delegatedHandoffs.length,
    },
    checkpoint: {
      kind: 'context.snapshot.created',
      summary: contextSnapshotBundle.recommended_action === 'compress'
        ? 'Context compression snapshot created'
        : 'Context budget snapshot created',
      metadata: {
        snapshot_id: contextSnapshotBundle.snapshot.snapshot_id,
        token_estimate: contextSnapshotBundle.snapshot.token_estimate,
      },
    },
  });
  auditStore.append(message.trace_id, {
    trace_id: message.trace_id,
    kind: 'context.snapshot.created',
    payload: contextSnapshotBundle.snapshot,
  });
  if (delegatedHandoffs.length > 0) {
    auditStore.append(message.trace_id, {
      trace_id: message.trace_id,
      kind: 'handoff.suggested',
      payload: {
        task_id: message.trace_id,
        handoffs: delegatedHandoffs,
      },
    });
  }
  let runResult;
  try {
    runResult = await runAgentTask({
      message,
      persona,
      plan,
      toolRegistry,
      store: executionStore,
      responseComposer,
      worker,
      eventBus,
      memoryStore,
      onTaskUpdate: createTaskUpdateHandler({ message, persona, plan }),
      orchestratorMode: platformConfig.routing.orchestrator ?? 'legacy',
    });
  } catch (error) {
    const deadLetter = extractExistingDeadLetter(error) ?? recordTaskDeadLetter(message.trace_id, {
      reason: 'task_execution_failed',
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
      payload: {
        message,
        persona_id: persona.persona_id,
        plan_id: plan.plan_id,
      },
    });

    return {
      message,
      persona,
      plan,
      task_id: message.trace_id,
      dead_letter: deadLetter,
      stream_url: `/api/stream?task_id=${encodeURIComponent(message.trace_id)}`,
      audit_url: `/api/traces?task_id=${encodeURIComponent(message.trace_id)}`,
      trace_bundle_url: `/api/traces/bundle?task_id=${encodeURIComponent(message.trace_id)}`,
      task_url: `/api/tasks?task_id=${encodeURIComponent(message.trace_id)}`,
      memory_url: buildMemoryUrl(message.trace_id, {
        workspaceId: message.workspace_id,
        personaId: persona.persona_id,
      }),
      evaluation_url: `/api/evaluations?task_id=${encodeURIComponent(message.trace_id)}`,
      review_url: `/api/reviews?task_id=${encodeURIComponent(message.trace_id)}`,
      alerts_url: `/api/alerts?task_id=${encodeURIComponent(message.trace_id)}`,
      governance_url: `/api/governance?task_id=${encodeURIComponent(message.trace_id)}`,
      quality_gate: null,
      governance: getGovernanceSnapshot(message.trace_id),
      wiki_url: '/api/wiki',
      events: [],
      run_state: taskStore.get(message.trace_id).run_state,
      dead_letter_url: `/api/dead-letters?task_id=${encodeURIComponent(message.trace_id)}`,
      recovery_url: `/api/tasks/recover?task_id=${encodeURIComponent(message.trace_id)}`,
      replay_url: `/api/replay?task_id=${encodeURIComponent(message.trace_id)}`,
    };
  }
  const { runState, events } = runResult;
  if (runState.status === 'waiting_approval') {
    const pausedStep = plan.steps.find((step) => step.step_id === runState.current_step_id) ?? null;
    const approvalReview = createApprovalReview({
      message,
      persona,
      plan,
      runState,
      pausedStep,
    });

    return {
      message,
      persona,
      plan,
      run_state: runState,
      task_id: message.trace_id,
      stream_url: `/api/stream?task_id=${encodeURIComponent(message.trace_id)}`,
      audit_url: `/api/traces?task_id=${encodeURIComponent(message.trace_id)}`,
      trace_bundle_url: `/api/traces/bundle?task_id=${encodeURIComponent(message.trace_id)}`,
      task_url: `/api/tasks?task_id=${encodeURIComponent(message.trace_id)}`,
      memory_url: buildMemoryUrl(message.trace_id, {
        workspaceId: message.workspace_id,
        personaId: persona.persona_id,
      }),
      evaluation_url: `/api/evaluations?task_id=${encodeURIComponent(message.trace_id)}`,
      review_url: `/api/reviews?task_id=${encodeURIComponent(message.trace_id)}`,
      approval_url: `/api/approvals?task_id=${encodeURIComponent(message.trace_id)}`,
      alerts_url: `/api/alerts?task_id=${encodeURIComponent(message.trace_id)}`,
      governance_url: `/api/governance?task_id=${encodeURIComponent(message.trace_id)}`,
      approval_required: true,
      approval_review: approvalReview,
      resume_url: `/api/tasks/resume?task_id=${encodeURIComponent(message.trace_id)}`,
      quality_gate: null,
      wiki_url: '/api/wiki',
      events,
    };
  }

  const { evaluation, gate, review, governance, deliveries } = await finalizeSuccessfulRun({
    message,
    persona,
    plan,
    runState,
  });

  return {
    message,
    persona,
    plan,
    run_state: runState,
    task_id: message.trace_id,
    stream_url: `/api/stream?task_id=${encodeURIComponent(message.trace_id)}`,
    audit_url: `/api/traces?task_id=${encodeURIComponent(message.trace_id)}`,
    trace_bundle_url: `/api/traces/bundle?task_id=${encodeURIComponent(message.trace_id)}`,
    task_url: `/api/tasks?task_id=${encodeURIComponent(message.trace_id)}`,
    memory_url: buildMemoryUrl(message.trace_id, {
      workspaceId: message.workspace_id,
      personaId: persona.persona_id,
    }),
    evaluation_url: `/api/evaluations?task_id=${encodeURIComponent(message.trace_id)}`,
    review_url: `/api/reviews?task_id=${encodeURIComponent(message.trace_id)}`,
    alerts_url: `/api/alerts?task_id=${encodeURIComponent(message.trace_id)}`,
    governance_url: `/api/governance?task_id=${encodeURIComponent(message.trace_id)}`,
    deliveries_url: `/api/deliveries?task_id=${encodeURIComponent(message.trace_id)}`,
    quality_gate: gate,
    governance,
    wiki_url: '/api/wiki',
    deliveries,
    events,
  };
}

export function getTraceEntries(taskId) {
  return auditStore.list(taskId);
}

export function getTraceBundle(taskId) {
  return traceCollector.collect(taskId);
}

export function getMemoryHarnessDraft(taskId, {
  queryText = null,
  recallTopK = 3,
} = {}) {
  const bundle = getTraceBundle(taskId);
  if (!bundle?.exists) {
    throw new Error(`Unknown task: ${taskId}`);
  }

  const searchSeed = queryText
    ?? (
      Array.isArray(bundle?.task?.message_snapshot?.content)
        ? bundle.task.message_snapshot.content
          .filter((item) => item?.type === 'text' && item?.text)
          .map((item) => item.text)
          .join(' ')
        : ''
    )
    ?? '';
  const normalizedSeed = String(searchSeed ?? '').trim();
  const searchResults = normalizedSeed
    ? memoryStore.searchLongTerm(normalizedSeed, {
      limit: Math.max(1, recallTopK),
      workspaceId: bundle?.memory?.workspace_id ?? null,
      personaId: bundle?.memory?.persona_id ?? null,
      excludeStale: false,
    })
    : [];

  return buildMemoryHarnessDraftFromTraceBundle(bundle, {
    queryText: normalizedSeed,
    searchResults,
    recallTopK,
  });
}

export function getWikiHarnessDraft(taskId, {
  queryText = null,
} = {}) {
  const bundle = getTraceBundle(taskId);
  if (!bundle?.exists) {
    throw new Error(`Unknown task: ${taskId}`);
  }

  return buildWikiHarnessDraftFromTraceBundle(bundle, {
    queryText,
  });
}

export async function saveMemoryHarnessDraftArtifact(taskId, {
  caseId = null,
  queryText = null,
  recallTopK = 3,
  outputPath = null,
} = {}) {
  const draft = getMemoryHarnessDraft(taskId, {
    queryText,
    recallTopK,
  });
  const artifact = createMemoryHarnessDraftArtifact(draft, { caseId });
  const filePath = outputPath
    ? resolve(getRepoRoot(), outputPath)
    : buildMemoryDraftArtifactPath(taskId, { caseId, timestamp: artifact.saved_at });

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  return {
    artifact,
    file_path: filePath,
    relative_path: filePath.replace(`${getRepoRoot()}/`, ''),
  };
}

export async function saveWikiHarnessDraftArtifact(taskId, {
  caseId = null,
  queryText = null,
  outputPath = null,
} = {}) {
  const draft = getWikiHarnessDraft(taskId, { queryText });
  const artifact = createWikiHarnessDraftArtifact(draft, { caseId });
  const filePath = outputPath
    ? resolve(getRepoRoot(), outputPath)
    : buildWikiDraftArtifactPath(taskId, { caseId, timestamp: artifact.saved_at });

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  return {
    artifact,
    file_path: filePath,
    relative_path: filePath.replace(`${getRepoRoot()}/`, ''),
  };
}

export async function promoteWikiHarnessDraftArtifactToSuite(taskId, {
  caseId = null,
  queryText = null,
  suitePath = null,
  suiteName = 'wiki-benchmark-candidate',
} = {}) {
  const draft = getWikiHarnessDraft(taskId, { queryText });
  const artifact = createWikiHarnessDraftArtifact(draft, { caseId });
  const filePath = suitePath
    ? resolve(getRepoRoot(), suitePath)
    : buildWikiCandidateSuitePath({ suiteName });

  let existingDocument = { cases: [] };
  try {
    const text = await readFile(filePath, 'utf8');
    existingDocument = JSON.parse(text);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  const merged = mergeWikiHarnessDraftArtifactIntoSuite(existingDocument, artifact, {
    suiteId: suiteName,
  });
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(merged.document, null, 2)}\n`, 'utf8');

  return {
    suite: merged.document,
    summary: merged.summary,
    governance_summary: summarizeWikiCandidateSuiteGovernance(merged.document),
    file_path: filePath,
    relative_path: filePath.replace(`${getRepoRoot()}/`, ''),
  };
}

export async function promoteMemoryHarnessDraftArtifactToSuite(taskId, {
  caseId = null,
  queryText = null,
  recallTopK = 3,
  suitePath = null,
  suiteName = 'memory-benchmark-candidate',
} = {}) {
  const draft = getMemoryHarnessDraft(taskId, {
    queryText,
    recallTopK,
  });
  const artifact = createMemoryHarnessDraftArtifact(draft, { caseId });
  const filePath = suitePath
    ? resolve(getRepoRoot(), suitePath)
    : buildMemoryCandidateSuitePath({ suiteName });

  let existingDocument = { cases: [] };
  try {
    const text = await readFile(filePath, 'utf8');
    existingDocument = JSON.parse(text);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  const merged = mergeMemoryHarnessDraftArtifactIntoSuite(existingDocument, artifact, {
    suiteId: suiteName,
  });
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(merged.document, null, 2)}\n`, 'utf8');

  return {
    suite: merged.document,
    summary: merged.summary,
    file_path: filePath,
    relative_path: filePath.replace(`${getRepoRoot()}/`, ''),
  };
}

export function listMemoryCandidateSuites({ rootPath = null } = {}) {
  const root = getMemoryCandidateSuiteRoot(rootPath);
  if (!existsSync(root)) {
    return [];
  }

  const suites = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      try {
        const payload = JSON.parse(readFileSync(fullPath, 'utf8'));
        suites.push({
          suite_id: payload.suite_id ?? entry.name.replace(/\.json$/, ''),
          updated_at: payload.updated_at ?? null,
          case_count: Array.isArray(payload.cases) ? payload.cases.length : 0,
          metadata: payload.metadata ?? {},
          file_path: fullPath,
          relative_path: fullPath.replace(`${getRepoRoot()}/`, ''),
        });
      } catch {
        suites.push({
          suite_id: entry.name.replace(/\.json$/, ''),
          updated_at: null,
          case_count: 0,
          metadata: { parse_error: true },
          file_path: fullPath,
          relative_path: fullPath.replace(`${getRepoRoot()}/`, ''),
        });
      }
    }
  }

  return suites.sort((left, right) => String(right.updated_at ?? '').localeCompare(String(left.updated_at ?? '')));
}

export function listWikiCandidateSuites({ rootPath = null } = {}) {
  const root = getWikiCandidateSuiteRoot(rootPath);
  if (!existsSync(root)) {
    return [];
  }

  const suites = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      try {
        const payload = JSON.parse(readFileSync(fullPath, 'utf8'));
        suites.push({
          suite_id: payload.suite_id ?? entry.name.replace(/\.json$/, ''),
          updated_at: payload.updated_at ?? null,
          case_count: Array.isArray(payload.cases) ? payload.cases.length : 0,
          metadata: payload.metadata ?? {},
          governance_summary: summarizeWikiCandidateSuiteGovernance(payload),
          file_path: fullPath,
          relative_path: fullPath.replace(`${getRepoRoot()}/`, ''),
        });
      } catch {
        suites.push({
          suite_id: entry.name.replace(/\.json$/, ''),
          updated_at: null,
          case_count: 0,
          metadata: { parse_error: true },
          file_path: fullPath,
          relative_path: fullPath.replace(`${getRepoRoot()}/`, ''),
        });
      }
    }
  }

  return suites.sort((left, right) => String(right.updated_at ?? '').localeCompare(String(left.updated_at ?? '')));
}

export async function getMemoryCandidateSuite(relativePath) {
  if (!relativePath) {
    throw new Error('suite_path is required');
  }
  const filePath = resolve(getRepoRoot(), relativePath);
  const payload = JSON.parse(await readFile(filePath, 'utf8'));
  return {
    ...payload,
    file_path: filePath,
    relative_path: filePath.replace(`${getRepoRoot()}/`, ''),
  };
}

export async function getWikiCandidateSuite(relativePath) {
  if (!relativePath) {
    throw new Error('suite_path is required');
  }
  const filePath = resolve(getRepoRoot(), relativePath);
  const payload = JSON.parse(await readFile(filePath, 'utf8'));
  return {
    ...payload,
    governance_summary: summarizeWikiCandidateSuiteGovernance(payload),
    file_path: filePath,
    relative_path: filePath.replace(`${getRepoRoot()}/`, ''),
  };
}

export async function reviewWikiCandidateSuiteCase(relativePath, {
  caseId,
  decision,
  reviewerId = 'reviewer',
  notes = null,
} = {}) {
  const filePath = resolve(getRepoRoot(), relativePath);
  const current = JSON.parse(await readFile(filePath, 'utf8'));
  const reviewed = applyWikiCandidateCaseReview(current, {
    caseId,
    decision,
    reviewerId,
    notes,
  });
  await writeFile(filePath, `${JSON.stringify(reviewed, null, 2)}\n`, 'utf8');
  return {
    suite: reviewed,
    governance_summary: summarizeWikiCandidateSuiteGovernance(reviewed),
    file_path: filePath,
    relative_path: filePath.replace(`${getRepoRoot()}/`, ''),
  };
}

export async function reviewWikiCandidateSuiteCases(relativePath, {
  caseIds,
  decision,
  reviewerId = 'reviewer',
  notes = null,
} = {}) {
  const filePath = resolve(getRepoRoot(), relativePath);
  const current = JSON.parse(await readFile(filePath, 'utf8'));
  const reviewed = applyWikiCandidateBatchReview(current, {
    caseIds,
    decision,
    reviewerId,
    notes,
  });
  await writeFile(filePath, `${JSON.stringify(reviewed.document, null, 2)}\n`, 'utf8');
  return {
    suite: reviewed.document,
    summary: reviewed.summary,
    governance_summary: summarizeWikiCandidateSuiteGovernance(reviewed.document),
    file_path: filePath,
    relative_path: filePath.replace(`${getRepoRoot()}/`, ''),
  };
}

export async function compareWikiCandidateSuiteWithObservedRun(relativePath, {
  caseId = null,
  caseIds = null,
  runId = null,
} = {}) {
  const candidatePath = resolve(getRepoRoot(), relativePath);
  const candidateSuite = JSON.parse(await readFile(candidatePath, 'utf8'));
  const observedRun = resolveLatestWikiCandidateRun({
    suitePath: candidatePath.replace(`${getRepoRoot()}/`, ''),
    runId,
  });
  if (!observedRun) {
    throw new Error('No observed wiki candidate run found for this suite');
  }

  const filteredSuite = Array.isArray(caseIds) && caseIds.length > 0
    ? {
      ...candidateSuite,
      cases: (candidateSuite.cases ?? []).filter((item) => caseIds.includes(item.case_id)),
    }
    : candidateSuite;

  const comparison = caseId
    ? compareWikiCandidateCaseAgainstObservedRun(filteredSuite, observedRun, { caseId })
    : compareWikiCandidateSuiteAgainstObservedRun(filteredSuite, observedRun);

  return {
    comparison,
    candidate_suite_path: candidatePath,
    candidate_suite_relative_path: candidatePath.replace(`${getRepoRoot()}/`, ''),
    observed_run_id: observedRun.run_id,
    observed_run_metadata: observedRun.metadata ?? {},
  };
}

export async function reviewMemoryCandidateSuiteCase(relativePath, {
  caseId,
  decision,
  reviewerId = 'reviewer',
  notes = null,
} = {}) {
  const filePath = resolve(getRepoRoot(), relativePath);
  const current = JSON.parse(await readFile(filePath, 'utf8'));
  const reviewed = applyMemoryCandidateCaseReview(current, {
    caseId,
    decision,
    reviewerId,
    notes,
  });
  await writeFile(filePath, `${JSON.stringify(reviewed, null, 2)}\n`, 'utf8');
  return {
    suite: reviewed,
    file_path: filePath,
    relative_path: filePath.replace(`${getRepoRoot()}/`, ''),
  };
}

export async function reviewMemoryCandidateSuiteCases(relativePath, {
  caseIds,
  decision,
  reviewerId = 'reviewer',
  notes = null,
} = {}) {
  const filePath = resolve(getRepoRoot(), relativePath);
  const current = JSON.parse(await readFile(filePath, 'utf8'));
  const reviewed = applyMemoryCandidateBatchReview(current, {
    caseIds,
    decision,
    reviewerId,
    notes,
  });
  await writeFile(filePath, `${JSON.stringify(reviewed.document, null, 2)}\n`, 'utf8');
  return {
    suite: reviewed.document,
    summary: reviewed.summary,
    file_path: filePath,
    relative_path: filePath.replace(`${getRepoRoot()}/`, ''),
  };
}

export async function compareMemoryCandidateSuiteWithGold(relativePath, {
  caseId = null,
  caseIds = null,
  goldPath = null,
} = {}) {
  const candidatePath = resolve(getRepoRoot(), relativePath);
  const candidateSuite = JSON.parse(await readFile(candidatePath, 'utf8'));
  const resolvedGoldPath = goldPath ? resolve(getRepoRoot(), goldPath) : getMemoryGoldSuitePath();
  const goldDocument = await loadJsonDocument(resolvedGoldPath, { cases: [] });

  const filteredSuite = Array.isArray(caseIds) && caseIds.length > 0
    ? {
      ...candidateSuite,
      cases: (candidateSuite.cases ?? []).filter((item) => caseIds.includes(item.case_id)),
    }
    : candidateSuite;

  const comparison = caseId
    ? compareMemoryCandidateCaseAgainstGold(filteredSuite, goldDocument, { caseId })
    : compareMemoryCandidateSuiteAgainstGold(filteredSuite, goldDocument);

  return {
    comparison,
    candidate_suite_path: candidatePath,
    candidate_suite_relative_path: candidatePath.replace(`${getRepoRoot()}/`, ''),
    gold_path: resolvedGoldPath,
    gold_relative_path: resolvedGoldPath.replace(`${getRepoRoot()}/`, ''),
  };
}

export async function promoteApprovedMemoryCandidateCaseToGold(relativePath, {
  caseId,
  goldPath = null,
  historyPath = null,
} = {}) {
  const candidatePath = resolve(getRepoRoot(), relativePath);
  const candidateSuite = JSON.parse(await readFile(candidatePath, 'utf8'));

  const resolvedGoldPath = goldPath ? resolve(getRepoRoot(), goldPath) : getMemoryGoldSuitePath();
  const goldDocument = await loadJsonDocument(resolvedGoldPath, { cases: [] });
  const previousGoldCase = Array.isArray(goldDocument?.cases)
    ? goldDocument.cases.find((item) => item?.case_id === caseId) ?? null
    : null;
  const candidateCase = Array.isArray(candidateSuite?.cases)
    ? candidateSuite.cases.find((item) => item?.case_id === caseId) ?? null
    : null;
  const promotionId = `memory_gold_${sanitizeDownloadStem(caseId)}_${Date.now()}`;
  const promotedAt = new Date().toISOString();
  const promotionRecord = {
    promotion_id: promotionId,
    case_id: caseId,
    promoted_at: promotedAt,
    candidate_suite_id: candidateSuite.suite_id ?? null,
    candidate_suite_path: candidatePath.replace(`${getRepoRoot()}/`, ''),
    gold_relative_path: resolvedGoldPath.replace(`${getRepoRoot()}/`, ''),
    reviewer_id: candidateCase?.metadata?.reviewer_id ?? null,
    review_status: candidateCase?.metadata?.review_status ?? null,
  };

  const merged = mergeApprovedMemoryCandidateIntoGold(goldDocument, candidateSuite, {
    caseId,
    promotedAt,
    promotionRecord,
  });
  await mkdir(dirname(resolvedGoldPath), { recursive: true });
  await writeFile(resolvedGoldPath, `${JSON.stringify(merged.document, null, 2)}\n`, 'utf8');
  const historyRecord = {
    event_type: 'promote_gold',
    promotion_id: promotionId,
    case_id: caseId,
    candidate_suite_id: candidateSuite.suite_id ?? null,
    candidate_suite_path: candidatePath.replace(`${getRepoRoot()}/`, ''),
    gold_relative_path: resolvedGoldPath.replace(`${getRepoRoot()}/`, ''),
    recorded_at: promotedAt,
    reviewer_id: candidateCase?.metadata?.reviewer_id ?? null,
    review_status: candidateCase?.metadata?.review_status ?? null,
    previous_gold_case: cloneJson(previousGoldCase),
    promoted_candidate_case: cloneJson(candidateCase),
  };
  const historyResult = await appendMemoryGoldHistoryRecord(historyRecord, historyPath);
  return {
    gold: merged.document,
    summary: merged.summary,
    file_path: resolvedGoldPath,
    relative_path: resolvedGoldPath.replace(`${getRepoRoot()}/`, ''),
    history_path: historyResult.relative_path,
    promotion_id: promotionId,
  };
}

export async function getMemoryGoldHistory({
  historyPath = null,
  caseId = null,
} = {}) {
  const resolvedHistoryPath = historyPath ? resolve(getRepoRoot(), historyPath) : getMemoryGoldHistoryPath();
  const history = await loadJsonDocument(resolvedHistoryPath, { events: [] });
  const allEvents = Array.isArray(history.events) ? history.events : [];
  const events = caseId ? allEvents.filter((item) => item.case_id === caseId) : allEvents;
  return {
    events,
    file_path: resolvedHistoryPath,
    relative_path: resolvedHistoryPath.replace(`${getRepoRoot()}/`, ''),
  };
}

export async function rollbackMemoryGoldPromotion({
  caseId,
  goldPath = null,
  historyPath = null,
  reviewerId = 'console_reviewer',
  reason = 'rollback',
} = {}) {
  if (!caseId) {
    throw new Error('caseId is required');
  }
  const resolvedGoldPath = goldPath ? resolve(getRepoRoot(), goldPath) : getMemoryGoldSuitePath();
  const resolvedHistoryPath = historyPath ? resolve(getRepoRoot(), historyPath) : getMemoryGoldHistoryPath();
  const history = await loadJsonDocument(resolvedHistoryPath, { events: [] });
  const events = Array.isArray(history.events) ? history.events : [];
  const rolledBackIds = new Set(
    events
      .filter((item) => item?.event_type === 'rollback_gold' && item?.rollback_of_promotion_id)
      .map((item) => item.rollback_of_promotion_id),
  );
  const targetPromotion = [...events].reverse().find((item) => (
    item?.event_type === 'promote_gold'
      && item?.case_id === caseId
      && !rolledBackIds.has(item.promotion_id)
  ));
  if (!targetPromotion) {
    throw new Error(`No active gold promotion found for case: ${caseId}`);
  }

  const goldDocument = await loadJsonDocument(resolvedGoldPath, { cases: [] });
  const baseDocument = Array.isArray(goldDocument)
    ? { cases: cloneJson(goldDocument) }
    : {
      ...cloneJson(goldDocument),
      cases: Array.isArray(goldDocument.cases) ? cloneJson(goldDocument.cases) : [],
    };
  const cases = Array.isArray(baseDocument.cases) ? baseDocument.cases : [];
  const existingIndex = cases.findIndex((item) => item?.case_id === caseId);
  if (targetPromotion.previous_gold_case) {
    if (existingIndex >= 0) {
      cases[existingIndex] = cloneJson(targetPromotion.previous_gold_case);
    } else {
      cases.push(cloneJson(targetPromotion.previous_gold_case));
    }
  } else if (existingIndex >= 0) {
    cases.splice(existingIndex, 1);
  }

  const rolledBackAt = new Date().toISOString();
  const nextDocument = {
    ...baseDocument,
    updated_at: rolledBackAt,
    cases,
  };
  await mkdir(dirname(resolvedGoldPath), { recursive: true });
  await writeFile(resolvedGoldPath, `${JSON.stringify(nextDocument, null, 2)}\n`, 'utf8');
  const historyRecord = {
    event_type: 'rollback_gold',
    case_id: caseId,
    rollback_of_promotion_id: targetPromotion.promotion_id,
    recorded_at: rolledBackAt,
    reviewer_id: reviewerId,
    reason,
    restored_previous_gold_case: cloneJson(targetPromotion.previous_gold_case),
  };
  const historyResult = await appendMemoryGoldHistoryRecord(historyRecord, historyPath);
  return {
    gold: nextDocument,
    summary: {
      case_id: caseId,
      removed_from_gold: !targetPromotion.previous_gold_case,
      restored_previous_gold_case: Boolean(targetPromotion.previous_gold_case),
      rollback_of_promotion_id: targetPromotion.promotion_id,
    },
    file_path: resolvedGoldPath,
    relative_path: resolvedGoldPath.replace(`${getRepoRoot()}/`, ''),
    history_path: historyResult.relative_path,
  };
}

export async function rollbackMemoryGoldPromotions({
  caseIds,
  goldPath = null,
  historyPath = null,
  reviewerId = 'console_reviewer',
  reason = 'batch rollback',
} = {}) {
  if (!Array.isArray(caseIds) || caseIds.length === 0) {
    throw new Error('caseIds are required');
  }

  const results = [];
  for (const caseId of caseIds) {
    try {
      const rolledBack = await rollbackMemoryGoldPromotion({
        caseId,
        goldPath,
        historyPath,
        reviewerId,
        reason,
      });
      results.push({
        case_id: caseId,
        ok: true,
        summary: rolledBack.summary,
      });
    } catch (error) {
      results.push({
        case_id: caseId,
        ok: false,
        error: error instanceof Error ? error.message : 'Batch rollback failed',
      });
    }
  }

  return {
    results,
    summary: {
      requested_case_count: caseIds.length,
      rolled_back_case_count: results.filter((item) => item.ok).length,
      failed_case_count: results.filter((item) => !item.ok).length,
      rolled_back_case_ids: results.filter((item) => item.ok).map((item) => item.case_id),
      failed_case_ids: results.filter((item) => !item.ok).map((item) => item.case_id),
    },
  };
}

export function getTaskSnapshot(taskId) {
  return taskStore.get(taskId);
}

export function getMemorySnapshot(taskId, options = {}) {
  const memory = memoryStore.buildContext({ taskId, ...(options ?? {}) });
  const handoffs = getHandoffSnapshot(taskId);
  const compressions = getCompressionSnapshot(taskId);
  const providerStrategy = memoryStore.describeStrategy();
  const shortTermArchive = memoryStore.shortTermArchiveSnapshot?.(taskId) ?? null;
  const staleLongTermCount = (memory.long_term ?? []).filter((entry) => entry?.stale).length;

  return {
    ...memory,
    runtime_summary: {
      provider_mode: memory.effective_provider ?? memory.provider ?? null,
      provider_switch: `${memory.requested_provider ?? 'n/a'} -> ${memory.effective_provider ?? 'n/a'}`,
      fallback_applied: Boolean(memory.fallback_applied),
      fallback_reason: memory.fallback_reason ?? null,
      short_term_count: memory.counts?.short_term ?? 0,
      long_term_count: memory.counts?.long_term ?? 0,
      stale_long_term_count: staleLongTermCount,
      stale_long_term_rate: (memory.counts?.long_term ?? 0) > 0
        ? Math.round((staleLongTermCount / memory.counts.long_term) * 10000) / 10000
        : 0,
      handoff_count: handoffs.length,
      compression_count: compressions.length,
      latest_handoff_id: handoffs.at(-1)?.handoff_id ?? null,
      latest_context_snapshot_id: compressions.at(-1)?.snapshot_id ?? handoffs.at(-1)?.context_snapshot_id ?? null,
      runtime_persistence: providerStrategy.runtime_persistence ?? null,
      short_term_persistence: providerStrategy.short_term_persistence ?? null,
      short_term_archive_entry_count: shortTermArchive?.entry_count ?? null,
      short_term_archive_updated_at: shortTermArchive?.updated_at ?? null,
      durable_store_entry_count: providerStrategy.durable_store?.entry_count ?? null,
      durable_store_updated_at: providerStrategy.durable_store?.updated_at ?? null,
    },
    linked_artifacts: {
      latest_handoff: handoffs.at(-1) ?? null,
      latest_compression: compressions.at(-1) ?? null,
      short_term_archive: shortTermArchive,
    },
  };
}

export function getWikiSnapshot({
  entryId = null,
  query = null,
  limit = 6,
  includeExpired = false,
  includeArchived = false,
  includeDeleted = false,
} = {}) {
  const providerStrategy = typeof describeWikiStrategy === 'function'
    ? describeWikiStrategy()
    : wikiProviderStrategy;
  const effectiveLimit = Math.max(1, Number(limit) || 6);
  const items = String(query ?? '').trim()
    ? wikiStore.query({
      query: String(query).trim(),
      limit: effectiveLimit,
      includeExpired,
      includeArchived,
      includeDeleted,
    })
    : [];

  return {
    entry: entryId ? wikiStore.get(entryId) : null,
    query: String(query ?? '').trim() || null,
    items,
    entries: wikiStore.list({
      includeExpired,
      includeArchived,
      includeDeleted,
    }),
    proposals: wikiStore.listProposals({ includeResolved: true }),
    history: entryId ? wikiStore.getHistory(entryId) : [],
    provider_strategy: providerStrategy,
    runtime_summary: {
      provider: providerStrategy?.provider ?? null,
      runtime_persistence: providerStrategy?.runtime_persistence ?? null,
      durable_store_entry_count: providerStrategy?.durable_store?.entry_count ?? null,
      durable_store_proposal_count: providerStrategy?.durable_store?.proposal_count ?? null,
      durable_store_updated_at: providerStrategy?.durable_store?.updated_at ?? null,
      cache_enabled: providerStrategy?.cache?.enabled ?? false,
      cache_backend: providerStrategy?.cache?.backend ?? null,
      cache_ttl_seconds: providerStrategy?.cache?.ttl_seconds ?? null,
    },
  };
}

function extractKnowledgeQueryText(task, bundle = null, overrideQuery = null) {
  const override = String(overrideQuery ?? '').trim();
  if (override) {
    return override;
  }

  const messageSnapshot = task?.message_snapshot ?? bundle?.task?.message_snapshot ?? null;
  const textContent = Array.isArray(messageSnapshot?.content)
    ? messageSnapshot.content
      .filter((item) => item?.type === 'text' && item?.text)
      .map((item) => item.text)
      .join(' ')
    : '';
  return String(textContent ?? '').trim();
}

function extractLatestRetrievalResult(task, bundle = null) {
  const stepResults = Array.isArray(task?.run_state?.step_results)
    ? task.run_state.step_results
    : Array.isArray(bundle?.task?.run_state?.step_results)
      ? bundle.task.run_state.step_results
      : [];

  const stepById = new Map((task?.plan?.steps ?? bundle?.task?.plan?.steps ?? []).map((step) => [step.step_id, step]));
  const result = [...stepResults].reverse().find((item) => {
    const step = stepById.get(item?.step_id);
    return Boolean(
      item?.output?.route
      || item?.output?.citations
      || item?.output?.supporting_chunks
      || item?.output?.query_analysis
      || step?.tool_name === 'hybrid_retrieve'
    );
  }) ?? null;

  return result?.output ?? result ?? null;
}

export function getKnowledgeSnapshot(taskId, {
  query = null,
  wikiLimit = 6,
} = {}) {
  const task = taskStore.get(taskId);
  if (!task) {
    throw new Error(`Unknown task: ${taskId}`);
  }

  const traceBundle = getTraceBundle(taskId);
  const resolvedQuery = extractKnowledgeQueryText(task, traceBundle, query);
  const memory = getMemorySnapshot(taskId, {
    query: resolvedQuery,
    workspaceId: task?.message_snapshot?.workspace_id ?? task?.workspace_id ?? null,
    personaId: task?.persona_id ?? null,
    excludeStale: false,
  });
  const retrieval = extractLatestRetrievalResult(task, traceBundle);
  const wikiMatches = resolvedQuery
    ? wikiStore.query({
      query: resolvedQuery,
      limit: Math.max(1, Number(wikiLimit) || 6),
      includeExpired: true,
      includeArchived: true,
      includeDeleted: false,
    })
    : [];
  const response = task?.run_state?.output ?? null;
  const retrievalQuality = retrieval?.quality ?? {};
  const retrievalCitations = Array.isArray(retrieval?.citations) ? retrieval.citations : [];
  const explicitContractCount = retrievalCitations.filter((citation) => citation?.knowledge_contract?.contract_source === 'explicit').length;
  const defaultInjectedContractCount = retrievalCitations.filter((citation) => citation?.knowledge_contract?.contract_source === 'default_injected').length;
  const governanceSummary = {
    filter_policy_mode: retrieval?.filter_policy?.mode ?? null,
    filter_hard_enforce_reason: retrieval?.filter_policy?.hard_enforce_reason ?? null,
    filter_hard_empty: Boolean(retrieval?.filter_policy?.hard_filter_empty),
    contract_coverage_score: retrievalQuality.contract_coverage_score ?? null,
    source_of_truth_conflict_count: retrievalQuality.source_of_truth_conflict_count ?? null,
    recommended_action: retrievalQuality.recommended_action ?? null,
    explicit_contract_count: explicitContractCount,
    default_injected_contract_count: defaultInjectedContractCount,
    citation_count: retrievalCitations.length,
  };
  const governanceRisks = [
    governanceSummary.filter_hard_empty ? 'hard_filter_empty' : null,
    Number(governanceSummary.source_of_truth_conflict_count ?? 0) > 0 ? 'source_of_truth_conflict' : null,
    governanceSummary.contract_coverage_score !== null && Number(governanceSummary.contract_coverage_score) < 1 ? 'partial_contract_coverage' : null,
    governanceSummary.recommended_action && governanceSummary.recommended_action !== 'accept' ? governanceSummary.recommended_action : null,
  ].filter(Boolean);
  const queryFrontend = retrieval?.query_analysis ?? {};
  const queryDecomposition = queryFrontend?.decomposition ?? {};
  const queryRewrites = queryFrontend?.rewrites ?? {};
  const subqueries = Array.isArray(queryDecomposition?.subqueries) ? queryDecomposition.subqueries : [];
  const rewriteVariants = Array.isArray(queryRewrites?.variants) ? queryRewrites.variants : [];
  const queryPreferredSources = Array.from(new Set(subqueries.map((item) => item?.preferred_source).filter(Boolean)));

  const chainStages = [
    {
      stage_id: 'query_frontend',
      title: 'Query Frontend',
      status: queryFrontend?.query_mode ?? 'derived',
      summary: [
        queryFrontend?.query_mode ?? 'lookup',
        queryFrontend?.boundary?.action ?? 'answer',
        `sq:${subqueries.length}`,
        `rw:${rewriteVariants.length}`,
      ].join(' · '),
      data: {
        query: resolvedQuery || null,
        query_mode: queryFrontend?.query_mode ?? null,
        intent_tags: queryFrontend?.intent_tags ?? [],
        decomposition: queryDecomposition,
        rewrites: queryRewrites,
        clarification: queryFrontend?.clarification ?? null,
        boundary: queryFrontend?.boundary ?? null,
        query_frontend_summary: {
          decomposition_strategy: queryDecomposition?.strategy ?? null,
          rewrite_strategy: queryRewrites?.strategy ?? null,
          preferred_sources: queryPreferredSources,
          subquery_count: subqueries.length,
          rewrite_count: rewriteVariants.length,
        },
      },
    },
    {
      stage_id: 'hybrid_retrieval',
      title: 'Hybrid Retrieval',
      status: retrieval?.route?.effective_mode ?? retrieval?.route?.route_mode ?? 'n/a',
      summary: `${Array.isArray(retrieval?.stable_items) ? retrieval.stable_items.length : 0} stable / ${Array.isArray(retrieval?.dynamic_items) ? retrieval.dynamic_items.length : 0} dynamic`,
      data: retrieval ?? null,
    },
    {
      stage_id: 'wiki_lookup',
      title: 'LLM Wiki',
      status: wikiMatches.length > 0 ? 'matched' : 'empty',
      summary: `${wikiMatches.length} matches`,
      data: {
        query: resolvedQuery || null,
        matches: wikiMatches,
      },
    },
    {
      stage_id: 'memory_recall',
      title: 'Memory Recall',
      status: memory?.runtime_summary?.provider_mode ?? 'n/a',
      summary: `short:${memory?.runtime_summary?.short_term_count ?? 0} long:${memory?.runtime_summary?.long_term_count ?? 0}`,
      data: {
        provider_summary: memory?.runtime_summary ?? null,
        linked_artifacts: memory?.linked_artifacts ?? null,
      },
    },
    {
      stage_id: 'knowledge_governance',
      title: 'Knowledge Governance',
      status: governanceRisks.length > 0 ? 'review' : 'healthy',
      summary: governanceRisks.length > 0 ? governanceRisks.join(', ') : 'no governance risks detected',
      data: {
        summary: governanceSummary,
        risks: governanceRisks,
      },
    },
    {
      stage_id: 'response_grounding',
      title: 'Response Grounding',
      status: response?.model_route?.provider ?? 'n/a',
      summary: response?.final_text ? response.final_text.slice(0, 120) : 'n/a',
      data: {
        response,
        model_route: response?.model_route ?? null,
        fallback: response?.fallback ?? null,
      },
    },
  ];

  return {
    task_id: taskId,
    query: resolvedQuery || null,
    task,
    trace_bundle: traceBundle,
    retrieval,
    memory,
    wiki: {
      query: resolvedQuery || null,
      matches: wikiMatches,
      catalog_count: wikiStore.list().length,
      proposal_count: wikiStore.listProposals({ includeResolved: true }).length,
    },
    governance: {
      summary: governanceSummary,
      risks: governanceRisks,
    },
    response,
    chain_stages: chainStages,
    chain_summary: {
      query: resolvedQuery || null,
      route_mode: retrieval?.route?.effective_mode ?? retrieval?.route?.route_mode ?? null,
      query_mode: queryFrontend?.query_mode ?? null,
      boundary_action: queryFrontend?.boundary?.action ?? null,
      clarification_required: Boolean(queryFrontend?.clarification?.required),
      decomposition_strategy: queryDecomposition?.strategy ?? null,
      rewrite_strategy: queryRewrites?.strategy ?? null,
      subquery_count: subqueries.length,
      rewrite_count: rewriteVariants.length,
      preferred_sources: queryPreferredSources,
      memory_provider: memory?.runtime_summary?.provider_mode ?? null,
      citation_count: Array.isArray(retrieval?.citations) ? retrieval.citations.length : 0,
      wiki_match_count: wikiMatches.length,
      memory_short_term_count: memory?.runtime_summary?.short_term_count ?? 0,
      memory_long_term_count: memory?.runtime_summary?.long_term_count ?? 0,
      final_text_present: Boolean(response?.final_text),
      trace_event_count: traceBundle?.metrics?.event_count ?? 0,
      filter_policy_mode: governanceSummary.filter_policy_mode,
      source_of_truth_conflict_count: governanceSummary.source_of_truth_conflict_count,
      recommended_action: governanceSummary.recommended_action,
      knowledge_risk_count: governanceRisks.length,
    },
  };
}

export function getEvaluationSnapshot(taskId) {
  return evaluationStore.list(taskId);
}

export function getReviewSnapshot(taskId) {
  return reviewStore.list({ taskId });
}

export function getApprovalSnapshot(taskId) {
  return getApprovalItems(taskId);
}

export function getAlertSnapshot(taskId) {
  return alertStore.list({ taskId });
}

export function getGovernanceSnapshot(taskId) {
  const task = taskStore.get(taskId);
  const alerts = alertStore.list({ taskId });
  const traceBundle = traceCollector.collect(taskId);
  const persona = task?.persona_id ? personaRegistry.get(task.persona_id) : null;
  const toolsets = personaRegistry.toolsets();
  const toolDefinitions = toolRegistry.list();
  return {
    task_id: taskId,
    task,
    policy: governanceMonitor.getPolicy(),
    alerts,
    latest_alert: alerts.at(-1) ?? null,
    metrics: {
      status: task?.metadata?.governance_status ?? null,
      alert_count: task?.metadata?.governance_alert_count ?? alerts.length,
      alert_codes: task?.metadata?.governance_alert_codes ?? alerts.map((alert) => alert.code),
      task_duration_ms: task?.metadata?.governance_task_duration_ms ?? null,
      estimated_cost_units: task?.metadata?.governance_estimated_cost_units ?? null,
      queue_depth: task?.metadata?.governance_queue_depth ?? null,
    },
    tool_governance: summarizeToolGovernance({
      task,
      traceBundle,
      alerts,
      persona,
      toolsets,
      toolDefinitions,
    }),
  };
}

export function getHarnessRun(runId) {
  return harnessStore.get(runId);
}

export function listHarnessRuns(options = {}) {
  return harnessStore.list(options);
}

function resolveLatestWikiCandidateRun({ suitePath = null, runId = null } = {}) {
  if (runId) {
    return getHarnessRun(runId);
  }

  const matchesSuitePath = (run) => {
    if (!suitePath) {
      return true;
    }
    if (run?.metadata?.suite_path === suitePath) {
      return true;
    }
    const casePaths = Array.isArray(run?.metadata?.case_paths) ? run.metadata.case_paths : [];
    return casePaths.includes(suitePath);
  };

  const runs = listHarnessRuns({ harnessType: 'wiki' })
    .filter((run) => run?.metadata?.source === 'candidate-suite' || matchesSuitePath(run))
    .filter((run) => matchesSuitePath(run))
    .sort((left, right) => String(right.completed_at ?? right.created_at ?? '').localeCompare(String(left.completed_at ?? left.created_at ?? '')));
  return runs[0] ?? null;
}

export function getDeadLetterSnapshot(taskId) {
  return deadLetterStore.list({ taskId });
}

export function getRecoveryDrillSnapshot(taskId) {
  return recoveryDrillStore.list({ taskId });
}

export function getRLSnapshot(taskId) {
  return rlStore.snapshot(taskId);
}

export function getHandoffSnapshot(taskId) {
  return handoffStore.list({ taskId });
}

export function getMultiAgentSnapshot(taskId) {
  const task = taskStore.get(taskId);
  return {
    task_id: taskId,
    handoffs: getHandoffSnapshot(taskId),
    aggregate: aggregateTaskHandoffs(taskId, { persist: false }),
    coordination: multiAgentCoordinator.describeCoordination({
      taskId,
      plan: task?.plan ?? null,
      messageText: task?.message?.content_preview ?? '',
    }),
  };
}

export function getCompressionSnapshot(taskId) {
  return compressionStore.list({ taskId });
}

export function getDeliverySnapshot(taskId) {
  return deliveryService.listDeliveries({ taskId });
}

export function getDeliveryReceiptSnapshot(taskId) {
  return deliveryService.listReceipts({ taskId });
}

function normalizeQueueFilterValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  if (!text || text === 'all') {
    return null;
  }
  return text;
}

function countJobsByStatus(jobs = []) {
  return jobs.reduce((acc, job) => {
    acc[job.status] = (acc[job.status] ?? 0) + 1;
    return acc;
  }, { queued: 0, running: 0, completed: 0, failed: 0 });
}

function summarizeQueueTaskLinks(taskId) {
  if (!taskId) {
    return null;
  }

  const deadLetters = deadLetterStore.list({ taskId });
  const recoveryDrills = recoveryDrillStore.list({ taskId });
  const alerts = alertStore.list({ taskId });
  const deadLetterCounts = countJobsByStatus(deadLetters.map((item) => ({
    status: item.status ?? 'open',
  })));
  const recoveryCounts = countJobsByStatus(recoveryDrills.map((item) => ({
    status: item.status ?? 'planned',
  })));
  const alertCounts = alerts.reduce((acc, alert) => {
    const status = alert.status ?? 'open';
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, { open: 0, resolved: 0 });

  return {
    task_id: taskId,
    dead_letters: {
      count: deadLetters.length,
      open_count: deadLetterCounts.open ?? 0,
      replayed_count: deadLetterCounts.replayed ?? 0,
      resolved_count: deadLetterCounts.resolved ?? 0,
      latest: deadLetters[0] ?? null,
    },
    recovery_drills: {
      count: recoveryDrills.length,
      planned_count: recoveryCounts.planned ?? 0,
      running_count: recoveryCounts.running ?? 0,
      completed_count: recoveryCounts.completed ?? 0,
      latest: recoveryDrills[0] ?? null,
    },
    alerts: {
      count: alerts.length,
      open_count: alertCounts.open ?? 0,
      resolved_count: alertCounts.resolved ?? 0,
      latest: alerts[0] ?? null,
      latest_open: alerts.find((item) => item.status === 'open') ?? null,
    },
  };
}

function annotateQueueJob(job) {
  return {
    ...job,
    linked_context: summarizeQueueTaskLinks(job.task_id),
  };
}

export function getWorkerQueueSnapshot(filters = {}) {
  const queue = worker.snapshot();
  const normalizedFilters = {
    task_id: normalizeQueueFilterValue(filters.task_id),
    trace_id: normalizeQueueFilterValue(filters.trace_id),
    status: normalizeQueueFilterValue(filters.status),
    worker_id: normalizeQueueFilterValue(filters.worker_id),
  };
  const filteredJobs = workerQueueStore.list({
    taskId: normalizedFilters.task_id,
    traceId: normalizedFilters.trace_id,
    status: normalizedFilters.status,
    workerId: normalizedFilters.worker_id,
  }).map(annotateQueueJob);
  const filteredCounts = countJobsByStatus(filteredJobs);
  const annotatedJobs = queue.jobs.map(annotateQueueJob);
  const staleJobs = annotatedJobs.filter((job) => (
    job.status === 'running'
    && job.lease_expires_at
    && Number.isFinite(Date.parse(job.lease_expires_at))
    && Date.parse(job.lease_expires_at) <= Date.now()
  ));

  return {
    ...queue,
    jobs: annotatedJobs,
    filters: normalizedFilters,
    filtered_jobs: filteredJobs,
    filtered_total: filteredJobs.length,
    filtered_counts: filteredCounts,
    stale_jobs: staleJobs,
    stale_count: staleJobs.length,
  };
}

export function registerPlatformWorkerHandler(jobType, handler) {
  worker.register(jobType, handler);
}

export function dispatchPlatformWorkerJob(input, options = {}) {
  return worker.dispatch(input, options);
}

export function listPlatformAdapters() {
  return deliveryService.listAdapters();
}

export function inspectContextBudget(taskId, options = {}) {
  return contextBudgetManager.inspectBudget({
    taskId,
    traceId: options.traceId ?? taskId,
    scope: options.scope ?? 'task',
    modelName: options.modelName ?? 'deepseek-chat',
    compressionStrategy: options.compressionStrategy ?? 'hybrid',
    tokenBudget: options.tokenBudget ?? 12000,
    query: options.query ?? '',
  });
}

export function createContextSnapshot(taskId, options = {}) {
  return contextBudgetManager.createSnapshot({
    taskId,
    traceId: options.traceId ?? taskId,
    scope: options.scope ?? 'task',
    modelName: options.modelName ?? 'deepseek-chat',
    compressionStrategy: options.compressionStrategy ?? 'hybrid',
    tokenBudget: options.tokenBudget ?? 12000,
    query: options.query ?? '',
  });
}

export function replayTaskExecution(taskId, { afterSeq = 0 } = {}) {
  return {
    task_id: taskId,
    task: taskStore.get(taskId),
    stream_events: streamStore.replay(taskId, afterSeq),
    audit_entries: auditStore.list(taskId),
    trace_bundle: traceCollector.collect(taskId),
  };
}

function recordTaskDeadLetter(taskId, {
  reason = 'unrecoverable_failure',
  error = null,
  replayable = true,
  payload = {},
  metadata = {},
} = {}) {
  const task = taskStore.get(taskId);
  const record = deadLetterStore.create({
    task_id: taskId,
    trace_id: task?.trace_id ?? taskId,
    reason,
    replayable,
    payload: {
      task,
      error,
      ...payload,
    },
    metadata: {
      ...metadata,
      task_status: task?.status ?? null,
      task_phase: task?.phase ?? null,
      current_step_id: task?.current_step_id ?? null,
    },
  });

  taskStore.upsert(taskId, {
    status: 'dead_letter',
    phase: 'dead_letter',
    metadata: {
      dead_letter_id: record.dead_letter_id,
      dead_letter_reason: reason,
      dead_letter_status: record.status,
      dead_letter_replayable: record.replayable,
    },
    checkpoint: {
      kind: 'dead_letter.created',
      summary: `Task moved to dead-letter: ${reason}`,
      metadata: {
        dead_letter_id: record.dead_letter_id,
      },
    },
  });
  auditStore.append(taskId, {
    trace_id: task?.trace_id ?? taskId,
    kind: 'dead_letter.created',
    payload: record,
  });

  return record;
}

function recordRecoveryDrill(taskId, {
  scenario = 'worker_restart',
  recovery_mode = 'resume',
  summary = null,
  metadata = {},
} = {}) {
  const task = taskStore.get(taskId);
  const drill = recoveryDrillStore.create({
    task_id: taskId,
    trace_id: task?.trace_id ?? taskId,
    scenario,
    recovery_mode,
    status: 'running',
    summary,
    metadata,
  });

  auditStore.append(taskId, {
    trace_id: task?.trace_id ?? taskId,
    kind: 'recovery.drill_started',
    payload: drill,
  });

  return drill;
}

function completeRecoveryDrill(drillId, {
  status = 'completed',
  summary = null,
  result = null,
  metadata = {},
} = {}) {
  const drill = recoveryDrillStore.complete(drillId, {
    status,
    summary,
    result,
    metadata,
  });

  auditStore.append(drill.task_id, {
    trace_id: drill.trace_id ?? drill.task_id,
    kind: 'recovery.drill_completed',
    payload: drill,
  });

  return drill;
}

export async function recoverTaskExecution({
  taskId,
  mode = 'resume',
  reviewerId = 'system',
  notes = null,
  decision = 'approved',
  overrides = {},
  reason = 'manual_recovery',
} = {}) {
  const deadLetterSnapshot = getLatestTaskDeadLetter(taskId, { replayable: true });
  if (deadLetterSnapshot?.payload?.task) {
    hydrateTaskFromSnapshot(taskId, deadLetterSnapshot.payload.task);
  }
  const task = taskStore.get(taskId);
  if (!task) {
    throw new Error(`Unknown task: ${taskId}`);
  }

  const deadLetter = deadLetterSnapshot ?? (task.status === 'dead_letter'
    ? getLatestTaskDeadLetter(taskId, { replayable: true })
    : null);

  const drill = recordRecoveryDrill(taskId, {
    scenario: mode === 'restart' ? 'manual_restart' : 'recovery_resume',
    recovery_mode: mode,
    summary: `Recovery ${mode} requested`,
    metadata: {
      reviewer_id: reviewerId,
      notes,
      reason,
    },
  });

  taskStore.upsert(taskId, {
    status: 'recovering',
    phase: 'recovering',
    metadata: {
      recovery_mode: mode,
      recovery_status: 'running',
      recovery_drill_id: drill.drill_id,
    },
    checkpoint: {
      kind: 'recovery.started',
      summary: `Recovery ${mode} started`,
      metadata: {
        drill_id: drill.drill_id,
      },
    },
  });

  try {
    let result;
    if (mode !== 'restart' && deadLetter && hasRecoverableCheckpoint(task)) {
      result = await recoverDeadLetterTaskFromCheckpoint({
        taskId,
        task,
        deadLetter,
        reviewerId,
        notes,
        overrides,
      });
      taskStore.upsert(taskId, {
        metadata: {
          recovery_mode: mode,
          recovery_status: result?.approval_required ? 'paused' : 'replayed',
          recovery_drill_id: drill.drill_id,
        },
      });
    } else if (mode !== 'restart' && (['waiting_approval', 'taken_over'].includes(task.status) || task.metadata?.approval_required)) {
      result = await resumeTaskExecution({
        taskId,
        reviewerId,
        notes,
        decision,
        overrides,
      });
    } else {
      const message = normalizeResumeMessage(task, overrides);
      const plan = normalizeResumePlan(task, overrides);
      const persona = personaRegistry.get(overrides.persona_id ?? task.persona_id);
      const onTaskUpdate = createTaskUpdateHandler({ message, persona, plan });
      result = await processInboundMessage(message, streamStore);
      taskStore.upsert(taskId, {
        metadata: {
          recovery_mode: mode,
          recovery_status: 'replayed',
          recovery_drill_id: drill.drill_id,
        },
      });
      onTaskUpdate?.({
        phase: 'recovered',
        summary: `Recovered via ${mode}`,
        runState: result.run_state ?? null,
        metadata: {
          recovery_mode: mode,
        },
      });
    }

    const drillStatus = result?.dead_letter
      ? 'failed'
      : result?.approval_required
        ? 'paused'
        : 'completed';
    completeRecoveryDrill(drill.drill_id, {
      status: drillStatus,
      summary: `Recovery ${mode} completed`,
      result: result?.dead_letter
        ? {
          dead_letter_id: result.dead_letter.dead_letter_id,
          error: result.dead_letter.payload?.error ?? null,
        }
        : {
          resumed: Boolean(result?.resumed),
          paused: Boolean(result?.approval_required),
          approval_required: Boolean(result?.approval_required),
          task_status: result?.run_state?.status ?? result?.task?.status ?? taskStore.get(taskId)?.status ?? null,
        },
      metadata: {
        recovered: true,
      },
    });

    return {
      ...result,
      recovery_drill: recoveryDrillStore.get(drill.drill_id),
      replay: replayTaskExecution(taskId),
    };
  } catch (error) {
    const deadLetter = extractExistingDeadLetter(error) ?? recordTaskDeadLetter(taskId, {
      reason: `recovery_failed:${mode}`,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
      metadata: {
        recovery_mode: mode,
        reviewer_id: reviewerId,
      },
      payload: {
        task,
      },
    });

    completeRecoveryDrill(drill.drill_id, {
      status: 'failed',
      summary: `Recovery ${mode} failed`,
      result: {
        error: error instanceof Error ? error.message : String(error),
      },
      metadata: {
        dead_letter_id: deadLetter.dead_letter_id,
      },
    });

    throw error;
  }
}

export function createTaskHandoff({
  taskId,
  traceId = taskId,
  parentAgentId = 'agent_main',
  targetAgentId = 'agent_specialist',
  role = 'specialist',
  objective = 'Complete delegated work',
  scope = {},
  inputSummary = 'Delegated specialist work',
  mustKeep = [],
  evidenceRefs = [],
  contextSnapshotId = null,
  outputSchema = {},
  metadata = {},
} = {}) {
  return multiAgentCoordinator.delegate({
    taskId,
    traceId,
    parentAgentId,
    targetAgentId,
    role,
    objective,
    scope,
    inputSummary,
    mustKeep,
    evidenceRefs,
    contextSnapshotId,
    outputSchema,
    metadata,
  });
}

export function delegateTaskWork(taskId, options = {}) {
  const task = taskStore.get(taskId);
  return multiAgentCoordinator.delegateSuggested({
    taskId,
    traceId: options.traceId ?? taskId,
    parentAgentId: options.parentAgentId ?? 'agent_main',
    plan: options.plan ?? task?.plan ?? null,
    messageText: options.messageText ?? task?.message?.content_preview ?? '',
    inputSummary: options.inputSummary ?? task?.message?.content_preview ?? 'Delegated specialist work',
    mustKeep: options.mustKeep ?? ['current step objective', 'latest tool result', 'safety boundaries'],
    evidenceRefs: options.evidenceRefs ?? [],
  });
}

export function submitTaskHandoffResult(handoffId, options = {}) {
  return multiAgentCoordinator.submitResult({
    handoffId,
    status: options.status ?? 'completed',
    resultSummary: options.resultSummary ?? null,
    result: options.result ?? null,
    evidenceRefs: options.evidenceRefs ?? [],
    adopted: options.adopted ?? null,
    fallbackStrategy: options.fallbackStrategy ?? null,
    joinDecision: options.joinDecision ?? null,
    metadata: options.metadata ?? {},
  });
}

export function aggregateTaskHandoffs(taskId, options = {}) {
  return multiAgentCoordinator.aggregate({
    taskId,
    persist: options.persist ?? true,
  });
}

export function recordRLFeedback(taskId, {
  traceId = taskId,
  score = 0,
  signal = 'quality',
  source = 'system',
  confidence = 0.5,
  metadata = {},
} = {}) {
  return rlStore.appendReward(taskId, {
    trace_id: traceId,
    score,
    signal,
    source,
    confidence,
    metadata,
  });
}

export function recordPolicyLog(taskId, {
  traceId = taskId,
  policyName = 'default_agent_policy',
  policyVersion = 'v0',
  action = 'respond',
  decision = 'pass',
  rationale = null,
  metadata = {},
} = {}) {
  return rlStore.appendPolicyLog(taskId, {
    trace_id: traceId,
    policy_name: policyName,
    policy_version: policyVersion,
    action,
    decision,
    rationale,
    metadata,
  });
}

export function recordSafetyGate(taskId, {
  traceId = taskId,
  status = 'hold',
  allowOnlineUpdate = false,
  rewardEligible = false,
  reason = 'awaiting_evaluation',
  blockingIssues = [],
  metadata = {},
} = {}) {
  return rlStore.appendSafetyGate(taskId, {
    trace_id: traceId,
    status,
    allow_online_update: allowOnlineUpdate,
    reward_eligible: rewardEligible,
    reason,
    blocking_issues: blockingIssues,
    metadata,
  });
}

export async function runEvaluationHarness(cases = [], metadata = {}) {
  return evaluationHarness.run({ cases, metadata });
}

export async function runMemoryHarness({
  cases = [],
  casePaths = [],
  casePath = null,
  preset = null,
  metadata = {},
} = {}) {
  return memoryHarness.run({ cases, casePaths, casePath, preset, metadata });
}

export async function runKnowledgeHarness({
  generationCases = [],
  generationCasePaths = [],
  generationCasePath = null,
  wikiCases = [],
  wikiCasePaths = [],
  wikiCasePath = null,
  memoryCases = [],
  memoryCasePaths = [],
  memoryCasePath = null,
  preset = null,
  metadata = {},
} = {}) {
  return knowledgeHarness.run({
    generationCases,
    generationCasePaths,
    generationCasePath,
    wikiCases,
    wikiCasePaths,
    wikiCasePath,
    memoryCases,
    memoryCasePaths,
    memoryCasePath,
    preset,
    metadata,
  });
}

export async function runWikiHarness({
  cases = [],
  casePaths = [],
  casePath = null,
  preset = null,
  metadata = {},
} = {}) {
  return wikiHarness.run({ cases, casePaths, casePath, preset, metadata });
}

function normalizeResumeMessage(task, overrides = {}) {
  return overrides.message
    ? createCanonicalMessage(overrides.message)
    : structuredClone(task.message_snapshot ?? task.message ?? null);
}

function normalizeResumePlan(task, overrides = {}) {
  if (!overrides.plan) {
    return structuredClone(task.plan);
  }

  return createAgentPlan({
    ...task.plan,
    ...overrides.plan,
    plan_id: overrides.plan.plan_id ?? task.plan?.plan_id ?? task.plan_id,
    task_id: task.task_id,
    trace_id: task.trace_id,
    persona_id: overrides.plan.persona_id ?? task.persona_id,
    goal: overrides.plan.goal ?? task.plan?.goal ?? task.message?.content_preview ?? task.task_id,
    summary: overrides.plan.summary ?? task.plan?.summary ?? task.plan?.goal ?? task.task_id,
    steps: overrides.plan.steps ?? task.plan?.steps ?? [],
  });
}

export async function resumeTaskExecution({
  taskId,
  reviewerId = 'human',
  notes = null,
  decision = 'approved',
  overrides = {},
} = {}) {
  const task = taskStore.get(taskId);
  if (!task) {
    throw new Error(`Unknown task: ${taskId}`);
  }

  if (!['waiting_approval', 'taken_over'].includes(task.status) && task.metadata?.approval_required !== true) {
    throw new Error(`Task ${taskId} is not waiting for approval`);
  }

  if (!task.message_snapshot || !task.plan || !task.run_state) {
    throw new Error(`Task ${taskId} does not have a recoverable checkpoint`);
  }

  const approvalReview = overrides.approval_id
    ? reviewStore.get(overrides.approval_id)
    : getApprovalItems(taskId).at(0) ?? null;
  if (!approvalReview) {
    throw new Error(`No approval item found for task ${taskId}`);
  }

  const resolvedApproval = reviewStore.resolve(approvalReview.review_id, {
    decision,
    reviewer_id: reviewerId,
    notes,
    metadata: overrides.metadata ?? {},
  });
  auditStore.append(taskId, {
    trace_id: task.trace_id,
    kind: 'approval.resolved',
    payload: resolvedApproval,
  });

  if (resolvedApproval.review_status !== 'approved') {
    taskStore.upsert(taskId, {
      status: 'blocked',
      phase: 'blocked',
      metadata: {
        control_state: 'blocked',
        approval_review_id: approvalReview.review_id,
        approval_resolution: resolvedApproval.review_status,
        reviewer_id: reviewerId,
        notes,
      },
      checkpoint: {
        kind: 'approval.resolved',
        summary: `Approval ${resolvedApproval.review_status}`,
        metadata: {
          review_id: approvalReview.review_id,
        },
      },
    });

    return {
      task: taskStore.get(taskId),
      approval_review: resolvedApproval,
      resumed: false,
    };
  }

  const message = normalizeResumeMessage(task, overrides);
  const plan = normalizeResumePlan(task, overrides);
  const persona = personaRegistry.get(overrides.persona_id ?? task.persona_id);
  const onTaskUpdate = createTaskUpdateHandler({ message, persona, plan });

  taskStore.upsert(taskId, {
    status: 'resuming',
    phase: 'resuming',
    message_snapshot: message,
    plan,
    metadata: {
      control_state: 'resuming',
      approval_review_id: approvalReview.review_id,
      approval_resolution: resolvedApproval.review_status,
      reviewer_id: reviewerId,
      notes,
    },
    checkpoint: {
      kind: 'approval.resolved',
      summary: 'Human approval granted',
      metadata: {
        review_id: approvalReview.review_id,
        reviewer_id: reviewerId,
      },
    },
  });

  const result = await resumeAgentTask({
    message,
    persona,
    plan,
    toolRegistry,
    store: streamStore,
    responseComposer,
    worker,
    eventBus,
    memoryStore,
    onTaskUpdate,
    resumeState: task.run_state,
    approvalContext: {
      approved: true,
      approval_id: approvalReview.review_id,
      reviewer_id: reviewerId,
    },
  });

  if (result.paused) {
    const pausedStep = plan.steps.find((step) => step.step_id === result.runState.current_step_id) ?? null;
    const approval = createApprovalReview({
      message,
      persona,
      plan,
      runState: result.runState,
      pausedStep,
      reason: 'approval_required',
    });

    return {
      message,
      persona,
      plan,
      run_state: result.runState,
      task_id: taskId,
      approval_required: true,
      approval_review: approval,
      approval_url: `/api/approvals?task_id=${encodeURIComponent(taskId)}`,
      resume_url: `/api/tasks/resume?task_id=${encodeURIComponent(taskId)}`,
      stream_url: `/api/stream?task_id=${encodeURIComponent(taskId)}`,
      audit_url: `/api/traces?task_id=${encodeURIComponent(taskId)}`,
      trace_bundle_url: `/api/traces/bundle?task_id=${encodeURIComponent(taskId)}`,
      task_url: `/api/tasks?task_id=${encodeURIComponent(taskId)}`,
      memory_url: buildMemoryUrl(taskId, {
        workspaceId: message.workspace_id,
        personaId: persona.persona_id,
      }),
      evaluation_url: `/api/evaluations?task_id=${encodeURIComponent(taskId)}`,
      review_url: `/api/reviews?task_id=${encodeURIComponent(taskId)}`,
      alerts_url: `/api/alerts?task_id=${encodeURIComponent(taskId)}`,
      governance_url: `/api/governance?task_id=${encodeURIComponent(taskId)}`,
      quality_gate: null,
      wiki_url: '/api/wiki',
      events: result.events,
      resumed: true,
    };
  }

  const { evaluation, gate, review, governance, deliveries } = await finalizeSuccessfulRun({
    message,
    persona,
    plan,
    runState: result.runState,
  });

  return {
    message,
    persona,
    plan,
    run_state: result.runState,
    task_id: taskId,
    stream_url: `/api/stream?task_id=${encodeURIComponent(taskId)}`,
    audit_url: `/api/traces?task_id=${encodeURIComponent(taskId)}`,
    trace_bundle_url: `/api/traces/bundle?task_id=${encodeURIComponent(taskId)}`,
    task_url: `/api/tasks?task_id=${encodeURIComponent(taskId)}`,
    memory_url: buildMemoryUrl(taskId, {
      workspaceId: message.workspace_id,
      personaId: persona.persona_id,
    }),
    evaluation_url: `/api/evaluations?task_id=${encodeURIComponent(taskId)}`,
    review_url: `/api/reviews?task_id=${encodeURIComponent(taskId)}`,
    alerts_url: `/api/alerts?task_id=${encodeURIComponent(taskId)}`,
    governance_url: `/api/governance?task_id=${encodeURIComponent(taskId)}`,
    deliveries_url: `/api/deliveries?task_id=${encodeURIComponent(taskId)}`,
    quality_gate: gate,
    governance,
    wiki_url: '/api/wiki',
    deliveries,
    approval_review: resolvedApproval,
    approval_required: false,
    events: result.events,
    resumed: true,
  };
}

export async function takeoverTaskExecution({
  taskId,
  reviewerId = 'human',
  notes = null,
  overrides = {},
} = {}) {
  const task = taskStore.get(taskId);
  if (!task) {
    throw new Error(`Unknown task: ${taskId}`);
  }

  const message = normalizeResumeMessage(task, overrides);
  const plan = normalizeResumePlan(task, overrides);

  taskStore.upsert(taskId, {
    status: 'taken_over',
    phase: 'human_takeover',
    message_snapshot: message,
    plan,
    metadata: {
      control_state: 'taken_over',
      takeover_reviewer_id: reviewerId,
      takeover_notes: notes,
    },
    checkpoint: {
      kind: 'human.takeover',
      summary: 'Task taken over by human operator',
      metadata: {
        reviewer_id: reviewerId,
      },
    },
  });

  auditStore.append(taskId, {
    trace_id: task.trace_id,
    kind: 'task.taken_over',
    payload: {
      task_id: taskId,
      reviewer_id: reviewerId,
      notes,
    },
  });

  return {
    task: taskStore.get(taskId),
  };
}

function resolveReviewItem(reviewId, {
  decision,
  reviewer_id = 'system',
  notes = null,
  metadata = {},
} = {}) {
  const review = reviewStore.resolve(reviewId, {
    decision,
    reviewer_id,
    notes,
    metadata,
  });
  taskStore.upsert(review.task_id, {
    metadata: {
      review_status: review.review_status,
      review_resolution: review.resolution?.decision ?? null,
    },
    checkpoint: {
      kind: 'review.resolved',
      summary: `Review resolved: ${review.review_status}`,
      metadata: {
        review_id: review.review_id,
        reviewer_id: review.resolution?.reviewer_id ?? null,
      },
    },
  });
  auditStore.append(review.task_id, {
    trace_id: review.trace_id ?? review.task_id,
    kind: 'review.resolved',
    payload: review,
  });
  return review;
}

export function searchMemory(query, limit = 4, options = {}) {
  return memoryStore.searchLongTerm(query, { limit, ...(options ?? {}) });
}

function summarizeTaskText(text, limit = 120) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}

function createTaskUpdateHandler({ message, persona, plan }) {
  return ({ phase, summary, runState: snapshot, metadata }) => {
    memoryStore.appendShortTerm(message.trace_id, {
      trace_id: message.trace_id,
      role: 'system',
      phase,
      title: phase,
      summary,
      content: snapshot?.output?.final_text ?? summary,
      facts: [
        ...(metadata?.step_title ? [metadata.step_title] : []),
        ...(metadata?.tool_name ? [`tool=${metadata.tool_name}`] : []),
      ],
      tags: ['task', phase, ...(metadata?.tool_name ? ['tool'] : [])],
      source: 'execution',
      source_trace_id: message.trace_id,
      source_task_id: message.trace_id,
      workspace_id: message.workspace_id,
      persona_id: persona.persona_id,
      metadata: {
        ...metadata,
        status: snapshot?.status ?? null,
        workspace_id: message.workspace_id,
        persona_id: persona.persona_id,
      },
    });
    taskStore.upsert(message.trace_id, {
      status: snapshot?.status ?? 'running',
      phase,
      plan_id: plan.plan_id,
      persona_id: persona.persona_id,
      current_step_id: snapshot?.current_step_id ?? null,
      completed_steps: snapshot?.completed_steps ?? 0,
      total_steps: snapshot?.total_steps ?? plan.steps.length,
      step_results: snapshot?.step_results ?? [],
      output: snapshot?.output ?? null,
      run_state: snapshot ?? null,
      metadata: {
        ...(metadata ?? {}),
        source_platform: message.source_platform,
      },
      checkpoint: {
        kind: phase,
        summary,
        metadata: metadata ?? {},
      },
    });
  };
}

function getApprovalItems(taskId = null) {
  const task = taskId ? taskStore.get(taskId) : null;
  return reviewStore.list({ taskId, queueName: 'approval' }).map((review) => ({
    ...review,
    preview: createApprovalPreview(task, review),
  }));
}

function createApprovalPreview(task, review) {
  return callPythonCore('build_approval_preview', {
    task,
    review,
  });
}

function createApprovalReview({ message, persona, plan, runState, pausedStep, reason = 'approval_required' }) {
  const review = reviewStore.create(callPythonCore('draft_approval_review', {
    message,
    persona,
    plan,
    run_state: runState,
    paused_step: pausedStep,
    reason,
  }));

  auditStore.append(message.trace_id, {
    trace_id: message.trace_id,
    kind: 'approval.requested',
    payload: review,
  });

  taskStore.upsert(message.trace_id, {
    status: 'waiting_approval',
    phase: 'waiting_approval',
    current_step_id: runState.current_step_id,
    completed_steps: runState.completed_steps,
    total_steps: runState.total_steps,
    step_results: runState.step_results,
    run_state: runState,
    output: runState.output,
    metadata: {
      approval_review_id: review.review_id,
      approval_queue: review.queue_name,
      approval_required: true,
      control_state: 'waiting_approval',
      paused_step_id: pausedStep?.step_id ?? runState.current_step_id,
      paused_tool_name: pausedStep?.tool_name ?? null,
    },
    checkpoint: {
      kind: 'approval.requested',
      summary: `Human approval required for ${pausedStep?.title ?? 'the current step'}`,
      metadata: {
        review_id: review.review_id,
        step_id: pausedStep?.step_id ?? null,
        tool_name: pausedStep?.tool_name ?? null,
      },
    },
  });

  return review;
}

async function finalizeSuccessfulRun({ message, persona, plan, runState, approvalReview = null }) {
  auditStore.append(message.trace_id, {
    trace_id: message.trace_id,
    kind: 'run.completed',
    payload: {
      status: runState.status,
      completed_steps: runState.completed_steps,
      output: runState.output,
    },
  });
  const evaluation = outputEvaluator.evaluate({
    message,
    persona,
    plan,
    runState,
  });
  evaluationStore.append(message.trace_id, evaluation);
  const gate = qualityGate.evaluate(evaluation);
  let review = approvalReview;
  if (gate.review_required) {
    review = reviewStore.create(callPythonCore('draft_quality_review', {
      message,
      persona,
      evaluation,
      gate,
    }));
    auditStore.append(message.trace_id, {
      trace_id: message.trace_id,
      kind: 'review.created',
      payload: review,
    });
  }
  auditStore.append(message.trace_id, {
    trace_id: message.trace_id,
    kind: 'quality.evaluated',
    payload: evaluation,
  });
  auditStore.append(message.trace_id, {
    trace_id: message.trace_id,
    kind: 'quality.gate_applied',
    payload: gate,
  });
  memoryStore.promoteDurableMemory({
    taskId: message.trace_id,
    traceId: message.trace_id,
    personaId: persona.persona_id,
    workspaceId: message.workspace_id,
    messageText: message.content.find((part) => part.type === 'text')?.text ?? '',
    responseText: runState.output?.final_text ?? '',
    plan,
    source: 'task_completion',
  });
  taskStore.upsert(message.trace_id, {
    status: runState.status,
    phase: 'completed',
    current_step_id: runState.current_step_id,
    completed_steps: runState.completed_steps,
    total_steps: runState.total_steps,
    step_results: runState.step_results,
    run_state: runState,
    output: runState.output,
    checkpoint: {
      kind: 'run.completed',
      summary: 'Task completed',
    },
  });
  taskStore.upsert(message.trace_id, {
    metadata: {
      control_state: 'automated',
      approval_required: false,
      evaluation_id: evaluation.evaluation_id,
      evaluation_score: evaluation.overall_score,
      evaluation_decision: evaluation.decision,
      quality_gate_id: gate.gate_id,
      quality_gate_status: gate.status,
      quality_gate_sampled: gate.sampled,
      review_required: gate.review_required,
      review_id: review?.review_id ?? null,
    },
    checkpoint: {
      kind: 'quality.evaluated',
      summary: `Quality gate: ${evaluation.decision}`,
      metadata: {
        score: evaluation.overall_score,
      },
    },
  });
  if (review) {
    taskStore.upsert(message.trace_id, {
      checkpoint: {
        kind: 'review.created',
        summary: `Review queued: ${review.reason}`,
        metadata: {
          review_id: review.review_id,
          gate_status: gate.status,
        },
      },
    });
  }

  const governance = governanceMonitor.evaluateTask({
    task: taskStore.get(message.trace_id),
    traceBundle: traceCollector.collect(message.trace_id),
    workerSnapshot: worker.snapshot(),
  });
  taskStore.upsert(message.trace_id, {
    metadata: {
      governance_status: governance.status,
      governance_alert_count: governance.alerts.length,
      governance_alert_codes: governance.alerts.map((alert) => alert.code),
      governance_task_duration_ms: governance.metrics.task_duration_ms,
      governance_estimated_cost_units: governance.metrics.estimated_cost_units,
      governance_queue_depth: governance.metrics.queue_depth,
    },
    checkpoint: {
      kind: 'governance.evaluated',
      summary: `Governance ${governance.status}`,
      metadata: {
        alert_count: governance.alerts.length,
        alert_codes: governance.alerts.map((alert) => alert.code),
      },
    },
  });
  auditStore.append(message.trace_id, {
    trace_id: message.trace_id,
    kind: 'governance.evaluated',
    payload: governance,
  });

  const finalContextSnapshot = createContextSnapshot(message.trace_id, {
    traceId: message.trace_id,
    scope: 'task',
    modelName: deepseekClient.model,
    tokenBudget: 12000,
    query: message.content.find((part) => part.type === 'text')?.text ?? '',
  });
  const policyLog = recordPolicyLog(message.trace_id, {
    traceId: message.trace_id,
    policyName: 'agent_completion_policy',
    policyVersion: 'v1',
    action: 'finalize',
    decision: gate.review_required ? 'review' : 'pass',
    rationale: gate.review_required
      ? `Quality gate status is ${gate.status}`
      : `Quality gate passed with score ${gate.score}`,
    metadata: {
      gate_status: gate.status,
      governance_status: governance.status,
    },
  });
  const reward = recordRLFeedback(message.trace_id, {
    traceId: message.trace_id,
    score: evaluation.overall_score,
    signal: evaluation.decision,
    source: 'quality_gate',
    confidence: gate.review_required ? 0.6 : 0.9,
    metadata: {
      gate_status: gate.status,
      governance_status: governance.status,
    },
  });
  const safetyGate = recordSafetyGate(message.trace_id, {
    traceId: message.trace_id,
    status: gate.status === 'passed' && governance.status !== 'breached'
      ? 'allow'
      : gate.status === 'review_required'
        ? 'hold'
        : 'block',
    allowOnlineUpdate: gate.status === 'passed' && governance.status !== 'breached',
    rewardEligible: gate.status === 'passed' && governance.status !== 'breached',
    reason: gate.status === 'passed'
      ? 'quality_gate_passed'
      : `quality_gate_${gate.status}`,
    blockingIssues: gate.review_required
      ? ['manual_review_required']
      : governance.alerts.map((alert) => alert.code),
    metadata: {
      evaluation_id: evaluation.evaluation_id,
      gate_id: gate.gate_id,
      governance_status: governance.status,
    },
  });
  auditStore.append(message.trace_id, {
    trace_id: message.trace_id,
    kind: 'rl.reward_recorded',
    payload: reward,
  });
  auditStore.append(message.trace_id, {
    trace_id: message.trace_id,
    kind: 'rl.policy_logged',
    payload: policyLog,
  });
  auditStore.append(message.trace_id, {
    trace_id: message.trace_id,
    kind: 'rl.safety_gate_recorded',
    payload: safetyGate,
  });
  auditStore.append(message.trace_id, {
    trace_id: message.trace_id,
    kind: 'context.snapshot.finalized',
    payload: finalContextSnapshot.snapshot,
  });
  taskStore.upsert(message.trace_id, {
    metadata: {
      context_final_snapshot_id: finalContextSnapshot.snapshot.snapshot_id,
      context_final_token_estimate: finalContextSnapshot.snapshot.token_estimate,
      rl_reward_id: reward.reward_id,
      rl_policy_log_id: policyLog.policy_log_id,
      rl_safety_gate_id: safetyGate.safety_gate_id,
      rl_status: safetyGate.status,
    },
    checkpoint: {
      kind: 'context.snapshot.finalized',
      summary: 'Final context snapshot captured',
      metadata: {
        snapshot_id: finalContextSnapshot.snapshot.snapshot_id,
        token_estimate: finalContextSnapshot.snapshot.token_estimate,
      },
    },
  });

  let deliveries = [];
  try {
    const deliveryBatch = await deliveryService.queueTaskDeliveries({
      task: taskStore.get(message.trace_id),
      persona,
      plan,
      runState,
      responseText: runState.output?.final_text ?? '',
      targetPlatforms: message.metadata?.target_platforms ?? message.metadata?.delivery_targets ?? null,
      metadata: message.metadata ?? {},
    });
    deliveries = deliveryBatch.deliveries;
    auditStore.append(message.trace_id, {
      trace_id: message.trace_id,
      kind: 'delivery.batch_queued',
      payload: deliveryBatch,
    });
  } catch (error) {
    auditStore.append(message.trace_id, {
      trace_id: message.trace_id,
      kind: 'delivery.queue_failed',
      payload: {
        error: error instanceof Error ? error.message : String(error),
        task_id: message.trace_id,
      },
    });
  }

  return {
    evaluation,
    gate,
    review,
    governance,
    deliveries,
  };
}

export function createPlatformServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/health') {
      const workerSnapshot = worker.snapshot();
      const asyncGovernance = governanceMonitor.evaluateWorker({ workerSnapshot });
      sendJson(response, 200, {
        ok: true,
        service: 'toukeagent-platform',
        model_provider: deepseekClient.isConfigured ? 'deepseek' : 'local',
        model: deepseekClient.model,
        model_config_source: deepseekClient.configSource,
        model_config_path: deepseekClient.configPath,
        model_routing: modelRouter.getPolicy(),
        memory_provider: memoryStore.describeStrategy(),
        worker_active: workerSnapshot.active,
        worker_queued: workerSnapshot.queued,
        open_alert_count: alertStore.list({ status: 'open' }).length,
        governance: asyncGovernance,
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/personas') {
      sendJson(response, 200, {
        ...personaRegistry.catalog(),
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/tools') {
      sendJson(response, 200, {
        items: toolRegistry.list(),
        toolsets: personaRegistry.catalog().toolsets ?? [],
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/worker-queue') {
      const queueFilters = {
        task_id: url.searchParams.get('task_id'),
        trace_id: url.searchParams.get('trace_id'),
        status: url.searchParams.get('status'),
        worker_id: url.searchParams.get('worker_id'),
      };
      sendJson(response, 200, {
        queue: getWorkerQueueSnapshot(queueFilters),
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/worker-queue/requeue-stale') {
      const requeued = workerQueueStore.requeueStaleJobs();
      sendJson(response, 200, {
        requeued_count: requeued.length,
        requeued,
        queue: getWorkerQueueSnapshot(),
      });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/traces') {
      const taskId = url.searchParams.get('task_id');
      if (!taskId) {
        sendJson(response, 400, { error: 'task_id is required' });
        return;
      }

      const download = url.searchParams.get('download');
      sendJson(response, 200, {
        task_id: taskId,
        entries: auditStore.list(taskId),
      }, {
        headOnly: request.method === 'HEAD',
        downloadName: download && download !== '0' && download !== 'false'
          ? buildDownloadName('trace-audit', taskId)
          : null,
      });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/traces/bundle') {
      const taskId = url.searchParams.get('task_id');
      if (!taskId) {
        sendJson(response, 400, { error: 'task_id is required' });
        return;
      }

      const download = url.searchParams.get('download');
      sendJson(response, 200, getTraceBundle(taskId), {
        headOnly: request.method === 'HEAD',
        downloadName: download && download !== '0' && download !== 'false'
          ? buildDownloadName('trace-bundle', taskId)
          : null,
      });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/tasks') {
      const taskId = url.searchParams.get('task_id');
      if (!taskId) {
        sendJson(response, 400, { error: 'task_id is required' });
        return;
      }

      sendJson(response, 200, {
        task_id: taskId,
        task: taskStore.get(taskId),
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/memory') {
      const taskId = url.searchParams.get('task_id');
      const query = url.searchParams.get('q') ?? '';
      const workspaceId = url.searchParams.get('workspace_id');
      const personaId = url.searchParams.get('persona_id');
      const excludeStale = ['1', 'true', 'yes', 'on'].includes((url.searchParams.get('exclude_stale') ?? '').toLowerCase());

      if (!taskId && !query) {
        sendJson(response, 400, { error: 'task_id or q is required' });
        return;
      }

      sendJson(response, 200, taskId
        ? {
          task_id: taskId,
          workspace_id: workspaceId ?? null,
          persona_id: personaId ?? null,
          exclude_stale: excludeStale,
          provider_strategy: memoryStore.describeStrategy(),
          memory: getMemorySnapshot(taskId, {
            taskId,
            query,
            workspaceId,
            personaId,
            excludeStale,
          }),
        }
        : {
          query,
          workspace_id: workspaceId ?? null,
          persona_id: personaId ?? null,
          exclude_stale: excludeStale,
          provider_strategy: memoryStore.describeStrategy(),
          items: memoryStore.searchLongTerm(query, {
            limit: 6,
            workspaceId,
            personaId,
            excludeStale,
          }),
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/knowledge') {
      const taskId = url.searchParams.get('task_id');
      if (!taskId) {
        sendJson(response, 400, { error: 'task_id is required' });
        return;
      }

      const query = url.searchParams.get('q') ?? url.searchParams.get('query') ?? null;
      const wikiLimit = Number(url.searchParams.get('wiki_limit') ?? 6);
      sendJson(response, 200, getKnowledgeSnapshot(taskId, {
        query,
        wikiLimit: Number.isFinite(wikiLimit) ? wikiLimit : 6,
      }), { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/evaluations') {
      const taskId = url.searchParams.get('task_id');
      if (!taskId) {
        sendJson(response, 400, { error: 'task_id is required' });
        return;
      }

      sendJson(response, 200, {
        task_id: taskId,
        evaluations: evaluationStore.list(taskId),
        latest: evaluationStore.getLatest(taskId),
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/alerts') {
      const taskId = url.searchParams.get('task_id');
      const status = url.searchParams.get('status');
      const scope = url.searchParams.get('scope');
      const category = url.searchParams.get('category');

      sendJson(response, 200, {
        task_id: taskId,
        items: alertStore.list({
          taskId,
          status,
          scope,
          category,
        }),
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/governance') {
      const taskId = url.searchParams.get('task_id');
      if (taskId) {
        sendJson(response, 200, getGovernanceSnapshot(taskId), { headOnly: request.method === 'HEAD' });
        return;
      }

      const workerSnapshot = worker.snapshot();
      sendJson(response, 200, {
        policy: governanceMonitor.getPolicy(),
        worker: governanceMonitor.evaluateWorker({ workerSnapshot }),
        open_alerts: alertStore.list({ status: 'open' }),
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/harness/runs') {
      const runId = url.searchParams.get('run_id');
      const harnessType = url.searchParams.get('harness_type');
      if (runId) {
        sendJson(response, 200, { run: getHarnessRun(runId) }, { headOnly: request.method === 'HEAD' });
        return;
      }

      sendJson(response, 200, {
        runs: listHarnessRuns({ harnessType }),
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/harness/memory-draft') {
      const taskId = url.searchParams.get('task_id');
      if (!taskId) {
        sendJson(response, 400, { error: 'task_id is required' });
        return;
      }

      try {
        const download = url.searchParams.get('download');
        const queryText = url.searchParams.get('query') ?? null;
        const recallTopK = Number(url.searchParams.get('top_k') ?? 3) || 3;
        sendJson(response, 200, getMemoryHarnessDraft(taskId, {
          queryText,
          recallTopK,
        }), {
          headOnly: request.method === 'HEAD',
          downloadName: download && download !== '0' && download !== 'false'
            ? buildDownloadName('memory-harness-draft', taskId)
            : null,
        });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/harness/wiki-draft') {
      const taskId = url.searchParams.get('task_id');
      if (!taskId) {
        sendJson(response, 400, { error: 'task_id is required' });
        return;
      }

      try {
        const download = url.searchParams.get('download');
        const queryText = url.searchParams.get('query') ?? null;
        sendJson(response, 200, getWikiHarnessDraft(taskId, {
          queryText,
        }), {
          headOnly: request.method === 'HEAD',
          downloadName: download && download !== '0' && download !== 'false'
            ? buildDownloadName('wiki-harness-draft', taskId)
            : null,
        });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/harness/memory-candidate-suites') {
      const suitePath = url.searchParams.get('suite_path');
      const rootPath = url.searchParams.get('root_path');
      if (suitePath) {
        try {
          sendJson(response, 200, { suite: await getMemoryCandidateSuite(suitePath) }, { headOnly: request.method === 'HEAD' });
        } catch (error) {
          sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
        }
        return;
      }

      sendJson(response, 200, { suites: listMemoryCandidateSuites({ rootPath }) }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/harness/wiki-candidate-suites') {
      const suitePath = url.searchParams.get('suite_path');
      const rootPath = url.searchParams.get('root_path');
      if (suitePath) {
        try {
          sendJson(response, 200, { suite: await getWikiCandidateSuite(suitePath) }, { headOnly: request.method === 'HEAD' });
        } catch (error) {
          sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
        }
        return;
      }

      sendJson(response, 200, { suites: listWikiCandidateSuites({ rootPath }) }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/harness/wiki-candidate-suites/compare') {
      const suitePath = url.searchParams.get('suite_path');
      if (!suitePath) {
        sendJson(response, 400, { error: 'suite_path is required' });
        return;
      }
      try {
        const caseIds = url.searchParams.getAll('case_id');
        const result = await compareWikiCandidateSuiteWithObservedRun(suitePath, {
          caseId: caseIds.length === 1 ? caseIds[0] : null,
          caseIds: caseIds.length > 1 ? caseIds : null,
          runId: url.searchParams.get('run_id') ?? null,
        });
        sendJson(response, 200, result, { headOnly: request.method === 'HEAD' });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/harness/memory-candidate-suites/compare') {
      const suitePath = url.searchParams.get('suite_path');
      if (!suitePath) {
        sendJson(response, 400, { error: 'suite_path is required' });
        return;
      }
      try {
        const caseIds = url.searchParams.getAll('case_id');
        const result = await compareMemoryCandidateSuiteWithGold(suitePath, {
          caseId: caseIds.length === 1 ? caseIds[0] : null,
          caseIds: caseIds.length > 1 ? caseIds : null,
          goldPath: url.searchParams.get('gold_path') ?? null,
        });
        sendJson(response, 200, result, { headOnly: request.method === 'HEAD' });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/harness/memory-gold/history') {
      try {
        const result = await getMemoryGoldHistory({
          historyPath: url.searchParams.get('history_path') ?? null,
          caseId: url.searchParams.get('case_id') ?? null,
        });
        sendJson(response, 200, result, { headOnly: request.method === 'HEAD' });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/harness/memory-draft/save') {
      try {
        const input = await readJsonBody(request);
        const taskId = input.task_id ?? input.taskId ?? null;
        if (!taskId) {
          sendJson(response, 400, { error: 'task_id is required' });
          return;
        }

        const saved = await saveMemoryHarnessDraftArtifact(taskId, {
          caseId: input.case_id ?? input.caseId ?? null,
          queryText: input.query ?? input.query_text ?? input.queryText ?? null,
          recallTopK: Number(input.top_k ?? input.topK ?? 3) || 3,
          outputPath: input.output_path ?? input.outputPath ?? null,
        });
        sendJson(response, 200, saved);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/harness/wiki-draft/save') {
      try {
        const input = await readJsonBody(request);
        const taskId = input.task_id ?? input.taskId ?? null;
        if (!taskId) {
          sendJson(response, 400, { error: 'task_id is required' });
          return;
        }

        const saved = await saveWikiHarnessDraftArtifact(taskId, {
          caseId: input.case_id ?? input.caseId ?? null,
          queryText: input.query ?? input.query_text ?? input.queryText ?? null,
          outputPath: input.output_path ?? input.outputPath ?? null,
        });
        sendJson(response, 200, saved);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/harness/memory-draft/promote') {
      try {
        const input = await readJsonBody(request);
        const taskId = input.task_id ?? input.taskId ?? null;
        if (!taskId) {
          sendJson(response, 400, { error: 'task_id is required' });
          return;
        }

        const promoted = await promoteMemoryHarnessDraftArtifactToSuite(taskId, {
          caseId: input.case_id ?? input.caseId ?? null,
          queryText: input.query ?? input.query_text ?? input.queryText ?? null,
          recallTopK: Number(input.top_k ?? input.topK ?? 3) || 3,
          suitePath: input.suite_path ?? input.suitePath ?? null,
          suiteName: input.suite_name ?? input.suiteName ?? 'memory-benchmark-candidate',
        });
        sendJson(response, 200, promoted);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/harness/wiki-draft/promote') {
      try {
        const input = await readJsonBody(request);
        const taskId = input.task_id ?? input.taskId ?? null;
        if (!taskId) {
          sendJson(response, 400, { error: 'task_id is required' });
          return;
        }

        const promoted = await promoteWikiHarnessDraftArtifactToSuite(taskId, {
          caseId: input.case_id ?? input.caseId ?? null,
          queryText: input.query ?? input.query_text ?? input.queryText ?? null,
          suitePath: input.suite_path ?? input.suitePath ?? null,
          suiteName: input.suite_name ?? input.suiteName ?? 'wiki-benchmark-candidate',
        });
        sendJson(response, 200, promoted);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/harness/memory-candidate-suites/run') {
      try {
        const input = await readJsonBody(request);
        const suitePath = input.suite_path ?? input.suitePath ?? null;
        if (!suitePath) {
          sendJson(response, 400, { error: 'suite_path is required' });
          return;
        }

        const run = await runMemoryHarness({
          casePath: suitePath,
          metadata: {
            source: 'candidate-suite',
            suite: input.suite_name ?? input.suiteName ?? 'memory-candidate-suite',
            suite_path: suitePath,
          },
        });
        sendJson(response, 200, { run });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/harness/wiki-candidate-suites/run') {
      try {
        const input = await readJsonBody(request);
        const suitePath = input.suite_path ?? input.suitePath ?? null;
        if (!suitePath) {
          sendJson(response, 400, { error: 'suite_path is required' });
          return;
        }

        const run = await runWikiHarness({
          casePath: suitePath,
          metadata: {
            source: 'candidate-suite',
            suite: input.suite_name ?? input.suiteName ?? 'wiki-candidate-suite',
            suite_path: suitePath,
          },
        });
        sendJson(response, 200, { run });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/harness/wiki-candidate-suites/review') {
      try {
        const input = await readJsonBody(request);
        const suitePath = input.suite_path ?? input.suitePath ?? null;
        const caseId = input.case_id ?? input.caseId ?? null;
        const caseIds = input.case_ids ?? input.caseIds ?? null;
        const decision = input.decision ?? null;
        if (!suitePath || (!caseId && (!Array.isArray(caseIds) || caseIds.length === 0)) || !decision) {
          sendJson(response, 400, { error: 'suite_path, decision, and case_id or case_ids are required' });
          return;
        }

        const reviewed = Array.isArray(caseIds) && caseIds.length > 0
          ? await reviewWikiCandidateSuiteCases(suitePath, {
            caseIds,
            decision,
            reviewerId: input.reviewer_id ?? input.reviewerId ?? 'console_reviewer',
            notes: input.notes ?? null,
          })
          : await reviewWikiCandidateSuiteCase(suitePath, {
            caseId,
            decision,
            reviewerId: input.reviewer_id ?? input.reviewerId ?? 'console_reviewer',
            notes: input.notes ?? null,
          });
        sendJson(response, 200, reviewed);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/harness/memory-candidate-suites/review') {
      try {
        const input = await readJsonBody(request);
        const suitePath = input.suite_path ?? input.suitePath ?? null;
        const caseId = input.case_id ?? input.caseId ?? null;
        const caseIds = input.case_ids ?? input.caseIds ?? null;
        const decision = input.decision ?? null;
        if (!suitePath || (!caseId && (!Array.isArray(caseIds) || caseIds.length === 0)) || !decision) {
          sendJson(response, 400, { error: 'suite_path, decision, and case_id or case_ids are required' });
          return;
        }

        const reviewed = Array.isArray(caseIds) && caseIds.length > 0
          ? await reviewMemoryCandidateSuiteCases(suitePath, {
            caseIds,
            decision,
            reviewerId: input.reviewer_id ?? input.reviewerId ?? 'console_reviewer',
            notes: input.notes ?? null,
          })
          : await reviewMemoryCandidateSuiteCase(suitePath, {
            caseId,
            decision,
            reviewerId: input.reviewer_id ?? input.reviewerId ?? 'console_reviewer',
            notes: input.notes ?? null,
          });
        sendJson(response, 200, reviewed);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/harness/memory-candidate-suites/promote-gold') {
      try {
        const input = await readJsonBody(request);
        const suitePath = input.suite_path ?? input.suitePath ?? null;
        const caseId = input.case_id ?? input.caseId ?? null;
        if (!suitePath || !caseId) {
          sendJson(response, 400, { error: 'suite_path and case_id are required' });
          return;
        }

        const promoted = await promoteApprovedMemoryCandidateCaseToGold(suitePath, {
          caseId,
          goldPath: input.gold_path ?? input.goldPath ?? null,
          historyPath: input.history_path ?? input.historyPath ?? null,
        });
        sendJson(response, 200, promoted);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/harness/memory-gold/rollback') {
      try {
        const input = await readJsonBody(request);
        const caseId = input.case_id ?? input.caseId ?? null;
        const caseIds = Array.isArray(input.case_ids) ? input.case_ids : null;
        if (!caseId && (!caseIds || caseIds.length === 0)) {
          sendJson(response, 400, { error: 'case_id or case_ids is required' });
          return;
        }
        const rolledBack = caseId
          ? await rollbackMemoryGoldPromotion({
            caseId,
            goldPath: input.gold_path ?? input.goldPath ?? null,
            historyPath: input.history_path ?? input.historyPath ?? null,
            reviewerId: input.reviewer_id ?? input.reviewerId ?? 'console_reviewer',
            reason: input.reason ?? 'Console rollback',
          })
          : await rollbackMemoryGoldPromotions({
            caseIds,
            goldPath: input.gold_path ?? input.goldPath ?? null,
            historyPath: input.history_path ?? input.historyPath ?? null,
            reviewerId: input.reviewer_id ?? input.reviewerId ?? 'console_reviewer',
            reason: input.reason ?? 'Console batch rollback',
          });
        sendJson(response, 200, rolledBack);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/harness/runs') {
      try {
        const input = await readJsonBody(request);
        const harnessType = input.harness_type ?? input.harnessType ?? 'task';
        const run = harnessType === 'memory'
          ? await runMemoryHarness({
            cases: input.cases ?? [],
            casePaths: input.case_paths ?? input.casePaths ?? [],
            casePath: input.case_path ?? input.casePath ?? null,
            preset: input.preset ?? null,
            metadata: input.metadata ?? {},
          })
          : harnessType === 'knowledge'
            ? await runKnowledgeHarness({
              generationCases: input.generation_cases ?? input.generationCases ?? [],
              generationCasePaths: input.generation_case_paths ?? input.generationCasePaths ?? [],
              generationCasePath: input.generation_case_path ?? input.generationCasePath ?? null,
              wikiCases: input.wiki_cases ?? input.wikiCases ?? [],
              wikiCasePaths: input.wiki_case_paths ?? input.wikiCasePaths ?? [],
              wikiCasePath: input.wiki_case_path ?? input.wikiCasePath ?? null,
              memoryCases: input.memory_cases ?? input.memoryCases ?? [],
              memoryCasePaths: input.memory_case_paths ?? input.memoryCasePaths ?? [],
              memoryCasePath: input.memory_case_path ?? input.memoryCasePath ?? null,
              preset: input.preset ?? null,
              metadata: input.metadata ?? {},
            })
          : harnessType === 'wiki'
            ? await runWikiHarness({
            cases: input.cases ?? [],
            casePaths: input.case_paths ?? input.casePaths ?? [],
              casePath: input.case_path ?? input.casePath ?? null,
              preset: input.preset ?? null,
              metadata: input.metadata ?? {},
            })
            : await runEvaluationHarness(input.cases ?? [], input.metadata ?? {});
        sendJson(response, 200, { run });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/reviews') {
      const taskId = url.searchParams.get('task_id');
      const status = url.searchParams.get('status');

      sendJson(response, 200, {
        task_id: taskId,
        items: reviewStore.list({
          taskId,
          status,
        }),
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/reviews/resolve') {
      try {
        const input = await readJsonBody(request);
        if (!input.review_id) {
          sendJson(response, 400, { error: 'review_id is required' });
          return;
        }
        if (!input.decision) {
          sendJson(response, 400, { error: 'decision is required' });
          return;
        }
        const review = resolveReviewItem(input.review_id, {
          decision: input.decision,
          reviewer_id: input.reviewer_id,
          notes: input.notes,
          metadata: input.metadata,
        });
        sendJson(response, 200, { review });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/approvals') {
      const taskId = url.searchParams.get('task_id');
      const status = url.searchParams.get('status');
      const items = getApprovalItems(taskId);
      const filteredItems = status ? items.filter((item) => item.review_status === status) : items;

      sendJson(response, 200, {
        task_id: taskId,
        task: taskId ? taskStore.get(taskId) : null,
        items: filteredItems,
        preview: filteredItems[0]?.preview ?? null,
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/approvals/resolve') {
      try {
        const input = await readJsonBody(request);
        if (!input.review_id) {
          sendJson(response, 400, { error: 'review_id is required' });
          return;
        }
        if (!input.decision) {
          sendJson(response, 400, { error: 'decision is required' });
          return;
        }
        const review = reviewStore.get(input.review_id);
        if (!review || review.queue_name !== 'approval') {
          sendJson(response, 400, { error: 'approval review not found' });
          return;
        }
        sendJson(response, 200, {
          review: resolveReviewItem(input.review_id, {
            decision: input.decision,
            reviewer_id: input.reviewer_id,
            notes: input.notes,
            metadata: input.metadata,
          }),
        });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/tasks/resume') {
      try {
        const input = await readJsonBody(request);
        if (!input.task_id) {
          sendJson(response, 400, { error: 'task_id is required' });
          return;
        }
        const result = await resumeTaskExecution({
          taskId: input.task_id,
          reviewerId: input.reviewer_id ?? 'human',
          notes: input.notes ?? null,
          decision: input.decision ?? 'approved',
          overrides: input.overrides ?? {},
        });
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/tasks/takeover') {
      try {
        const input = await readJsonBody(request);
        if (!input.task_id) {
          sendJson(response, 400, { error: 'task_id is required' });
          return;
        }
        const result = await takeoverTaskExecution({
          taskId: input.task_id,
          reviewerId: input.reviewer_id ?? 'human',
          notes: input.notes ?? null,
          overrides: input.overrides ?? {},
        });
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/dead-letters') {
      const taskId = url.searchParams.get('task_id');
      const status = url.searchParams.get('status');
      const replayable = url.searchParams.get('replayable');
      sendJson(response, 200, {
        task_id: taskId,
        items: deadLetterStore.list({
          taskId,
          status,
          replayable: replayable === null ? null : replayable === 'true',
        }),
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/dead-letters') {
      try {
        const input = await readJsonBody(request);
        const record = recordTaskDeadLetter(input.task_id, {
          reason: input.reason,
          error: input.error,
          replayable: input.replayable ?? true,
          payload: input.payload,
          metadata: input.metadata,
        });
        sendJson(response, 200, { record });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/dead-letters/replay') {
      try {
        const input = await readJsonBody(request);
        if (!input.dead_letter_id) {
          sendJson(response, 400, { error: 'dead_letter_id is required' });
          return;
        }
        const result = await replayDeadLetterExecution(input.dead_letter_id, {
          operatorId: input.operator_id ?? 'system',
          notes: input.notes ?? null,
          metadata: input.metadata ?? {},
        });
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/dead-letters/resolve') {
      try {
        const input = await readJsonBody(request);
        if (!input.dead_letter_id) {
          sendJson(response, 400, { error: 'dead_letter_id is required' });
          return;
        }
        const record = input.decision === 'replayed'
          ? deadLetterStore.markReplayed(input.dead_letter_id, {
            replayId: input.replay_id ?? null,
            metadata: input.metadata ?? {},
          })
          : deadLetterStore.resolve(input.dead_letter_id, {
            decision: input.decision ?? 'resolved',
            operator_id: input.operator_id ?? 'system',
            notes: input.notes ?? null,
            metadata: input.metadata ?? {},
          });
        sendJson(response, 200, { record });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/replay') {
      const taskId = url.searchParams.get('task_id');
      const afterSeq = Number(url.searchParams.get('after_seq') ?? 0);
      if (!taskId) {
        sendJson(response, 400, { error: 'task_id is required' });
        return;
      }

      const download = url.searchParams.get('download');
      sendJson(response, 200, replayTaskExecution(taskId, {
        afterSeq: Number.isFinite(afterSeq) ? afterSeq : 0,
      }), {
        headOnly: request.method === 'HEAD',
        downloadName: download && download !== '0' && download !== 'false'
          ? buildDownloadName('trace-replay', taskId)
          : null,
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/tasks/recover') {
      try {
        const input = await readJsonBody(request);
        if (!input.task_id) {
          sendJson(response, 400, { error: 'task_id is required' });
          return;
        }
        const result = await recoverTaskExecution({
          taskId: input.task_id,
          mode: input.mode ?? 'resume',
          reviewerId: input.reviewer_id ?? 'system',
          notes: input.notes ?? null,
          decision: input.decision ?? 'approved',
          overrides: input.overrides ?? {},
          reason: input.reason ?? 'manual_recovery',
        });
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/recovery/drills') {
      const taskId = url.searchParams.get('task_id');
      const status = url.searchParams.get('status');
      sendJson(response, 200, {
        task_id: taskId,
        items: recoveryDrillStore.list({
          taskId,
          status,
        }),
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/recovery/drills') {
      try {
        const input = await readJsonBody(request);
        const drill = recordRecoveryDrill(input.task_id, {
          scenario: input.scenario,
          recovery_mode: input.recovery_mode,
          summary: input.summary,
          metadata: input.metadata,
        });
        sendJson(response, 200, { drill });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/recovery/drills/complete') {
      try {
        const input = await readJsonBody(request);
        if (!input.drill_id) {
          sendJson(response, 400, { error: 'drill_id is required' });
          return;
        }
        const drill = completeRecoveryDrill(input.drill_id, {
          status: input.status ?? 'completed',
          summary: input.summary,
          result: input.result,
          metadata: input.metadata,
        });
        sendJson(response, 200, { drill });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/rl') {
      const taskId = url.searchParams.get('task_id');
      if (!taskId) {
        sendJson(response, 400, { error: 'task_id is required' });
        return;
      }

      sendJson(response, 200, getRLSnapshot(taskId), { headOnly: request.method === 'HEAD' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/rl/rewards') {
      try {
        const input = await readJsonBody(request);
        if (!input.task_id) {
          sendJson(response, 400, { error: 'task_id is required' });
          return;
        }
        const reward = recordRLFeedback(input.task_id, {
          traceId: input.trace_id ?? input.task_id,
          score: input.score ?? 0,
          signal: input.signal ?? 'quality',
          source: input.source ?? 'api',
          confidence: input.confidence ?? 0.5,
          metadata: input.metadata ?? {},
        });
        sendJson(response, 200, { reward });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/rl/policy-logs') {
      try {
        const input = await readJsonBody(request);
        if (!input.task_id) {
          sendJson(response, 400, { error: 'task_id is required' });
          return;
        }
        const policyLog = recordPolicyLog(input.task_id, {
          traceId: input.trace_id ?? input.task_id,
          policyName: input.policy_name ?? 'default_agent_policy',
          policyVersion: input.policy_version ?? 'v0',
          action: input.action ?? 'respond',
          decision: input.decision ?? 'pass',
          rationale: input.rationale ?? null,
          metadata: input.metadata ?? {},
        });
        sendJson(response, 200, { policy_log: policyLog });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/rl/safety-gates') {
      try {
        const input = await readJsonBody(request);
        if (!input.task_id) {
          sendJson(response, 400, { error: 'task_id is required' });
          return;
        }
        const safetyGate = recordSafetyGate(input.task_id, {
          traceId: input.trace_id ?? input.task_id,
          status: input.status ?? 'hold',
          allowOnlineUpdate: input.allow_online_update ?? false,
          rewardEligible: input.reward_eligible ?? false,
          reason: input.reason ?? 'awaiting_evaluation',
          blockingIssues: input.blocking_issues ?? [],
          metadata: input.metadata ?? {},
        });
        sendJson(response, 200, { safety_gate: safetyGate });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/handoffs') {
      const taskId = url.searchParams.get('task_id');
      const status = url.searchParams.get('status');
      const role = url.searchParams.get('role');
      sendJson(response, 200, {
        task_id: taskId,
        items: handoffStore.list({
          taskId,
          status,
          role,
        }),
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/handoffs') {
      try {
        const input = await readJsonBody(request);
        if (!input.task_id) {
          sendJson(response, 400, { error: 'task_id is required' });
          return;
        }
        const packet = createTaskHandoff({
          taskId: input.task_id,
          traceId: input.trace_id ?? input.task_id,
          parentAgentId: input.parent_agent_id ?? 'agent_main',
          targetAgentId: input.target_agent_id ?? 'agent_specialist',
          role: input.role ?? 'specialist',
          objective: input.objective ?? 'Complete delegated work',
          scope: input.scope ?? {},
          inputSummary: input.input_summary ?? 'Delegated specialist work',
          mustKeep: input.must_keep ?? [],
          evidenceRefs: input.evidence_refs ?? [],
          contextSnapshotId: input.context_snapshot_id ?? null,
          outputSchema: input.output_schema ?? {},
          metadata: input.metadata ?? {},
        });
        sendJson(response, 200, { handoff: packet });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/handoffs/complete') {
      try {
        const input = await readJsonBody(request);
        if (!input.handoff_id) {
          sendJson(response, 400, { error: 'handoff_id is required' });
          return;
        }
        const handoff = submitTaskHandoffResult(input.handoff_id, {
          status: input.status ?? 'completed',
          resultSummary: input.result_summary ?? null,
          result: input.result ?? null,
          evidenceRefs: input.evidence_refs ?? [],
          adopted: input.adopted ?? null,
          fallbackStrategy: input.fallback_strategy ?? null,
          joinDecision: input.join_decision ?? null,
          metadata: input.metadata ?? {},
        });
        sendJson(response, 200, { handoff });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/context/budget') {
      const taskId = url.searchParams.get('task_id');
      if (!taskId) {
        sendJson(response, 400, { error: 'task_id is required' });
        return;
      }

      sendJson(response, 200, inspectContextBudget(taskId, {
        traceId: url.searchParams.get('trace_id') ?? taskId,
        scope: url.searchParams.get('scope') ?? 'task',
        modelName: url.searchParams.get('model_name') ?? deepseekClient.model,
        compressionStrategy: url.searchParams.get('compression_strategy') ?? 'hybrid',
        tokenBudget: Number(url.searchParams.get('token_budget') ?? 12000),
        query: url.searchParams.get('q') ?? '',
      }), { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/context/snapshots') {
      const taskId = url.searchParams.get('task_id');
      if (!taskId) {
        sendJson(response, 400, { error: 'task_id is required' });
        return;
      }

      sendJson(response, 200, {
        task_id: taskId,
        items: getCompressionSnapshot(taskId),
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/context/snapshots') {
      try {
        const input = await readJsonBody(request);
        if (!input.task_id) {
          sendJson(response, 400, { error: 'task_id is required' });
          return;
        }
        const snapshot = createContextSnapshot(input.task_id, {
          traceId: input.trace_id ?? input.task_id,
          scope: input.scope ?? 'task',
          modelName: input.model_name ?? deepseekClient.model,
          compressionStrategy: input.compression_strategy ?? 'hybrid',
          tokenBudget: input.token_budget ?? 12000,
          query: input.query ?? '',
        });
        sendJson(response, 200, snapshot);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/multi-agent/delegate') {
      try {
        const input = await readJsonBody(request);
        if (!input.task_id) {
          sendJson(response, 400, { error: 'task_id is required' });
          return;
        }
        const handoffs = delegateTaskWork(input.task_id, {
          traceId: input.trace_id ?? input.task_id,
          parentAgentId: input.parent_agent_id ?? 'agent_main',
          plan: input.plan ?? taskStore.get(input.task_id)?.plan ?? null,
          messageText: input.message_text ?? taskStore.get(input.task_id)?.message?.content_preview ?? '',
          inputSummary: input.input_summary ?? 'Delegated specialist work',
          mustKeep: input.must_keep ?? [],
          evidenceRefs: input.evidence_refs ?? [],
        });
        sendJson(response, 200, { handoffs });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/multi-agent/aggregate') {
      try {
        const input = await readJsonBody(request);
        if (!input.task_id) {
          sendJson(response, 400, { error: 'task_id is required' });
          return;
        }
        sendJson(response, 200, {
          aggregate: aggregateTaskHandoffs(input.task_id),
        });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/multi-agent') {
      const taskId = url.searchParams.get('task_id');
      if (!taskId) {
        sendJson(response, 400, { error: 'task_id is required' });
        return;
      }

      sendJson(response, 200, getMultiAgentSnapshot(taskId), { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/platform-adapters') {
      sendJson(response, 200, {
        adapters: listPlatformAdapters(),
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/deliveries') {
      const taskId = url.searchParams.get('task_id');
      const deliveryId = url.searchParams.get('delivery_id');
      const targetPlatform = url.searchParams.get('target_platform');
      const status = url.searchParams.get('status');
      const deliveries = deliveryService.listDeliveries({
        taskId,
        targetPlatform,
        status,
      });

      sendJson(response, 200, {
        task_id: taskId,
        delivery_id: deliveryId,
        items: deliveryId
          ? deliveries.filter((item) => item.delivery_id === deliveryId)
          : deliveries,
        receipts: deliveryId
          ? deliveryService.listReceipts({ deliveryId })
          : deliveryService.listReceipts({ taskId }),
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/delivery-callbacks') {
      try {
        const input = await readJsonBody(request);
        if (!input.delivery_id && !input.provider_reference) {
          sendJson(response, 400, { error: 'delivery_id or provider_reference is required' });
          return;
        }
        const result = await deliveryService.handleDeliveryCallback(input);
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/wiki') {
      const entryId = url.searchParams.get('entry_id');
      const query = url.searchParams.get('q');
      const includeExpired = ['1', 'true', 'yes', 'on'].includes((url.searchParams.get('include_expired') ?? '').toLowerCase());
      const includeArchived = ['1', 'true', 'yes', 'on'].includes((url.searchParams.get('include_archived') ?? '').toLowerCase());
      const includeDeleted = ['1', 'true', 'yes', 'on'].includes((url.searchParams.get('include_deleted') ?? '').toLowerCase());
      const snapshot = getWikiSnapshot({
        entryId,
        query,
        limit: 6,
        includeExpired,
        includeArchived,
        includeDeleted,
      });

      if (entryId) {
        sendJson(response, 200, {
          entry: snapshot.entry,
          provider_strategy: snapshot.provider_strategy,
          runtime_summary: snapshot.runtime_summary,
        });
        return;
      }

      if (query) {
        sendJson(response, 200, {
          query: snapshot.query,
          items: snapshot.items,
          provider_strategy: snapshot.provider_strategy,
          runtime_summary: snapshot.runtime_summary,
        });
        return;
      }

      sendJson(response, 200, {
        entries: snapshot.entries,
        proposals: snapshot.proposals,
        history: snapshot.history,
        provider_strategy: snapshot.provider_strategy,
        runtime_summary: snapshot.runtime_summary,
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/wiki/history') {
      const entryId = url.searchParams.get('entry_id');
      if (!entryId) {
        sendJson(response, 400, { error: 'entry_id is required' });
        return;
      }

      sendJson(response, 200, {
        entry_id: entryId,
        current: wikiStore.get(entryId),
        history: wikiStore.getHistory(entryId),
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/wiki/proposals') {
      const proposalId = url.searchParams.get('proposal_id');
      const entryId = url.searchParams.get('entry_id');
      const status = url.searchParams.get('status');
      const includeResolved = url.searchParams.get('include_resolved') === '1';

      if (proposalId) {
        sendJson(response, 200, { proposal: wikiStore.getProposal(proposalId) });
        return;
      }

      sendJson(response, 200, {
        proposals: wikiStore.listProposals({
          entryId,
          status,
          includeResolved,
        }),
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/wiki') {
      try {
        const input = await readJsonBody(request);
        const entry = wikiStore.upsert(input);
        auditStore.append(entry.entry_id, {
          trace_id: input.source_trace_id ?? input.entry_id ?? entry.entry_id,
          kind: 'wiki.upsert',
          payload: entry,
        });
        sendJson(response, 200, { entry });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/wiki/import-markdown') {
      try {
        const input = await readJsonBody(request);
        const result = await importWikiMarkdown({
          markdown: input.markdown ?? null,
          filePath: input.file_path ?? input.filePath ?? null,
          mode: input.mode ?? 'proposal',
          entryId: input.entry_id ?? input.entryId ?? null,
          baseVersion: Number.isFinite(input.base_version) ? input.base_version : (Number.isFinite(input.baseVersion) ? input.baseVersion : null),
          sourceTraceId: input.source_trace_id ?? input.sourceTraceId ?? null,
          metadata: input.metadata ?? {},
        });
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/wiki/import-markdown-batch') {
      try {
        const input = await readJsonBody(request);
        const result = await importWikiMarkdownBatch({
          directoryPath: input.directory_path ?? input.directoryPath ?? null,
          filePaths: Array.isArray(input.file_paths) ? input.file_paths : (Array.isArray(input.filePaths) ? input.filePaths : []),
          mode: input.mode ?? 'proposal',
          sourceTraceId: input.source_trace_id ?? input.sourceTraceId ?? null,
          metadata: input.metadata ?? {},
        });
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/wiki/proposals') {
      try {
        const input = await readJsonBody(request);
        const proposal = wikiStore.createProposal(input);
        auditStore.append(proposal.entry_id, {
          trace_id: input.source_trace_id ?? proposal.source_trace_id ?? proposal.entry_id,
          kind: 'wiki.proposal.created',
          payload: proposal,
        });
        sendJson(response, 200, { proposal });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/wiki/proposals/review') {
      try {
        const input = await readJsonBody(request);
        if (!input.proposal_id) {
          sendJson(response, 400, { error: 'proposal_id is required' });
          return;
        }
        if (!input.decision) {
          sendJson(response, 400, { error: 'decision is required' });
          return;
        }
        const result = wikiStore.reviewProposal(input.proposal_id, {
          decision: input.decision,
          reviewer_id: input.reviewer_id,
          notes: input.notes,
          merge_strategy: input.merge_strategy,
          metadata: input.metadata,
        });
        auditStore.append(result.proposal.entry_id, {
          trace_id: input.source_trace_id ?? result.proposal.source_trace_id ?? result.proposal.entry_id,
          kind: 'wiki.proposal.reviewed',
          payload: result,
        });
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/wiki/expire') {
      try {
        const input = await readJsonBody(request);
        if (!input.entry_id) {
          sendJson(response, 400, { error: 'entry_id is required' });
          return;
        }
        const entry = wikiStore.expire(input.entry_id, {
          reason: input.reason,
          metadata: input.metadata,
        });
        auditStore.append(entry.entry_id, {
          trace_id: input.source_trace_id ?? input.entry_id,
          kind: 'wiki.expire',
          payload: entry,
        });
        sendJson(response, 200, { entry });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/wiki/rollback') {
      try {
        const input = await readJsonBody(request);
        if (!input.entry_id) {
          sendJson(response, 400, { error: 'entry_id is required' });
          return;
        }
        if (!Number.isFinite(input.target_version)) {
          sendJson(response, 400, { error: 'target_version is required' });
          return;
        }
        const entry = wikiStore.rollback(input.entry_id, {
          target_version: input.target_version,
          reviewer_id: input.reviewer_id,
          reason: input.reason,
          metadata: input.metadata,
        });
        auditStore.append(entry.entry_id, {
          trace_id: input.source_trace_id ?? input.entry_id,
          kind: 'wiki.rollback',
          payload: {
            entry,
            target_version: input.target_version,
            reviewer_id: input.reviewer_id ?? null,
          },
        });
        sendJson(response, 200, { entry });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/wiki/archive') {
      try {
        const input = await readJsonBody(request);
        if (!input.entry_id) {
          sendJson(response, 400, { error: 'entry_id is required' });
          return;
        }
        const entry = wikiStore.archive(input.entry_id, {
          reason: input.reason,
          metadata: input.metadata,
        });
        auditStore.append(entry.entry_id, {
          trace_id: input.source_trace_id ?? input.entry_id,
          kind: 'wiki.archive',
          payload: entry,
        });
        sendJson(response, 200, { entry });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/wiki/delete') {
      try {
        const input = await readJsonBody(request);
        if (!input.entry_id) {
          sendJson(response, 400, { error: 'entry_id is required' });
          return;
        }
        const entry = wikiStore.softDelete(input.entry_id, {
          reason: input.reason,
          metadata: input.metadata,
        });
        auditStore.append(entry.entry_id, {
          trace_id: input.source_trace_id ?? input.entry_id,
          kind: 'wiki.delete',
          payload: entry,
        });
        sendJson(response, 200, { entry });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/stream') {
      const taskId = url.searchParams.get('task_id');
      if (!taskId) {
        sendJson(response, 400, { error: 'task_id is required' });
        return;
      }

      const lastEventId = Number(url.searchParams.get('last_seq') ?? request.headers['last-event-id'] ?? 0);
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });

      const replay = streamStore.replay(taskId, Number.isFinite(lastEventId) ? lastEventId : 0);
      for (const event of replay) {
        sendSseEvent(response, event);
      }

      response.write('event: heartbeat\n');
      response.write(`data: ${JSON.stringify({ ok: true })}\n\n`);

      const unsubscribe = streamStore.subscribe(taskId, (event) => {
        sendSseEvent(response, event);
      });

      const heartbeat = setInterval(() => {
        response.write('event: heartbeat\n');
        response.write(`data: ${JSON.stringify({ ok: true, timestamp: new Date().toISOString() })}\n\n`);
      }, 15_000);

      request.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });

      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/messages') {
      try {
        const input = await readJsonBody(request);
        try {
          sendJson(response, 200, await processInboundMessage(input, streamStore));
        } catch (error) {
          const taskId = input?.trace_id ?? input?.message_id ?? `task_${Date.now()}`;
          const deadLetter = recordTaskDeadLetter(taskId, {
            reason: 'message_processing_failed',
            error: {
              message: error instanceof Error ? error.message : String(error),
            },
            payload: {
              input,
            },
          });
          sendJson(response, 500, {
            error: error instanceof Error ? error.message : 'Task execution failed',
            dead_letter: deadLetter,
          });
        }
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/app.mjs') {
      serveFile(response, join(PUBLIC_DIR, 'app.mjs'), { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && (url.pathname === '/' || url.pathname === '/index.html')) {
      serveFile(response, join(PUBLIC_DIR, 'index.html'), { headOnly: request.method === 'HEAD' });
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
  });

  return { server, streamStore };
}

export async function startPlatformServer({ port = 3000 } = {}) {
  const { server, streamStore } = createPlatformServer();
  await new Promise((resolve) => {
    server.listen({ port, host: '127.0.0.1' }, resolve);
  });
  const address = server.address();
  return {
    server,
    streamStore,
    url: typeof address === 'object' && address !== null ? `http://127.0.0.1:${address.port}` : `http://127.0.0.1:${port}`,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT ?? 3000);
  const { url } = await startPlatformServer({ port });
  console.log(`ToukeAgent platform server running at ${url}`);
}
