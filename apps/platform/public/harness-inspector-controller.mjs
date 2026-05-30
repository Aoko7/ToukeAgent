export function createHarnessInspectorController({
  state,
  harnessSelectedId,
  harnessSummaryChips,
  harnessRunList,
  harnessDraftCaseList,
  harnessCandidateSuiteList,
  harnessTypeFilter,
  harnessDetailOutput,
  taskStatus,
  clearNode,
  createChip,
  setStatus,
  fetchJson,
  formatTimestamp,
  normalizeTaskId,
  triggerDownload,
  renderInspectorTabs,
  loadInspector,
  renderTextDetail,
  renderHarnessRunReviewerDetail,
  buildHarnessCaseSubtitle,
  renderMemoryHarnessDraft,
  renderWikiHarnessDraft,
  renderMemoryCandidateSuites,
  renderWikiCandidateSuites,
  renderMemoryCandidateComparisonDetail,
  renderWikiCandidateComparisonDetail,
  renderMemoryGoldHistoryAudit,
  appendDraftJsonSection,
  memoryCandidateReviewDecision,
  memoryCandidateReviewerId,
  memoryCandidateReviewNotes,
  wikiCandidateReviewDecision,
  wikiCandidateReviewerId,
  wikiCandidateReviewNotes,
  controls = {},
} = {}) {
  let eventsBound = false;

  const {
    harnessOps,
    harnessRefreshButton,
    runMemoryHarnessButton,
    runWikiHarnessButton,
    runKnowledgeHarnessButton,
    draftMemoryHarnessButton,
    draftWikiHarnessButton,
    downloadMemoryDraftButton,
    downloadWikiDraftButton,
    saveMemoryDraftCaseButton,
    saveWikiDraftCaseButton,
    promoteMemoryDraftCaseButton,
    promoteWikiDraftCaseButton,
    refreshMemoryCandidateSuitesButton,
    runMemoryCandidateSuiteButton,
    refreshWikiCandidateSuitesButton,
    runWikiCandidateSuiteButton,
    approveMemoryCandidateCaseButton,
    batchReviewMemoryCandidateCasesButton,
    approveWikiCandidateCaseButton,
    batchReviewWikiCandidateCasesButton,
    compareWikiCandidateCaseButton,
    compareWikiCandidateSuiteButton,
    compareMemoryCandidateCaseButton,
    compareMemoryCandidateSuiteButton,
    promoteMemoryCandidateCaseGoldButton,
    rollbackMemoryGoldCaseButton,
    batchRollbackMemoryGoldCasesButton,
    loadMemoryGoldHistoryButton,
  } = controls;

  function getHarnessTypeFilterValue() {
    return harnessTypeFilter?.value && harnessTypeFilter.value !== 'all' ? harnessTypeFilter.value : 'all';
  }

  function buildHarnessRunsEndpoint() {
    const harnessType = getHarnessTypeFilterValue();
    return `/api/harness/runs${harnessType !== 'all' ? `?harness_type=${encodeURIComponent(harnessType)}` : ''}`;
  }

  function normalizeHarnessInspectorPayload(payload) {
    const runs = Array.isArray(payload?.runs) ? payload.runs : [];
    return {
      runs,
      harness_type: getHarnessTypeFilterValue(),
      selected_run: runs.find((item) => item.run_id === state.harnessSelectedId) ?? runs[0] ?? null,
    };
  }

  function buildHarnessInspectorSummary(payload) {
    return [
      `runs:${payload?.runs?.length ?? 0}`,
      `type:${payload?.harness_type ?? getHarnessTypeFilterValue()}`,
      `selected:${payload?.selected_run?.harness_type ?? 'n/a'}`,
    ];
  }

  async function loadHarnessInspectorData() {
    const payload = await fetchJson(buildHarnessRunsEndpoint());
    return normalizeHarnessInspectorPayload(payload);
  }

  function clearHarnessInspector() {
    clearNode(harnessSummaryChips);
    clearNode(harnessRunList);
    clearNode(harnessDraftCaseList);
    clearNode(harnessDetailOutput);
    harnessSelectedId.value = '';
  }

  function setHarnessInspectorVisibility(showHarness) {
    if (harnessOps) {
      harnessOps.hidden = !showHarness;
    }
  }

  function renderHarnessInspectorPanel(showHarness, payload) {
    setHarnessInspectorVisibility(showHarness);
    if (showHarness) {
      renderHarnessInspector(payload);
      return;
    }
    clearHarnessInspector();
  }

  async function focusHarnessInspector() {
    state.activeInspector = 'harness';
    renderInspectorTabs();
    await loadInspector('harness');
  }

  async function focusHarnessRun(result, harnessType, successLabel) {
    const runId = result?.run?.run_id ?? null;
    if (harnessTypeFilter) {
      harnessTypeFilter.value = harnessType;
    }
    state.harnessSelectedId = runId;
    await focusHarnessInspector();
    setStatus(taskStatus, runId ? `${successLabel} ${runId}` : `${successLabel} completed`, 'good');
  }

  function renderHarnessInspector(payload) {
    const runs = Array.isArray(payload?.runs) ? payload.runs : [];
    const previousSelectedRunId = state.harnessSelectedId;
    state.harnessRuns = runs;
    state.memoryHarnessDraft = null;
    state.memoryHarnessDraftSelectedCaseId = null;
    state.wikiHarnessDraft = null;
    state.wikiHarnessDraftSelectedCaseId = null;
    state.wikiCandidateSuites = [];
    state.wikiCandidateSuiteSelectedPath = null;
    state.wikiCandidateSuiteSelectedCaseId = null;
    const selected = runs.find((item) => item.run_id === state.harnessSelectedId) ?? runs[0] ?? null;
    state.harnessSelectedId = selected?.run_id ?? null;
    if (previousSelectedRunId !== state.harnessSelectedId) {
      state.harnessSelectedCaseId = null;
    }
    harnessSelectedId.value = state.harnessSelectedId ?? '';

    clearNode(harnessSummaryChips);
    clearNode(harnessDraftCaseList);
    clearNode(harnessCandidateSuiteList);
    const summaryItems = [
      `runs:${runs.length}`,
      `task:${runs.filter((item) => item.harness_type === 'task').length}`,
      `memory:${runs.filter((item) => item.harness_type === 'memory').length}`,
      `wiki:${runs.filter((item) => item.harness_type === 'wiki').length}`,
      `knowledge:${runs.filter((item) => item.harness_type === 'knowledge').length}`,
    ];
    if (selected) {
      summaryItems.push(`selected:${selected.harness_type ?? 'n/a'}`);
      summaryItems.push(`cases:${selected.summary?.case_count ?? 0}`);
    }
    for (const item of summaryItems) {
      harnessSummaryChips.appendChild(createChip(item));
    }

    clearNode(harnessRunList);
    if (runs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No harness runs found';
      harnessRunList.appendChild(empty);
    } else {
      for (const item of runs) {
        const row = document.createElement('div');
        row.className = 'list-item';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-task-link';
        button.dataset.active = String(item.run_id === state.harnessSelectedId);
        const latestScore = item.summary?.mean_overall_score ?? item.summary?.quality_pass_rate ?? item.summary?.success_rate ?? 'n/a';
        button.textContent = `${item.run_id} · ${item.harness_type ?? 'task'} · score:${latestScore}`;
        button.addEventListener('click', () => {
          state.harnessSelectedId = item.run_id;
          renderHarnessInspector(payload);
        });

        const meta = document.createElement('div');
        meta.className = 'tiny muted';
        meta.textContent = `${item.metadata?.suite ?? item.metadata?.suite_name ?? 'suite n/a'} · cases:${item.summary?.case_count ?? 0} · ${formatTimestamp(item.completed_at ?? item.created_at)}`;

        row.append(button, meta);
        harnessRunList.appendChild(row);
      }
    }

    if (selected && Array.isArray(selected.cases) && selected.cases.length > 0) {
      for (const item of selected.cases) {
        const row = document.createElement('div');
        row.className = 'list-item';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-task-link';
        button.dataset.active = String(item.case_id === state.harnessSelectedCaseId);
        button.textContent = `${item.case_id} · ${item.judge?.decision ?? item.reviewer_summary?.decision ?? 'n/a'}`;
        button.addEventListener('click', () => {
          state.harnessSelectedCaseId = item.case_id;
          renderHarnessInspector(payload);
        });
        const meta = document.createElement('div');
        meta.className = 'tiny muted';
        meta.textContent = buildHarnessCaseSubtitle(item) || 'review case';
        row.append(button, meta);
        harnessDraftCaseList.appendChild(row);
      }
      renderHarnessRunReviewerDetail(selected);
      return;
    }

    const reviewMarkdown = selected?.artifacts?.review_markdown;
    const reviewJson = selected?.artifacts?.review_json;
    if (typeof reviewMarkdown === 'string' && reviewMarkdown.trim()) {
      renderTextDetail(harnessDetailOutput, reviewMarkdown.trim());
      return;
    }

    renderTextDetail(
      harnessDetailOutput,
      selected ? JSON.stringify(reviewJson ?? selected, null, 2) : JSON.stringify(payload ?? {}, null, 2),
    );
  }

  async function runDefaultMemoryHarnessSuite() {
    setStatus(taskStatus, 'running memory harness', 'warn');
    try {
      const result = await fetchJson('/api/harness/runs', {
        method: 'POST',
        body: JSON.stringify({
          harness_type: 'memory',
          preset: 'default_memory_suite',
          metadata: {
            source: 'console',
            suite: 'console-default-memory-suite',
          },
        }),
      });
      await focusHarnessRun(result, 'memory', 'memory harness');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'memory harness failed', 'bad');
    }
  }

  async function runDefaultWikiHarnessSuite() {
    setStatus(taskStatus, 'running wiki harness', 'warn');
    try {
      const result = await fetchJson('/api/harness/runs', {
        method: 'POST',
        body: JSON.stringify({
          harness_type: 'wiki',
          preset: 'default_wiki_suite',
          metadata: {
            source: 'console',
            suite: 'console-default-wiki-suite',
          },
        }),
      });
      await focusHarnessRun(result, 'wiki', 'wiki harness');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'wiki harness failed', 'bad');
    }
  }

  async function runDefaultKnowledgeHarnessSuite() {
    setStatus(taskStatus, 'running knowledge harness', 'warn');
    try {
      const result = await fetchJson('/api/harness/runs', {
        method: 'POST',
        body: JSON.stringify({
          harness_type: 'knowledge',
          preset: 'default_knowledge_suite',
          metadata: {
            source: 'console',
            suite: 'console-default-knowledge-suite',
          },
        }),
      });
      await focusHarnessRun(result, 'knowledge', 'knowledge harness');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'knowledge harness failed', 'bad');
    }
  }

  async function draftMemoryHarnessFromCurrentTask(taskId = typeof normalizeTaskId === 'function' ? normalizeTaskId() : null) {
    if (!taskId) {
      setStatus(taskStatus, 'task id required for memory draft', 'warn');
      return;
    }

    setStatus(taskStatus, 'building memory harness draft', 'warn');
    try {
      await focusHarnessInspector();
      const draft = await fetchJson(`/api/harness/memory-draft?task_id=${encodeURIComponent(taskId)}`);
      state.memoryHarnessDraft = draft;
      state.memoryHarnessDraftSelectedCaseId = draft.cases?.[0]?.case_id ?? null;
      harnessSelectedId.value = '';
      renderMemoryHarnessDraft(draft);
      setStatus(taskStatus, `memory draft ${draft.summary?.generated_case_count ?? 0} cases`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'memory draft failed', 'bad');
    }
  }

  async function draftWikiHarnessFromCurrentTask(taskId = typeof normalizeTaskId === 'function' ? normalizeTaskId() : null) {
    if (!taskId) {
      setStatus(taskStatus, 'task id required for wiki draft', 'warn');
      return;
    }

    setStatus(taskStatus, 'building wiki harness draft', 'warn');
    try {
      await focusHarnessInspector();
      const draft = await fetchJson(`/api/harness/wiki-draft?task_id=${encodeURIComponent(taskId)}`);
      state.wikiHarnessDraft = draft;
      state.wikiHarnessDraftSelectedCaseId = draft.cases?.[0]?.case_id ?? null;
      state.memoryHarnessDraft = null;
      state.memoryHarnessDraftSelectedCaseId = null;
      harnessSelectedId.value = '';
      renderWikiHarnessDraft(draft);
      setStatus(taskStatus, `wiki draft ${draft.summary?.generated_case_count ?? 0} cases`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'wiki draft failed', 'bad');
    }
  }

  async function refreshMemoryCandidateSuites() {
    setStatus(taskStatus, 'loading memory candidate suites', 'warn');
    try {
      const payload = await fetchJson('/api/harness/memory-candidate-suites');
      state.memoryCandidateSuites = Array.isArray(payload?.suites) ? payload.suites : [];
      const selected = state.memoryCandidateSuites.find((item) => item.relative_path === state.memoryCandidateSuiteSelectedPath) ?? null;
      renderMemoryCandidateSuites(state.memoryCandidateSuites, null);
      if (selected) {
        const detail = await fetchJson(`/api/harness/memory-candidate-suites?suite_path=${encodeURIComponent(selected.relative_path)}`);
        renderMemoryCandidateSuites(state.memoryCandidateSuites, detail.suite);
      }
      setStatus(taskStatus, `candidate suites ${state.memoryCandidateSuites.length}`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'load candidate suites failed', 'bad');
    }
  }

  async function refreshWikiCandidateSuites() {
    setStatus(taskStatus, 'loading wiki candidate suites', 'warn');
    try {
      const payload = await fetchJson('/api/harness/wiki-candidate-suites');
      state.wikiCandidateSuites = Array.isArray(payload?.suites) ? payload.suites : [];
      const selected = state.wikiCandidateSuites.find((item) => item.relative_path === state.wikiCandidateSuiteSelectedPath) ?? null;
      renderWikiCandidateSuites(state.wikiCandidateSuites, null);
      if (selected) {
        const detail = await fetchJson(`/api/harness/wiki-candidate-suites?suite_path=${encodeURIComponent(selected.relative_path)}`);
        renderWikiCandidateSuites(state.wikiCandidateSuites, detail.suite);
      }
      setStatus(taskStatus, `wiki candidate suites ${state.wikiCandidateSuites.length}`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'load wiki candidate suites failed', 'bad');
    }
  }

  async function runSelectedMemoryCandidateSuite() {
    if (!state.memoryCandidateSuiteSelectedPath) {
      setStatus(taskStatus, 'select a candidate suite first', 'warn');
      return;
    }

    setStatus(taskStatus, 'running candidate memory suite', 'warn');
    try {
      const result = await fetchJson('/api/harness/memory-candidate-suites/run', {
        method: 'POST',
        body: JSON.stringify({
          suite_path: state.memoryCandidateSuiteSelectedPath,
          suite_name: 'console-candidate-memory-suite',
        }),
      });
      await focusHarnessRun(result, 'memory', 'candidate suite');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'candidate suite failed', 'bad');
    }
  }

  async function runSelectedWikiCandidateSuite() {
    if (!state.wikiCandidateSuiteSelectedPath) {
      setStatus(taskStatus, 'select a wiki candidate suite first', 'warn');
      return;
    }

    setStatus(taskStatus, 'running candidate wiki suite', 'warn');
    try {
      const result = await fetchJson('/api/harness/wiki-candidate-suites/run', {
        method: 'POST',
        body: JSON.stringify({
          suite_path: state.wikiCandidateSuiteSelectedPath,
          suite_name: 'console-candidate-wiki-suite',
        }),
      });
      await focusHarnessRun(result, 'wiki', 'wiki candidate suite');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'wiki candidate suite failed', 'bad');
    }
  }

  async function downloadCurrentMemoryDraft(taskId = typeof normalizeTaskId === 'function' ? normalizeTaskId() : null) {
    if (!taskId) {
      setStatus(taskStatus, 'task id required for memory draft download', 'warn');
      return;
    }
    if (typeof triggerDownload !== 'function') {
      setStatus(taskStatus, 'memory draft download unavailable', 'bad');
      return;
    }
    triggerDownload(`/api/harness/memory-draft?task_id=${encodeURIComponent(taskId)}&download=1`);
  }

  async function downloadCurrentWikiDraft(taskId = typeof normalizeTaskId === 'function' ? normalizeTaskId() : null) {
    if (!taskId) {
      setStatus(taskStatus, 'task id required for wiki draft download', 'warn');
      return;
    }
    if (typeof triggerDownload !== 'function') {
      setStatus(taskStatus, 'wiki draft download unavailable', 'bad');
      return;
    }
    triggerDownload(`/api/harness/wiki-draft?task_id=${encodeURIComponent(taskId)}&download=1`);
  }

  async function saveSelectedMemoryDraftCase(taskId = typeof normalizeTaskId === 'function' ? normalizeTaskId() : null) {
    const caseId = state.memoryHarnessDraftSelectedCaseId;
    if (!taskId) {
      setStatus(taskStatus, 'task id required for memory draft save', 'warn');
      return;
    }
    if (!state.memoryHarnessDraft || !caseId) {
      setStatus(taskStatus, 'build a memory draft before saving', 'warn');
      return;
    }

    setStatus(taskStatus, 'saving memory draft case', 'warn');
    try {
      const result = await fetchJson('/api/harness/memory-draft/save', {
        method: 'POST',
        body: JSON.stringify({
          task_id: taskId,
          case_id: caseId,
        }),
      });
      setStatus(taskStatus, `saved ${result.relative_path ?? result.file_path ?? caseId}`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'save memory draft failed', 'bad');
    }
  }

  async function saveSelectedWikiDraftCase(taskId = typeof normalizeTaskId === 'function' ? normalizeTaskId() : null) {
    const caseId = state.wikiHarnessDraftSelectedCaseId;
    if (!taskId) {
      setStatus(taskStatus, 'task id required for wiki draft save', 'warn');
      return;
    }
    if (!state.wikiHarnessDraft || !caseId) {
      setStatus(taskStatus, 'build a wiki draft before saving', 'warn');
      return;
    }

    setStatus(taskStatus, 'saving wiki draft case', 'warn');
    try {
      const result = await fetchJson('/api/harness/wiki-draft/save', {
        method: 'POST',
        body: JSON.stringify({
          task_id: taskId,
          case_id: caseId,
        }),
      });
      setStatus(taskStatus, `saved ${result.relative_path ?? result.file_path ?? caseId}`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'save wiki draft failed', 'bad');
    }
  }

  async function promoteSelectedMemoryDraftCase(taskId = typeof normalizeTaskId === 'function' ? normalizeTaskId() : null) {
    const caseId = state.memoryHarnessDraftSelectedCaseId;
    if (!taskId) {
      setStatus(taskStatus, 'task id required for draft promote', 'warn');
      return;
    }
    if (!state.memoryHarnessDraft || !caseId) {
      setStatus(taskStatus, 'build a memory draft before promoting', 'warn');
      return;
    }

    setStatus(taskStatus, 'promoting memory draft case', 'warn');
    try {
      const result = await fetchJson('/api/harness/memory-draft/promote', {
        method: 'POST',
        body: JSON.stringify({
          task_id: taskId,
          case_id: caseId,
        }),
      });
      await refreshMemoryCandidateSuites();
      setStatus(taskStatus, `promoted ${result.relative_path ?? result.file_path ?? caseId}`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'promote memory draft failed', 'bad');
    }
  }

  async function promoteSelectedWikiDraftCase(taskId = typeof normalizeTaskId === 'function' ? normalizeTaskId() : null) {
    const caseId = state.wikiHarnessDraftSelectedCaseId;
    if (!taskId) {
      setStatus(taskStatus, 'task id required for wiki draft promote', 'warn');
      return;
    }
    if (!state.wikiHarnessDraft || !caseId) {
      setStatus(taskStatus, 'build a wiki draft before promoting', 'warn');
      return;
    }

    setStatus(taskStatus, 'promoting wiki draft case', 'warn');
    try {
      const result = await fetchJson('/api/harness/wiki-draft/promote', {
        method: 'POST',
        body: JSON.stringify({
          task_id: taskId,
          case_id: caseId,
        }),
      });
      await refreshWikiCandidateSuites();
      setStatus(taskStatus, `promoted ${result.relative_path ?? result.file_path ?? caseId}`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'promote wiki draft failed', 'bad');
    }
  }

  async function approveSelectedWikiCandidateCase() {
    if (!state.wikiCandidateSuiteSelectedPath || !state.wikiCandidateSuiteSelectedCaseId) {
      setStatus(taskStatus, 'select a wiki candidate case first', 'warn');
      return;
    }

    const decision = wikiCandidateReviewDecision?.value ?? 'approved';
    const reviewerId = wikiCandidateReviewerId?.value.trim() || 'console_reviewer';
    const notes = wikiCandidateReviewNotes?.value.trim() || `Reviewed from console as ${decision}`;

    setStatus(taskStatus, `reviewing wiki candidate case as ${decision}`, 'warn');
    try {
      await fetchJson('/api/harness/wiki-candidate-suites/review', {
        method: 'POST',
        body: JSON.stringify({
          suite_path: state.wikiCandidateSuiteSelectedPath,
          case_id: state.wikiCandidateSuiteSelectedCaseId,
          decision,
          reviewer_id: reviewerId,
          notes,
        }),
      });
      await refreshWikiCandidateSuites();
      setStatus(taskStatus, `${decision} ${state.wikiCandidateSuiteSelectedCaseId}`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'wiki candidate review failed', 'bad');
    }
  }

  async function batchReviewSelectedWikiCandidateCases() {
    if (!state.wikiCandidateSuiteSelectedPath || !Array.isArray(state.wikiCandidateSuiteSelectedCaseIds) || state.wikiCandidateSuiteSelectedCaseIds.length === 0) {
      setStatus(taskStatus, 'select wiki candidate cases first', 'warn');
      return;
    }

    const decision = wikiCandidateReviewDecision?.value ?? 'approved';
    const reviewerId = wikiCandidateReviewerId?.value.trim() || 'console_reviewer';
    const notes = wikiCandidateReviewNotes?.value.trim() || `Batch reviewed from console as ${decision}`;

    setStatus(taskStatus, `batch reviewing ${state.wikiCandidateSuiteSelectedCaseIds.length} wiki cases as ${decision}`, 'warn');
    try {
      await fetchJson('/api/harness/wiki-candidate-suites/review', {
        method: 'POST',
        body: JSON.stringify({
          suite_path: state.wikiCandidateSuiteSelectedPath,
          case_ids: state.wikiCandidateSuiteSelectedCaseIds,
          decision,
          reviewer_id: reviewerId,
          notes,
        }),
      });
      await refreshWikiCandidateSuites();
      setStatus(taskStatus, `${decision} ${state.wikiCandidateSuiteSelectedCaseIds.length} wiki cases`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'wiki batch review failed', 'bad');
    }
  }

  async function compareSelectedWikiCandidateCase() {
    if (!state.wikiCandidateSuiteSelectedPath || !state.wikiCandidateSuiteSelectedCaseId) {
      setStatus(taskStatus, 'select a wiki candidate case first', 'warn');
      return;
    }

    setStatus(taskStatus, `comparing ${state.wikiCandidateSuiteSelectedCaseId}`, 'warn');
    try {
      const result = await fetchJson(`/api/harness/wiki-candidate-suites/compare?suite_path=${encodeURIComponent(state.wikiCandidateSuiteSelectedPath)}&case_id=${encodeURIComponent(state.wikiCandidateSuiteSelectedCaseId)}`);
      renderWikiCandidateComparisonDetail(result.comparison, 'Wiki Candidate Compare');
      setStatus(taskStatus, `compared ${state.wikiCandidateSuiteSelectedCaseId}`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'compare wiki candidate case failed', 'bad');
    }
  }

  async function compareSelectedWikiCandidateSuite() {
    if (!state.wikiCandidateSuiteSelectedPath) {
      setStatus(taskStatus, 'select a wiki candidate suite first', 'warn');
      return;
    }

    const params = new URLSearchParams({
      suite_path: state.wikiCandidateSuiteSelectedPath,
    });
    for (const caseId of state.wikiCandidateSuiteSelectedCaseIds ?? []) {
      params.append('case_id', caseId);
    }

    setStatus(taskStatus, `comparing suite ${state.wikiCandidateSuiteSelectedPath}`, 'warn');
    try {
      const result = await fetchJson(`/api/harness/wiki-candidate-suites/compare?${params.toString()}`);
      renderWikiCandidateComparisonDetail(result.comparison, 'Wiki Candidate Suite Compare');
      setStatus(taskStatus, `compared suite ${result.comparison?.suite_id ?? 'candidate'}`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'compare wiki candidate suite failed', 'bad');
    }
  }

  async function approveSelectedMemoryCandidateCase() {
    if (!state.memoryCandidateSuiteSelectedPath || !state.memoryCandidateSuiteSelectedCaseId) {
      setStatus(taskStatus, 'select a candidate case first', 'warn');
      return;
    }

    const decision = memoryCandidateReviewDecision?.value ?? 'approved';
    const reviewerId = memoryCandidateReviewerId?.value.trim() || 'console_reviewer';
    const notes = memoryCandidateReviewNotes?.value.trim() || `Reviewed from console as ${decision}`;

    setStatus(taskStatus, `reviewing candidate case as ${decision}`, 'warn');
    try {
      await fetchJson('/api/harness/memory-candidate-suites/review', {
        method: 'POST',
        body: JSON.stringify({
          suite_path: state.memoryCandidateSuiteSelectedPath,
          case_id: state.memoryCandidateSuiteSelectedCaseId,
          decision,
          reviewer_id: reviewerId,
          notes,
        }),
      });
      await refreshMemoryCandidateSuites();
      setStatus(taskStatus, `${decision} ${state.memoryCandidateSuiteSelectedCaseId}`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'candidate review failed', 'bad');
    }
  }

  async function batchReviewSelectedMemoryCandidateCases() {
    if (!state.memoryCandidateSuiteSelectedPath || !Array.isArray(state.memoryCandidateSuiteSelectedCaseIds) || state.memoryCandidateSuiteSelectedCaseIds.length === 0) {
      setStatus(taskStatus, 'select candidate cases first', 'warn');
      return;
    }

    const decision = memoryCandidateReviewDecision?.value ?? 'approved';
    const reviewerId = memoryCandidateReviewerId?.value.trim() || 'console_reviewer';
    const notes = memoryCandidateReviewNotes?.value.trim() || `Batch reviewed from console as ${decision}`;
    setStatus(taskStatus, `batch reviewing ${state.memoryCandidateSuiteSelectedCaseIds.length} cases as ${decision}`, 'warn');
    try {
      await fetchJson('/api/harness/memory-candidate-suites/review', {
        method: 'POST',
        body: JSON.stringify({
          suite_path: state.memoryCandidateSuiteSelectedPath,
          case_ids: state.memoryCandidateSuiteSelectedCaseIds,
          decision,
          reviewer_id: reviewerId,
          notes,
        }),
      });
      await refreshMemoryCandidateSuites();
      setStatus(taskStatus, `${decision} ${state.memoryCandidateSuiteSelectedCaseIds.length} cases`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'batch review failed', 'bad');
    }
  }

  async function promoteSelectedMemoryCandidateCaseToGold() {
    if (!state.memoryCandidateSuiteSelectedPath || !state.memoryCandidateSuiteSelectedCaseId) {
      setStatus(taskStatus, 'select an approved candidate case first', 'warn');
      return;
    }

    setStatus(taskStatus, 'promoting candidate case to gold', 'warn');
    try {
      const result = await fetchJson('/api/harness/memory-candidate-suites/promote-gold', {
        method: 'POST',
        body: JSON.stringify({
          suite_path: state.memoryCandidateSuiteSelectedPath,
          case_id: state.memoryCandidateSuiteSelectedCaseId,
        }),
      });
      setStatus(taskStatus, `promoted to gold ${result.relative_path ?? result.file_path ?? state.memoryCandidateSuiteSelectedCaseId}`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'promote to gold failed', 'bad');
    }
  }

  async function compareSelectedMemoryCandidateCase() {
    if (!state.memoryCandidateSuiteSelectedPath || !state.memoryCandidateSuiteSelectedCaseId) {
      setStatus(taskStatus, 'select a candidate case first', 'warn');
      return;
    }

    setStatus(taskStatus, 'comparing candidate case against gold', 'warn');
    try {
      const result = await fetchJson(`/api/harness/memory-candidate-suites/compare?suite_path=${encodeURIComponent(state.memoryCandidateSuiteSelectedPath)}&case_id=${encodeURIComponent(state.memoryCandidateSuiteSelectedCaseId)}`);
      renderMemoryCandidateComparisonDetail(result.comparison, 'Candidate vs Gold Compare');
      setStatus(taskStatus, `compared ${state.memoryCandidateSuiteSelectedCaseId}`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'compare candidate case failed', 'bad');
    }
  }

  async function compareSelectedMemoryCandidateSuite() {
    if (!state.memoryCandidateSuiteSelectedPath) {
      setStatus(taskStatus, 'select a candidate suite first', 'warn');
      return;
    }

    setStatus(taskStatus, 'comparing candidate suite against gold', 'warn');
    try {
      const params = new URLSearchParams({ suite_path: state.memoryCandidateSuiteSelectedPath });
      for (const caseId of state.memoryCandidateSuiteSelectedCaseIds ?? []) {
        params.append('case_id', caseId);
      }
      const result = await fetchJson(`/api/harness/memory-candidate-suites/compare?${params.toString()}`);
      renderMemoryCandidateComparisonDetail(result.comparison, 'Candidate Suite Compare');
      setStatus(taskStatus, `compared suite ${result.comparison?.suite_id ?? 'candidate'}`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'compare candidate suite failed', 'bad');
    }
  }

  async function loadSelectedMemoryGoldHistory() {
    try {
      const params = new URLSearchParams();
      if (state.memoryCandidateSuiteSelectedCaseId) {
        params.set('case_id', state.memoryCandidateSuiteSelectedCaseId);
      }
      const result = await fetchJson(`/api/harness/memory-gold/history${params.toString() ? `?${params.toString()}` : ''}`);
      harnessDetailOutput.appendChild(renderMemoryGoldHistoryAudit(result.events ?? []));
      setStatus(taskStatus, `gold history ${Array.isArray(result.events) ? result.events.length : 0} events`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'load gold history failed', 'bad');
    }
  }

  async function rollbackSelectedMemoryGoldPromotion() {
    if (!state.memoryCandidateSuiteSelectedCaseId) {
      setStatus(taskStatus, 'select a candidate case first', 'warn');
      return;
    }

    setStatus(taskStatus, 'rolling back gold promotion', 'warn');
    try {
      const result = await fetchJson('/api/harness/memory-gold/rollback', {
        method: 'POST',
        body: JSON.stringify({
          case_id: state.memoryCandidateSuiteSelectedCaseId,
          reviewer_id: memoryCandidateReviewerId?.value.trim() || 'console_reviewer',
          reason: memoryCandidateReviewNotes?.value.trim() || 'Console rollback',
        }),
      });
      await refreshMemoryCandidateSuites();
      appendDraftJsonSection(harnessDetailOutput, 'Gold Rollback Result', result.summary);
      await loadSelectedMemoryGoldHistory();
      setStatus(taskStatus, `rolled back ${state.memoryCandidateSuiteSelectedCaseId}`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'rollback gold failed', 'bad');
    }
  }

  async function batchRollbackSelectedMemoryGoldPromotions() {
    if (!Array.isArray(state.memoryCandidateSuiteSelectedCaseIds) || state.memoryCandidateSuiteSelectedCaseIds.length === 0) {
      setStatus(taskStatus, 'select candidate cases first', 'warn');
      return;
    }

    setStatus(taskStatus, `batch rolling back ${state.memoryCandidateSuiteSelectedCaseIds.length} gold cases`, 'warn');
    try {
      const result = await fetchJson('/api/harness/memory-gold/rollback', {
        method: 'POST',
        body: JSON.stringify({
          case_ids: state.memoryCandidateSuiteSelectedCaseIds,
          reviewer_id: memoryCandidateReviewerId?.value.trim() || 'console_reviewer',
          reason: memoryCandidateReviewNotes?.value.trim() || 'Console batch rollback',
        }),
      });
      await refreshMemoryCandidateSuites();
      appendDraftJsonSection(harnessDetailOutput, 'Batch Gold Rollback Result', result);
      setStatus(taskStatus, `rolled back ${result.summary?.rolled_back_case_count ?? 0}/${state.memoryCandidateSuiteSelectedCaseIds.length} cases`, 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'batch rollback gold failed', 'bad');
    }
  }

  function bindHarnessInspectorEvents() {
    if (eventsBound) {
      return;
    }
    eventsBound = true;

    const suppressContextMenu = (event) => event.preventDefault();

    harnessRefreshButton?.addEventListener('click', () => void loadInspector('harness'));
    runMemoryHarnessButton?.addEventListener('click', () => void runDefaultMemoryHarnessSuite());
    runWikiHarnessButton?.addEventListener('click', () => void runDefaultWikiHarnessSuite());
    runKnowledgeHarnessButton?.addEventListener('click', () => void runDefaultKnowledgeHarnessSuite());
    draftMemoryHarnessButton?.addEventListener('click', () => void draftMemoryHarnessFromCurrentTask());
    draftWikiHarnessButton?.addEventListener('click', () => void draftWikiHarnessFromCurrentTask());
    downloadMemoryDraftButton?.addEventListener('click', () => void downloadCurrentMemoryDraft());
    downloadWikiDraftButton?.addEventListener('click', () => void downloadCurrentWikiDraft());
    saveMemoryDraftCaseButton?.addEventListener('click', () => void saveSelectedMemoryDraftCase());
    saveWikiDraftCaseButton?.addEventListener('click', () => void saveSelectedWikiDraftCase());
    promoteMemoryDraftCaseButton?.addEventListener('click', () => void promoteSelectedMemoryDraftCase());
    promoteWikiDraftCaseButton?.addEventListener('click', () => void promoteSelectedWikiDraftCase());
    refreshMemoryCandidateSuitesButton?.addEventListener('click', () => void refreshMemoryCandidateSuites());
    runMemoryCandidateSuiteButton?.addEventListener('click', () => void runSelectedMemoryCandidateSuite());
    refreshWikiCandidateSuitesButton?.addEventListener('click', () => void refreshWikiCandidateSuites());
    runWikiCandidateSuiteButton?.addEventListener('click', () => void runSelectedWikiCandidateSuite());
    approveWikiCandidateCaseButton?.addEventListener('click', () => void approveSelectedWikiCandidateCase());
    batchReviewWikiCandidateCasesButton?.addEventListener('click', () => void batchReviewSelectedWikiCandidateCases());
    approveMemoryCandidateCaseButton?.addEventListener('click', () => void approveSelectedMemoryCandidateCase());
    batchReviewMemoryCandidateCasesButton?.addEventListener('click', () => void batchReviewSelectedMemoryCandidateCases());
    compareWikiCandidateCaseButton?.addEventListener('click', () => void compareSelectedWikiCandidateCase());
    compareWikiCandidateSuiteButton?.addEventListener('click', () => void compareSelectedWikiCandidateSuite());
    compareMemoryCandidateCaseButton?.addEventListener('click', () => void compareSelectedMemoryCandidateCase());
    compareMemoryCandidateSuiteButton?.addEventListener('click', () => void compareSelectedMemoryCandidateSuite());
    promoteMemoryCandidateCaseGoldButton?.addEventListener('click', () => void promoteSelectedMemoryCandidateCaseToGold());
    rollbackMemoryGoldCaseButton?.addEventListener('click', () => void rollbackSelectedMemoryGoldPromotion());
    batchRollbackMemoryGoldCasesButton?.addEventListener('click', () => void batchRollbackSelectedMemoryGoldPromotions());
    loadMemoryGoldHistoryButton?.addEventListener('click', () => void loadSelectedMemoryGoldHistory());

    compareWikiCandidateCaseButton?.addEventListener('contextmenu', suppressContextMenu);
    compareWikiCandidateSuiteButton?.addEventListener('contextmenu', suppressContextMenu);
    compareMemoryCandidateCaseButton?.addEventListener('contextmenu', suppressContextMenu);
    compareMemoryCandidateSuiteButton?.addEventListener('contextmenu', suppressContextMenu);
    approveWikiCandidateCaseButton?.addEventListener('contextmenu', suppressContextMenu);
    batchReviewWikiCandidateCasesButton?.addEventListener('contextmenu', suppressContextMenu);

    harnessTypeFilter?.addEventListener('change', () => {
      state.harnessSelectedId = null;
      if (state.activeInspector === 'harness') {
        void loadInspector('harness');
      }
    });
  }

  return {
    bindHarnessInspectorEvents,
    buildHarnessRunsEndpoint,
    normalizeHarnessInspectorPayload,
    buildHarnessInspectorSummary,
    loadHarnessInspectorData,
    clearHarnessInspector,
    setHarnessInspectorVisibility,
    renderHarnessInspectorPanel,
    renderHarnessInspector,
    runDefaultMemoryHarnessSuite,
    runDefaultWikiHarnessSuite,
    runDefaultKnowledgeHarnessSuite,
    draftMemoryHarnessFromCurrentTask,
    draftWikiHarnessFromCurrentTask,
    downloadCurrentMemoryDraft,
    downloadCurrentWikiDraft,
    saveSelectedMemoryDraftCase,
    saveSelectedWikiDraftCase,
    promoteSelectedMemoryDraftCase,
    promoteSelectedWikiDraftCase,
    refreshMemoryCandidateSuites,
    refreshWikiCandidateSuites,
    runSelectedMemoryCandidateSuite,
    runSelectedWikiCandidateSuite,
    approveSelectedWikiCandidateCase,
    batchReviewSelectedWikiCandidateCases,
    compareSelectedWikiCandidateCase,
    compareSelectedWikiCandidateSuite,
    approveSelectedMemoryCandidateCase,
    batchReviewSelectedMemoryCandidateCases,
    promoteSelectedMemoryCandidateCaseToGold,
    compareSelectedMemoryCandidateCase,
    compareSelectedMemoryCandidateSuite,
    loadSelectedMemoryGoldHistory,
    rollbackSelectedMemoryGoldPromotion,
    batchRollbackSelectedMemoryGoldPromotions,
  };
}
