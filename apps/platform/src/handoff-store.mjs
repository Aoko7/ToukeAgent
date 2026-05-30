import { randomUUID } from 'node:crypto';
import { createAgentHandoffPacket } from '../../../packages/contracts/src/index.mjs';

function clone(value) {
  return structuredClone(value);
}

function normalizeRecord(input, current = null) {
  const base = createAgentHandoffPacket({
    ...current,
    ...input,
    handoff_id: input.handoff_id ?? current?.handoff_id ?? `handoff_${randomUUID()}`,
    task_id: input.task_id ?? current?.task_id,
    trace_id: input.trace_id ?? current?.trace_id ?? input.task_id ?? current?.task_id,
    parent_agent_id: input.parent_agent_id ?? current?.parent_agent_id ?? 'agent_main',
    target_agent_id: input.target_agent_id ?? current?.target_agent_id ?? 'agent_specialist',
    role: input.role ?? current?.role ?? 'specialist',
    objective: input.objective ?? current?.objective ?? 'Complete delegated work',
    scope: input.scope ?? current?.scope ?? {},
    input_summary: input.input_summary ?? current?.input_summary ?? 'No summary provided',
    must_keep: input.must_keep ?? current?.must_keep ?? [],
    evidence_refs: input.evidence_refs ?? current?.evidence_refs ?? [],
    context_snapshot_id: input.context_snapshot_id ?? current?.context_snapshot_id ?? null,
    output_schema: input.output_schema ?? current?.output_schema ?? {},
    status: input.status ?? current?.status ?? 'created',
    metadata: input.metadata === undefined
      ? clone(current?.metadata ?? {})
      : { ...clone(current?.metadata ?? {}), ...clone(input.metadata ?? {}) },
  });

  return {
    ...base,
    created_at: current?.created_at ?? input.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: input.completed_at ?? current?.completed_at ?? null,
    result_summary: input.result_summary ?? current?.result_summary ?? null,
    result: input.result === undefined ? clone(current?.result ?? null) : clone(input.result),
    adopted: input.adopted ?? current?.adopted ?? null,
    fallback_strategy: input.fallback_strategy ?? current?.fallback_strategy ?? null,
    join_decision: input.join_decision === undefined ? clone(current?.join_decision ?? null) : clone(input.join_decision),
  };
}

export function createHandoffStore() {
  const records = new Map();

  function create(input = {}) {
    const record = normalizeRecord(input);
    records.set(record.handoff_id, record);
    return clone(record);
  }

  function get(handoffId) {
    const record = records.get(handoffId);
    return record ? clone(record) : null;
  }

  function list({
    taskId = null,
    status = null,
    role = null,
    parentAgentId = null,
    targetAgentId = null,
  } = {}) {
    return Array.from(records.values())
      .filter((item) => (taskId ? item.task_id === taskId : true))
      .filter((item) => (status ? item.status === status : true))
      .filter((item) => (role ? item.role === role : true))
      .filter((item) => (parentAgentId ? item.parent_agent_id === parentAgentId : true))
      .filter((item) => (targetAgentId ? item.target_agent_id === targetAgentId : true))
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .map((item) => clone(item));
  }

  function update(handoffId, patch = {}) {
    const current = records.get(handoffId);
    if (!current) {
      throw new Error(`Unknown handoff packet: ${handoffId}`);
    }

    const updated = normalizeRecord({
      ...patch,
      handoff_id: handoffId,
    }, current);
    records.set(handoffId, updated);
    return clone(updated);
  }

  function recordResult(handoffId, {
    status = 'completed',
    result_summary = null,
    result = null,
    evidence_refs = null,
    adopted = null,
    fallback_strategy = null,
    join_decision = null,
    metadata = {},
  } = {}) {
    return update(handoffId, {
      status,
      result_summary,
      result,
      evidence_refs: evidence_refs ?? undefined,
      adopted,
      fallback_strategy,
      join_decision,
      completed_at: ['completed', 'failed', 'cancelled'].includes(status) ? new Date().toISOString() : null,
      metadata,
    });
  }

  return {
    create,
    get,
    list,
    update,
    recordResult,
  };
}
