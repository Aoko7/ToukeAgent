import { randomUUID } from 'node:crypto';

function clone(value) {
  return structuredClone(value);
}

export function createRecoveryDrillStore() {
  const drills = new Map();

  function create(input = {}) {
    const now = new Date().toISOString();
    const record = {
      drill_id: input.drill_id ?? `drill_${randomUUID()}`,
      task_id: input.task_id ?? null,
      trace_id: input.trace_id ?? input.task_id ?? null,
      scenario: input.scenario ?? 'worker_restart',
      recovery_mode: input.recovery_mode ?? 'resume',
      status: input.status ?? 'planned',
      summary: input.summary ?? null,
      result: clone(input.result ?? null),
      metadata: clone(input.metadata ?? {}),
      created_at: input.created_at ?? now,
      completed_at: input.completed_at ?? null,
      updated_at: input.updated_at ?? now,
    };
    drills.set(record.drill_id, record);
    return clone(record);
  }

  function get(drillId) {
    const record = drills.get(drillId);
    return record ? clone(record) : null;
  }

  function list({ taskId = null, status = null } = {}) {
    return Array.from(drills.values())
      .filter((item) => (taskId ? item.task_id === taskId : true))
      .filter((item) => (status ? item.status === status : true))
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map((item) => clone(item));
  }

  function complete(drillId, {
    status = 'completed',
    summary = null,
    result = null,
    metadata = {},
  } = {}) {
    const current = drills.get(drillId);
    if (!current) {
      throw new Error(`Unknown recovery drill: ${drillId}`);
    }

    const updated = {
      ...current,
      status,
      summary: summary ?? current.summary,
      result: result === undefined ? clone(current.result) : clone(result),
      metadata: {
        ...current.metadata,
        ...clone(metadata),
      },
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    drills.set(drillId, updated);
    return clone(updated);
  }

  return {
    create,
    get,
    list,
    complete,
  };
}
