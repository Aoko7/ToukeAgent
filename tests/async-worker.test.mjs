import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventBus } from '../apps/platform/src/event-bus.mjs';
import { createAsyncWorker } from '../apps/platform/src/async-worker.mjs';
import { createPersistentJobQueueStore } from '../apps/platform/src/job-queue-store.mjs';

test('async worker dispatches queued, running, and completed lifecycle events', async () => {
  const bus = createEventBus();
  const worker = createAsyncWorker({ bus });
  const observed = [];
  bus.subscribeAll((event) => {
    observed.push(event.topic);
  });

  worker.register('echo', async ({ value }) => ({
    summary: 'Echo complete',
    result: value,
  }));

  const result = await worker.dispatch({
    job_type: 'echo',
    trace_id: 'trace_worker_1',
    task_id: 'task_worker_1',
    run_id: 'run_worker_1',
    step_id: 'step_worker_1',
    payload: { value: 'hello' },
  });

  assert.equal(result.result, 'hello');
  assert.deepEqual(observed, [
    'worker.job.queued',
    'worker.job.started',
    'worker.job.completed',
  ]);
  assert.equal(worker.snapshot().active, 0);
  assert.equal(worker.snapshot().queued, 0);
});

test('async worker resumes queued jobs from a persistent queue store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'toukeagent-worker-resume-'));
  const filePath = join(dir, 'queue.json');
  const queueStore = createPersistentJobQueueStore({ filePath });
  const bus = createEventBus();
  const observed = [];

  bus.subscribeAll((event) => {
    observed.push(event.topic);
  });

  queueStore.enqueue({
    job_type: 'echo',
    trace_id: 'trace_worker_resume',
    task_id: 'task_worker_resume',
    run_id: 'run_worker_resume',
    payload: { value: 'persisted' },
  });

  const worker = createAsyncWorker({ bus, queueStore, workerId: 'worker_resume' });
  worker.register('echo', async ({ value }) => ({
    summary: 'Echo complete',
    result: value,
  }));

  const waitForCompletion = async (predicate, timeoutMs = 1000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (predicate()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for worker queue resume');
  };

  await waitForCompletion(() => queueStore.snapshot().completed === 1);

  assert.equal(queueStore.snapshot().queued, 0);
  assert.equal(queueStore.snapshot().running, 0);
  assert.equal(worker.snapshot().active, 0);
  assert.equal(worker.snapshot().queued, 0);
  assert.ok(observed.includes('worker.job.started'));
  assert.ok(observed.includes('worker.job.completed'));
  assert.equal(queueStore.list({ status: 'completed' }).at(0).task_id, 'task_worker_resume');
});

test('async worker retries a transient failure before completing', async () => {
  const bus = createEventBus();
  const queueStore = createPersistentJobQueueStore({ filePath: null });
  const worker = createAsyncWorker({ bus, queueStore });
  const observed = [];
  let attempts = 0;

  bus.subscribeAll((event) => {
    observed.push(event.topic);
  });

  worker.register('flaky', async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error('transient failure');
    }
    return {
      summary: 'Recovered after retry',
      result: 'ok',
    };
  });

  const result = await worker.dispatch({
    job_type: 'flaky',
    trace_id: 'trace_worker_retry',
    task_id: 'task_worker_retry',
    run_id: 'run_worker_retry',
    payload: {},
    retry_limit: 2,
  });

  assert.equal(result.result, 'ok');
  assert.equal(attempts, 2);
  assert.ok(observed.includes('worker.job.requeued'));
  assert.equal(queueStore.snapshot().completed, 1);
  assert.equal(queueStore.list({ status: 'completed' }).at(0).attempts, 2);
});

test('async worker sends final failures to dead-letter callback after retries are exhausted', async () => {
  const bus = createEventBus();
  const queueStore = createPersistentJobQueueStore({ filePath: null });
  const deadLetters = [];
  const observed = [];
  const worker = createAsyncWorker({
    bus,
    queueStore,
    onDeadLetter: ({ job, error }) => {
      const record = {
        dead_letter_id: 'dlq_worker_final_fail',
        task_id: job.task_id,
        reason: job.metadata?.dead_letter_reason,
        error: error.message,
      };
      deadLetters.push(record);
      return record;
    },
  });

  bus.subscribeAll((event) => {
    observed.push(event.topic);
  });

  worker.register('always_fail', async () => {
    throw new Error('permanent failure');
  });

  await assert.rejects(
    worker.dispatch({
      job_type: 'always_fail',
      trace_id: 'trace_worker_dead_letter',
      task_id: 'task_worker_dead_letter',
      run_id: 'run_worker_dead_letter',
      payload: {},
      retry_limit: 2,
      dead_letter_on_failure: true,
      dead_letter_reason: 'worker_job_failed',
    }),
    (error) => {
      assert.equal(error.message, 'permanent failure');
      assert.equal(error.dead_letter_record.dead_letter_id, 'dlq_worker_final_fail');
      return true;
    },
  );

  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0].task_id, 'task_worker_dead_letter');
  assert.ok(observed.includes('worker.job.requeued'));
  assert.ok(observed.includes('worker.job.failed'));
  assert.equal(queueStore.snapshot().failed, 1);
  assert.equal(queueStore.list({ status: 'failed' }).at(0).attempts, 2);
});
