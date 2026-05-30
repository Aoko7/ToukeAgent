import { randomUUID } from 'node:crypto';

function clone(value) {
  return structuredClone(value);
}

function createDefaultTask(taskId) {
  const now = new Date().toISOString();
  return {
    task_id: taskId,
    trace_id: taskId,
    status: 'queued',
    phase: 'created',
    persona_id: null,
    plan_id: null,
    message: null,
    message_snapshot: null,
    plan: null,
    run_state: null,
    current_step_id: null,
    completed_steps: 0,
    total_steps: 0,
    step_results: [],
    output: null,
    checkpoints: [],
    metadata: {},
    created_at: now,
    updated_at: now,
  };
}

function normalizeCheckpoint(checkpoint) {
  if (!checkpoint) return null;
  return {
    checkpoint_id: checkpoint.checkpoint_id ?? `chk_${randomUUID()}`,
    kind: checkpoint.kind ?? 'update',
    summary: checkpoint.summary ?? null,
    timestamp: checkpoint.timestamp ?? new Date().toISOString(),
    metadata: clone(checkpoint.metadata ?? {}),
  };
}

export function createTaskStore() {
  const buckets = new Map();

  function ensure(taskId) {
    if (!buckets.has(taskId)) {
      buckets.set(taskId, createDefaultTask(taskId));
    }
    return buckets.get(taskId);
  }

  function upsert(taskId, patch = {}) {
    const current = ensure(taskId);
    const next = {
      ...current,
      ...clone(patch),
      task_id: taskId,
      trace_id: patch.trace_id ?? current.trace_id ?? taskId,
      updated_at: new Date().toISOString(),
    };

    if (patch.message !== undefined) next.message = patch.message === null ? null : clone(patch.message);
    if (patch.message_snapshot !== undefined) next.message_snapshot = patch.message_snapshot === null ? null : clone(patch.message_snapshot);
    if (patch.plan !== undefined) next.plan = patch.plan === null ? null : clone(patch.plan);
    if (patch.run_state !== undefined) next.run_state = patch.run_state === null ? null : clone(patch.run_state);
    if (patch.output !== undefined) next.output = patch.output === null ? null : clone(patch.output);
    if (patch.step_results !== undefined) next.step_results = clone(patch.step_results);
    if (patch.metadata !== undefined) next.metadata = { ...current.metadata, ...clone(patch.metadata) };
    if (patch.checkpoint) {
      next.checkpoints = [...current.checkpoints, normalizeCheckpoint(patch.checkpoint)];
    } else {
      next.checkpoints = clone(current.checkpoints);
    }

    buckets.set(taskId, next);
    return clone(next);
  }

  function get(taskId) {
    return clone(ensure(taskId));
  }

  function list() {
    return Array.from(buckets.values()).map((item) => clone(item));
  }

  return { upsert, get, list };
}
