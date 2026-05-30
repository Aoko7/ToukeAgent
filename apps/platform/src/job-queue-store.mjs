import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

function clone(value) {
  return structuredClone(value);
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }

  if (error && typeof error === 'object') {
    return {
      name: String(error.name ?? 'Error'),
      message: String(error.message ?? error),
      stack: error.stack ?? null,
    };
  }

  return {
    name: 'Error',
    message: String(error),
    stack: null,
  };
}

function parseIso(value) {
  const timestamp = Date.parse(String(value ?? ''));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function safeIso(clock) {
  const value = clock();
  return typeof value === 'string' && value ? value : new Date().toISOString();
}

function jobSortKey(job) {
  return `${job.queued_at ?? ''}:${job.job_id ?? ''}`;
}

function normalizeJob(input = {}, clock, leaseMs) {
  const now = safeIso(clock);
  return {
    job_id: input.job_id ?? `job_${randomUUID()}`,
    job_type: input.job_type ?? 'unknown',
    payload: clone(input.payload ?? {}),
    trace_id: input.trace_id ?? null,
    task_id: input.task_id ?? null,
    run_id: input.run_id ?? null,
    step_id: input.step_id ?? null,
    persona_id: input.persona_id ?? null,
    submitted_by_worker_id: input.submitted_by_worker_id ?? null,
    worker_id: input.worker_id ?? null,
    status: input.status ?? 'queued',
    attempts: Number.isFinite(input.attempts) ? Number(input.attempts) : 0,
    queued_at: input.queued_at ?? now,
    started_at: input.started_at ?? null,
    finished_at: input.finished_at ?? null,
    leased_at: input.leased_at ?? null,
    lease_expires_at: input.lease_expires_at ?? null,
    result: clone(input.result ?? null),
    error: clone(input.error ?? null),
    metadata: clone(input.metadata ?? {}),
    lease_ms: Number.isFinite(input.lease_ms) ? Number(input.lease_ms) : leaseMs,
  };
}

function summarizeJob(job) {
  return {
    job_id: job.job_id,
    job_type: job.job_type,
    status: job.status,
    trace_id: job.trace_id,
    task_id: job.task_id,
    run_id: job.run_id,
    step_id: job.step_id,
    persona_id: job.persona_id,
    worker_id: job.worker_id,
    submitted_by_worker_id: job.submitted_by_worker_id,
    attempts: job.attempts,
    queued_at: job.queued_at,
    started_at: job.started_at,
    leased_at: job.leased_at,
    lease_expires_at: job.lease_expires_at,
    finished_at: job.finished_at,
    metadata: clone(job.metadata ?? {}),
    error: clone(job.error ?? null),
  };
}

function createEmptyState() {
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    jobs: [],
  };
}

export function createPersistentJobQueueStore({
  filePath = null,
  clock = () => new Date().toISOString(),
  leaseMs = 30_000,
} = {}) {
  const waiters = new Map();
  const state = createEmptyState();

  function persist() {
    if (!filePath) {
      return;
    }

    mkdirSync(dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${randomUUID()}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(state, null, 2));
    renameSync(tmpPath, filePath);
  }

  function load() {
    if (!filePath || !existsSync(filePath)) {
      return;
    }

    const raw = readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      return;
    }

    const parsed = JSON.parse(raw);
    const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
    state.version = Number.isFinite(parsed?.version) ? Number(parsed.version) : 1;
    state.updated_at = parsed?.updated_at ?? state.updated_at;
    state.jobs = jobs.map((job) => normalizeJob(job, clock, leaseMs));
  }

  function touch() {
    state.updated_at = safeIso(clock);
    persist();
  }

  function findJob(jobId) {
    return state.jobs.find((job) => job.job_id === jobId) ?? null;
  }

  function clearWaiter(jobId) {
    waiters.delete(jobId);
  }

  function settle(job, kind, value) {
    const waiter = waiters.get(job.job_id);
    if (!waiter) {
      return;
    }

    clearWaiter(job.job_id);
    if (kind === 'complete') {
      waiter.resolve(value);
    } else {
      waiter.reject(value);
    }
  }

  function requeueStaleJobs({ now = safeIso(clock) } = {}) {
    const nowMs = parseIso(now);
    const requeued = [];

    for (const job of state.jobs) {
      if (job.status !== 'running' || !job.lease_expires_at) {
        continue;
      }

      const expiresAt = parseIso(job.lease_expires_at);
      if (expiresAt === null || nowMs === null || expiresAt > nowMs) {
        continue;
      }

      job.status = 'queued';
      job.worker_id = null;
      job.leased_at = null;
      job.lease_expires_at = null;
      job.metadata = {
        ...clone(job.metadata ?? {}),
        requeued_at: now,
        requeue_reason: 'lease_expired',
      };
      requeued.push(summarizeJob(job));
    }

    if (requeued.length > 0) {
      touch();
    }

    return requeued;
  }

  function requeue(jobId, {
    workerId = null,
    reason = 'manual_requeue',
    error = null,
    now = safeIso(clock),
  } = {}) {
    const job = findJob(jobId);
    if (!job) {
      throw new Error(`Unknown job id: ${jobId}`);
    }

    if (!['running', 'failed'].includes(job.status)) {
      throw new Error(`Job ${jobId} cannot be requeued from status ${job.status}`);
    }

    if (workerId && job.worker_id && job.worker_id !== workerId) {
      throw new Error(`Job ${jobId} is leased by another worker`);
    }

    const normalizedError = error ? serializeError(error) : null;
    job.status = 'queued';
    job.worker_id = null;
    job.leased_at = null;
    job.lease_expires_at = null;
    job.finished_at = null;
    job.result = null;
    job.error = null;
    job.metadata = {
      ...clone(job.metadata ?? {}),
      last_requeue_at: now,
      last_requeue_reason: reason,
      last_error: normalizedError,
    };
    touch();
    return clone(job);
  }

  function enqueue(input = {}) {
    const job = normalizeJob({
      ...clone(input),
      lease_ms: leaseMs,
    }, clock, leaseMs);

    if (findJob(job.job_id)) {
      throw new Error(`Duplicate job id: ${job.job_id}`);
    }

    state.jobs.push(job);
    touch();
    return clone(job);
  }

  function claimNext({ workerId = 'worker' } = {}) {
    requeueStaleJobs();

    const candidate = state.jobs
      .filter((job) => job.status === 'queued')
      .sort((left, right) => jobSortKey(left).localeCompare(jobSortKey(right)))[0] ?? null;

    if (!candidate) {
      return null;
    }

    const now = safeIso(clock);
    candidate.status = 'running';
    candidate.worker_id = workerId;
    candidate.attempts = (Number(candidate.attempts) || 0) + 1;
    candidate.started_at = candidate.started_at ?? now;
    candidate.leased_at = now;
    candidate.lease_expires_at = new Date(Date.parse(now) + leaseMs).toISOString();
    touch();
    return clone(candidate);
  }

  function renewLease(jobId, { workerId = null } = {}) {
    const job = findJob(jobId);
    if (!job) {
      throw new Error(`Unknown job id: ${jobId}`);
    }

    if (job.status !== 'running') {
      throw new Error(`Job ${jobId} is not running`);
    }

    if (workerId && job.worker_id && job.worker_id !== workerId) {
      throw new Error(`Job ${jobId} is leased by another worker`);
    }

    const now = safeIso(clock);
    job.leased_at = now;
    job.lease_expires_at = new Date(Date.parse(now) + leaseMs).toISOString();
    touch();
    return clone(job);
  }

  function attachWaiter(jobId, { resolve, reject } = {}) {
    waiters.set(jobId, {
      resolve: typeof resolve === 'function' ? resolve : () => {},
      reject: typeof reject === 'function' ? reject : () => {},
    });

    return () => clearWaiter(jobId);
  }

  function complete(jobId, result, { workerId = null } = {}) {
    const job = findJob(jobId);
    if (!job) {
      throw new Error(`Unknown job id: ${jobId}`);
    }

    if (job.status !== 'running') {
      throw new Error(`Job ${jobId} is not running`);
    }

    if (workerId && job.worker_id && job.worker_id !== workerId) {
      throw new Error(`Job ${jobId} is leased by another worker`);
    }

    job.status = 'completed';
    job.finished_at = safeIso(clock);
    job.result = clone(result ?? null);
    job.error = null;
    job.lease_expires_at = null;
    touch();
    const settled = clone(job);
    settle(settled, 'complete', result);
    return settled;
  }

  function fail(jobId, error, { workerId = null } = {}) {
    const job = findJob(jobId);
    if (!job) {
      throw new Error(`Unknown job id: ${jobId}`);
    }

    if (job.status !== 'running') {
      throw new Error(`Job ${jobId} is not running`);
    }

    if (workerId && job.worker_id && job.worker_id !== workerId) {
      throw new Error(`Job ${jobId} is leased by another worker`);
    }

    const normalized = serializeError(error);
    job.status = 'failed';
    job.finished_at = safeIso(clock);
    job.result = null;
    job.error = normalized;
    job.lease_expires_at = null;
    touch();
    const settled = clone(job);
    settle(settled, 'fail', error instanceof Error ? error : new Error(normalized.message));
    return settled;
  }

  function list({
    status = null,
    traceId = null,
    taskId = null,
    workerId = null,
  } = {}) {
    return state.jobs
      .filter((job) => (status ? job.status === status : true))
      .filter((job) => (traceId ? job.trace_id === traceId : true))
      .filter((job) => (taskId ? job.task_id === taskId : true))
      .filter((job) => (workerId ? job.worker_id === workerId : true))
      .sort((left, right) => jobSortKey(left).localeCompare(jobSortKey(right)))
      .map((job) => clone(job));
  }

  function snapshot() {
    const jobs = state.jobs
      .slice()
      .sort((left, right) => jobSortKey(left).localeCompare(jobSortKey(right)))
      .map((job) => summarizeJob(job));

    const counts = jobs.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] ?? 0) + 1;
      return acc;
    }, { queued: 0, running: 0, completed: 0, failed: 0 });

    return {
      file_path: filePath,
      version: state.version,
      updated_at: state.updated_at,
      lease_ms: leaseMs,
      queued: counts.queued,
      running: counts.running,
      completed: counts.completed,
      failed: counts.failed,
      total: jobs.length,
      jobs,
    };
  }

  load();
  requeueStaleJobs();

  return {
    attachWaiter,
    claimNext,
    complete,
    enqueue,
    fail,
    findJob: (jobId) => {
      const job = findJob(jobId);
      return job ? clone(job) : null;
    },
    list,
    requeueStaleJobs,
    requeue,
    renewLease,
    snapshot,
  };
}
