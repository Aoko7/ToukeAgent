import { callPythonCore } from './python-core-bridge.mjs';

function clone(value) {
  return structuredClone(value);
}

export function createContextBudgetManager({
  taskStore,
  streamStore,
  auditStore,
  memoryStore,
  handoffStore,
  compressionStore,
} = {}) {
  function buildPayload({
    taskId,
    traceId = taskId,
    scope = 'task',
    modelName = 'deepseek-chat',
    compressionStrategy = 'hybrid',
    tokenBudget = 12000,
    query = '',
  } = {}) {
    const task = clone(taskStore?.get(taskId) ?? null);
    const streamEvents = clone(streamStore?.snapshot(taskId) ?? []);
    const auditEntries = clone(auditStore?.list(taskId) ?? []);
    const memory = clone(memoryStore?.buildContext({
      taskId,
      query: query || task?.message?.content_preview || '',
      limit: 6,
    }) ?? { short_term: [], long_term: [] });
    const handoffs = clone(handoffStore?.list({ taskId }) ?? []);

    return {
      task_id: taskId,
      trace_id: traceId,
      task,
      stream_events: streamEvents,
      audit_entries: auditEntries,
      memory,
      handoffs,
      scope,
      model_name: modelName,
      compression_strategy: compressionStrategy,
      token_budget: tokenBudget,
    };
  }

  function inspectBudget(options = {}) {
    return callPythonCore('inspect_context_budget', buildPayload(options));
  }

  function createSnapshot(options = {}) {
    const inspection = inspectBudget(options);
    const snapshot = compressionStore.create({
      ...inspection,
      metadata: {
        ...inspection.metadata,
        over_budget: inspection.over_budget,
        recommended_action: inspection.recommended_action,
      },
    });
    return {
      snapshot,
      over_budget: inspection.over_budget,
      recommended_action: inspection.recommended_action,
    };
  }

  function recoverSnapshot(snapshotId) {
    const snapshot = compressionStore.get(snapshotId);
    if (!snapshot) {
      return null;
    }

    const task = clone(taskStore?.get(snapshot.task_id) ?? null);
    return callPythonCore('recover_context_snapshot', {
      snapshot,
      task,
    });
  }

  return {
    inspectBudget,
    createSnapshot,
    recoverSnapshot,
  };
}
