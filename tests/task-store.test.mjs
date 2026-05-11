import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskStore } from '../apps/platform/src/task-store.mjs';

test('task store keeps independent snapshots and checkpoints', () => {
  const store = createTaskStore();
  const first = store.upsert('task_1', {
    trace_id: 'trace_1',
    status: 'received',
    phase: 'received',
    checkpoint: {
      kind: 'message.received',
      summary: 'Inbound message accepted',
    },
  });

  const second = store.upsert('task_1', {
    status: 'completed',
    phase: 'completed',
    plan_id: 'plan_1',
    completed_steps: 3,
    total_steps: 3,
    checkpoint: {
      kind: 'run.completed',
      summary: 'Task completed',
    },
  });

  assert.equal(first.status, 'received');
  assert.equal(second.status, 'completed');
  assert.equal(store.get('task_1').checkpoints.length, 2);
  assert.equal(store.get('task_1').plan_id, 'plan_1');
  assert.equal(store.list().length, 1);
});
