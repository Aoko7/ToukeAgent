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

function uniqueStrings(values, { limit = 8, minLength = 2 } = {}) {
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

function pickKnowledgeFields(item = {}) {
  return {
    entry_id: item.entry_id ?? null,
    doc_id: item.doc_id ?? null,
    chunk_id: item.chunk_id ?? null,
    title: item.title ?? null,
    summary: item.summary ?? null,
    facts: clone(item.facts ?? []),
    tags: clone(item.tags ?? []),
    source_type: item.source_type ?? null,
    freshness: item.freshness ?? null,
    owner: item.owner ?? null,
    required_context: clone(item.required_context ?? []),
    retrieval_hints: clone(item.retrieval_hints ?? []),
    ttl_seconds: item.ttl_seconds ?? null,
    source_of_truth: item.source_of_truth ?? null,
    version: item.version ?? null,
    metadata: clone(item.metadata ?? {}),
    text: item.text ?? null,
    snippet: item.snippet ?? null,
  };
}

function choosePrimaryTopic(retrievalResult = {}) {
  const dynamicItems = Array.isArray(retrievalResult?.dynamic_items) ? retrievalResult.dynamic_items : [];
  const stableItems = Array.isArray(retrievalResult?.stable_items) ? retrievalResult.stable_items : [];
  const candidate = dynamicItems[0] ?? stableItems[0] ?? null;
  if (!candidate) {
    return 'wiki_trace';
  }

  const metadata = candidate.metadata ?? {};
  return normalizeText(
    metadata.topic
    ?? metadata.entity_id
    ?? candidate.entry_id
    ?? candidate.doc_id
    ?? candidate.title
    ?? 'wiki_trace',
  ).replace(/\s+/g, '_').toLowerCase();
}

function inferExpectedBucket(route = {}, quality = {}) {
  if (route.fallback_applied) {
    return 'fallback';
  }
  if (quality.recommended_action && quality.recommended_action !== 'accept') {
    return quality.recommended_action;
  }
  if (route.effective_mode === 'wiki-first') {
    return 'wiki_first';
  }
  return 'rag_first';
}

function deriveCitationTitles(retrievalResult = {}) {
  const citations = Array.isArray(retrievalResult?.citations) ? retrievalResult.citations : [];
  return uniqueStrings(citations.map((item) => item?.title), { limit: 4, minLength: 1 });
}

function toComparableJson(value) {
  return JSON.stringify(value ?? null, null, 2);
}

function summarizeArrayDiff(candidateValues = [], observedValues = []) {
  const candidateList = Array.isArray(candidateValues) ? candidateValues.map((item) => normalizeText(item)) : [];
  const observedList = Array.isArray(observedValues) ? observedValues.map((item) => normalizeText(item)) : [];
  const observedSet = new Set(observedList);
  const candidateSet = new Set(candidateList);
  return {
    candidate_only: candidateList.filter((item) => item && !observedSet.has(item)),
    observed_only: observedList.filter((item) => item && !candidateSet.has(item)),
    overlap: candidateList.filter((item) => item && observedSet.has(item)),
  };
}

function isPrimitive(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function buildFieldDiffEntries(candidateValue, observedValue, path) {
  const candidateIsArray = Array.isArray(candidateValue);
  const observedIsArray = Array.isArray(observedValue);
  if (candidateIsArray || observedIsArray) {
    const candidateArray = candidateIsArray ? candidateValue : [];
    const observedArray = observedIsArray ? observedValue : [];
    if (candidateArray.every(isPrimitive) && observedArray.every(isPrimitive)) {
      const summary = summarizeArrayDiff(candidateArray, observedArray);
      return [{
        path,
        type: 'array',
        equal: summary.candidate_only.length === 0 && summary.observed_only.length === 0,
        candidate_count: candidateArray.length,
        observed_count: observedArray.length,
        ...summary,
      }];
    }

    return [{
      path,
      type: 'array_json',
      equal: toComparableJson(candidateArray) === toComparableJson(observedArray),
      candidate_count: candidateArray.length,
      observed_count: observedArray.length,
      candidate_preview: candidateArray.slice(0, 2),
      observed_preview: observedArray.slice(0, 2),
    }];
  }

  const candidateIsObject = candidateValue && typeof candidateValue === 'object';
  const observedIsObject = observedValue && typeof observedValue === 'object';
  if (candidateIsObject || observedIsObject) {
    if (!candidateIsObject || !observedIsObject) {
      return [{
        path,
        type: 'shape',
        equal: false,
        candidate: candidateValue ?? null,
        observed: observedValue ?? null,
      }];
    }
    const keys = [...new Set([
      ...Object.keys(candidateValue ?? {}),
      ...Object.keys(observedValue ?? {}),
    ])].sort();
    return keys.flatMap((key) => buildFieldDiffEntries(
      candidateValue?.[key],
      observedValue?.[key],
      path ? `${path}.${key}` : key,
    ));
  }

  return [{
    path,
    type: 'scalar',
    equal: toComparableJson(candidateValue) === toComparableJson(observedValue),
    candidate: candidateValue ?? null,
    observed: observedValue ?? null,
  }];
}

function summarizeFieldDiffEntries(entries = []) {
  return {
    total: entries.length,
    equal: entries.filter((item) => item.equal).length,
    different: entries.filter((item) => !item.equal).length,
  };
}

function normalizeWikiCandidateReviewStatus(metadata = {}) {
  const normalized = normalizeText(metadata?.review_status).toLowerCase();
  if (['approved', 'rejected', 'needs_revision', 'pending_review'].includes(normalized)) {
    return normalized;
  }
  return 'pending_review';
}

function wikiCompareChecklist(candidateCase = {}, observedCase = null) {
  const candidateMeta = candidateCase?.metadata ?? {};
  const reference = candidateCase?.reference ?? {};
  const judge = observedCase?.judge ?? {};
  const route = judge?.route ?? {};
  const quality = judge?.quality ?? {};
  const citationTitles = Array.isArray(judge?.citation_titles) ? judge.citation_titles : [];

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
      key: 'observed_run_present',
      passed: Boolean(observedCase),
      detail: observedCase ? 'matched observed run case exists' : 'matched observed run case not found',
    },
    {
      key: 'route_match',
      passed: reference.expected_route_mode ? route.actual_route_mode === reference.expected_route_mode : true,
      detail: `expected=${reference.expected_route_mode ?? 'n/a'} observed=${route.actual_route_mode ?? 'n/a'}`,
    },
    {
      key: 'effective_route_match',
      passed: reference.expected_effective_mode ? route.actual_effective_mode === reference.expected_effective_mode : true,
      detail: `expected=${reference.expected_effective_mode ?? 'n/a'} observed=${route.actual_effective_mode ?? 'n/a'}`,
    },
    {
      key: 'recommended_action_match',
      passed: reference.expected_recommended_action ? quality.recommended_action === reference.expected_recommended_action : true,
      detail: `expected=${reference.expected_recommended_action ?? 'n/a'} observed=${quality.recommended_action ?? 'n/a'}`,
    },
    {
      key: 'required_citations_present',
      passed: !Array.isArray(reference.required_citation_titles) || reference.required_citation_titles.every((title) => citationTitles.includes(title)),
      detail: `expected=${(reference.required_citation_titles ?? []).join(', ') || 'n/a'} observed=${citationTitles.join(', ') || 'n/a'}`,
    },
  ];
}

export function buildWikiHarnessDraftFromTraceBundle(bundle, {
  queryText = null,
} = {}) {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('trace bundle is required');
  }
  if (!bundle.task_id) {
    throw new Error('trace bundle is missing task_id');
  }

  const task = bundle.task ?? {};
  const runState = task.run_state ?? bundle.run_state ?? {};
  const stepResults = Array.isArray(runState.step_results) ? runState.step_results : [];
  const retrievalResult = stepResults.find((entry) => entry?.output?.route || entry?.output?.citations || entry?.output?.items)?.output ?? null;
  if (!retrievalResult) {
    throw new Error(`Task ${bundle.task_id} does not contain a retrieval result`);
  }

  const resolvedQueryText = normalizeText(queryText || extractMessageText(bundle) || retrievalResult.query || '');
  const language = inferLanguage(resolvedQueryText);
  const route = retrievalResult.route ?? {};
  const quality = retrievalResult.quality ?? {};
  const queryAnalysis = retrievalResult.query_analysis ?? {};
  const stableItems = Array.isArray(retrievalResult.stable_items) ? retrievalResult.stable_items : [];
  const dynamicItems = Array.isArray(retrievalResult.dynamic_items) ? retrievalResult.dynamic_items : [];
  const citations = deriveCitationTitles(retrievalResult);
  const expectedBucket = inferExpectedBucket(route, quality);
  const routeFamily = route.mode ?? 'rag-first';
  const topic = choosePrimaryTopic(retrievalResult);
  const personaId = task.persona_id ?? bundle?.memory?.persona_id ?? null;

  const reviewNotes = [
    'This draft is derived from a real task trace, not a validated wiki benchmark gold case.',
    'Review route expectations, citation titles, and recommended_action before using this case in a scored suite.',
  ];

  return {
    task_id: bundle.task_id,
    trace_id: bundle.trace_id ?? bundle.task_id,
    generated_at: new Date().toISOString(),
    source: {
      query_seed: resolvedQueryText || null,
      query_seed_summary: summarizeText(resolvedQueryText, 96) || null,
      persona_id: personaId,
      route_mode: route.mode ?? null,
      effective_mode: route.effective_mode ?? null,
    },
    summary: {
      generated_case_count: 1,
      review_required: true,
      generated_from_trace: true,
      dynamic_item_count: dynamicItems.length,
      stable_item_count: stableItems.length,
      citation_count: citations.length,
    },
    notes: reviewNotes,
    cases: [
      {
        case_id: `${bundle.task_id}_trace_wiki_case`,
        payload: {
          query: resolvedQueryText,
          persona_id: personaId,
          stable_items: stableItems.map((item) => pickKnowledgeFields(item)),
          dynamic_items: dynamicItems.map((item) => pickKnowledgeFields(item)),
        },
        reference: {
          expected_route_mode: route.mode ?? null,
          expected_effective_mode: route.effective_mode ?? route.mode ?? null,
          expected_fallback_applied: Boolean(route.fallback_applied),
          expected_recommended_action: quality.recommended_action ?? null,
          required_citation_titles: citations,
          review_notes: reviewNotes,
        },
        metadata: {
          domain: 'wiki',
          route_family: routeFamily,
          topic,
          language,
          expected_bucket: expectedBucket,
          tags: uniqueStrings([
            'trace-derived',
            'draft',
            ...(queryAnalysis.intent_tags ?? []),
            ...(dynamicItems.flatMap((item) => item.tags ?? [])),
          ], { limit: 10, minLength: 2 }),
          review_required: true,
          draft_origin: 'trace_bundle',
          source_task_id: bundle.task_id,
          source_trace_id: bundle.trace_id ?? bundle.task_id,
        },
      },
    ],
  };
}

export function createWikiHarnessDraftArtifact(draft, {
  caseId = null,
  savedAt = new Date().toISOString(),
} = {}) {
  if (!draft || typeof draft !== 'object') {
    throw new Error('wiki harness draft is required');
  }

  const cases = Array.isArray(draft.cases) ? draft.cases : [];
  const selectedCases = caseId
    ? cases.filter((item) => item?.case_id === caseId)
    : cases;
  if (caseId && selectedCases.length === 0) {
    throw new Error(`Unknown draft case: ${caseId}`);
  }
  if (selectedCases.length === 0) {
    throw new Error('wiki harness draft has no cases to save');
  }

  return {
    artifact_type: 'wiki_harness_case_draft',
    saved_at: savedAt,
    review_required: true,
    draft_origin: 'trace_bundle',
    task_id: draft.task_id ?? null,
    trace_id: draft.trace_id ?? draft.task_id ?? null,
    source: clone(draft.source ?? {}),
    summary: {
      generated_case_count: draft.summary?.generated_case_count ?? cases.length,
      selected_case_count: selectedCases.length,
      selected_case_ids: selectedCases.map((item) => item.case_id).filter(Boolean),
      generated_from_trace: true,
      review_required: true,
    },
    notes: [
      ...(Array.isArray(draft.notes) ? clone(draft.notes) : []),
      'Saved from a trace-derived wiki harness draft artifact.',
      'Review this draft before merging it into a scored wiki benchmark suite.',
    ],
    cases: selectedCases.map((item) => clone(item)),
  };
}

export function mergeWikiHarnessDraftArtifactIntoSuite(suiteDocument, artifact, {
  promotedAt = new Date().toISOString(),
  suiteId = 'wiki-benchmark-candidate',
} = {}) {
  if (!artifact || typeof artifact !== 'object') {
    throw new Error('wiki draft artifact is required');
  }

  const artifactCases = Array.isArray(artifact.cases) ? artifact.cases.map((item) => clone(item)) : [];
  if (artifactCases.length === 0) {
    throw new Error('wiki draft artifact has no cases to promote');
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
        benchmark_domain: 'wiki',
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

export function summarizeWikiCandidateSuiteGovernance(suiteDocument) {
  const cases = Array.isArray(suiteDocument?.cases) ? suiteDocument.cases : [];
  const reviewStatusCounts = {
    approved: 0,
    needs_revision: 0,
    rejected: 0,
    pending_review: 0,
  };

  let promotedFromTraceCaseCount = 0;
  let reviewRequiredCaseCount = 0;

  for (const item of cases) {
    const metadata = item?.metadata ?? {};
    reviewStatusCounts[normalizeWikiCandidateReviewStatus(metadata)] += 1;
    if (metadata.promoted_from_trace_draft) {
      promotedFromTraceCaseCount += 1;
    }
    if (metadata.review_required !== false) {
      reviewRequiredCaseCount += 1;
    }
  }

  return {
    case_count: cases.length,
    review_status_counts: reviewStatusCounts,
    approved_case_count: reviewStatusCounts.approved,
    needs_revision_case_count: reviewStatusCounts.needs_revision,
    rejected_case_count: reviewStatusCounts.rejected,
    pending_case_count: reviewStatusCounts.pending_review,
    reviewed_case_count: reviewStatusCounts.approved + reviewStatusCounts.needs_revision + reviewStatusCounts.rejected,
    review_required_case_count: reviewRequiredCaseCount,
    promoted_from_trace_case_count: promotedFromTraceCaseCount,
    last_promoted_at: suiteDocument?.metadata?.last_promoted_at ?? null,
    last_reviewed_at: suiteDocument?.metadata?.last_reviewed_at ?? null,
    last_batch_reviewed_at: suiteDocument?.metadata?.last_batch_reviewed_at ?? null,
  };
}

export function applyWikiCandidateCaseReview(suiteDocument, {
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

export function applyWikiCandidateBatchReview(suiteDocument, {
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
    nextDocument = applyWikiCandidateCaseReview(nextDocument, {
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

export function compareWikiCandidateCaseAgainstObservedRun(candidateSuite, observedRun, {
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

  const observedCases = Array.isArray(observedRun?.cases) ? observedRun.cases : [];
  const observedCase = observedCases.find((item) => item?.case_id === caseId) ?? null;

  const candidateReference = candidateCase.reference ?? {};
  const observedRoute = observedCase?.judge?.route ?? {};
  const observedQuality = observedCase?.judge?.quality ?? {};
  const observedCitations = Array.isArray(observedCase?.judge?.citation_titles) ? observedCase.judge.citation_titles : [];
  const observedSummary = {
    actual_route_mode: observedRoute.actual_route_mode ?? null,
    actual_effective_mode: observedRoute.actual_effective_mode ?? null,
    fallback_applied: observedRoute.fallback_applied ?? null,
    recommended_action: observedQuality.recommended_action ?? null,
    retrieval_score: observedQuality.retrieval_score ?? null,
    freshness_score: observedQuality.freshness_score ?? null,
    contract_coverage_score: observedQuality.contract_coverage_score ?? null,
    citation_titles: observedCitations,
  };

  return {
    case_id: caseId,
    candidate_suite_id: candidateSuite.suite_id ?? null,
    observed_run_id: observedRun?.run_id ?? null,
    candidate_review_status: candidateCase.metadata?.review_status ?? 'pending_review',
    observed_exists: Boolean(observedCase),
    summary: {
      route_equal: candidateReference.expected_route_mode === observedSummary.actual_route_mode,
      effective_route_equal: candidateReference.expected_effective_mode === observedSummary.actual_effective_mode,
      recommended_action_equal: candidateReference.expected_recommended_action === observedSummary.recommended_action,
      citation_guard_equal: toComparableJson(candidateReference.required_citation_titles ?? []) === toComparableJson(observedSummary.citation_titles ?? []),
      judge_decision: observedCase?.judge?.decision ?? null,
      judge_score: observedCase?.judge?.score ?? null,
    },
    checklist: wikiCompareChecklist(candidateCase, observedCase),
    field_diffs: {
      reference: buildFieldDiffEntries(candidateReference, {
        expected_route_mode: observedSummary.actual_route_mode,
        expected_effective_mode: observedSummary.actual_effective_mode,
        expected_fallback_applied: observedSummary.fallback_applied,
        expected_recommended_action: observedSummary.recommended_action,
        required_citation_titles: observedSummary.citation_titles,
      }, 'reference'),
      metadata: buildFieldDiffEntries(candidateCase.metadata ?? {}, observedCase?.metadata ?? {}, 'metadata'),
      judge: buildFieldDiffEntries({
        decision: null,
        score: null,
      }, {
        decision: observedCase?.judge?.decision ?? null,
        score: observedCase?.judge?.score ?? null,
      }, 'judge'),
    },
    diffs: {
      reference_json: {
        candidate: candidateReference,
        observed: observedSummary,
      },
      citations: summarizeArrayDiff(
        candidateReference.required_citation_titles ?? [],
        observedSummary.citation_titles ?? [],
      ),
      metadata: {
        candidate: candidateCase.metadata ?? {},
        observed: observedCase?.metadata ?? {},
      },
      judge: observedCase?.judge ?? null,
    },
    field_diff_summary: {
      reference: summarizeFieldDiffEntries(buildFieldDiffEntries(candidateReference, {
        expected_route_mode: observedSummary.actual_route_mode,
        expected_effective_mode: observedSummary.actual_effective_mode,
        expected_fallback_applied: observedSummary.fallback_applied,
        expected_recommended_action: observedSummary.recommended_action,
        required_citation_titles: observedSummary.citation_titles,
      }, 'reference')),
      metadata: summarizeFieldDiffEntries(buildFieldDiffEntries(candidateCase.metadata ?? {}, observedCase?.metadata ?? {}, 'metadata')),
      judge: summarizeFieldDiffEntries(buildFieldDiffEntries({
        decision: null,
        score: null,
      }, {
        decision: observedCase?.judge?.decision ?? null,
        score: observedCase?.judge?.score ?? null,
      }, 'judge')),
    },
  };
}

export function compareWikiCandidateSuiteAgainstObservedRun(candidateSuite, observedRun) {
  if (!candidateSuite || typeof candidateSuite !== 'object' || !Array.isArray(candidateSuite.cases)) {
    throw new Error('candidate suite is required');
  }

  const comparisons = candidateSuite.cases.map((item) => compareWikiCandidateCaseAgainstObservedRun(candidateSuite, observedRun, {
    caseId: item.case_id,
  }));

  return {
    suite_id: candidateSuite.suite_id ?? null,
    observed_run_id: observedRun?.run_id ?? null,
    case_count: comparisons.length,
    summary: {
      approved_case_count: comparisons.filter((item) => item.candidate_review_status === 'approved').length,
      observed_existing_case_count: comparisons.filter((item) => item.observed_exists).length,
      route_match_case_count: comparisons.filter((item) => item.summary.route_equal).length,
      recommended_action_match_case_count: comparisons.filter((item) => item.summary.recommended_action_equal).length,
      checklist_fail_case_count: comparisons.filter((item) => item.checklist.some((check) => !check.passed)).length,
      field_diff_case_count: comparisons.filter((item) => (
        (item.field_diff_summary?.reference?.different ?? 0) > 0
          || (item.field_diff_summary?.metadata?.different ?? 0) > 0
          || (item.field_diff_summary?.judge?.different ?? 0) > 0
      )).length,
    },
    comparisons,
  };
}
