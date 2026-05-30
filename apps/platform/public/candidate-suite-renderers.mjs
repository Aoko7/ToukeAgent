export function createCandidateSuiteRenderers({
  state,
  harnessDetailOutput,
  harnessCandidateSuiteList,
  clearNode,
  appendDraftJsonSection,
  appendDraftListSection,
  appendDraftKv,
  createChip,
  createCompareValue,
  formatTimestamp,
  toggleSelectedMemoryCandidateCase,
  toggleSelectedWikiCandidateCase,
  fetchJson,
  renderMemoryCandidateReviewFormState,
  renderWikiCandidateReviewFormState,
} = {}) {
  function buildMemoryCandidateSuiteStats(suite = {}) {
    const cases = Array.isArray(suite?.cases) ? suite.cases : [];
    const reviewCounts = {
      approved: 0,
      needs_revision: 0,
      rejected: 0,
      pending_review: 0,
    };
    let promotedCount = 0;

    for (const item of cases) {
      const status = item?.metadata?.review_status ?? 'pending_review';
      if (!Object.hasOwn(reviewCounts, status)) {
        reviewCounts.pending_review += 1;
      } else {
        reviewCounts[status] += 1;
      }
      if (item?.metadata?.promotion_record || item?.metadata?.promoted_to_gold_at) {
        promotedCount += 1;
      }
    }

    return {
      case_count: cases.length,
      approved_count: reviewCounts.approved,
      needs_revision_count: reviewCounts.needs_revision,
      rejected_count: reviewCounts.rejected,
      pending_review_count: reviewCounts.pending_review,
      promoted_count: promotedCount,
      approval_rate: cases.length > 0 ? Number((reviewCounts.approved / cases.length).toFixed(2)) : 0,
    };
  }

  function buildWikiCandidateSuiteStats(suite = {}) {
    const cases = Array.isArray(suite?.cases) ? suite.cases : [];
    const reviewCounts = {
      approved: 0,
      needs_revision: 0,
      rejected: 0,
      pending_review: 0,
    };

    for (const item of cases) {
      const status = item?.metadata?.review_status ?? 'pending_review';
      if (!Object.hasOwn(reviewCounts, status)) {
        reviewCounts.pending_review += 1;
      } else {
        reviewCounts[status] += 1;
      }
    }

    return {
      case_count: cases.length,
      approved_count: reviewCounts.approved,
      needs_revision_count: reviewCounts.needs_revision,
      rejected_count: reviewCounts.rejected,
      pending_review_count: reviewCounts.pending_review,
      approval_rate: cases.length > 0 ? Number((reviewCounts.approved / cases.length).toFixed(2)) : 0,
    };
  }

  function renderMemoryGoldHistoryAudit(events = []) {
    const section = document.createElement('section');
    section.className = 'draft-section';

    const title = document.createElement('strong');
    title.textContent = 'Gold History Audit';
    section.appendChild(title);

    if (!Array.isArray(events) || events.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tiny muted';
      empty.textContent = 'No gold history loaded';
      section.appendChild(empty);
      return section;
    }

    const chips = document.createElement('div');
    chips.className = 'chip-row';
    const promoteCount = events.filter((item) => item?.event_type === 'promote_gold').length;
    const rollbackCount = events.filter((item) => item?.event_type === 'rollback_gold').length;
    chips.appendChild(createChip(`events:${events.length}`));
    chips.appendChild(createChip(`promote:${promoteCount}`, promoteCount > 0 ? 'good' : null));
    chips.appendChild(createChip(`rollback:${rollbackCount}`, rollbackCount > 0 ? 'warn' : null));
    section.appendChild(chips);

    const grid = document.createElement('div');
    grid.className = 'compare-grid';
    for (const event of [...events].reverse()) {
      const card = document.createElement('div');
      card.className = 'compare-card';
      card.dataset.tone = event?.event_type === 'rollback_gold' ? 'bad' : 'good';

      const head = document.createElement('div');
      head.className = 'compare-card-head';
      const heading = document.createElement('span');
      heading.className = 'compare-card-title';
      heading.textContent = `${event?.event_type ?? 'event'} · ${event?.case_id ?? 'n/a'}`;
      head.appendChild(heading);
      head.appendChild(createChip(formatTimestamp(event?.recorded_at)));
      card.appendChild(head);

      const values = document.createElement('div');
      values.className = 'compare-values';
      values.appendChild(createCompareValue('Reviewer', event?.reviewer_id ?? 'n/a'));
      values.appendChild(createCompareValue('Reason / Status', event?.reason ?? event?.review_status ?? 'n/a'));
      values.appendChild(createCompareValue('Promotion ID', event?.promotion_id ?? event?.rollback_of_promotion_id ?? 'n/a'));
      values.appendChild(createCompareValue('Candidate Suite', event?.candidate_suite_id ?? event?.candidate_suite_path ?? 'n/a'));
      card.appendChild(values);

      if (event?.previous_gold_case || event?.promoted_candidate_case || event?.restored_previous_gold_case) {
        card.appendChild(createCompareValue('Payload', {
          previous_gold_case: event?.previous_gold_case ?? null,
          promoted_candidate_case: event?.promoted_candidate_case ?? null,
          restored_previous_gold_case: event?.restored_previous_gold_case ?? null,
        }));
      }

      grid.appendChild(card);
    }

    section.appendChild(grid);
    return section;
  }

  function renderMemoryCandidateSuiteDetail(suite) {
    clearNode(harnessDetailOutput);
    const wrapper = document.createElement('div');
    wrapper.className = 'draft-detail';
    const suiteStats = buildMemoryCandidateSuiteStats(suite);

    const header = document.createElement('section');
    header.className = 'draft-section';
    const grid = document.createElement('div');
    grid.className = 'draft-grid';
    appendDraftKv(grid, 'Suite ID', suite?.suite_id ?? 'n/a');
    appendDraftKv(grid, 'Cases', suite?.cases?.length ?? suite?.case_count ?? 0);
    appendDraftKv(grid, 'Updated At', suite?.updated_at ?? 'n/a');
    appendDraftKv(grid, 'Path', suite?.relative_path ?? 'n/a');
    header.appendChild(grid);
    wrapper.appendChild(header);

    const statSection = document.createElement('section');
    statSection.className = 'draft-section';
    const statTitle = document.createElement('strong');
    statTitle.textContent = 'Suite Governance Summary';
    statSection.appendChild(statTitle);
    const statChips = document.createElement('div');
    statChips.className = 'chip-row';
    statChips.appendChild(createChip(`approved:${suiteStats.approved_count}`, suiteStats.approved_count > 0 ? 'good' : null));
    statChips.appendChild(createChip(`needs-revision:${suiteStats.needs_revision_count}`, suiteStats.needs_revision_count > 0 ? 'warn' : null));
    statChips.appendChild(createChip(`rejected:${suiteStats.rejected_count}`, suiteStats.rejected_count > 0 ? 'bad' : null));
    statChips.appendChild(createChip(`pending:${suiteStats.pending_review_count}`, suiteStats.pending_review_count > 0 ? 'warn' : 'good'));
    statChips.appendChild(createChip(`promoted:${suiteStats.promoted_count}`));
    statChips.appendChild(createChip(`approval-rate:${suiteStats.approval_rate}`));
    statSection.appendChild(statChips);
    wrapper.appendChild(statSection);

    if (suite?.metadata) {
      appendDraftJsonSection(wrapper, 'Suite Metadata', suite.metadata);
    }
    if (Array.isArray(suite?.cases) && suite.cases.length > 0) {
      const selectedCase = suite.cases.find((item) => item.case_id === state.memoryCandidateSuiteSelectedCaseId) ?? suite.cases[0];
      state.memoryCandidateSuiteSelectedCaseId = selectedCase?.case_id ?? null;
      if (!Array.isArray(state.memoryCandidateSuiteSelectedCaseIds) || state.memoryCandidateSuiteSelectedCaseIds.length === 0) {
        state.memoryCandidateSuiteSelectedCaseIds = selectedCase?.case_id ? [selectedCase.case_id] : [];
      }
      renderMemoryCandidateReviewFormState(selectedCase);
      appendDraftJsonSection(wrapper, 'Selected Candidate Case', selectedCase);
      if (selectedCase?.metadata?.promotion_record) {
        appendDraftJsonSection(wrapper, 'Gold Promotion Record', selectedCase.metadata.promotion_record);
      }
    }

    harnessDetailOutput.appendChild(wrapper);
  }

  function renderMemoryCandidateSuites(suites, selectedSuite = null) {
    clearNode(harnessCandidateSuiteList);
    if (!Array.isArray(suites) || suites.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No memory candidate suites found';
      harnessCandidateSuiteList.appendChild(empty);
      return;
    }

    const activeSuite = selectedSuite ?? suites.find((item) => item.relative_path === state.memoryCandidateSuiteSelectedPath) ?? null;
    for (const item of suites) {
      const row = document.createElement('div');
      row.className = 'list-item';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recent-task-link';
      button.dataset.active = String(item.relative_path === state.memoryCandidateSuiteSelectedPath);
      button.textContent = `${item.suite_id} · cases:${item.case_count ?? 0}`;
      button.addEventListener('click', async () => {
        state.memoryCandidateSuiteSelectedPath = item.relative_path;
        const payload = await fetchJson(`/api/harness/memory-candidate-suites?suite_path=${encodeURIComponent(item.relative_path)}`);
        renderMemoryCandidateSuites(state.memoryCandidateSuites, payload.suite);
        renderMemoryCandidateSuiteDetail(payload.suite);
      });

      const meta = document.createElement('div');
      meta.className = 'tiny muted';
      meta.textContent = `${item.relative_path} · ${formatTimestamp(item.updated_at)}`;

      row.append(button, meta);
      if (activeSuite?.relative_path === item.relative_path && Array.isArray(activeSuite?.cases)) {
        const caseList = document.createElement('div');
        caseList.className = 'list';
        for (const candidateCase of activeSuite.cases) {
          const caseRow = document.createElement('div');
          caseRow.className = 'draft-kv';
          const selector = document.createElement('input');
          selector.type = 'checkbox';
          selector.checked = state.memoryCandidateSuiteSelectedCaseIds.includes(candidateCase.case_id);
          selector.addEventListener('change', () => {
            toggleSelectedMemoryCandidateCase(candidateCase.case_id, selector.checked);
          });
          const caseButton = document.createElement('button');
          caseButton.type = 'button';
          caseButton.className = 'recent-task-link';
          caseButton.dataset.active = String(candidateCase.case_id === state.memoryCandidateSuiteSelectedCaseId);
          caseButton.textContent = `${candidateCase.case_id} · ${candidateCase.metadata?.review_status ?? 'pending_review'}`;
          caseButton.addEventListener('click', () => {
            state.memoryCandidateSuiteSelectedCaseId = candidateCase.case_id;
            toggleSelectedMemoryCandidateCase(candidateCase.case_id, true);
            renderMemoryCandidateSuites(suites, activeSuite);
          });
          caseRow.append(selector, caseButton);
          caseList.appendChild(caseRow);
        }
        row.appendChild(caseList);
      }
      harnessCandidateSuiteList.appendChild(row);
    }

    if (activeSuite) {
      renderMemoryCandidateSuiteDetail(activeSuite);
    }
  }

  function renderWikiCandidateSuiteDetail(suite) {
    clearNode(harnessDetailOutput);
    const wrapper = document.createElement('div');
    wrapper.className = 'draft-detail';
    const suiteStats = buildWikiCandidateSuiteStats(suite);

    const header = document.createElement('section');
    header.className = 'draft-section';
    const grid = document.createElement('div');
    grid.className = 'draft-grid';
    appendDraftKv(grid, 'Suite ID', suite?.suite_id ?? 'n/a');
    appendDraftKv(grid, 'Cases', suite?.cases?.length ?? suite?.case_count ?? 0);
    appendDraftKv(grid, 'Updated At', suite?.updated_at ?? 'n/a');
    appendDraftKv(grid, 'Path', suite?.relative_path ?? 'n/a');
    header.appendChild(grid);
    wrapper.appendChild(header);

    const statSection = document.createElement('section');
    statSection.className = 'draft-section';
    const statTitle = document.createElement('strong');
    statTitle.textContent = 'Wiki Suite Governance Summary';
    statSection.appendChild(statTitle);
    const statChips = document.createElement('div');
    statChips.className = 'chip-row';
    statChips.appendChild(createChip(`approved:${suiteStats.approved_count}`, suiteStats.approved_count > 0 ? 'good' : null));
    statChips.appendChild(createChip(`needs-revision:${suiteStats.needs_revision_count}`, suiteStats.needs_revision_count > 0 ? 'warn' : null));
    statChips.appendChild(createChip(`rejected:${suiteStats.rejected_count}`, suiteStats.rejected_count > 0 ? 'bad' : null));
    statChips.appendChild(createChip(`pending:${suiteStats.pending_review_count}`, suiteStats.pending_review_count > 0 ? 'warn' : 'good'));
    statChips.appendChild(createChip(`approval-rate:${suiteStats.approval_rate}`));
    statSection.appendChild(statChips);
    wrapper.appendChild(statSection);

    if (suite?.metadata) {
      appendDraftJsonSection(wrapper, 'Suite Metadata', suite.metadata);
    }

    if (Array.isArray(suite?.cases) && suite.cases.length > 0) {
      const selectedCase = suite.cases.find((item) => item.case_id === state.wikiCandidateSuiteSelectedCaseId) ?? suite.cases[0];
      state.wikiCandidateSuiteSelectedCaseId = selectedCase?.case_id ?? null;
      if (!Array.isArray(state.wikiCandidateSuiteSelectedCaseIds) || state.wikiCandidateSuiteSelectedCaseIds.length === 0) {
        state.wikiCandidateSuiteSelectedCaseIds = selectedCase?.case_id ? [selectedCase.case_id] : [];
      }
      renderWikiCandidateReviewFormState(selectedCase);

      const selectedCaseSection = document.createElement('section');
      selectedCaseSection.className = 'draft-section';
      const selectedCaseTitle = document.createElement('strong');
      selectedCaseTitle.textContent = 'Selected Candidate Case';
      selectedCaseSection.appendChild(selectedCaseTitle);

      const caseCard = document.createElement('div');
      caseCard.className = 'compare-card';
      caseCard.dataset.tone = selectedCase?.metadata?.review_status === 'approved'
        ? 'good'
        : (selectedCase?.metadata?.review_status === 'rejected' ? 'bad' : 'warn');

      const caseHead = document.createElement('div');
      caseHead.className = 'compare-card-head';
      const caseHeadTitle = document.createElement('span');
      caseHeadTitle.className = 'compare-card-title';
      caseHeadTitle.textContent = selectedCase?.case_id ?? 'n/a';
      caseHead.appendChild(caseHeadTitle);
      caseHead.appendChild(createChip(selectedCase?.metadata?.review_status ?? 'pending_review', selectedCase?.metadata?.review_status === 'approved' ? 'good' : 'warn'));
      caseCard.appendChild(caseHead);

      const caseChipRow = document.createElement('div');
      caseChipRow.className = 'chip-row';
      if (selectedCase?.metadata?.route_family) {
        caseChipRow.appendChild(createChip(`route:${selectedCase.metadata.route_family}`));
      }
      if (selectedCase?.metadata?.expected_bucket) {
        caseChipRow.appendChild(createChip(`bucket:${selectedCase.metadata.expected_bucket}`));
      }
      if (selectedCase?.metadata?.language) {
        caseChipRow.appendChild(createChip(`lang:${selectedCase.metadata.language}`));
      }
      if (selectedCase?.metadata?.topic) {
        caseChipRow.appendChild(createChip(`topic:${selectedCase.metadata.topic}`));
      }
      if (selectedCase?.metadata?.review_required) {
        caseChipRow.appendChild(createChip('review-required', 'warn'));
      }
      caseCard.appendChild(caseChipRow);
      selectedCaseSection.appendChild(caseCard);
      wrapper.appendChild(selectedCaseSection);

      const reference = selectedCase?.reference ?? {};
      const referenceSection = document.createElement('section');
      referenceSection.className = 'draft-section';
      const referenceTitle = document.createElement('strong');
      referenceTitle.textContent = 'Candidate Reference';
      referenceSection.appendChild(referenceTitle);
      const referenceGrid = document.createElement('div');
      referenceGrid.className = 'draft-grid';
      appendDraftKv(referenceGrid, 'Expected Route', reference.expected_route_mode ?? 'n/a');
      appendDraftKv(referenceGrid, 'Expected Effective Route', reference.expected_effective_mode ?? 'n/a');
      appendDraftKv(referenceGrid, 'Fallback Applied', reference.expected_fallback_applied ? 'yes' : 'no');
      appendDraftKv(referenceGrid, 'Recommended Action', reference.expected_recommended_action ?? 'n/a');
      appendDraftKv(referenceGrid, 'Required Citations', Array.isArray(reference.required_citation_titles) ? reference.required_citation_titles.length : 0);
      referenceSection.appendChild(referenceGrid);
      wrapper.appendChild(referenceSection);

      appendDraftListSection(wrapper, 'Required Citation Titles', reference.required_citation_titles ?? []);

      const payload = selectedCase?.payload ?? {};
      const payloadSection = document.createElement('section');
      payloadSection.className = 'draft-section';
      const payloadTitle = document.createElement('strong');
      payloadTitle.textContent = 'Candidate Payload';
      payloadSection.appendChild(payloadTitle);
      const payloadGrid = document.createElement('div');
      payloadGrid.className = 'draft-grid';
      appendDraftKv(payloadGrid, 'Query', payload.query ?? 'n/a');
      appendDraftKv(payloadGrid, 'Persona', payload.persona_id ?? 'n/a');
      appendDraftKv(payloadGrid, 'Stable Items', Array.isArray(payload.stable_items) ? payload.stable_items.length : 0);
      appendDraftKv(payloadGrid, 'Dynamic Items', Array.isArray(payload.dynamic_items) ? payload.dynamic_items.length : 0);
      payloadSection.appendChild(payloadGrid);
      wrapper.appendChild(payloadSection);

      appendDraftListSection(wrapper, 'Tags', selectedCase?.metadata?.tags ?? []);
      appendDraftJsonSection(wrapper, 'Selected Candidate Case JSON', selectedCase);
    }

    harnessDetailOutput.appendChild(wrapper);
  }

  function renderWikiCandidateSuites(suites, selectedSuite = null) {
    clearNode(harnessCandidateSuiteList);
    if (!Array.isArray(suites) || suites.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No wiki candidate suites found';
      harnessCandidateSuiteList.appendChild(empty);
      return;
    }

    const activeSuite = selectedSuite ?? suites.find((item) => item.relative_path === state.wikiCandidateSuiteSelectedPath) ?? null;
    for (const item of suites) {
      const row = document.createElement('div');
      row.className = 'list-item';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recent-task-link';
      button.dataset.active = String(item.relative_path === state.wikiCandidateSuiteSelectedPath);
      button.textContent = `${item.suite_id} · cases:${item.case_count ?? 0}`;
      button.addEventListener('click', async () => {
        state.wikiCandidateSuiteSelectedPath = item.relative_path;
        const payload = await fetchJson(`/api/harness/wiki-candidate-suites?suite_path=${encodeURIComponent(item.relative_path)}`);
        renderWikiCandidateSuites(state.wikiCandidateSuites, payload.suite);
        renderWikiCandidateSuiteDetail(payload.suite);
      });

      const meta = document.createElement('div');
      meta.className = 'tiny muted';
      meta.textContent = `${item.relative_path} · ${formatTimestamp(item.updated_at)}`;

      row.append(button, meta);
      if (activeSuite?.relative_path === item.relative_path && Array.isArray(activeSuite?.cases)) {
        const caseList = document.createElement('div');
        caseList.className = 'list';
        for (const candidateCase of activeSuite.cases) {
          const caseRow = document.createElement('div');
          caseRow.className = 'draft-kv';
          const selector = document.createElement('input');
          selector.type = 'checkbox';
          selector.checked = state.wikiCandidateSuiteSelectedCaseIds.includes(candidateCase.case_id);
          selector.addEventListener('change', () => {
            toggleSelectedWikiCandidateCase(candidateCase.case_id, selector.checked);
          });
          const caseButton = document.createElement('button');
          caseButton.type = 'button';
          caseButton.className = 'recent-task-link';
          caseButton.dataset.active = String(candidateCase.case_id === state.wikiCandidateSuiteSelectedCaseId);
          caseButton.textContent = `${candidateCase.case_id} · ${candidateCase.metadata?.review_status ?? 'pending_review'}`;
          caseButton.addEventListener('click', () => {
            state.wikiCandidateSuiteSelectedCaseId = candidateCase.case_id;
            toggleSelectedWikiCandidateCase(candidateCase.case_id, true);
            renderWikiCandidateSuites(suites, activeSuite);
          });
          caseRow.append(selector, caseButton);
          caseList.appendChild(caseRow);
        }
        row.appendChild(caseList);
      }
      harnessCandidateSuiteList.appendChild(row);
    }

    if (activeSuite) {
      renderWikiCandidateSuiteDetail(activeSuite);
    }
  }

  return {
    buildMemoryCandidateSuiteStats,
    buildWikiCandidateSuiteStats,
    renderMemoryGoldHistoryAudit,
    renderMemoryCandidateSuiteDetail,
    renderMemoryCandidateSuites,
    renderWikiCandidateSuiteDetail,
    renderWikiCandidateSuites,
  };
}
