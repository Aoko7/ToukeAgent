export function createHarnessDetailRenderers({
  state,
  harnessDetailOutput,
  harnessSummaryChips,
  harnessDraftCaseList,
  clearNode,
  appendDraftJsonSection,
  appendDraftListSection,
  appendDraftKv,
  appendDraftTableSection,
  createChip,
  renderTextDetail,
} = {}) {
  function getHarnessCaseTone(item) {
    const decision = item?.judge?.decision ?? item?.reviewer_summary?.decision ?? null;
    if (decision === 'pass') {
      return 'good';
    }
    if (decision === 'review') {
      return 'warn';
    }
    if (decision === 'fail') {
      return 'bad';
    }
    return null;
  }

  function buildHarnessCaseSubtitle(item) {
    const frontend = item?.query_frontend ?? item?.reviewer_summary?.query_frontend ?? {};
    const pieces = [];
    if (item?.suite) {
      pieces.push(item.suite);
    }
    if (frontend?.query_mode) {
      pieces.push(frontend.query_mode);
    }
    if (frontend?.decomposition_strategy) {
      pieces.push(frontend.decomposition_strategy);
    }
    if (frontend?.rewrite_strategy) {
      pieces.push(frontend.rewrite_strategy);
    }
    if (item?.case_type) {
      pieces.push(item.case_type);
    }
    if (item?.provider) {
      pieces.push(item.provider);
    }
    return pieces.join(' · ');
  }

  function renderHarnessRunReviewerDetail(run) {
    clearNode(harnessDetailOutput);
    const wrapper = document.createElement('div');
    wrapper.className = 'draft-detail';

    const summarySection = document.createElement('section');
    summarySection.className = 'draft-section';
    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'draft-grid';
    appendDraftKv(summaryGrid, 'Run ID', run?.run_id ?? 'n/a');
    appendDraftKv(summaryGrid, 'Harness Type', run?.harness_type ?? 'n/a');
    appendDraftKv(summaryGrid, 'Suite', run?.metadata?.suite ?? run?.metadata?.suite_name ?? 'n/a');
    appendDraftKv(summaryGrid, 'Cases', run?.summary?.case_count ?? run?.cases?.length ?? 0);
    appendDraftKv(summaryGrid, 'Completed At', run?.completed_at ?? run?.created_at ?? 'n/a');
    summarySection.appendChild(summaryGrid);
    wrapper.appendChild(summarySection);

    const summaryChips = document.createElement('div');
    summaryChips.className = 'chip-row';
    for (const [key, value] of Object.entries(run?.summary ?? {})) {
      if (typeof value === 'number' && (
        key.endsWith('_rate')
        || key.endsWith('_score')
        || key === 'case_count'
        || key.endsWith('_count')
      )) {
        summaryChips.appendChild(createChip(`${key}:${value}`));
      }
    }
    if (summaryChips.childNodes.length > 0) {
      wrapper.appendChild(summaryChips);
    }

    const cases = Array.isArray(run?.cases) ? run.cases : [];
    if (cases.length === 0) {
      if (typeof run?.artifacts?.review_markdown === 'string' && run.artifacts.review_markdown.trim()) {
        renderTextDetail(harnessDetailOutput, run.artifacts.review_markdown.trim());
        return;
      }
      renderTextDetail(harnessDetailOutput, JSON.stringify(run?.artifacts?.review_json ?? run, null, 2));
      return;
    }

    const selectedCase = cases.find((item) => item.case_id === state.harnessSelectedCaseId) ?? cases[0];
    state.harnessSelectedCaseId = selectedCase?.case_id ?? null;

    const caseSummary = document.createElement('section');
    caseSummary.className = 'draft-section';
    const caseTitle = document.createElement('strong');
    caseTitle.textContent = 'Selected Case';
    caseSummary.appendChild(caseTitle);

    const caseHead = document.createElement('div');
    caseHead.className = 'compare-card';
    caseHead.dataset.tone = getHarnessCaseTone(selectedCase) ?? 'warn';
    const caseHeadTop = document.createElement('div');
    caseHeadTop.className = 'compare-card-head';
    const caseHeadTitle = document.createElement('span');
    caseHeadTitle.className = 'compare-card-title';
    caseHeadTitle.textContent = selectedCase?.reviewer_summary?.headline ?? selectedCase?.case_id ?? 'n/a';
    caseHeadTop.appendChild(caseHeadTitle);
    caseHeadTop.appendChild(createChip(selectedCase?.judge?.decision ?? selectedCase?.reviewer_summary?.decision ?? 'n/a', getHarnessCaseTone(selectedCase)));
    caseHead.appendChild(caseHeadTop);

    const caseChipRow = document.createElement('div');
    caseChipRow.className = 'chip-row';
    caseChipRow.appendChild(createChip(`case:${selectedCase?.case_id ?? 'n/a'}`));
    if (selectedCase?.suite) {
      caseChipRow.appendChild(createChip(`suite:${selectedCase.suite}`));
    }
    if (selectedCase?.judge?.score !== undefined) {
      caseChipRow.appendChild(createChip(`score:${selectedCase.judge.score}`));
    } else if (selectedCase?.reviewer_summary?.score !== undefined) {
      caseChipRow.appendChild(createChip(`score:${selectedCase.reviewer_summary.score}`));
    }
    const frontend = selectedCase?.query_frontend ?? selectedCase?.reviewer_summary?.query_frontend ?? {};
    if (frontend?.boundary_action) {
      caseChipRow.appendChild(createChip(`boundary:${frontend.boundary_action}`));
    }
    if (frontend?.clarification_required) {
      caseChipRow.appendChild(createChip('clarify', 'warn'));
    }
    if (selectedCase?.reviewer_summary?.recommended_action) {
      caseChipRow.appendChild(createChip(`action:${selectedCase.reviewer_summary.recommended_action}`));
    } else if (selectedCase?.judge?.quality?.recommended_action) {
      caseChipRow.appendChild(createChip(`action:${selectedCase.judge.quality.recommended_action}`));
    }
    caseHead.appendChild(caseChipRow);
    caseSummary.appendChild(caseHead);
    wrapper.appendChild(caseSummary);

    const frontendSection = document.createElement('section');
    frontendSection.className = 'draft-section';
    const frontendTitle = document.createElement('strong');
    frontendTitle.textContent = 'Query Frontend';
    frontendSection.appendChild(frontendTitle);
    const frontendGrid = document.createElement('div');
    frontendGrid.className = 'draft-grid';
    appendDraftKv(frontendGrid, 'Query Mode', frontend?.query_mode ?? 'n/a');
    appendDraftKv(frontendGrid, 'Boundary', frontend?.boundary_action ?? 'n/a');
    appendDraftKv(frontendGrid, 'Clarification Required', frontend?.clarification_required ? 'yes' : 'no');
    appendDraftKv(frontendGrid, 'Decomposition', frontend?.decomposition_strategy ?? 'n/a');
    appendDraftKv(frontendGrid, 'Rewrite', frontend?.rewrite_strategy ?? 'n/a');
    appendDraftKv(frontendGrid, 'Subqueries', frontend?.subquery_count ?? 0);
    appendDraftKv(frontendGrid, 'Rewrites', frontend?.rewrite_count ?? 0);
    appendDraftKv(frontendGrid, 'Preferred Sources', (frontend?.preferred_sources ?? []).join(', ') || 'n/a');
    frontendSection.appendChild(frontendGrid);
    wrapper.appendChild(frontendSection);

    if (Array.isArray(frontend?.intent_tags) && frontend.intent_tags.length > 0) {
      const tagRow = document.createElement('div');
      tagRow.className = 'chip-row';
      for (const tag of frontend.intent_tags) {
        tagRow.appendChild(createChip(tag));
      }
      wrapper.appendChild(tagRow);
    }

    appendDraftListSection(wrapper, 'Clarification Questions', frontend?.clarification_questions ?? []);
    appendDraftTableSection(
      wrapper,
      'Subqueries',
      (frontend?.subqueries ?? []).map((item) => ({
        subquery_id: item?.subquery_id ?? 'n/a',
        preferred_source: item?.preferred_source ?? 'n/a',
        reason: item?.reason ?? 'n/a',
        query_text: item?.query_text ?? '',
      })),
      [
        { key: 'subquery_id', label: 'ID' },
        { key: 'preferred_source', label: 'Source' },
        { key: 'reason', label: 'Reason' },
        { key: 'query_text', label: 'Query' },
      ],
    );
    appendDraftTableSection(
      wrapper,
      'Rewrite Variants',
      (frontend?.rewrite_variants ?? []).map((item) => ({
        variant_id: item?.variant_id ?? 'n/a',
        reason: item?.reason ?? 'n/a',
        text: item?.text ?? '',
      })),
      [
        { key: 'variant_id', label: 'ID' },
        { key: 'reason', label: 'Reason' },
        { key: 'text', label: 'Text' },
      ],
    );

    if (selectedCase?.judge) {
      appendDraftJsonSection(wrapper, 'Judge', selectedCase.judge);
    }
    if (selectedCase?.reference) {
      appendDraftJsonSection(wrapper, 'Reference', selectedCase.reference);
    }
    if (selectedCase?.reviewer_summary && Object.keys(selectedCase.reviewer_summary).length > 0) {
      appendDraftJsonSection(wrapper, 'Reviewer Summary', selectedCase.reviewer_summary);
    }

    harnessDetailOutput.appendChild(wrapper);
  }

  function renderMemoryHarnessDraftDetail(draft, selectedCase) {
    clearNode(harnessDetailOutput);

    const wrapper = document.createElement('div');
    wrapper.className = 'draft-detail';

    const header = document.createElement('section');
    header.className = 'draft-section';
    const headerGrid = document.createElement('div');
    headerGrid.className = 'draft-grid';
    appendDraftKv(headerGrid, 'Case ID', selectedCase?.case_id ?? 'n/a');
    appendDraftKv(headerGrid, 'Case Type', selectedCase?.case_type ?? 'n/a');
    appendDraftKv(headerGrid, 'Provider', selectedCase?.provider ?? 'n/a');
    appendDraftKv(headerGrid, 'Language', selectedCase?.metadata?.language ?? draft?.source?.language ?? 'n/a');
    appendDraftKv(headerGrid, 'Source Task', selectedCase?.metadata?.source_task_id ?? draft?.task_id ?? 'n/a');
    appendDraftKv(headerGrid, 'Source Trace', selectedCase?.metadata?.source_trace_id ?? draft?.trace_id ?? 'n/a');
    header.appendChild(headerGrid);
    wrapper.appendChild(header);

    appendDraftListSection(wrapper, 'Tags', selectedCase?.metadata?.tags ?? []);

    const reference = selectedCase?.reference ?? {};
    const referenceSection = document.createElement('section');
    referenceSection.className = 'draft-section';
    const referenceTitle = document.createElement('strong');
    referenceTitle.textContent = 'Reference';
    referenceSection.appendChild(referenceTitle);
    const referenceGrid = document.createElement('div');
    referenceGrid.className = 'draft-grid';
    for (const [key, value] of Object.entries(reference)) {
      if (Array.isArray(value)) {
        continue;
      }
      appendDraftKv(referenceGrid, key, value);
    }
    if (referenceGrid.childNodes.length > 0) {
      referenceSection.appendChild(referenceGrid);
    }
    wrapper.appendChild(referenceSection);

    for (const [key, value] of Object.entries(reference)) {
      if (Array.isArray(value)) {
        appendDraftListSection(wrapper, key, value);
      }
    }

    const observed = selectedCase?.observed ?? {};
    const observedSections = [];
    for (const [key, value] of Object.entries(observed)) {
      if (Array.isArray(value)) {
        observedSections.push([key, value]);
      } else {
        appendDraftJsonSection(wrapper, `Observed · ${key}`, value);
      }
    }

    for (const [key, value] of observedSections) {
      appendDraftJsonSection(wrapper, `Observed · ${key}`, value);
    }

    if (Array.isArray(draft?.notes) && draft.notes.length > 0) {
      appendDraftListSection(wrapper, 'Draft Notes', draft.notes);
    }

    harnessDetailOutput.appendChild(wrapper);
  }

  function renderMemoryHarnessDraft(draft) {
    clearNode(harnessSummaryChips);
    clearNode(harnessDraftCaseList);

    const summaryItems = [
      `draft:${draft.summary?.generated_case_count ?? 0}`,
      `missing:${draft.summary?.missing_case_types?.length ?? 0}`,
      `provider:${draft.source?.memory_provider ?? 'n/a'}`,
    ];
    if (draft.source?.persona_id) {
      summaryItems.push(`persona:${draft.source.persona_id}`);
    }
    for (const item of summaryItems) {
      harnessSummaryChips.appendChild(createChip(item));
    }

    const cases = Array.isArray(draft.cases) ? draft.cases : [];
    if (cases.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No draft cases derived from this task';
      harnessDraftCaseList.appendChild(empty);
      renderTextDetail(harnessDetailOutput, JSON.stringify(draft, null, 2));
      return;
    }

    const selectedCase = cases.find((item) => item.case_id === state.memoryHarnessDraftSelectedCaseId) ?? cases[0];
    state.memoryHarnessDraftSelectedCaseId = selectedCase?.case_id ?? null;

    for (const item of cases) {
      const row = document.createElement('div');
      row.className = 'list-item';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recent-task-link';
      button.dataset.active = String(item.case_id === state.memoryHarnessDraftSelectedCaseId);
      button.textContent = `${item.case_id} · ${item.case_type}`;
      button.addEventListener('click', () => {
        state.memoryHarnessDraftSelectedCaseId = item.case_id;
        renderMemoryHarnessDraft(draft);
      });

      const meta = document.createElement('div');
      meta.className = 'tiny muted';
      meta.textContent = `${item.provider ?? 'local_builtin'} · ${(item.metadata?.tags ?? []).join(', ') || 'draft'}`;

      row.append(button, meta);
      harnessDraftCaseList.appendChild(row);
    }
    renderMemoryHarnessDraftDetail(draft, selectedCase);
  }

  function renderWikiHarnessDraft(draft) {
    clearNode(harnessSummaryChips);
    clearNode(harnessDraftCaseList);

    const summaryItems = [
      `draft:${draft.summary?.generated_case_count ?? 0}`,
      `dynamic:${draft.summary?.dynamic_item_count ?? 0}`,
      `stable:${draft.summary?.stable_item_count ?? 0}`,
    ];
    if (draft.source?.route_mode) {
      summaryItems.push(`route:${draft.source.route_mode}`);
    }
    if (draft.source?.effective_mode) {
      summaryItems.push(`effective:${draft.source.effective_mode}`);
    }
    for (const item of summaryItems) {
      harnessSummaryChips.appendChild(createChip(item));
    }

    const cases = Array.isArray(draft.cases) ? draft.cases : [];
    if (cases.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No wiki draft cases derived from this task';
      harnessDraftCaseList.appendChild(empty);
      renderTextDetail(harnessDetailOutput, JSON.stringify(draft, null, 2));
      return;
    }

    const selectedCase = cases.find((item) => item.case_id === state.wikiHarnessDraftSelectedCaseId) ?? cases[0];
    state.wikiHarnessDraftSelectedCaseId = selectedCase?.case_id ?? null;

    for (const item of cases) {
      const row = document.createElement('div');
      row.className = 'list-item';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recent-task-link';
      button.dataset.active = String(item.case_id === state.wikiHarnessDraftSelectedCaseId);
      button.textContent = `${item.case_id} · ${item.metadata?.route_family ?? item.reference?.expected_route_mode ?? 'wiki'}`;
      button.addEventListener('click', () => {
        state.wikiHarnessDraftSelectedCaseId = item.case_id;
        renderWikiHarnessDraft(draft);
      });

      const meta = document.createElement('div');
      meta.className = 'tiny muted';
      meta.textContent = `${item.metadata?.topic ?? 'wiki_trace'} · ${(item.metadata?.tags ?? []).join(', ') || 'draft'}`;

      row.append(button, meta);
      harnessDraftCaseList.appendChild(row);
    }

    renderWikiHarnessDraftDetail(draft, selectedCase);
  }

  function renderWikiHarnessDraftDetail(draft, selectedCase) {
    clearNode(harnessDetailOutput);

    const wrapper = document.createElement('div');
    wrapper.className = 'draft-detail';

    const header = document.createElement('section');
    header.className = 'draft-section';
    const headerGrid = document.createElement('div');
    headerGrid.className = 'draft-grid';
    appendDraftKv(headerGrid, 'Case ID', selectedCase?.case_id ?? 'n/a');
    appendDraftKv(headerGrid, 'Route', selectedCase?.reference?.expected_route_mode ?? 'n/a');
    appendDraftKv(headerGrid, 'Effective Route', selectedCase?.reference?.expected_effective_mode ?? 'n/a');
    appendDraftKv(headerGrid, 'Recommended Action', selectedCase?.reference?.expected_recommended_action ?? 'n/a');
    appendDraftKv(headerGrid, 'Topic', selectedCase?.metadata?.topic ?? 'n/a');
    appendDraftKv(headerGrid, 'Language', selectedCase?.metadata?.language ?? 'n/a');
    header.appendChild(headerGrid);
    wrapper.appendChild(header);

    appendDraftListSection(wrapper, 'Tags', selectedCase?.metadata?.tags ?? []);

    const reference = selectedCase?.reference ?? {};
    const referenceSection = document.createElement('section');
    referenceSection.className = 'draft-section';
    const referenceTitle = document.createElement('strong');
    referenceTitle.textContent = 'Reference';
    referenceSection.appendChild(referenceTitle);
    const referenceGrid = document.createElement('div');
    referenceGrid.className = 'draft-grid';
    for (const [key, value] of Object.entries(reference)) {
      if (Array.isArray(value)) {
        continue;
      }
      appendDraftKv(referenceGrid, key, value);
    }
    if (referenceGrid.childNodes.length > 0) {
      referenceSection.appendChild(referenceGrid);
    }
    wrapper.appendChild(referenceSection);

    for (const [key, value] of Object.entries(reference)) {
      if (Array.isArray(value)) {
        appendDraftListSection(wrapper, key, value);
      }
    }

    appendDraftJsonSection(wrapper, 'Payload', selectedCase?.payload ?? {});

    if (Array.isArray(draft?.notes) && draft.notes.length > 0) {
      appendDraftListSection(wrapper, 'Draft Notes', draft.notes);
    }

    harnessDetailOutput.appendChild(wrapper);
  }

  return {
    getHarnessCaseTone,
    buildHarnessCaseSubtitle,
    renderHarnessRunReviewerDetail,
    renderMemoryHarnessDraftDetail,
    renderMemoryHarnessDraft,
    renderWikiHarnessDraft,
    renderWikiHarnessDraftDetail,
  };
}
