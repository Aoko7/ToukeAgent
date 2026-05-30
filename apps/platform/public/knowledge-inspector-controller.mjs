export function createKnowledgeInspectorController({
  state,
  knowledgeOps,
  knowledgeQueryInput,
  knowledgeSelectedStage,
  knowledgeSummaryChips,
  knowledgeStageList,
  knowledgeDetailOutput,
  clearNode,
  createChip,
  renderKnowledgeFrontendDetail,
  renderTextDetail,
} = {}) {
  function normalizeKnowledgeInspectorPayload(payload) {
    return {
      task_id: payload?.task_id ?? null,
      query: payload?.query ?? null,
      task: payload?.task ?? null,
      trace_bundle: payload?.trace_bundle ?? null,
      retrieval: payload?.retrieval ?? null,
      memory: payload?.memory ?? null,
      wiki: payload?.wiki ?? null,
      response: payload?.response ?? null,
      chain_summary: payload?.chain_summary ?? {},
      chain_stages: Array.isArray(payload?.chain_stages) ? payload.chain_stages : [],
    };
  }

  function buildKnowledgeInspectorSummary(payload) {
    return [
      `query:${payload?.query ? 'yes' : 'no'}`,
      `route:${payload?.chain_summary?.route_mode ?? 'n/a'}`,
      `mode:${payload?.chain_summary?.query_mode ?? 'n/a'}`,
      `boundary:${payload?.chain_summary?.boundary_action ?? 'n/a'}`,
      `wiki:${payload?.chain_summary?.wiki_match_count ?? 0}`,
      `memory:${payload?.chain_summary?.memory_provider ?? 'n/a'}`,
      `citations:${payload?.chain_summary?.citation_count ?? 0}`,
    ];
  }

  function clearKnowledgeInspector() {
    clearNode(knowledgeSummaryChips);
    clearNode(knowledgeStageList);
    clearNode(knowledgeDetailOutput);
    if (knowledgeQueryInput) {
      knowledgeQueryInput.value = '';
    }
    if (knowledgeSelectedStage) {
      knowledgeSelectedStage.value = '';
    }
  }

  function setKnowledgeInspectorVisibility(showKnowledge) {
    if (knowledgeOps) {
      knowledgeOps.hidden = !showKnowledge;
    }
  }

  function renderKnowledgeInspector(payload) {
    const summary = payload?.chain_summary ?? {};
    const stages = Array.isArray(payload?.chain_stages) ? payload.chain_stages : [];
    const selectedStage = stages.find((item) => item.stage_id === state.knowledgeSelectedStageId) ?? stages[0] ?? null;
    state.knowledgeSelectedStageId = selectedStage?.stage_id ?? null;

    if (knowledgeQueryInput) {
      knowledgeQueryInput.value = payload?.query ?? '';
    }
    if (knowledgeSelectedStage) {
      knowledgeSelectedStage.value = state.knowledgeSelectedStageId ?? '';
    }

    clearNode(knowledgeSummaryChips);
    for (const item of [
      `route:${summary.route_mode ?? 'n/a'}`,
      `mode:${summary.query_mode ?? 'n/a'}`,
      `boundary:${summary.boundary_action ?? 'n/a'}`,
      `subqueries:${summary.subquery_count ?? 0}`,
      `rewrites:${summary.rewrite_count ?? 0}`,
      `wiki:${summary.wiki_match_count ?? 0}`,
      `citations:${summary.citation_count ?? 0}`,
      `memory:${summary.memory_provider ?? 'n/a'}`,
      `short:${summary.memory_short_term_count ?? 0}`,
      `long:${summary.memory_long_term_count ?? 0}`,
    ]) {
      knowledgeSummaryChips.appendChild(createChip(item));
    }

    clearNode(knowledgeStageList);
    if (stages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No knowledge-chain stages available for this task yet';
      knowledgeStageList.appendChild(empty);
    } else {
      for (const stage of stages) {
        const row = document.createElement('div');
        row.className = 'list-item';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-task-link';
        button.dataset.active = String(stage.stage_id === state.knowledgeSelectedStageId);
        button.textContent = `${stage.title ?? stage.stage_id} · ${stage.status ?? 'n/a'}`;
        button.addEventListener('click', () => {
          state.knowledgeSelectedStageId = stage.stage_id;
          renderKnowledgeInspector(payload);
        });

        const meta = document.createElement('div');
        meta.className = 'tiny muted';
        meta.textContent = stage.summary ?? 'n/a';

        row.append(button, meta);
        knowledgeStageList.appendChild(row);
      }
    }

    if (selectedStage?.stage_id === 'query_frontend') {
      renderKnowledgeFrontendDetail(knowledgeDetailOutput, selectedStage, summary);
      return;
    }

    renderTextDetail(
      knowledgeDetailOutput,
      JSON.stringify(selectedStage
        ? {
          stage: selectedStage,
          chain_summary: summary,
          retrieval: payload?.retrieval ?? null,
          wiki: payload?.wiki ?? null,
          memory_runtime_summary: payload?.memory?.runtime_summary ?? null,
          response: payload?.response ?? null,
        }
        : payload ?? {}, null, 2),
    );
  }

  function renderKnowledgeInspectorPanel(showKnowledge, payload) {
    setKnowledgeInspectorVisibility(showKnowledge);
    if (showKnowledge) {
      renderKnowledgeInspector(payload);
      return;
    }
    clearKnowledgeInspector();
  }

  return {
    normalizeKnowledgeInspectorPayload,
    buildKnowledgeInspectorSummary,
    clearKnowledgeInspector,
    setKnowledgeInspectorVisibility,
    renderKnowledgeInspectorPanel,
    renderKnowledgeInspector,
  };
}
