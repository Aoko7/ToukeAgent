import { randomUUID } from 'node:crypto';

function clone(value) {
  return structuredClone(value);
}

export function createHarnessStore() {
  const runs = new Map();

  function create(record = {}) {
    const run = {
      run_id: record.run_id ?? `harness_${randomUUID()}`,
      status: record.status ?? 'completed',
      created_at: record.created_at ?? new Date().toISOString(),
      completed_at: record.completed_at ?? new Date().toISOString(),
      metadata: clone(record.metadata ?? {}),
      summary: clone(record.summary ?? {}),
      metrics: clone(record.metrics ?? {}),
      cases: clone(record.cases ?? []),
    };
    runs.set(run.run_id, run);
    return clone(run);
  }

  function get(runId) {
    const run = runs.get(runId);
    return run ? clone(run) : null;
  }

  function list() {
    return Array.from(runs.values()).map((run) => clone(run));
  }

  return {
    create,
    get,
    list,
  };
}
