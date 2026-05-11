import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvaluationHarness } from '../apps/platform/src/evaluation-harness.mjs';
import { createHarnessStore } from '../apps/platform/src/harness-store.mjs';

test('evaluation harness runs cases and summarizes trace-based metrics', async () => {
  const executed = [];
  const harnessStore = createHarnessStore();
  const harness = createEvaluationHarness({
    executeTask: async (input) => {
      executed.push(input.trace_id);
      return {
        task_id: input.trace_id,
        message: { trace_id: input.trace_id },
      };
    },
    collectTraceBundle: (taskId) => ({
      task_id: taskId,
      exists: true,
      task: { task_id: taskId },
      latest_evaluation: taskId === 'trace_a'
        ? { decision: 'pass', overall_score: 0.92, dimensions: { citation_consistency: 0.9 } }
        : { decision: 'review', overall_score: 0.67, dimensions: { citation_consistency: 0.62 } },
      latest_review: taskId === 'trace_b'
        ? { review_status: 'pending' }
        : null,
      metrics: {
        final_status: 'completed',
        tool_compliance_rate: taskId === 'trace_a' ? 1 : 0.5,
        gate_status: taskId === 'trace_a' ? 'passed' : 'review_required',
      },
      evaluations: [],
      reviews: [],
      audit_entries: [],
      stream_events: [],
      memory: null,
    }),
    harnessStore,
  });

  const run = await harness.run({
    cases: [
      { case_id: 'case_a', input: { trace_id: 'trace_a', message_id: 'msg_a' } },
      { case_id: 'case_b', input: { trace_id: 'trace_b', message_id: 'msg_b' } },
    ],
    metadata: { suite: 'smoke' },
  });

  assert.deepEqual(executed, ['trace_a', 'trace_b']);
  assert.equal(run.summary.case_count, 2);
  assert.equal(run.summary.success_rate, 1);
  assert.equal(run.summary.quality_pass_rate, 0.5);
  assert.equal(run.summary.review_rate, 0.5);
  assert.equal(run.summary.tool_compliance_rate, 0.75);
  assert.equal(harnessStore.list().length, 1);
  assert.equal(harnessStore.get(run.run_id).summary.case_count, 2);
});
