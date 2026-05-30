import { randomUUID } from 'node:crypto';
import { createPersistentJobQueueStore } from './job-queue-store.mjs';

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
    attempts: job.attempts,
    metadata: job.metadata,
    queued_at: job.queued_at,
    started_at: job.started_at,
    leased_at: job.leased_at,
    finished_at: job.finished_at,
    error: job.error,
  };
}

export function createAsyncWorker({
  bus = null,
  concurrency = 1,
  queueStore = createPersistentJobQueueStore({ filePath: null }),
  workerId = `worker_${randomUUID()}`,
  defaultRetryLimit = 1,
  onDeadLetter = null,
} = {}) {
  const handlers = new Map();
  let activeCount = 0;
  let pumpScheduled = false;

  function register(jobType, handler) {
    handlers.set(jobType, handler);
    schedulePump();
  }

  function snapshot() {
    const queueSnapshot = queueStore.snapshot();
    return {
      worker_id: workerId,
      active: queueSnapshot.running,
      local_active: activeCount,
      queued: queueSnapshot.queued,
      running: queueSnapshot.running,
      completed: queueSnapshot.completed,
      failed: queueSnapshot.failed,
      jobs: queueSnapshot.jobs,
      queue: queueSnapshot,
    };
  }

  function normalizeRetryLimit(job) {
    const configured = job?.metadata?.retry_limit;
    if (Number.isFinite(configured)) {
      return Math.max(1, Number(configured));
    }
    return Math.max(1, Number(defaultRetryLimit) || 1);
  }

  async function runJob(job) {
    const leaseRenewalIntervalMs = Math.max(1000, Math.floor((queueStore.snapshot().lease_ms ?? 30_000) / 2));
    const leaseTimer = setInterval(() => {
      try {
        queueStore.renewLease(job.job_id, { workerId });
      } catch {
        /* ignore lease renewal failures while the job is already in flight */
      }
    }, leaseRenewalIntervalMs);
    leaseTimer.unref?.();

    try {
      const handler = handlers.get(job.job_type);
      if (!handler) {
        throw new Error(`Unknown job type: ${job.job_type}`);
      }

      job.status = 'running';
      job.started_at = new Date().toISOString();
      await bus?.publish('worker.job.started', summarizeJob(job));

      const result = await handler(job.payload, summarizeJob(job));
      const settled = queueStore.complete(job.job_id, result, { workerId });
      try {
        await bus?.publish('worker.job.completed', {
          ...summarizeJob(settled),
          result_summary: result?.summary ?? null,
          metrics: result?.metrics ?? {},
        });
      } catch {
        /* ignore bus failures after persistence */
      }
      return result;
    } catch (error) {
      const retryLimit = normalizeRetryLimit(job);
      if ((Number(job.attempts) || 0) < retryLimit) {
        const requeued = queueStore.requeue(job.job_id, {
          workerId,
          reason: 'retryable_failure',
          error,
        });
        try {
          await bus?.publish('worker.job.requeued', {
            ...summarizeJob(requeued),
            retry_limit: retryLimit,
            error: requeued.metadata?.last_error ?? null,
          });
        } catch {
          /* ignore bus failures after persistence */
        }
        return null;
      }

      let workerError = error instanceof Error ? error : new Error(String(error));
      let deadLetterRecord = null;
      if (job.metadata?.dead_letter_on_failure) {
        deadLetterRecord = await onDeadLetter?.({
          job: summarizeJob(job),
          payload: structuredClone(job.payload),
          error: workerError,
          workerId,
        }) ?? null;
        if (deadLetterRecord) {
          workerError.dead_letter_record = deadLetterRecord;
        }
      }

      const settled = queueStore.fail(job.job_id, workerError, { workerId });
      try {
        await bus?.publish('worker.job.failed', {
          ...summarizeJob(settled),
          retry_limit: retryLimit,
          dead_letter_id: deadLetterRecord?.dead_letter_id ?? null,
        });
      } catch {
        /* ignore bus failures after persistence */
      }
      return null;
    } finally {
      clearInterval(leaseTimer);
      activeCount -= 1;
      schedulePump();
    }
  }

  function schedulePump() {
    if (pumpScheduled) {
      return;
    }

    pumpScheduled = true;
    queueMicrotask(() => {
      pumpScheduled = false;
      queueStore.requeueStaleJobs();
      while (activeCount < concurrency) {
        const job = queueStore.claimNext({ workerId });
        if (!job) {
          break;
        }

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
    retry_limit = null,
    dead_letter_on_failure = false,
    dead_letter_reason = 'worker_job_failed',
    dead_letter_replayable = true,
  }, { includeJob = false } = {}) {
    const job = queueStore.enqueue({
      job_type,
      payload,
      trace_id,
      task_id,
      run_id,
      step_id,
      persona_id,
      metadata: {
        ...metadata,
        retry_limit: Number.isFinite(retry_limit) ? Number(retry_limit) : undefined,
        dead_letter_on_failure,
        dead_letter_reason,
        dead_letter_replayable,
      },
      submitted_by_worker_id: workerId,
    });

    return new Promise((resolve, reject) => {
      queueStore.attachWaiter(job.job_id, { resolve, reject });
      void bus?.publish('worker.job.queued', {
        ...summarizeJob(job),
        queue_depth: queueStore.snapshot().queued,
      });
      schedulePump();
    }).then((result) => {
      if (!includeJob) {
        return result;
      }

      return {
        job: queueStore.findJob(job.job_id) ?? job,
        result,
      };
    });
  }

  return {
    dispatch,
    kick: schedulePump,
    register,
    snapshot,
    workerId,
  };
}
