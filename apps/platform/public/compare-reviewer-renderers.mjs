export function createCompareReviewerRenderers({
  harnessDetailOutput,
  clearNode,
  appendDraftJsonSection,
  appendCompareChecklistSection,
  appendCompareFieldSummarySection,
  appendCompareFieldDiffGroup,
  appendDraftListSection,
  appendDraftKv,
  createChip,
  createCompareValue,
  appendSuiteComparisonSection,
  appendWikiSuiteComparisonSection,
} = {}) {
  function appendComparisonReviewerSummarySection(container, comparison = {}, {
    titleText,
    summaryChips = [],
    summaryRows = [],
  } = {}) {
    const section = document.createElement('section');
    section.className = 'draft-section';

    const title = document.createElement('strong');
    title.textContent = titleText;
    section.appendChild(title);

    const chipRow = document.createElement('div');
    chipRow.className = 'chip-row';
    chipRow.appendChild(createChip(`cases:${comparison?.case_count ?? 1}`));
    for (const chip of summaryChips) {
      if (!chip) {
        continue;
      }
      chipRow.appendChild(createChip(chip.text, chip.tone ?? null));
    }
    section.appendChild(chipRow);

    const grid = document.createElement('div');
    grid.className = 'draft-grid';
    for (const row of summaryRows) {
      appendDraftKv(grid, row.label, row.value);
    }
    section.appendChild(grid);

    container.appendChild(section);
  }

  function collectComparisonGapIssues(comparison = {}, {
    missingIssue,
    issuePredicates = [],
  } = {}) {
    const comparisons = Array.isArray(comparison?.comparisons) ? comparison.comparisons : [comparison];
    const issues = [];

    for (const item of comparisons) {
      const failChecks = Array.isArray(item?.checklist)
        ? item.checklist.filter((check) => !check.passed).map((check) => `${item?.case_id ?? 'case'} · ${check.key}: ${check.detail ?? 'failed'}`)
        : [];
      issues.push(...failChecks);

      if (missingIssue?.predicate?.(item)) {
        issues.push(`${item?.case_id ?? 'case'} · ${missingIssue.message}`);
      }
      for (const issue of issuePredicates) {
        if (issue?.predicate?.(item)) {
          issues.push(`${item?.case_id ?? 'case'} · ${issue.message}`);
        }
      }
    }

    return Array.from(new Set(issues));
  }

  function appendComparisonGapSection(container, issues = []) {
    appendDraftListSection(container, 'Reviewer Gaps', issues.length > 0 ? issues : ['no material reviewer gaps']);
  }

  function appendSelectedComparisonCaseSection(container, comparison = {}, {
    diffCount,
    isMissing,
    headChips = [],
    detailRows = [],
    trailingLists = [],
  } = {}) {
    if (Array.isArray(comparison?.comparisons)) {
      return;
    }

    const failCount = Array.isArray(comparison?.checklist) ? comparison.checklist.filter((item) => !item.passed).length : 0;
    const section = document.createElement('section');
    section.className = 'draft-section';

    const title = document.createElement('strong');
    title.textContent = 'Selected Compare Case';
    section.appendChild(title);

    const card = document.createElement('div');
    card.className = 'compare-card';
    card.dataset.tone = isMissing || failCount > 0 || diffCount > 0 ? 'warn' : 'good';

    const head = document.createElement('div');
    head.className = 'compare-card-head';
    const heading = document.createElement('span');
    heading.className = 'compare-card-title';
    heading.textContent = comparison?.case_id ?? 'case';
    head.appendChild(heading);
    head.appendChild(createChip(comparison?.candidate_review_status ?? 'pending_review', comparison?.candidate_review_status === 'approved' ? 'good' : 'warn'));
    card.appendChild(head);

    const chipRow = document.createElement('div');
    chipRow.className = 'chip-row';
    for (const chip of headChips) {
      if (!chip) {
        continue;
      }
      chipRow.appendChild(createChip(chip.text, chip.tone ?? null));
    }
    card.appendChild(chipRow);
    section.appendChild(card);

    const grid = document.createElement('div');
    grid.className = 'draft-grid';
    for (const row of detailRows) {
      appendDraftKv(grid, row.label, row.value);
    }
    section.appendChild(grid);

    for (const list of trailingLists) {
      appendDraftListSection(container, list.title, list.values ?? []);
    }
    container.appendChild(section);
  }

  function renderComparisonDetail(comparison, titleText, {
    appendReviewerSummary,
    appendReviewerGaps,
    appendSelectedCaseDetail,
    appendSuiteCompare,
  } = {}) {
    clearNode(harnessDetailOutput);
    const wrapper = document.createElement('div');
    wrapper.className = 'draft-detail';

    appendReviewerSummary?.(wrapper, comparison);
    appendReviewerGaps?.(wrapper, comparison);
    appendSelectedCaseDetail?.(wrapper, comparison);
    appendDraftJsonSection(wrapper, titleText, comparison?.summary ?? comparison);
    if (Array.isArray(comparison?.checklist)) {
      appendCompareChecklistSection(wrapper, comparison.checklist);
    }
    if (comparison?.field_diff_summary) {
      appendCompareFieldSummarySection(wrapper, comparison.field_diff_summary);
    }
    if (comparison?.field_diffs) {
      for (const [fieldGroup, rows] of Object.entries(comparison.field_diffs)) {
        appendCompareFieldDiffGroup(wrapper, fieldGroup, rows);
      }
    }
    if (Array.isArray(comparison?.comparisons)) {
      appendSuiteCompare?.(wrapper, comparison.comparisons);
    }
    if (comparison?.diffs) {
      appendDraftJsonSection(wrapper, 'Diff Snapshot', comparison.diffs);
    }

    harnessDetailOutput.appendChild(wrapper);
  }

  function createMemoryCompareRenderConfig(comparison = {}) {
    return {
      appendReviewerSummary: (container) => void appendMemoryComparisonReviewerSummary(container, comparison),
      appendReviewerGaps: (container) => void appendMemoryComparisonGapSection(container, comparison),
      appendSelectedCaseDetail: (container) => void appendMemoryCaseComparisonReviewerDetail(container, comparison),
      appendSuiteCompare: appendSuiteComparisonSection,
    };
  }

  function createWikiCompareRenderConfig(comparison = {}) {
    return {
      appendReviewerSummary: (container) => void appendWikiComparisonReviewerSummary(container, comparison),
      appendReviewerGaps: (container) => void appendWikiComparisonGapSection(container, comparison),
      appendSelectedCaseDetail: (container) => void appendWikiCaseComparisonReviewerDetail(container, comparison),
      appendSuiteCompare: appendWikiSuiteComparisonSection,
    };
  }

  function appendMemoryComparisonReviewerSummary(container, comparison = {}) {
    const summary = comparison?.summary ?? comparison ?? {};
    appendComparisonReviewerSummarySection(container, comparison, {
      titleText: 'Memory Reviewer Summary',
      summaryChips: [
        typeof summary.approved_case_count === 'number' ? { text: `approved:${summary.approved_case_count}`, tone: summary.approved_case_count > 0 ? 'good' : null } : null,
        typeof summary.gold_existing_case_count === 'number' ? { text: `gold:${summary.gold_existing_case_count}`, tone: summary.gold_existing_case_count > 0 ? 'good' : 'warn' } : null,
        typeof summary.fully_equal_case_count === 'number' ? { text: `fully-equal:${summary.fully_equal_case_count}`, tone: summary.fully_equal_case_count > 0 ? 'good' : 'warn' } : null,
        typeof summary.checklist_fail_case_count === 'number' ? { text: `check-fail-cases:${summary.checklist_fail_case_count}`, tone: summary.checklist_fail_case_count > 0 ? 'bad' : 'good' } : null,
        typeof summary.field_diff_case_count === 'number' ? { text: `diff-cases:${summary.field_diff_case_count}`, tone: summary.field_diff_case_count > 0 ? 'warn' : 'good' } : null,
      ],
      summaryRows: [
        { label: 'Suite ID', value: comparison?.suite_id ?? comparison?.case_id ?? 'n/a' },
        { label: 'Gold Coverage', value: typeof summary.gold_existing_case_count === 'number' ? `${summary.gold_existing_case_count}/${comparison?.case_count ?? 1}` : (comparison?.gold_exists ? '1/1' : '0/1') },
        { label: 'Equality Coverage', value: typeof summary.fully_equal_case_count === 'number' ? `${summary.fully_equal_case_count}/${comparison?.case_count ?? 1}` : ((summary?.reference_equal && summary?.observed_equal && summary?.metadata_equal) ? '1/1' : '0/1') },
        { label: 'Reference Equality', value: typeof comparison?.case_count === 'number' ? 'see suite cards' : (summary?.reference_equal ? 'match' : 'drift') },
        { label: 'Observed Equality', value: typeof comparison?.case_count === 'number' ? 'see suite cards' : (summary?.observed_equal ? 'match' : 'drift') },
        { label: 'Metadata Equality', value: typeof comparison?.case_count === 'number' ? 'see suite cards' : (summary?.metadata_equal ? 'match' : 'drift') },
      ],
    });
  }

  function appendMemoryComparisonGapSection(container, comparison = {}) {
    const issues = collectComparisonGapIssues(comparison, {
      missingIssue: { predicate: (item) => item && item.gold_exists === false, message: 'gold case missing' },
      issuePredicates: [
        { predicate: (item) => item?.summary?.reference_equal === false, message: 'reference drift' },
        { predicate: (item) => item?.summary?.observed_equal === false, message: 'observed drift' },
        { predicate: (item) => item?.summary?.metadata_equal === false, message: 'metadata drift' },
      ],
    });
    appendComparisonGapSection(container, issues);
  }

  function appendMemoryCaseComparisonReviewerDetail(container, comparison = {}) {
    const summary = comparison?.summary ?? {};
    const reference = comparison?.diffs?.reference_json?.candidate ?? {};
    const goldReference = comparison?.diffs?.reference_json?.gold ?? {};
    const observed = comparison?.diffs?.observed_json?.candidate ?? {};
    const goldObserved = comparison?.diffs?.observed_json?.gold ?? {};
    appendSelectedComparisonCaseSection(container, comparison, {
      diffCount: (comparison?.field_diff_summary?.reference?.different ?? 0)
        + (comparison?.field_diff_summary?.observed?.different ?? 0)
        + (comparison?.field_diff_summary?.metadata?.different ?? 0),
      isMissing: !comparison?.gold_exists,
      headChips: [
        { text: comparison?.gold_exists ? 'gold:yes' : 'gold:no', tone: comparison?.gold_exists ? 'good' : 'warn' },
        summary?.candidate_case_type ? { text: `cand:${summary.candidate_case_type}` } : null,
        summary?.gold_case_type ? { text: `gold-type:${summary.gold_case_type}` } : null,
        { text: summary?.reference_equal ? 'reference:match' : 'reference:drift', tone: summary?.reference_equal ? 'good' : 'warn' },
        { text: summary?.observed_equal ? 'observed:match' : 'observed:drift', tone: summary?.observed_equal ? 'good' : 'warn' },
        { text: summary?.metadata_equal ? 'metadata:match' : 'metadata:drift', tone: summary?.metadata_equal ? 'good' : 'warn' },
      ],
      detailRows: [
        { label: 'Expected Phrases', value: Array.isArray(reference.expected_phrases) ? reference.expected_phrases.length : 0 },
        { label: 'Gold Phrases', value: Array.isArray(goldReference.expected_phrases) ? goldReference.expected_phrases.length : 0 },
        { label: 'Expected Memory IDs', value: Array.isArray(reference.expected_memory_ids) ? reference.expected_memory_ids.length : 0 },
        { label: 'Gold Memory IDs', value: Array.isArray(goldReference.expected_memory_ids) ? goldReference.expected_memory_ids.length : 0 },
        { label: 'Observed Recall IDs', value: Array.isArray(observed.recalled_memory_ids) ? observed.recalled_memory_ids.length : 0 },
        { label: 'Gold Recall IDs', value: Array.isArray(goldObserved.recalled_memory_ids) ? goldObserved.recalled_memory_ids.length : 0 },
      ],
      trailingLists: [
        { title: 'Candidate Expected Phrases', values: reference.expected_phrases ?? [] },
        { title: 'Gold Expected Phrases', values: goldReference.expected_phrases ?? [] },
        { title: 'Candidate Expected Memory IDs', values: reference.expected_memory_ids ?? [] },
        { title: 'Gold Expected Memory IDs', values: goldReference.expected_memory_ids ?? [] },
      ],
    });
  }

  function appendWikiComparisonReviewerSummary(container, comparison = {}) {
    const summary = comparison?.summary ?? comparison ?? {};
    appendComparisonReviewerSummarySection(container, comparison, {
      titleText: 'Wiki Reviewer Summary',
      summaryChips: [
        typeof summary.approved_case_count === 'number' ? { text: `approved:${summary.approved_case_count}`, tone: summary.approved_case_count > 0 ? 'good' : null } : null,
        typeof summary.observed_existing_case_count === 'number' ? { text: `observed:${summary.observed_existing_case_count}`, tone: summary.observed_existing_case_count > 0 ? 'good' : 'warn' } : null,
        typeof summary.route_match_case_count === 'number' ? { text: `route-match:${summary.route_match_case_count}`, tone: summary.route_match_case_count > 0 ? 'good' : 'warn' } : null,
        typeof summary.recommended_action_match_case_count === 'number' ? { text: `action-match:${summary.recommended_action_match_case_count}`, tone: summary.recommended_action_match_case_count > 0 ? 'good' : 'warn' } : null,
        typeof summary.checklist_fail_case_count === 'number' ? { text: `check-fail-cases:${summary.checklist_fail_case_count}`, tone: summary.checklist_fail_case_count > 0 ? 'bad' : 'good' } : null,
        typeof summary.field_diff_case_count === 'number' ? { text: `diff-cases:${summary.field_diff_case_count}`, tone: summary.field_diff_case_count > 0 ? 'warn' : 'good' } : null,
      ],
      summaryRows: [
        { label: 'Suite ID', value: comparison?.suite_id ?? comparison?.case_id ?? 'n/a' },
        { label: 'Observed Run', value: comparison?.observed_run_id ?? 'n/a' },
        { label: 'Observed Coverage', value: typeof summary.observed_existing_case_count === 'number' ? `${summary.observed_existing_case_count}/${comparison?.case_count ?? 1}` : (comparison?.observed_exists ? '1/1' : '0/1') },
        { label: 'Route Match Coverage', value: typeof summary.route_match_case_count === 'number' ? `${summary.route_match_case_count}/${comparison?.case_count ?? 1}` : (summary?.route_equal ? '1/1' : '0/1') },
        { label: 'Action Match Coverage', value: typeof summary.recommended_action_match_case_count === 'number' ? `${summary.recommended_action_match_case_count}/${comparison?.case_count ?? 1}` : (summary?.recommended_action_equal ? '1/1' : '0/1') },
        { label: 'Citation Guard Coverage', value: typeof comparison?.case_count === 'number' ? 'see equality cards' : (summary?.citation_guard_equal ? 'match' : 'drift') },
      ],
    });
  }

  function appendWikiComparisonGapSection(container, comparison = {}) {
    const issues = collectComparisonGapIssues(comparison, {
      missingIssue: { predicate: (item) => item && item.observed_exists === false, message: 'observed run missing' },
      issuePredicates: [
        { predicate: (item) => item?.summary?.route_equal === false, message: 'route mismatch' },
        { predicate: (item) => item?.summary?.effective_route_equal === false, message: 'effective route mismatch' },
        { predicate: (item) => item?.summary?.recommended_action_equal === false, message: 'recommended action mismatch' },
        { predicate: (item) => item?.summary?.citation_guard_equal === false, message: 'citation guard mismatch' },
      ],
    });
    appendComparisonGapSection(container, issues);
  }

  function appendWikiCaseComparisonReviewerDetail(container, comparison = {}) {
    const summary = comparison?.summary ?? {};
    const reference = comparison?.diffs?.reference_json?.candidate ?? {};
    const observed = comparison?.diffs?.reference_json?.observed ?? {};
    appendSelectedComparisonCaseSection(container, comparison, {
      diffCount: (comparison?.field_diff_summary?.reference?.different ?? 0)
        + (comparison?.field_diff_summary?.metadata?.different ?? 0)
        + (comparison?.field_diff_summary?.judge?.different ?? 0),
      isMissing: !comparison?.observed_exists,
      headChips: [
        { text: comparison?.observed_exists ? 'observed:yes' : 'observed:no', tone: comparison?.observed_exists ? 'good' : 'warn' },
        summary?.judge_decision ? { text: `judge:${summary.judge_decision}`, tone: summary.judge_decision === 'pass' ? 'good' : (summary.judge_decision === 'fail' ? 'bad' : 'warn') } : null,
        (summary?.judge_score !== null && summary?.judge_score !== undefined) ? { text: `score:${summary.judge_score}` } : null,
        { text: summary?.route_equal ? 'route:match' : 'route:drift', tone: summary?.route_equal ? 'good' : 'warn' },
        { text: summary?.recommended_action_equal ? 'action:match' : 'action:drift', tone: summary?.recommended_action_equal ? 'good' : 'warn' },
        { text: summary?.citation_guard_equal ? 'citation:match' : 'citation:drift', tone: summary?.citation_guard_equal ? 'good' : 'warn' },
      ],
      detailRows: [
        { label: 'Expected Route', value: reference.expected_route_mode ?? 'n/a' },
        { label: 'Observed Route', value: observed.actual_route_mode ?? 'n/a' },
        { label: 'Expected Effective Route', value: reference.expected_effective_mode ?? 'n/a' },
        { label: 'Observed Effective Route', value: observed.actual_effective_mode ?? 'n/a' },
        { label: 'Expected Action', value: reference.expected_recommended_action ?? 'n/a' },
        { label: 'Observed Action', value: observed.recommended_action ?? 'n/a' },
        { label: 'Expected Fallback', value: reference.expected_fallback_applied ? 'yes' : 'no' },
        { label: 'Observed Fallback', value: observed.fallback_applied ? 'yes' : 'no' },
      ],
      trailingLists: [
        { title: 'Expected Citation Titles', values: reference.required_citation_titles ?? [] },
        { title: 'Observed Citation Titles', values: observed.citation_titles ?? [] },
      ],
    });
  }

  function renderMemoryCandidateComparisonDetail(comparison, titleText) {
    renderComparisonDetail(comparison, titleText, createMemoryCompareRenderConfig(comparison));
  }

  function renderWikiCandidateComparisonDetail(comparison, titleText) {
    renderComparisonDetail(comparison, titleText, createWikiCompareRenderConfig(comparison));
  }

  return {
    renderComparisonDetail,
    createMemoryCompareRenderConfig,
    createWikiCompareRenderConfig,
    appendMemoryComparisonReviewerSummary,
    appendMemoryComparisonGapSection,
    appendMemoryCaseComparisonReviewerDetail,
    appendWikiComparisonReviewerSummary,
    appendWikiComparisonGapSection,
    appendWikiCaseComparisonReviewerDetail,
    renderMemoryCandidateComparisonDetail,
    renderWikiCandidateComparisonDetail,
  };
}
