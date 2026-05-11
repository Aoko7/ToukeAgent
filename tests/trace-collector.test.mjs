import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditStore } from '../apps/platform/src/audit-store.mjs';
import { createEvaluationStore } from '../apps/platform/src/evaluation-store.mjs';
import { createMemoryStore } from '../apps/platform/src/memory-store.mjs';
import { createReviewStore } from '../apps/platform/src/review-store.mjs';
import { createStreamStore } from '../apps/platform/src/stream-store.mjs';
import { createTaskStore } from '../apps/platform/src/task-store.mjs';
import { createTraceCollector } from '../apps/platform/src/trace-collector.mjs';

test('trace collector bundles task, audit, stream, memory, evaluation, and review data', () => {
  const auditStore = createAuditStore();
  const streamStore = createStreamStore();
  const taskStore = createTaskStore();
  const memoryStore = createMemoryStore();
  const evaluationStore = createEvaluationStore();
  const reviewStore = createReviewStore();
  const collector = createTraceCollector({
    auditStore,
    streamStore,
    taskStore,
    evaluationStore,
    reviewStore,
    memoryStore,
  });

  taskStore.upsert('trace_bundle_1', {
    status: 'completed',
    phase: 'completed',
    metadata: {
      quality_gate_status: 'passed',
    },
    run_state: {
      status: 'completed',
    },
  });
  auditStore.append('trace_bundle_1', { kind: 'message.received', payload: { message_id: 'msg_1' } });
  streamStore.append('trace_bundle_1', { event_type: 'start', payload: { title: 'start' } });
  streamStore.append('trace_bundle_1', { event_type: 'tool_result', payload: { status: 'success' } });
  memoryStore.appendShortTerm('trace_bundle_1', { title: 'memory', summary: 'summary' });
  evaluationStore.append('trace_bundle_1', {
    evaluation_id: 'eval_1',
    task_id: 'trace_bundle_1',
    trace_id: 'trace_bundle_1',
    decision: 'pass',
    overall_score: 0.91,
    dimensions: { citation_consistency: 0.88 },
  });
  reviewStore.create({
    task_id: 'trace_bundle_1',
    trace_id: 'trace_bundle_1',
    review_status: 'pending',
    gate_status: 'review_required',
  });

  const bundle = collector.collect('trace_bundle_1');

  assert.equal(bundle.exists, true);
  assert.equal(bundle.task.task_id, 'trace_bundle_1');
  assert.equal(bundle.metrics.event_count, 2);
  assert.equal(bundle.metrics.tool_compliance_rate, 1);
  assert.equal(bundle.metrics.quality_decision, 'pass');
  assert.equal(bundle.evaluations.length, 1);
  assert.equal(bundle.reviews.length, 1);
});
