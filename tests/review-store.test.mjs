import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewStore } from '../apps/platform/src/review-store.mjs';

test('review store creates, lists, and resolves review items', () => {
  const store = createReviewStore();
  const created = store.create({
    task_id: 'task_1',
    trace_id: 'trace_1',
    evaluation_id: 'eval_1',
    gate_id: 'gate_1',
    gate_status: 'blocked',
    reason: 'quality_gate_failed',
    summary: 'Needs review',
    recommended_actions: ['human_review'],
  });

  assert.equal(created.review_status, 'pending');
  assert.equal(store.list({ taskId: 'task_1' }).length, 1);

  const resolved = store.resolve(created.review_id, {
    decision: 'approved',
    reviewer_id: 'reviewer_1',
    notes: 'Accepted after manual review',
  });

  assert.equal(resolved.review_status, 'approved');
  assert.equal(resolved.resolution.decision, 'approved');
  assert.equal(store.get(created.review_id).resolved_at !== null, true);
});
