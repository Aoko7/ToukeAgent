import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWikiHarnessDraftFromTraceBundle,
  createWikiHarnessDraftArtifact,
  mergeWikiHarnessDraftArtifactIntoSuite,
  applyWikiCandidateCaseReview,
  applyWikiCandidateBatchReview,
  summarizeWikiCandidateSuiteGovernance,
} from '../apps/platform/src/wiki-harness-draft.mjs';

test('wiki harness draft builder derives a trace-backed wiki case from retrieval output', () => {
  const draft = buildWikiHarnessDraftFromTraceBundle({
    task_id: 'trace_wiki_draft_1',
    trace_id: 'trace_wiki_draft_1',
    task: {
      persona_id: 'researcher',
      message_snapshot: {
        content: [
          {
            type: 'text',
            text: '当前 DeepSeek 的版本和价格状态是什么？',
          },
        ],
      },
      run_state: {
        step_results: [
          {
            step_id: 'step_retrieve',
            output: {
              route: {
                mode: 'wiki-first',
                effective_mode: 'wiki-first',
                fallback_applied: false,
              },
              query_analysis: {
                intent_tags: ['dynamic_lookup', 'pricing_lookup', 'version_lookup'],
              },
              quality: {
                recommended_action: 'accept',
              },
              stable_items: [
                {
                  doc_id: 'doc_architecture_overview',
                  chunk_id: 'chunk_architecture_overview',
                  title: 'Architecture overview',
                  source_type: 'rag',
                  freshness: 'stable',
                  text: 'Stable architecture guidance.',
                  metadata: {
                    topic: 'architecture',
                  },
                },
              ],
              dynamic_items: [
                {
                  entry_id: 'wiki_deepseek_provider',
                  title: 'DeepSeek provider profile',
                  summary: 'Fresh provider state.',
                  facts: ['Pricing changes frequently.', 'Version status is dynamic.'],
                  tags: ['deepseek', 'pricing', 'version'],
                  source_type: 'wiki',
                  freshness: 'dynamic',
                  owner: 'provider_ops',
                  required_context: ['provider_name'],
                  retrieval_hints: ['deepseek', 'pricing', 'version'],
                  ttl_seconds: 3600,
                  source_of_truth: 'provider_wiki',
                  version: 'v3',
                  metadata: {
                    entity_id: 'deepseek_provider',
                    topic: 'provider_status',
                  },
                },
              ],
              citations: [
                {
                  title: 'DeepSeek provider profile',
                  source_type: 'wiki',
                  freshness: 'dynamic',
                  score: 0.98,
                },
              ],
            },
          },
        ],
      },
    },
  });

  assert.equal(draft.task_id, 'trace_wiki_draft_1');
  assert.equal(draft.summary.generated_case_count, 1);
  assert.equal(draft.summary.dynamic_item_count, 1);
  assert.equal(draft.source.route_mode, 'wiki-first');
  assert.equal(draft.cases[0].reference.expected_route_mode, 'wiki-first');
  assert.equal(draft.cases[0].reference.expected_recommended_action, 'accept');
  assert.deepEqual(draft.cases[0].reference.required_citation_titles, ['DeepSeek provider profile']);
  assert.equal(draft.cases[0].metadata.domain, 'wiki');
  assert.ok(draft.cases[0].metadata.tags.includes('trace-derived'));
  assert.ok(draft.cases[0].payload.dynamic_items[0].required_context.includes('provider_name'));
});

test('wiki harness draft artifact can save a selected trace-derived case', () => {
  const draft = buildWikiHarnessDraftFromTraceBundle({
    task_id: 'trace_wiki_draft_artifact_1',
    trace_id: 'trace_wiki_draft_artifact_1',
    task: {
      persona_id: 'researcher',
      message_snapshot: {
        content: [
          { type: 'text', text: '当前项目预训练状态是什么？' },
        ],
      },
      run_state: {
        step_results: [
          {
            step_id: 'step_retrieve',
            output: {
              route: {
                mode: 'wiki-first',
                effective_mode: 'wiki-first',
                fallback_applied: false,
              },
              query_analysis: {
                intent_tags: ['dynamic_lookup'],
              },
              quality: {
                recommended_action: 'accept',
              },
              stable_items: [],
              dynamic_items: [
                {
                  entry_id: 'wiki_project_pretraining_status',
                  title: 'Project pretraining status',
                  summary: 'Current pretraining milestones.',
                  facts: ['BinMAE pretraining completed.'],
                  tags: ['project', 'status'],
                  source_type: 'wiki',
                  freshness: 'dynamic',
                  owner: 'project_ops',
                  required_context: ['project_scope'],
                  retrieval_hints: ['预训练状态'],
                  ttl_seconds: 1209600,
                  source_of_truth: 'private-notes/project-briefing.md',
                  version: 'v2',
                  metadata: {
                    entity_id: 'project_pretraining_status',
                  },
                },
              ],
              citations: [
                { title: 'Project pretraining status' },
              ],
            },
          },
        ],
      },
    },
  });

  const artifact = createWikiHarnessDraftArtifact(draft, {
    caseId: 'trace_wiki_draft_artifact_1_trace_wiki_case',
    savedAt: '2026-05-15T10:00:00.000Z',
  });

  assert.equal(artifact.artifact_type, 'wiki_harness_case_draft');
  assert.equal(artifact.review_required, true);
  assert.equal(artifact.summary.selected_case_count, 1);
  assert.deepEqual(artifact.summary.selected_case_ids, ['trace_wiki_draft_artifact_1_trace_wiki_case']);
  assert.equal(artifact.cases[0].metadata.domain, 'wiki');
});

test('wiki harness draft artifact can merge into candidate suite', () => {
  const draft = buildWikiHarnessDraftFromTraceBundle({
    task_id: 'trace_wiki_candidate_suite_1',
    trace_id: 'trace_wiki_candidate_suite_1',
    task: {
      persona_id: 'researcher',
      message_snapshot: {
        content: [
          { type: 'text', text: '当前 DeepSeek pricing 的主数据源是什么？' },
        ],
      },
      run_state: {
        step_results: [
          {
            step_id: 'step_retrieve',
            output: {
              route: {
                mode: 'wiki-first',
                effective_mode: 'wiki-first',
                fallback_applied: false,
              },
              query_analysis: {
                intent_tags: ['dynamic_lookup', 'pricing_lookup'],
              },
              quality: {
                recommended_action: 'accept',
              },
              stable_items: [],
              dynamic_items: [
                {
                  entry_id: 'wiki_deepseek_pricing_status',
                  title: 'DeepSeek pricing status',
                  summary: 'Fresh pricing source.',
                  facts: ['Pricing should be checked against provider wiki.'],
                  tags: ['deepseek', 'pricing'],
                  source_type: 'wiki',
                  freshness: 'dynamic',
                  owner: 'provider_ops',
                  required_context: ['provider_name'],
                  retrieval_hints: ['pricing'],
                  ttl_seconds: 3600,
                  source_of_truth: 'provider_wiki',
                  version: 'v1',
                  metadata: {
                    topic: 'pricing_status',
                  },
                },
              ],
              citations: [
                { title: 'DeepSeek pricing status' },
              ],
            },
          },
        ],
      },
    },
  });

  const artifact = createWikiHarnessDraftArtifact(draft, {
    caseId: 'trace_wiki_candidate_suite_1_trace_wiki_case',
    savedAt: '2026-05-15T12:00:00.000Z',
  });

  const merged = mergeWikiHarnessDraftArtifactIntoSuite({ cases: [] }, artifact, {
    promotedAt: '2026-05-15T12:05:00.000Z',
    suiteId: 'wiki-candidate-suite',
  });

  assert.equal(merged.document.suite_id, 'wiki-candidate-suite');
  assert.equal(merged.document.metadata.suite_kind, 'candidate');
  assert.equal(merged.document.metadata.benchmark_domain, 'wiki');
  assert.equal(merged.summary.promoted_case_count, 1);
  assert.deepEqual(merged.summary.added_case_ids, ['trace_wiki_candidate_suite_1_trace_wiki_case']);
  assert.equal(merged.document.cases[0].metadata.benchmark_stage, 'candidate');
  assert.equal(merged.document.cases[0].metadata.promoted_from_trace_draft, true);
  assert.equal(merged.document.cases[0].metadata.review_status, 'pending_review');
});

test('wiki candidate suite supports case review and batch review metadata updates', () => {
  const baseSuite = {
    suite_id: 'wiki-candidate-suite',
    cases: [
      {
        case_id: 'case_a',
        metadata: {},
      },
      {
        case_id: 'case_b',
        metadata: {},
      },
    ],
  };

  const reviewed = applyWikiCandidateCaseReview(baseSuite, {
    caseId: 'case_a',
    decision: 'approved',
    reviewerId: 'reviewer_a',
    notes: 'ready to keep',
    reviewedAt: '2026-05-15T13:00:00.000Z',
  });
  assert.equal(reviewed.cases[0].metadata.review_status, 'approved');
  assert.equal(reviewed.cases[0].metadata.reviewer_id, 'reviewer_a');
  assert.equal(reviewed.cases[0].metadata.review_notes, 'ready to keep');

  const batchReviewed = applyWikiCandidateBatchReview(reviewed, {
    caseIds: ['case_a', 'case_b'],
    decision: 'needs_revision',
    reviewerId: 'reviewer_batch',
    notes: 'tighten route expectation',
    reviewedAt: '2026-05-15T13:10:00.000Z',
  });
  assert.equal(batchReviewed.document.cases[0].metadata.review_status, 'needs_revision');
  assert.equal(batchReviewed.document.cases[1].metadata.review_status, 'needs_revision');
  assert.deepEqual(batchReviewed.summary.reviewed_case_ids, ['case_a', 'case_b']);
  assert.equal(batchReviewed.document.metadata.last_batch_reviewed_case_ids[1], 'case_b');
});

test('wiki candidate suite governance summary tracks pending and reviewed cases', () => {
  const suite = {
    suite_id: 'wiki-candidate-suite',
    metadata: {
      last_promoted_at: '2026-05-15T12:05:00.000Z',
      last_reviewed_at: '2026-05-15T13:00:00.000Z',
    },
    cases: [
      { case_id: 'case_pending', metadata: { promoted_from_trace_draft: true, review_required: true } },
      { case_id: 'case_approved', metadata: { review_status: 'approved', promoted_from_trace_draft: true, review_required: true } },
      { case_id: 'case_needs_revision', metadata: { review_status: 'needs_revision', review_required: true } },
    ],
  };

  const summary = summarizeWikiCandidateSuiteGovernance(suite);
  assert.equal(summary.case_count, 3);
  assert.equal(summary.pending_case_count, 1);
  assert.equal(summary.approved_case_count, 1);
  assert.equal(summary.needs_revision_case_count, 1);
  assert.equal(summary.reviewed_case_count, 2);
  assert.equal(summary.promoted_from_trace_case_count, 2);
  assert.equal(summary.review_required_case_count, 3);
});
