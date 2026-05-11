import { randomUUID } from 'node:crypto';

export function createAuditStore() {
  const buckets = new Map();

  function ensureBucket(taskId) {
    if (!buckets.has(taskId)) {
      buckets.set(taskId, []);
    }
    return buckets.get(taskId);
  }

  function append(taskId, entry) {
    const bucket = ensureBucket(taskId);
    const stored = {
      entry_id: entry.entry_id ?? `audit_${randomUUID()}`,
      task_id: taskId,
      trace_id: entry.trace_id ?? taskId,
      kind: entry.kind,
      timestamp: entry.timestamp ?? new Date().toISOString(),
      payload: entry.payload === undefined ? {} : structuredClone(entry.payload),
      metadata: entry.metadata === undefined ? {} : structuredClone(entry.metadata),
    };
    bucket.push(stored);
    return stored;
  }

  function list(taskId) {
    return ensureBucket(taskId).slice();
  }

  return {
    append,
    list,
  };
}
