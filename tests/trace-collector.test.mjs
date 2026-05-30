import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditStore } from '../apps/platform/src/audit-store.mjs';
import { createEvaluationStore } from '../apps/platform/src/evaluation-store.mjs';
import { createMemoryStore } from '../apps/platform/src/memory-store.mjs';
import { createReviewStore } from '../apps/platform/src/review-store.mjs';
import { createStreamStore } from '../apps/platform/src/stream-store.mjs';
import { createTaskStore } from '../apps/platform/src/task-store.mjs';
import { createTraceCollector } from '../apps/platform/src/trace-collector.mjs';
import { createAlertStore } from '../apps/platform/src/alert-store.mjs';

test('trace collector bundles task, audit, stream, memory, evaluation, and review data', () => {
  const auditStore = createAuditStore();
  const streamStore = createStreamStore();
  const taskStore = createTaskStore();
  const memoryStore = createMemoryStore();
  const evaluationStore = createEvaluationStore();
  const reviewStore = createReviewStore();
  const alertStore = createAlertStore();
  const collector = createTraceCollector({
    auditStore,
    streamStore,
    taskStore,
    evaluationStore,
    reviewStore,
    memoryStore,
    alertStore,
  });

  taskStore.upsert('trace_bundle_1', {
    status: 'completed',
    phase: 'completed',
    metadata: {
      quality_gate_status: 'passed',
    },
    run_state: {
      status: 'completed',
      step_results: [
        {
          step_id: 'step_retrieve',
          output: {
            route: { mode: 'wiki-first', effective_mode: 'wiki-first' },
            query_analysis: {
              query_mode: 'status_lookup',
              intent_tags: ['dynamic_lookup', 'version_lookup'],
              boundary: { action: 'decompose', explicit_scope_required: true },
              clarification: { required: false },
              rewrites: { strategy: 'decompose_then_expand', variants: [{ variant_id: 'rewrite_1' }] },
              decomposition: {
                strategy: 'comparison_split',
                subqueries: [
                  { subquery_id: 'sq_1', preferred_source: 'wiki' },
                  { subquery_id: 'sq_2', preferred_source: 'rag' },
                ],
              },
            },
            filter_policy: {
              mode: 'hard_enforce',
              hard_enforce_reason: 'user_explicit',
              hard_filter_empty: false,
              hard_filter_empty_reason: null,
            },
            citations: [{ title: 'Release notes', score: 0.94 }],
            quality: {
              retrieval_score: 0.9,
              citation_score: 0.94,
              contract_coverage_score: 1,
              recommended_action: 'accept',
              source_of_truth_conflict_count: 0,
            },
          },
        },
      ],
    },
  });
  auditStore.append('trace_bundle_1', { kind: 'message.received', payload: { message_id: 'msg_1' } });
  streamStore.append('trace_bundle_1', { event_type: 'start', payload: { title: 'start' } });
  streamStore.append('trace_bundle_1', { event_type: 'tool_result', payload: { status: 'success' } });
  streamStore.append('trace_bundle_1', {
    event_type: 'tool_result',
    payload: { status: 'error', error_code: 'tool_disabled', tool_name: 'blocked_tool' },
    usage: {
      blocked: true,
      restricted: true,
      environment_policy: {
        allowNetwork: false,
        filesystemScope: 'read_only',
        allowShell: false,
        allowedPaths: ['/workspace/docs'],
        egressAllowlist: {
          hosts: ['api.deepseek.com'],
          providers: ['deepseek'],
          providerHostBindings: [
            {
              provider: 'deepseek',
              hosts: ['api.deepseek.com'],
            },
          ],
        },
      },
    },
  });
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
  alertStore.record({
    task_id: 'trace_bundle_1',
    trace_id: 'trace_bundle_1',
    category: 'slo',
    code: 'quality_slo_breach',
    message: 'quality below threshold',
    observed: 0.4,
    threshold: 0.6,
  });

  const bundle = collector.collect('trace_bundle_1');

  assert.equal(bundle.exists, true);
  assert.equal(bundle.task.task_id, 'trace_bundle_1');
  assert.equal(bundle.metrics.event_count, 3);
  assert.equal(bundle.metrics.tool_compliance_rate, 0.5);
  assert.equal(bundle.metrics.blocked_tool_result_count, 1);
  assert.equal(bundle.metrics.blocked_tool_error_codes.tool_disabled, 1);
  assert.deepEqual(bundle.metrics.blocked_tool_names, ['blocked_tool']);
  assert.equal(bundle.metrics.sandbox_blocked_tool_result_count, 1);
  assert.equal(bundle.metrics.sandbox_blocked_error_codes.tool_disabled, 1);
  assert.deepEqual(bundle.metrics.sandbox_blocked_tool_names, ['blocked_tool']);
  assert.equal(bundle.metrics.sandbox_environment_policy.filesystemScope, 'read_only');
  assert.deepEqual(bundle.metrics.sandbox_environment_policy.egressAllowlist.hosts, ['api.deepseek.com']);
  assert.deepEqual(bundle.metrics.sandbox_environment_policy.egressAllowlist.providerHostBindings, [
    {
      provider: 'deepseek',
      hosts: ['api.deepseek.com'],
    },
  ]);
  assert.equal(bundle.metrics.quality_decision, 'pass');
  assert.equal(bundle.metrics.retrieval_route_mode, 'wiki-first');
  assert.equal(bundle.metrics.retrieval_effective_mode, 'wiki-first');
  assert.equal(bundle.metrics.retrieval_score, 0.9);
  assert.equal(bundle.metrics.citation_score, 0.94);
  assert.equal(bundle.metrics.contract_coverage_score, 1);
  assert.equal(bundle.metrics.query_mode, 'status_lookup');
  assert.equal(bundle.metrics.query_boundary_action, 'decompose');
  assert.equal(bundle.metrics.query_explicit_scope_required, true);
  assert.equal(bundle.metrics.query_decomposition_strategy, 'comparison_split');
  assert.equal(bundle.metrics.query_rewrite_strategy, 'decompose_then_expand');
  assert.equal(bundle.metrics.query_subquery_count, 2);
  assert.equal(bundle.metrics.query_rewrite_count, 1);
  assert.deepEqual(bundle.metrics.query_preferred_sources, ['wiki', 'rag']);
  assert.equal(bundle.metrics.clarification_required, false);
  assert.deepEqual(bundle.metrics.intent_tags, ['dynamic_lookup', 'version_lookup']);
  assert.equal(bundle.metrics.filter_policy_mode, 'hard_enforce');
  assert.equal(bundle.metrics.filter_hard_enforce_reason, 'user_explicit');
  assert.equal(bundle.metrics.filter_hard_empty, false);
  assert.equal(bundle.metrics.filter_hard_empty_reason, null);
  assert.equal(bundle.metrics.source_of_truth_conflict_count, 0);
  assert.equal(bundle.metrics.alert_count, 1);
  assert.equal(bundle.latest_alert.code, 'quality_slo_breach');
  assert.equal(bundle.evaluations.length, 1);
  assert.equal(bundle.reviews.length, 1);
});
