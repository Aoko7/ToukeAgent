import { randomUUID } from 'node:crypto';

function clone(value) {
  return structuredClone(value);
}

export function createHarnessStore() {
  const runs = new Map();

  function create(record = {}) {
    const run = {
      run_id: record.run_id ?? `harness_${randomUUID()}`,
      harness_type: record.harness_type ?? 'task',
      status: record.status ?? 'completed',
      created_at: record.created_at ?? new Date().toISOString(),
      completed_at: record.completed_at ?? new Date().toISOString(),
      metadata: clone(record.metadata ?? {}),
      summary: clone(record.summary ?? {}),
      metrics: clone(record.metrics ?? {}),
      cases: clone(record.cases ?? []),
      artifacts: clone(record.artifacts ?? {}),
    };
    runs.set(run.run_id, run);
    return clone(run);
  }

  function get(runId) {
    const run = runs.get(runId);
    return run ? clone(run) : null;
  }

  function list(options = {}) {
    const harnessType = options.harnessType ?? null;
    return Array.from(runs.values())
      .filter((run) => (harnessType ? run.harness_type === harnessType : true))
      .map((run) => clone(run));
  }

  return {
    create,
    get,
    list,
  };
}
