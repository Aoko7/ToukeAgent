const MEMORY_CASE_TYPES = ['durable_write', 'memory_recall', 'compression_fidelity', 'handoff_sufficiency'];
const DEFAULT_HANDOFF_REQUIRED_FIELDS = ['objective', 'context_snapshot_id', 'must_keep', 'evidence_refs', 'output_schema'];

function clone(value) {
  return structuredClone(value);
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function summarizeText(value, limit = 120) {
  const text = normalizeText(value);
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function inferLanguage(text) {
  return /[\u4e00-\u9fff]/.test(String(text ?? '')) ? 'zh' : 'en';
}

function uniqueStrings(values, { limit = 6, minLength = 2 } = {}) {
  const seen = new Set();
  const result = [];
  for (const value of values ?? []) {
    const normalized = normalizeText(value);
    if (!normalized || normalized.length < minLength) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function extractMessageText(bundle = {}) {
  const message = bundle?.task?.message_snapshot ?? bundle?.task?.message ?? null;
  const parts = Array.isArray(message?.content)
    ? message.content
      .filter((item) => item?.type === 'text' && item?.text)
      .map((item) => item.text)
    : [];
  const joined = normalizeText(parts.join(' '));
  if (joined) {
    return joined;
  }
  return normalizeText(
    message?.content_preview
    ?? bundle?.task?.message
    ?? bundle?.task?.summary
    ?? bundle?.plan?.summary
    ?? '',
  );
}

function collectTaskDurableMemories(bundle = {}) {
  const taskId = bundle?.task_id ?? null;
  const traceId = bundle?.trace_id ?? taskId ?? null;
  const items = Array.isArray(bundle?.memory?.long_term) ? bundle.memory.long_term : [];
  return items.filter((item) => (
    item?.source_task_id === taskId
      || item?.task_id === taskId
      || item?.source_trace_id === traceId
      || item?.trace_id === traceId
  ));
}

function durableMemoryToObservedEntry(item = {}) {
  return {
    memory_id: item.memory_id,
    title: item.title ?? null,
    summary: item.summary ?? null,
    content: item.content ?? null,
    facts: clone(item.facts ?? []),
    tags: clone(item.tags ?? []),
    source_task_id: item.source_task_id ?? item.task_id ?? null,
    source_trace_id: item.source_trace_id ?? item.trace_id ?? null,
    stale: item.stale ?? false,
  };
}

function deriveExpectedPhrases(durableMemories = []) {
  const candidates = [];
  for (const item of durableMemories) {
    candidates.push(...(item.facts ?? []));
    candidates.push(item.title);
    candidates.push(item.summary);
  }
  return uniqueStrings(candidates.map((value) => summarizeText(value, 96)), { limit: 6, minLength: 2 });
}

function deriveDisallowedPhrases(bundle = {}) {
  const shortTerm = Array.isArray(bundle?.memory?.short_term) ? bundle.memory.short_term : [];
  const timeSensitive = shortTerm
    .filter((item) => item?.role === 'user')
    .map((item) => normalizeText(item.content ?? item.summary ?? item.title ?? ''))
    .filter((text) => /明天|后天|提醒|下周|今晚|明早|tomorrow|tonight|next week|remind/i.test(text));
  return uniqueStrings(timeSensitive.map((value) => summarizeText(value, 96)), { limit: 3, minLength: 2 });
}

function buildDurableWriteCase(bundle, {
  provider,
  language,
  queryText,
  durableMemories,
} = {}) {
  if (!durableMemories.length) {
    return null;
  }

  return {
    case_id: `${bundle.task_id}_trace_durable_write`,
    case_type: 'durable_write',
    provider,
    metadata: {
      language,
      tags: ['trace-derived', 'draft', 'durable'],
      source_task_id: bundle.task_id,
      source_trace_id: bundle.trace_id,
      review_required: true,
      query_seed: summarizeText(queryText, 96),
      draft_origin: 'trace_bundle',
    },
    reference: {
      expected_phrases: deriveExpectedPhrases(durableMemories),
      disallowed_phrases: deriveDisallowedPhrases(bundle),
      review_notes: [
        'This draft pre-fills expected phrases from promoted durable memories.',
        'Trim or tighten the expected/disallowed phrases before using this case as a benchmark gold item.',
      ],
    },
    observed: {
      promoted_memories: durableMemories.map((item) => durableMemoryToObservedEntry(item)),
    },
  };
}

function retrievedMemoryToObservedEntry(item = {}) {
  return {
    memory_id: item.memory_id,
    title: item.title ?? null,
    summary: item.summary ?? null,
    content: item.content ?? null,
    facts: clone(item.facts ?? []),
    tags: clone(item.tags ?? []),
    source_task_id: item.source_task_id ?? null,
    source_trace_id: item.source_trace_id ?? null,
    stale: item.stale ?? false,
    score: item.score ?? null,
    lexical_score: item.lexical_score ?? null,
    semantic_score: item.semantic_score ?? null,
    score_breakdown: clone(item.score_breakdown ?? {}),
  };
}

function buildMemoryRecallCase(bundle, {
  provider,
  language,
  queryText,
  durableMemories,
  searchResults,
  recallTopK,
} = {}) {
  if (!queryText || !durableMemories.length || !searchResults.length) {
    return null;
  }

  const expectedMemoryIds = durableMemories
    .map((item) => item.memory_id)
    .filter(Boolean)
    .slice(0, Math.max(1, Math.min(recallTopK, 3)));
  if (!expectedMemoryIds.length) {
    return null;
  }

  const observedRetrieved = searchResults.slice(0, recallTopK).map((item) => retrievedMemoryToObservedEntry(item));
  return {
    case_id: `${bundle.task_id}_trace_memory_recall`,
    case_type: 'memory_recall',
    provider,
    metadata: {
      language,
      tags: ['trace-derived', 'draft', 'recall'],
      source_task_id: bundle.task_id,
      source_trace_id: bundle.trace_id,
      review_required: true,
      query_seed: summarizeText(queryText, 96),
      draft_origin: 'trace_bundle',
    },
    reference: {
      expected_memory_ids: expectedMemoryIds,
      stale_memory_ids: observedRetrieved.filter((item) => item.stale).map((item) => item.memory_id),
      top_k: recallTopK,
      review_notes: [
        'This draft uses the current task message as the recall query seed.',
        'Review the expected_memory_ids list and replace it with manually curated gold ids if needed.',
      ],
    },
    observed: {
      retrieved_memories: observedRetrieved,
    },
  };
}

function buildCompressionCase(bundle, {
  provider,
  language,
  queryText,
} = {}) {
  const snapshot = bundle?.latest_context_compression ?? bundle?.context_compressions?.at?.(-1) ?? null;
  if (!snapshot) {
    return null;
  }

  const mustKeep = uniqueStrings(snapshot.must_keep ?? [], { limit: 12, minLength: 1 });
  const unresolved = uniqueStrings(snapshot.unresolved_items ?? [], { limit: 8, minLength: 1 });
  const memoryRefs = uniqueStrings(snapshot.memory_refs ?? [], { limit: 8, minLength: 1 });
  if (!mustKeep.length && !unresolved.length && !memoryRefs.length) {
    return null;
  }

  return {
    case_id: `${bundle.task_id}_trace_compression_fidelity`,
    case_type: 'compression_fidelity',
    provider,
    metadata: {
      language,
      tags: ['trace-derived', 'draft', 'compression'],
      source_task_id: bundle.task_id,
      source_trace_id: bundle.trace_id,
      review_required: true,
      query_seed: summarizeText(queryText, 96),
      draft_origin: 'trace_bundle',
      snapshot_id: snapshot.snapshot_id ?? null,
    },
    reference: {
      expected_must_keep: mustKeep,
      expected_unresolved_items: unresolved,
      expected_memory_refs: memoryRefs,
      review_notes: [
        'This draft uses the latest context compression snapshot as a starting point.',
        'Review the must-keep and unresolved lists before promoting this into a benchmark gold case.',
      ],
    },
    observed: {
      snapshot: {
        snapshot_id: snapshot.snapshot_id ?? null,
        compression_strategy: snapshot.compression_strategy ?? null,
        must_keep: mustKeep,
        unresolved_items: unresolved,
        memory_refs: memoryRefs,
      },
    },
  };
}

function buildHandoffCase(bundle, {
  provider,
  language,
  queryText,
} = {}) {
  const handoff = bundle?.latest_handoff ?? bundle?.handoffs?.at?.(-1) ?? null;
  if (!handoff) {
    return null;
  }

  return {
    case_id: `${bundle.task_id}_trace_handoff_sufficiency`,
    case_type: 'handoff_sufficiency',
    provider,
    metadata: {
      language,
      tags: ['trace-derived', 'draft', 'handoff'],
      source_task_id: bundle.task_id,
      source_trace_id: bundle.trace_id,
      review_required: true,
      query_seed: summarizeText(queryText, 96),
      draft_origin: 'trace_bundle',
      handoff_id: handoff.handoff_id ?? null,
    },
    reference: {
      required_fields: DEFAULT_HANDOFF_REQUIRED_FIELDS,
      review_notes: [
        'This draft keeps a stable required_fields contract instead of copying fields from the handoff payload.',
      ],
    },
    observed: {
      handoff: {
        handoff_id: handoff.handoff_id ?? null,
        role: handoff.role ?? null,
        status: handoff.status ?? null,
        objective: handoff.objective ?? null,
        context_snapshot_id: handoff.context_snapshot_id ?? null,
        must_keep: clone(handoff.must_keep ?? []),
        evidence_refs: clone(handoff.evidence_refs ?? []),
        output_schema: clone(handoff.output_schema ?? {}),
      },
    },
  };
}

export function buildMemoryHarnessDraftFromTraceBundle(bundle, {
  searchResults = [],
  queryText = null,
  recallTopK = 3,
} = {}) {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('trace bundle is required');
  }
  if (!bundle.task_id) {
    throw new Error('trace bundle is missing task_id');
  }

  const resolvedQueryText = normalizeText(queryText || extractMessageText(bundle));
  const language = inferLanguage(resolvedQueryText);
  const provider = bundle?.memory?.effective_provider ?? bundle?.memory?.provider ?? 'local_builtin';
  const durableMemories = collectTaskDurableMemories(bundle);
  const cases = [
    buildDurableWriteCase(bundle, {
      provider,
      language,
      queryText: resolvedQueryText,
      durableMemories,
    }),
    buildMemoryRecallCase(bundle, {
      provider,
      language,
      queryText: resolvedQueryText,
      durableMemories,
      searchResults,
      recallTopK: Math.max(1, Math.min(recallTopK, searchResults.length || recallTopK)),
    }),
    buildCompressionCase(bundle, {
      provider,
      language,
      queryText: resolvedQueryText,
    }),
    buildHandoffCase(bundle, {
      provider,
      language,
      queryText: resolvedQueryText,
    }),
  ].filter(Boolean);

  const generatedTypes = cases.map((item) => item.case_type);
  const missingTypes = MEMORY_CASE_TYPES.filter((item) => !generatedTypes.includes(item));

  return {
    task_id: bundle.task_id,
    trace_id: bundle.trace_id ?? bundle.task_id,
    generated_at: new Date().toISOString(),
    source: {
      query_seed: resolvedQueryText || null,
      query_seed_summary: summarizeText(resolvedQueryText, 96) || null,
      workspace_id: bundle?.memory?.workspace_id ?? null,
      persona_id: bundle?.memory?.persona_id ?? null,
      memory_provider: provider,
    },
    summary: {
      generated_case_count: cases.length,
      case_types_generated: generatedTypes,
      missing_case_types: missingTypes,
      review_required: true,
      generated_from_trace: true,
      generated_from_long_term_count: durableMemories.length,
      generated_from_search_count: Array.isArray(searchResults) ? searchResults.length : 0,
    },
    notes: [
      'These cases are trace-derived drafts, not validated benchmark gold items.',
      'Review expected_phrases, expected_memory_ids, and compression expectations before using them in a scored harness run.',
    ],
    cases,
  };
}

export function createMemoryHarnessDraftArtifact(draft, {
  caseId = null,
  savedAt = new Date().toISOString(),
} = {}) {
  if (!draft || typeof draft !== 'object') {
    throw new Error('memory harness draft is required');
  }

  const cases = Array.isArray(draft.cases) ? draft.cases : [];
  const selectedCases = caseId
    ? cases.filter((item) => item?.case_id === caseId)
    : cases;
  if (caseId && selectedCases.length === 0) {
    throw new Error(`Unknown draft case: ${caseId}`);
  }
  if (selectedCases.length === 0) {
    throw new Error('memory harness draft has no cases to save');
  }

  const selectedCaseIds = selectedCases.map((item) => item.case_id).filter(Boolean);
  const selectedCaseTypes = selectedCases.map((item) => item.case_type).filter(Boolean);

  return {
    artifact_type: 'memory_harness_case_draft',
    saved_at: savedAt,
    review_required: true,
    draft_origin: 'trace_bundle',
    task_id: draft.task_id ?? null,
    trace_id: draft.trace_id ?? draft.task_id ?? null,
    source: clone(draft.source ?? {}),
    summary: {
      generated_case_count: draft.summary?.generated_case_count ?? cases.length,
      selected_case_count: selectedCases.length,
      selected_case_ids: selectedCaseIds,
      selected_case_types: selectedCaseTypes,
      generated_from_trace: true,
      review_required: true,
    },
    notes: [
      ...(Array.isArray(draft.notes) ? clone(draft.notes) : []),
      'Saved from a trace-derived memory harness draft artifact.',
      'Review this draft before merging it into a scored benchmark suite.',
    ],
    cases: selectedCases.map((item) => clone(item)),
  };
}

export function mergeMemoryHarnessDraftArtifactIntoSuite(suiteDocument, artifact, {
  promotedAt = new Date().toISOString(),
  suiteId = 'memory-benchmark-candidate',
} = {}) {
  if (!artifact || typeof artifact !== 'object') {
    throw new Error('memory draft artifact is required');
  }

  const artifactCases = Array.isArray(artifact.cases) ? artifact.cases.map((item) => clone(item)) : [];
  if (artifactCases.length === 0) {
    throw new Error('memory draft artifact has no cases to promote');
  }

  const baseDocument = Array.isArray(suiteDocument)
    ? { cases: suiteDocument.map((item) => clone(item)) }
    : (suiteDocument && typeof suiteDocument === 'object'
      ? {
        ...clone(suiteDocument),
        cases: Array.isArray(suiteDocument.cases) ? suiteDocument.cases.map((item) => clone(item)) : [],
      }
      : { cases: [] });

  const existingCases = Array.isArray(baseDocument.cases) ? baseDocument.cases : [];
  const indexByCaseId = new Map(
    existingCases
      .filter((item) => item?.case_id)
      .map((item, index) => [item.case_id, index]),
  );

  const addedCaseIds = [];
  const updatedCaseIds = [];

  for (const item of artifactCases) {
    const caseId = item?.case_id;
    if (!caseId) {
      throw new Error('cannot promote a case without case_id');
    }

    const promotedCase = {
      ...clone(item),
      metadata: {
        ...(clone(item.metadata ?? {})),
        benchmark_stage: 'candidate',
        promoted_from_trace_draft: true,
        promoted_at: promotedAt,
        promoted_from_task_id: artifact.task_id ?? null,
        promoted_from_trace_id: artifact.trace_id ?? artifact.task_id ?? null,
        review_status: clone(item.metadata?.review_status ?? 'pending_review'),
      },
    };

    if (indexByCaseId.has(caseId)) {
      existingCases[indexByCaseId.get(caseId)] = promotedCase;
      updatedCaseIds.push(caseId);
    } else {
      indexByCaseId.set(caseId, existingCases.length);
      existingCases.push(promotedCase);
      addedCaseIds.push(caseId);
    }
  }

  return {
    document: {
      ...baseDocument,
      suite_id: baseDocument.suite_id ?? suiteId,
      updated_at: promotedAt,
      metadata: {
        ...(clone(baseDocument.metadata ?? {})),
        suite_kind: 'candidate',
        last_promoted_at: promotedAt,
        last_promoted_case_ids: [...addedCaseIds, ...updatedCaseIds],
      },
      cases: existingCases,
    },
    summary: {
      promoted_case_count: artifactCases.length,
      added_case_ids: addedCaseIds,
      updated_case_ids: updatedCaseIds,
      total_case_count: existingCases.length,
    },
  };
}

export function applyMemoryCandidateCaseReview(suiteDocument, {
  caseId,
  decision,
  reviewerId = 'reviewer',
  notes = null,
  reviewedAt = new Date().toISOString(),
} = {}) {
  if (!suiteDocument || typeof suiteDocument !== 'object' || !Array.isArray(suiteDocument.cases)) {
    throw new Error('candidate suite document is required');
  }
  if (!caseId) {
    throw new Error('caseId is required');
  }
  if (!['approved', 'rejected', 'needs_revision'].includes(decision)) {
    throw new Error('decision must be approved, rejected, or needs_revision');
  }

  const nextDocument = clone(suiteDocument);
  const target = nextDocument.cases.find((item) => item?.case_id === caseId);
  if (!target) {
    throw new Error(`Unknown candidate case: ${caseId}`);
  }

  target.metadata = {
    ...(clone(target.metadata ?? {})),
    review_status: decision,
    reviewed_at: reviewedAt,
    reviewer_id: reviewerId,
    review_notes: notes ?? null,
  };

  nextDocument.updated_at = reviewedAt;
  nextDocument.metadata = {
    ...(clone(nextDocument.metadata ?? {})),
    last_reviewed_at: reviewedAt,
    last_reviewed_case_id: caseId,
  };

  return nextDocument;
}

export function applyMemoryCandidateBatchReview(suiteDocument, {
  caseIds,
  decision,
  reviewerId = 'reviewer',
  notes = null,
  reviewedAt = new Date().toISOString(),
} = {}) {
  if (!Array.isArray(caseIds) || caseIds.length === 0) {
    throw new Error('caseIds are required');
  }

  let nextDocument = clone(suiteDocument);
  const reviewedCaseIds = [];
  for (const caseId of caseIds) {
    nextDocument = applyMemoryCandidateCaseReview(nextDocument, {
      caseId,
      decision,
      reviewerId,
      notes,
      reviewedAt,
    });
    reviewedCaseIds.push(caseId);
  }

  nextDocument.metadata = {
    ...(clone(nextDocument.metadata ?? {})),
    last_batch_reviewed_at: reviewedAt,
    last_batch_reviewed_case_ids: reviewedCaseIds,
  };

  return {
    document: nextDocument,
    summary: {
      reviewed_case_count: reviewedCaseIds.length,
      reviewed_case_ids: reviewedCaseIds,
      decision,
    },
  };
}

export function mergeApprovedMemoryCandidateIntoGold(goldDocument, candidateSuite, {
  caseId,
  promotedAt = new Date().toISOString(),
  promotionRecord = null,
} = {}) {
  if (!candidateSuite || typeof candidateSuite !== 'object' || !Array.isArray(candidateSuite.cases)) {
    throw new Error('candidate suite is required');
  }

  const approvedCase = candidateSuite.cases.find((item) => (
    item?.case_id === caseId
      && item?.metadata?.review_status === 'approved'
  ));
  if (!approvedCase) {
    throw new Error(`Approved candidate case not found: ${caseId}`);
  }

  const baseDocument = Array.isArray(goldDocument)
    ? { cases: goldDocument.map((item) => clone(item)) }
    : (goldDocument && typeof goldDocument === 'object'
      ? {
        ...clone(goldDocument),
        cases: Array.isArray(goldDocument.cases) ? goldDocument.cases.map((item) => clone(item)) : [],
      }
      : { cases: [] });

  const existingCases = Array.isArray(baseDocument.cases) ? baseDocument.cases : [];
  const existingIndex = existingCases.findIndex((item) => item?.case_id === caseId);

  const goldCase = {
    ...clone(approvedCase),
    metadata: {
      ...(clone(approvedCase.metadata ?? {})),
      benchmark_stage: 'gold',
      promoted_to_gold_at: promotedAt,
      source_candidate_suite: candidateSuite.suite_id ?? null,
      promotion_record: promotionRecord ? clone(promotionRecord) : clone(approvedCase.metadata?.promotion_record ?? null),
    },
  };

  if (existingIndex >= 0) {
    existingCases[existingIndex] = goldCase;
  } else {
    existingCases.push(goldCase);
  }

  return {
    document: {
      ...baseDocument,
      updated_at: promotedAt,
      cases: existingCases,
    },
    summary: {
      case_id: caseId,
      total_case_count: existingCases.length,
      updated_existing: existingIndex >= 0,
    },
  };
}

function toComparableJson(value) {
  return JSON.stringify(value ?? null, null, 2);
}

function caseChecklist(candidateCase = {}, goldCase = null) {
  const candidateMeta = candidateCase?.metadata ?? {};
  const goldMeta = goldCase?.metadata ?? {};
  const reference = candidateCase?.reference ?? {};
  const observed = candidateCase?.observed ?? {};

  return [
    {
      key: 'approved_status',
      passed: candidateMeta.review_status === 'approved',
      detail: `review_status=${candidateMeta.review_status ?? 'n/a'}`,
    },
    {
      key: 'review_notes_present',
      passed: Boolean(candidateMeta.review_notes),
      detail: candidateMeta.review_notes ?? 'missing review notes',
    },
    {
      key: 'reference_present',
      passed: Object.keys(reference).length > 0,
      detail: `reference_keys=${Object.keys(reference).length}`,
    },
    {
      key: 'observed_present',
      passed: Object.keys(observed).length > 0,
      detail: `observed_keys=${Object.keys(observed).length}`,
    },
    {
      key: 'gold_exists',
      passed: Boolean(goldCase),
      detail: goldCase ? 'gold case exists' : 'gold case not found',
    },
    {
      key: 'gold_from_same_candidate_suite',
      passed: goldCase
        ? goldMeta.source_candidate_suite === (candidateMeta.source_candidate_suite ?? candidateMeta.promoted_from_suite ?? candidateCase?.suite_id ?? null)
          || goldMeta.source_candidate_suite === candidateCase?.metadata?.source_candidate_suite
          || goldMeta.source_candidate_suite === null
        : false,
      detail: `gold_source_candidate_suite=${goldMeta.source_candidate_suite ?? 'n/a'}`,
    },
  ];
}

function summarizeArrayDiff(candidateValues = [], goldValues = []) {
  const candidateList = Array.isArray(candidateValues) ? candidateValues.map((item) => normalizeText(item)) : [];
  const goldList = Array.isArray(goldValues) ? goldValues.map((item) => normalizeText(item)) : [];
  const goldSet = new Set(goldList);
  const candidateSet = new Set(candidateList);
  return {
    candidate_only: candidateList.filter((item) => item && !goldSet.has(item)),
    gold_only: goldList.filter((item) => item && !candidateSet.has(item)),
    overlap: candidateList.filter((item) => item && goldSet.has(item)),
  };
}

function isPrimitive(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function buildFieldDiffEntries(candidateValue, goldValue, path) {
  const candidateIsArray = Array.isArray(candidateValue);
  const goldIsArray = Array.isArray(goldValue);
  if (candidateIsArray || goldIsArray) {
    const candidateArray = candidateIsArray ? candidateValue : [];
    const goldArray = goldIsArray ? goldValue : [];
    if (candidateArray.every(isPrimitive) && goldArray.every(isPrimitive)) {
      const summary = summarizeArrayDiff(candidateArray, goldArray);
      return [{
        path,
        type: 'array',
        equal: summary.candidate_only.length === 0 && summary.gold_only.length === 0,
        candidate_count: candidateArray.length,
        gold_count: goldArray.length,
        ...summary,
      }];
    }

    return [{
      path,
      type: 'array_json',
      equal: toComparableJson(candidateArray) === toComparableJson(goldArray),
      candidate_count: candidateArray.length,
      gold_count: goldArray.length,
      candidate_preview: candidateArray.slice(0, 2),
      gold_preview: goldArray.slice(0, 2),
    }];
  }

  const candidateIsObject = candidateValue && typeof candidateValue === 'object';
  const goldIsObject = goldValue && typeof goldValue === 'object';
  if (candidateIsObject || goldIsObject) {
    if (!candidateIsObject || !goldIsObject) {
      return [{
        path,
        type: 'shape',
        equal: false,
        candidate: candidateValue ?? null,
        gold: goldValue ?? null,
      }];
    }
    const keys = [...new Set([
      ...Object.keys(candidateValue ?? {}),
      ...Object.keys(goldValue ?? {}),
    ])].sort();
    return keys.flatMap((key) => buildFieldDiffEntries(
      candidateValue?.[key],
      goldValue?.[key],
      path ? `${path}.${key}` : key,
    ));
  }

  return [{
    path,
    type: 'scalar',
    equal: toComparableJson(candidateValue) === toComparableJson(goldValue),
    candidate: candidateValue ?? null,
    gold: goldValue ?? null,
  }];
}

function summarizeFieldDiffEntries(entries = []) {
  return {
    total: entries.length,
    equal: entries.filter((item) => item.equal).length,
    different: entries.filter((item) => !item.equal).length,
  };
}

export function compareMemoryCandidateCaseAgainstGold(candidateSuite, goldDocument, {
  caseId,
} = {}) {
  if (!candidateSuite || typeof candidateSuite !== 'object' || !Array.isArray(candidateSuite.cases)) {
    throw new Error('candidate suite is required');
  }
  if (!caseId) {
    throw new Error('caseId is required');
  }

  const candidateCase = candidateSuite.cases.find((item) => item?.case_id === caseId);
  if (!candidateCase) {
    throw new Error(`Unknown candidate case: ${caseId}`);
  }

  const goldCases = Array.isArray(goldDocument?.cases)
    ? goldDocument.cases
    : (Array.isArray(goldDocument) ? goldDocument : []);
  const goldCase = goldCases.find((item) => item?.case_id === caseId) ?? null;

  const candidateReference = candidateCase.reference ?? {};
  const goldReference = goldCase?.reference ?? {};
  const candidateObserved = candidateCase.observed ?? {};
  const goldObserved = goldCase?.observed ?? {};

  return {
    case_id: caseId,
    candidate_suite_id: candidateSuite.suite_id ?? null,
    candidate_review_status: candidateCase.metadata?.review_status ?? 'pending_review',
    gold_exists: Boolean(goldCase),
    summary: {
      candidate_case_type: candidateCase.case_type ?? null,
      gold_case_type: goldCase?.case_type ?? null,
      reference_equal: toComparableJson(candidateReference) === toComparableJson(goldReference),
      observed_equal: toComparableJson(candidateObserved) === toComparableJson(goldObserved),
      metadata_equal: toComparableJson(candidateCase.metadata ?? {}) === toComparableJson(goldCase?.metadata ?? {}),
    },
    checklist: caseChecklist(candidateCase, goldCase),
    field_diffs: {
      reference: buildFieldDiffEntries(candidateReference, goldReference, 'reference'),
      observed: buildFieldDiffEntries(candidateObserved, goldObserved, 'observed'),
      metadata: buildFieldDiffEntries(candidateCase.metadata ?? {}, goldCase?.metadata ?? {}, 'metadata'),
    },
    diffs: {
      reference_json: {
        candidate: candidateReference,
        gold: goldReference,
      },
      observed_json: {
        candidate: candidateObserved,
        gold: goldObserved,
      },
      expected_phrases: summarizeArrayDiff(
        candidateReference.expected_phrases ?? [],
        goldReference.expected_phrases ?? [],
      ),
      expected_memory_ids: summarizeArrayDiff(
        candidateReference.expected_memory_ids ?? [],
        goldReference.expected_memory_ids ?? [],
      ),
      must_keep: summarizeArrayDiff(
        candidateReference.must_keep ?? [],
        goldReference.must_keep ?? [],
      ),
      metadata: {
        candidate: candidateCase.metadata ?? {},
        gold: goldCase?.metadata ?? {},
      },
    },
    field_diff_summary: {
      reference: summarizeFieldDiffEntries(buildFieldDiffEntries(candidateReference, goldReference, 'reference')),
      observed: summarizeFieldDiffEntries(buildFieldDiffEntries(candidateObserved, goldObserved, 'observed')),
      metadata: summarizeFieldDiffEntries(buildFieldDiffEntries(candidateCase.metadata ?? {}, goldCase?.metadata ?? {}, 'metadata')),
    },
  };
}

export function compareMemoryCandidateSuiteAgainstGold(candidateSuite, goldDocument) {
  if (!candidateSuite || typeof candidateSuite !== 'object' || !Array.isArray(candidateSuite.cases)) {
    throw new Error('candidate suite is required');
  }

  const comparisons = candidateSuite.cases.map((item) => compareMemoryCandidateCaseAgainstGold(candidateSuite, goldDocument, {
    caseId: item.case_id,
  }));

  return {
    suite_id: candidateSuite.suite_id ?? null,
    case_count: comparisons.length,
    summary: {
      approved_case_count: comparisons.filter((item) => item.candidate_review_status === 'approved').length,
      gold_existing_case_count: comparisons.filter((item) => item.gold_exists).length,
      fully_equal_case_count: comparisons.filter((item) => (
        item.summary.reference_equal
          && item.summary.observed_equal
          && item.summary.metadata_equal
      )).length,
      checklist_fail_case_count: comparisons.filter((item) => item.checklist.some((check) => !check.passed)).length,
      field_diff_case_count: comparisons.filter((item) => (
        (item.field_diff_summary?.reference?.different ?? 0) > 0
          || (item.field_diff_summary?.observed?.different ?? 0) > 0
          || (item.field_diff_summary?.metadata?.different ?? 0) > 0
      )).length,
    },
    comparisons,
  };
}
