import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from '../apps/platform/src/event-bus.mjs';
import { createAsyncWorker } from '../apps/platform/src/async-worker.mjs';

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
