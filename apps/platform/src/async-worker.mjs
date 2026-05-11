import { randomUUID } from 'node:crypto';

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    name: 'Error',
    message: String(error),
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
    metadata: job.metadata,
    queued_at: job.queued_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    error: job.error,
  };
}

export function createAsyncWorker({
  bus = null,
  concurrency = 1,
} = {}) {
  const handlers = new Map();
  const pending = [];
  const jobs = new Map();
  let activeCount = 0;

  function register(jobType, handler) {
    handlers.set(jobType, handler);
  }

  function snapshot() {
    return {
      active: activeCount,
      queued: pending.length,
      jobs: Array.from(jobs.values()).map(summarizeJob),
    };
  }

  async function runJob(job) {
    try {
      const handler = handlers.get(job.job_type);
      if (!handler) {
        throw new Error(`Unknown job type: ${job.job_type}`);
      }

      job.status = 'running';
      job.started_at = new Date().toISOString();
      await bus?.publish('worker.job.started', summarizeJob(job));

      const result = await handler(job.payload, summarizeJob(job));
      job.status = 'completed';
      job.finished_at = new Date().toISOString();
      await bus?.publish('worker.job.completed', {
        ...summarizeJob(job),
        result_summary: result?.summary ?? null,
        metrics: result?.metrics ?? {},
      });
      job.resolve(result);
    } catch (error) {
      job.status = 'failed';
      job.finished_at = new Date().toISOString();
      job.error = serializeError(error);
      await bus?.publish('worker.job.failed', summarizeJob(job));
      job.reject(error);
    } finally {
      activeCount -= 1;
      schedulePump();
    }
  }

  function schedulePump() {
    queueMicrotask(() => {
      while (activeCount < concurrency && pending.length > 0) {
        const job = pending.shift();
        activeCount += 1;
        void runJob(job);
      }
    });
  }

  function dispatch({
    job_type,
    payload,
    trace_id,
    task_id,
    run_id,
    step_id = null,
    persona_id = null,
    metadata = {},
  }) {
    return new Promise((resolve, reject) => {
      const job = {
        job_id: `job_${randomUUID()}`,
        job_type,
        payload,
        trace_id,
        task_id,
        run_id,
        step_id,
        persona_id,
        metadata,
        status: 'queued',
        queued_at: new Date().toISOString(),
        started_at: null,
        finished_at: null,
        error: null,
        resolve,
        reject,
      };

      jobs.set(job.job_id, job);
      pending.push(job);
      void bus?.publish('worker.job.queued', {
        ...summarizeJob(job),
        queue_depth: pending.length,
      });
      schedulePump();
    });
  }

  return {
    dispatch,
    register,
    snapshot,
  };
}
