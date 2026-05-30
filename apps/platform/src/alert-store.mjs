import { randomUUID } from 'node:crypto';

function clone(value) {
  return structuredClone(value);
}

function normalizeAlert(input = {}) {
  const now = new Date().toISOString();
  return {
    alert_id: input.alert_id ?? `alert_${randomUUID()}`,
    dedupe_key: input.dedupe_key ?? null,
    scope: input.scope ?? 'task',
    category: input.category ?? 'slo',
    code: input.code ?? 'unknown_alert',
    severity: input.severity ?? 'medium',
    status: input.status ?? 'open',
    task_id: input.task_id ?? null,
    trace_id: input.trace_id ?? input.task_id ?? null,
    message: input.message ?? null,
    observed: clone(input.observed ?? null),
    threshold: clone(input.threshold ?? null),
    metadata: clone(input.metadata ?? {}),
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now,
    resolved_at: input.resolved_at ?? null,
    resolution: clone(input.resolution ?? null),
  };
}

export function createAlertStore() {
  const records = new Map();
  const dedupe = new Map();

  function record(input = {}) {
    const existingId = input.dedupe_key ? dedupe.get(input.dedupe_key) : null;
    if (existingId && records.has(existingId)) {
      const current = records.get(existingId);
      const updated = {
        ...current,
        ...clone(input),
        alert_id: current.alert_id,
        dedupe_key: current.dedupe_key ?? input.dedupe_key ?? null,
        created_at: current.created_at,
        updated_at: new Date().toISOString(),
        resolution: current.status === 'resolved' && input.status !== 'resolved'
          ? null
          : clone(input.resolution ?? current.resolution ?? null),
        resolved_at: input.status === 'resolved'
          ? (input.resolved_at ?? current.resolved_at ?? new Date().toISOString())
          : null,
      };
      records.set(existingId, updated);
      return clone(updated);
    }

    const alert = normalizeAlert(input);
    records.set(alert.alert_id, alert);
    if (alert.dedupe_key) {
      dedupe.set(alert.dedupe_key, alert.alert_id);
    }
    return clone(alert);
  }

  function get(alertId) {
    const alert = records.get(alertId);
    return alert ? clone(alert) : null;
  }

  function list({ taskId = null, status = null, category = null, scope = null } = {}) {
    return Array.from(records.values())
      .filter((alert) => (taskId ? alert.task_id === taskId : true))
      .filter((alert) => (status ? alert.status === status : true))
      .filter((alert) => (category ? alert.category === category : true))
      .filter((alert) => (scope ? alert.scope === scope : true))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .map((alert) => clone(alert));
  }

  function resolve(alertId, {
    resolver_id = 'system',
    notes = null,
    metadata = {},
  } = {}) {
    const current = records.get(alertId);
    if (!current) {
      throw new Error(`Unknown alert: ${alertId}`);
    }

    const now = new Date().toISOString();
    const updated = {
      ...current,
      status: 'resolved',
      updated_at: now,
      resolved_at: now,
      resolution: {
        resolver_id,
        notes,
        metadata: clone(metadata),
        resolved_at: now,
      },
    };
    records.set(alertId, updated);
    return clone(updated);
  }

  return {
    record,
    get,
    list,
    resolve,
  };
}
