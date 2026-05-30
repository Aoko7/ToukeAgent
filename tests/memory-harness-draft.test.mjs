import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMemoryHarnessDraftFromTraceBundle,
  createMemoryHarnessDraftArtifact,
  mergeMemoryHarnessDraftArtifactIntoSuite,
  applyMemoryCandidateCaseReview,
  applyMemoryCandidateBatchReview,
  compareMemoryCandidateCaseAgainstGold,
  compareMemoryCandidateSuiteAgainstGold,
  mergeApprovedMemoryCandidateIntoGold,
} from '../apps/platform/src/memory-harness-draft.mjs';

test('memory harness draft builder derives durable, recall, compression, and handoff cases from a trace bundle', () => {
  const draft = buildMemoryHarnessDraftFromTraceBundle({
    task_id: 'trace_memory_draft_1',
    trace_id: 'trace_memory_draft_1',
    task: {
      status: 'completed',
      message_snapshot: {
        content: [
          {
            type: 'text',
            text: '请以后始终用中文回答，并记住我喜欢简洁输出。',
          },
        ],
      },
    },
    memory: {
      effective_provider: 'mem0_compatible',
      workspace_id: 'ws_memory',
      persona_id: 'researcher',
      short_term: [
        {
          role: 'user',
          content: '明天早上十点提醒我提交日报。',
        },
      ],
      long_term: [
        {
          memory_id: 'mem_pref_cn',
          title: '请以后始终用中文回答，并记住我喜欢简洁输出。',
          summary: 'Captured stable user preference',
          facts: ['请以后始终用中文回答', '我喜欢简洁输出'],
          source_task_id: 'trace_memory_draft_1',
          source_trace_id: 'trace_memory_draft_1',
          stale: false,
        },
      ],
    },
    latest_context_compression: {
      snapshot_id: 'ctx_memory_1',
      compression_strategy: 'hybrid',
      must_keep: ['current step objective', 'safety boundaries'],
      unresolved_items: ['Resolve pending human approval'],
      memory_refs: ['mem_pref_cn'],
    },
    latest_handoff: {
      handoff_id: 'handoff_memory_1',
      role: 'retriever',
      status: 'completed',
      objective: 'Summarize the stable user preference.',
      context_snapshot_id: 'ctx_memory_1',
      must_keep: ['current step objective', 'safety boundaries'],
      evidence_refs: ['mem_pref_cn'],
      output_schema: {
        type: 'object',
        required: ['summary', 'citations'],
      },
    },
  }, {
    searchResults: [
      {
        memory_id: 'mem_pref_cn',
        title: '请以后始终用中文回答',
        summary: 'Stable language preference',
        source_task_id: 'trace_memory_draft_1',
        source_trace_id: 'trace_memory_draft_1',
        stale: false,
        score: 0.98,
      },
      {
        memory_id: 'mem_old_price',
        title: '旧价格表',
        summary: 'Outdated provider pricing',
        source_task_id: 'legacy_task',
        source_trace_id: 'legacy_trace',
        stale: true,
        score: 0.44,
      },
    ],
  });

  assert.equal(draft.task_id, 'trace_memory_draft_1');
  assert.equal(draft.source.memory_provider, 'mem0_compatible');
  assert.equal(draft.summary.generated_case_count, 4);
  assert.deepEqual(draft.summary.missing_case_types, []);

  const durable = draft.cases.find((item) => item.case_type === 'durable_write');
  const recall = draft.cases.find((item) => item.case_type === 'memory_recall');
  const compression = draft.cases.find((item) => item.case_type === 'compression_fidelity');
  const handoff = draft.cases.find((item) => item.case_type === 'handoff_sufficiency');

  assert.ok(durable);
  assert.ok(recall);
  assert.ok(compression);
  assert.ok(handoff);
  assert.ok(durable.reference.expected_phrases.some((item) => item.includes('中文回答')));
  assert.ok(durable.reference.disallowed_phrases.some((item) => item.includes('提醒')));
  assert.deepEqual(recall.reference.expected_memory_ids, ['mem_pref_cn']);
  assert.deepEqual(recall.reference.stale_memory_ids, ['mem_old_price']);
  assert.deepEqual(compression.reference.expected_memory_refs, ['mem_pref_cn']);
  assert.ok(handoff.reference.required_fields.includes('output_schema'));
});

test('memory harness draft artifact can save a selected case without mutating validated benchmark gold', () => {
  const draft = buildMemoryHarnessDraftFromTraceBundle({
    task_id: 'trace_memory_draft_artifact_1',
    trace_id: 'trace_memory_draft_artifact_1',
    task: {
      message_snapshot: {
        content: [
          { type: 'text', text: '请记住我喜欢结构化汇报。' },
        ],
      },
    },
    memory: {
      effective_provider: 'local_builtin',
      long_term: [
        {
          memory_id: 'mem_structured',
          title: '喜欢结构化汇报',
          summary: 'Stable reporting preference',
          facts: ['喜欢结构化汇报'],
          source_task_id: 'trace_memory_draft_artifact_1',
          source_trace_id: 'trace_memory_draft_artifact_1',
        },
      ],
    },
  }, {
    searchResults: [
      {
        memory_id: 'mem_structured',
        title: '喜欢结构化汇报',
        summary: 'Stable reporting preference',
        source_task_id: 'trace_memory_draft_artifact_1',
        source_trace_id: 'trace_memory_draft_artifact_1',
        stale: false,
        score: 0.91,
      },
    ],
  });

  const artifact = createMemoryHarnessDraftArtifact(draft, {
    caseId: 'trace_memory_draft_artifact_1_trace_durable_write',
    savedAt: '2026-05-14T10:00:00.000Z',
  });

  assert.equal(artifact.artifact_type, 'memory_harness_case_draft');
  assert.equal(artifact.review_required, true);
  assert.equal(artifact.summary.selected_case_count, 1);
  assert.deepEqual(artifact.summary.selected_case_types, ['durable_write']);
  assert.equal(artifact.cases.length, 1);
  assert.equal(artifact.cases[0].case_type, 'durable_write');
});

test('memory harness draft artifact can merge into a candidate suite without corrupting existing cases', () => {
  const draft = buildMemoryHarnessDraftFromTraceBundle({
    task_id: 'trace_memory_promote_1',
    trace_id: 'trace_memory_promote_1',
    task: {
      message_snapshot: {
        content: [{ type: 'text', text: '请保持输出简洁。' }],
      },
    },
    memory: {
      effective_provider: 'local_builtin',
      long_term: [
        {
          memory_id: 'mem_short_style',
          title: '保持输出简洁',
          summary: 'Stable style preference',
          facts: ['保持输出简洁'],
          source_task_id: 'trace_memory_promote_1',
          source_trace_id: 'trace_memory_promote_1',
        },
      ],
    },
  }, {
    searchResults: [
      {
        memory_id: 'mem_short_style',
        title: '保持输出简洁',
        summary: 'Stable style preference',
        source_task_id: 'trace_memory_promote_1',
        source_trace_id: 'trace_memory_promote_1',
        stale: false,
        score: 0.88,
      },
    ],
  });

  const artifact = createMemoryHarnessDraftArtifact(draft, {
    caseId: 'trace_memory_promote_1_trace_durable_write',
    savedAt: '2026-05-14T11:00:00.000Z',
  });

  const merged = mergeMemoryHarnessDraftArtifactIntoSuite({
    suite_id: 'candidate-suite',
    cases: [
      {
        case_id: 'existing_case',
        case_type: 'handoff_sufficiency',
        provider: 'local_builtin',
        metadata: { language: 'en' },
        reference: { required_fields: ['objective'] },
        observed: { handoff: { objective: 'existing' } },
      },
    ],
  }, artifact, {
    promotedAt: '2026-05-14T11:05:00.000Z',
    suiteId: 'candidate-suite',
  });

  assert.equal(merged.summary.promoted_case_count, 1);
  assert.deepEqual(merged.summary.added_case_ids, ['trace_memory_promote_1_trace_durable_write']);
  assert.equal(merged.document.cases.length, 2);
  const promoted = merged.document.cases.find((item) => item.case_id === 'trace_memory_promote_1_trace_durable_write');
  assert.equal(promoted.metadata.benchmark_stage, 'candidate');
  assert.equal(promoted.metadata.promoted_from_trace_draft, true);
});

test('approved candidate case can be reviewed and merged into gold benchmark safely', () => {
  const candidateSuite = applyMemoryCandidateCaseReview({
    suite_id: 'candidate-suite',
    cases: [
      {
        case_id: 'candidate_case_1',
        case_type: 'memory_recall',
        provider: 'local_builtin',
        metadata: {
          benchmark_stage: 'candidate',
          review_status: 'pending_review',
        },
        reference: { expected_memory_ids: ['mem_x'], top_k: 1 },
        observed: { retrieved_memories: [{ memory_id: 'mem_x' }] },
      },
    ],
  }, {
    caseId: 'candidate_case_1',
    decision: 'approved',
    reviewerId: 'reviewer_a',
    notes: 'looks good',
    reviewedAt: '2026-05-14T12:00:00.000Z',
  });

  assert.equal(candidateSuite.cases[0].metadata.review_status, 'approved');
  assert.equal(candidateSuite.cases[0].metadata.reviewer_id, 'reviewer_a');

  const gold = mergeApprovedMemoryCandidateIntoGold({
    cases: [],
  }, candidateSuite, {
    caseId: 'candidate_case_1',
    promotedAt: '2026-05-14T12:10:00.000Z',
  });

  assert.equal(gold.summary.case_id, 'candidate_case_1');
  assert.equal(gold.document.cases.length, 1);
  assert.equal(gold.document.cases[0].metadata.benchmark_stage, 'gold');
  assert.equal(gold.document.cases[0].metadata.source_candidate_suite, 'candidate-suite');
});

test('candidate case marked needs_revision cannot be promoted into gold', () => {
  const candidateSuite = applyMemoryCandidateCaseReview({
    suite_id: 'candidate-suite',
    cases: [
      {
        case_id: 'candidate_case_2',
        case_type: 'compression_fidelity',
        provider: 'local_builtin',
        metadata: {
          benchmark_stage: 'candidate',
          review_status: 'pending_review',
        },
        reference: { must_keep: ['objective'] },
        observed: { compression_snapshot: { must_keep: ['objective'] } },
      },
    ],
  }, {
    caseId: 'candidate_case_2',
    decision: 'needs_revision',
    reviewerId: 'reviewer_b',
    notes: 'supporting fields need tightening',
    reviewedAt: '2026-05-14T12:20:00.000Z',
  });

  assert.equal(candidateSuite.cases[0].metadata.review_status, 'needs_revision');
  assert.equal(candidateSuite.cases[0].metadata.review_notes, 'supporting fields need tightening');

  assert.throws(() => mergeApprovedMemoryCandidateIntoGold({
    cases: [],
  }, candidateSuite, {
    caseId: 'candidate_case_2',
    promotedAt: '2026-05-14T12:30:00.000Z',
  }), /Approved candidate case not found/);
});

test('candidate vs gold compare summarizes checklist and diff surface', () => {
  const candidateSuite = {
    suite_id: 'candidate-suite',
    cases: [
      {
        case_id: 'candidate_case_3',
        case_type: 'durable_write',
        provider: 'local_builtin',
        metadata: {
          benchmark_stage: 'candidate',
          review_status: 'approved',
          reviewer_id: 'reviewer_c',
          review_notes: 'looks aligned',
        },
        reference: {
          expected_phrases: ['中文回答', '简洁输出'],
          expected_memory_ids: ['mem_pref_cn'],
        },
        observed: {
          promoted_memories: [{ memory_id: 'mem_pref_cn' }],
        },
      },
    ],
  };
  const goldDocument = {
    cases: [
      {
        case_id: 'candidate_case_3',
        case_type: 'durable_write',
        provider: 'local_builtin',
        metadata: {
          benchmark_stage: 'gold',
          source_candidate_suite: 'candidate-suite',
        },
        reference: {
          expected_phrases: ['中文回答'],
          expected_memory_ids: ['mem_pref_cn'],
        },
        observed: {
          promoted_memories: [{ memory_id: 'mem_pref_cn' }],
        },
      },
    ],
  };

  const comparison = compareMemoryCandidateCaseAgainstGold(candidateSuite, goldDocument, {
    caseId: 'candidate_case_3',
  });
  assert.equal(comparison.gold_exists, true);
  assert.equal(comparison.summary.reference_equal, false);
  assert.ok(comparison.checklist.some((item) => item.key === 'approved_status' && item.passed));
  assert.deepEqual(comparison.diffs.expected_phrases.candidate_only, ['简洁输出']);

  const suiteComparison = compareMemoryCandidateSuiteAgainstGold(candidateSuite, goldDocument);
  assert.equal(suiteComparison.case_count, 1);
  assert.equal(suiteComparison.summary.approved_case_count, 1);
  assert.equal(suiteComparison.summary.gold_existing_case_count, 1);
});

test('batch review updates multiple candidate cases consistently', () => {
  const suite = {
    suite_id: 'candidate-suite',
    cases: [
      { case_id: 'case_a', metadata: { review_status: 'pending_review' }, reference: {}, observed: {} },
      { case_id: 'case_b', metadata: { review_status: 'pending_review' }, reference: {}, observed: {} },
    ],
  };

  const reviewed = applyMemoryCandidateBatchReview(suite, {
    caseIds: ['case_a', 'case_b'],
    decision: 'needs_revision',
    reviewerId: 'reviewer_batch',
    notes: 'tighten expected fields',
    reviewedAt: '2026-05-15T09:00:00.000Z',
  });

  assert.equal(reviewed.summary.reviewed_case_count, 2);
  assert.deepEqual(reviewed.summary.reviewed_case_ids, ['case_a', 'case_b']);
  assert.ok(reviewed.document.cases.every((item) => item.metadata.review_status === 'needs_revision'));
});
