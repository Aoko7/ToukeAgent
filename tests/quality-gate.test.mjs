import test from 'node:test';
import assert from 'node:assert/strict';
import { createQualityGate } from '../apps/platform/src/quality-gate.mjs';

test('quality gate blocks failed evaluations and queues review', () => {
  const gate = createQualityGate({ sampleRate: 0 });
  const result = gate.evaluate({
    evaluation_id: 'eval_1',
    task_id: 'task_1',
    trace_id: 'trace_1',
    decision: 'fail',
    overall_score: 0.32,
    recommended_actions: ['retry', 'human_review'],
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.review_required, true);
  assert.equal(result.sampled, false);
  assert.equal(result.priority, 'high');
});

test('quality gate can sample passing evaluations for audit review', () => {
  const gate = createQualityGate({ sampleRate: 1 });
  const result = gate.evaluate({
    evaluation_id: 'eval_2',
    task_id: 'task_2',
    trace_id: 'trace_2',
    decision: 'pass',
    overall_score: 0.93,
    recommended_actions: [],
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.review_required, true);
  assert.equal(result.sampled, true);
  assert.equal(result.reason, 'online_sampled_review');
});
