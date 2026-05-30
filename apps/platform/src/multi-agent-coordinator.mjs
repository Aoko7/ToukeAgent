import { callPythonCore } from './python-core-bridge.mjs';

export function createMultiAgentCoordinator({
  handoffStore,
  auditStore,
  taskStore,
  contextBudgetManager = null,
} = {}) {
  function suggestSpecialists({ plan = null, messageText = '' } = {}) {
    return callPythonCore('suggest_specialists', {
      plan,
      message_text: messageText,
    });
  }

  function describeCoordination({
    taskId,
    plan = null,
    messageText = '',
  } = {}) {
    return callPythonCore('describe_coordination', {
      task_id: taskId,
      plan,
      message_text: messageText,
      handoffs: handoffStore.list({ taskId }),
    });
  }

  function delegate({
    taskId,
    traceId = taskId,
    parentAgentId = 'agent_main',
    targetAgentId,
    role,
    objective,
    scope = {},
    inputSummary,
    mustKeep = [],
    evidenceRefs = [],
    contextSnapshotId = null,
    outputSchema = {},
    metadata = {},
  } = {}) {
    const packet = handoffStore.create({
      task_id: taskId,
      trace_id: traceId,
      parent_agent_id: parentAgentId,
      target_agent_id: targetAgentId,
      role,
      objective,
      scope,
      input_summary: inputSummary,
      must_keep: mustKeep,
      evidence_refs: evidenceRefs,
      context_snapshot_id: contextSnapshotId,
      output_schema: outputSchema,
      metadata,
    });

    auditStore?.append(taskId, {
      trace_id: traceId,
      kind: 'handoff.created',
      payload: packet,
    });
    taskStore?.upsert(taskId, {
      metadata: {
        multi_agent_enabled: true,
        last_handoff_id: packet.handoff_id,
        handoff_count: handoffStore.list({ taskId }).length,
      },
      checkpoint: {
        kind: 'handoff.created',
        summary: `Delegated ${role} handoff`,
        metadata: {
          handoff_id: packet.handoff_id,
          target_agent_id: targetAgentId,
        },
      },
    });

    return packet;
  }

  function delegateSuggested({
    taskId,
    traceId = taskId,
    parentAgentId = 'agent_main',
    plan = null,
    messageText = '',
    inputSummary = 'Delegated specialist work',
    mustKeep = [],
    evidenceRefs = [],
  } = {}) {
    const suggestions = suggestSpecialists({ plan, messageText });
    const sharedSnapshot = suggestions.length > 0 && contextBudgetManager
      ? contextBudgetManager.createSnapshot({
        taskId,
        traceId,
        scope: 'agent',
        tokenBudget: 8000,
      }).snapshot.snapshot_id
      : null;

    return suggestions.map((suggestion) => delegate({
      taskId,
      traceId,
      parentAgentId,
      targetAgentId: suggestion.target_agent_id,
      role: suggestion.role,
      objective: suggestion.objective,
      scope: suggestion.scope,
      inputSummary,
      mustKeep,
      evidenceRefs,
      contextSnapshotId: sharedSnapshot,
      outputSchema: suggestion.output_schema,
      metadata: {
        strategy: 'suggested',
        persona_id: suggestion.persona_id ?? null,
        persona_pack_id: suggestion.persona_pack_id ?? null,
        specialist_profile: suggestion.specialist_profile ?? null,
      },
    }));
  }

  function submitResult({
    handoffId,
    status = 'completed',
    resultSummary = null,
    result = null,
    evidenceRefs = [],
    adopted = null,
    fallbackStrategy = null,
    joinDecision = null,
    metadata = {},
  } = {}) {
    const updated = handoffStore.recordResult(handoffId, {
      status,
      result_summary: resultSummary,
      result,
      evidence_refs: evidenceRefs,
      adopted,
      fallback_strategy: fallbackStrategy,
      join_decision: joinDecision,
      metadata,
    });

    auditStore?.append(updated.task_id, {
      trace_id: updated.trace_id,
      kind: `handoff.${status}`,
      payload: updated,
    });
    taskStore?.upsert(updated.task_id, {
      metadata: {
        last_handoff_id: updated.handoff_id,
        last_handoff_status: updated.status,
      },
      checkpoint: {
        kind: `handoff.${status}`,
        summary: `Handoff ${updated.role} ${status}`,
        metadata: {
          handoff_id: updated.handoff_id,
        },
      },
    });

    return updated;
  }

  function aggregate({ taskId, persist = true } = {}) {
    const handoffs = handoffStore.list({ taskId });
    const aggregateResult = callPythonCore('aggregate_handoffs', {
      task_id: taskId,
      handoffs,
    });

    if (persist) {
      taskStore?.upsert(taskId, {
        metadata: {
          multi_agent_fallback_strategy: aggregateResult.fallback.strategy,
          multi_agent_failed_count: aggregateResult.failed_count,
          multi_agent_completed_count: aggregateResult.completed_count,
        },
        checkpoint: {
          kind: 'handoff.aggregate',
          summary: `Aggregated ${handoffs.length} handoff(s)`,
          metadata: {
            fallback_strategy: aggregateResult.fallback.strategy,
          },
        },
      });
      auditStore?.append(taskId, {
        trace_id: taskId,
        kind: 'handoff.aggregate',
        payload: aggregateResult,
      });
    }

    return aggregateResult;
  }

  return {
    suggestSpecialists,
    describeCoordination,
    delegate,
    delegateSuggested,
    submitResult,
    aggregate,
  };
}
