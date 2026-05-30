import { randomUUID } from 'node:crypto';
import { createContextCompressionSnapshot } from '../../../packages/contracts/src/index.mjs';

function clone(value) {
  return structuredClone(value);
}

export function createCompressionStore() {
  const records = new Map();

  function create(input = {}) {
    const snapshot = createContextCompressionSnapshot({
      ...input,
      snapshot_id: input.snapshot_id ?? `ctx_${randomUUID()}`,
    });
    records.set(snapshot.snapshot_id, snapshot);
    return clone(snapshot);
  }

  function get(snapshotId) {
    const snapshot = records.get(snapshotId);
    return snapshot ? clone(snapshot) : null;
  }

  function list({ taskId = null, traceId = null, scope = null } = {}) {
    return Array.from(records.values())
      .filter((item) => (taskId ? item.task_id === taskId : true))
      .filter((item) => (traceId ? item.trace_id === traceId : true))
      .filter((item) => (scope ? item.scope === scope : true))
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .map((item) => clone(item));
  }

  function latest(taskId) {
    return list({ taskId }).at(-1) ?? null;
  }

  return {
    create,
    get,
    list,
    latest,
  };
}
