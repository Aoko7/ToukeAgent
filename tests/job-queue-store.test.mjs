import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPersistentJobQueueStore } from '../apps/platform/src/job-queue-store.mjs';

test('persistent job queue store survives reloads and preserves job state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toukeagent-job-queue-'));
  const filePath = join(dir, 'queue.json');
  const storeA = createPersistentJobQueueStore({ filePath });

  const enqueued = storeA.enqueue({
    job_type: 'echo',
    trace_id: 'trace_queue_1',
    task_id: 'task_queue_1',
    run_id: 'run_queue_1',
    payload: { value: 'hello' },
  });

  assert.equal(storeA.snapshot().queued, 1);

  const storeB = createPersistentJobQueueStore({ filePath });
  assert.equal(storeB.snapshot().queued, 1);

  const claimed = storeB.claimNext({ workerId: 'worker_a' });
  assert.equal(claimed.job_id, enqueued.job_id);
  assert.equal(claimed.status, 'running');

  storeB.complete(claimed.job_id, {
    summary: 'Echo complete',
    result: 'hello',
  }, {
    workerId: 'worker_a',
  });

  const storeC = createPersistentJobQueueStore({ filePath });
  assert.equal(storeC.snapshot().completed, 1);
  assert.equal(storeC.snapshot().queued, 0);
  assert.equal(storeC.snapshot().running, 0);
  assert.equal(storeC.list({ status: 'completed' }).at(0).job_id, enqueued.job_id);
});

test('persistent job queue store requeues stale running jobs on restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toukeagent-job-queue-requeue-'));
  const filePath = join(dir, 'queue.json');
  let currentTime = new Date('2026-05-12T00:00:00.000Z');
  const clock = () => currentTime.toISOString();

  const storeA = createPersistentJobQueueStore({ filePath, clock, leaseMs: 1000 });
  const enqueued = storeA.enqueue({
    job_type: 'echo',
    trace_id: 'trace_queue_2',
    task_id: 'task_queue_2',
    run_id: 'run_queue_2',
    payload: { value: 'resume' },
  });

  const claimed = storeA.claimNext({ workerId: 'worker_a' });
  assert.equal(claimed.job_id, enqueued.job_id);
  assert.equal(claimed.status, 'running');

  currentTime = new Date(currentTime.getTime() + 2000);
  const storeB = createPersistentJobQueueStore({ filePath, clock, leaseMs: 1000 });
  const snapshot = storeB.snapshot();

  assert.equal(snapshot.queued, 1);
  assert.equal(snapshot.running, 0);

  const reclaimed = storeB.claimNext({ workerId: 'worker_b' });
  assert.equal(reclaimed.job_id, enqueued.job_id);
  assert.equal(reclaimed.worker_id, 'worker_b');
});

test('persistent job queue store can requeue a failed job for retry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toukeagent-job-queue-retry-'));
  const filePath = join(dir, 'queue.json');
  const store = createPersistentJobQueueStore({ filePath });

  const enqueued = store.enqueue({
    job_type: 'echo',
    trace_id: 'trace_queue_retry',
    task_id: 'task_queue_retry',
    run_id: 'run_queue_retry',
    payload: { value: 'retry me' },
  });

  const claimed = store.claimNext({ workerId: 'worker_retry_a' });
  assert.equal(claimed.job_id, enqueued.job_id);
  store.fail(claimed.job_id, new Error('temporary failure'), { workerId: 'worker_retry_a' });
  assert.equal(store.snapshot().failed, 1);

  const requeued = store.requeue(claimed.job_id, {
    reason: 'manual_retry',
    error: new Error('temporary failure'),
  });
  assert.equal(requeued.status, 'queued');
  assert.equal(store.snapshot().queued, 1);
  assert.equal(store.snapshot().failed, 0);
  assert.equal(requeued.metadata.last_requeue_reason, 'manual_retry');
  assert.equal(requeued.metadata.last_error.message, 'temporary failure');

  const reclaimed = store.claimNext({ workerId: 'worker_retry_b' });
  assert.equal(reclaimed.job_id, enqueued.job_id);
  assert.equal(reclaimed.attempts, 2);
});
