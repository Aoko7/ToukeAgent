import { randomUUID } from 'node:crypto';

function clone(value) {
  return structuredClone(value);
}

export function createDeadLetterStore() {
  const records = new Map();

  function create(input = {}) {
    const now = new Date().toISOString();
    const record = {
      dead_letter_id: input.dead_letter_id ?? `dlq_${randomUUID()}`,
      task_id: input.task_id ?? null,
      trace_id: input.trace_id ?? input.task_id ?? null,
      status: input.status ?? 'open',
      reason: input.reason ?? 'unclassified_failure',
      failure_count: Number.isFinite(input.failure_count) ? input.failure_count : 1,
      replayable: input.replayable ?? true,
      payload: clone(input.payload ?? {}),
      metadata: clone(input.metadata ?? {}),
      created_at: input.created_at ?? now,
      updated_at: input.updated_at ?? now,
      last_replayed_at: input.last_replayed_at ?? null,
      resolved_at: input.resolved_at ?? null,
      resolution: clone(input.resolution ?? null),
    };

    records.set(record.dead_letter_id, record);
    return clone(record);
  }

  function get(deadLetterId) {
    const record = records.get(deadLetterId);
    return record ? clone(record) : null;
  }

  function list({ taskId = null, status = null, replayable = null } = {}) {
    return Array.from(records.values())
      .filter((item) => (taskId ? item.task_id === taskId : true))
      .filter((item) => (status ? item.status === status : true))
      .filter((item) => (replayable === null ? true : item.replayable === replayable))
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map((item) => clone(item));
  }

  function update(deadLetterId, patch = {}) {
    const current = records.get(deadLetterId);
    if (!current) {
      throw new Error(`Unknown dead-letter item: ${deadLetterId}`);
    }

    const updated = {
      ...current,
      ...clone(patch),
      payload: patch.payload === undefined ? clone(current.payload) : clone(patch.payload),
      metadata: patch.metadata === undefined ? clone(current.metadata) : { ...current.metadata, ...clone(patch.metadata) },
      resolution: patch.resolution === undefined ? clone(current.resolution) : clone(patch.resolution),
      updated_at: new Date().toISOString(),
    };
    records.set(deadLetterId, updated);
    return clone(updated);
  }

  function markReplayed(deadLetterId, { replayId = null, metadata = {} } = {}) {
    return update(deadLetterId, {
      status: 'replayed',
      last_replayed_at: new Date().toISOString(),
      metadata: {
        replay_id: replayId,
        ...metadata,
      },
    });
  }

  function resolve(deadLetterId, {
    decision = 'resolved',
    operator_id = 'system',
    notes = null,
    metadata = {},
  } = {}) {
    const now = new Date().toISOString();
    return update(deadLetterId, {
      status: 'resolved',
      resolved_at: now,
      resolution: {
        decision,
        operator_id,
        notes,
        metadata: clone(metadata),
        resolved_at: now,
      },
    });
  }

  return {
    create,
    get,
    list,
    update,
    markReplayed,
    resolve,
  };
}
