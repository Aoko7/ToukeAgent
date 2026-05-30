export function createMemoryInspectorController({
  memoryOps,
  memorySummaryChips,
  memoryDetailOutput,
  clearNode,
  createChip,
  appendDraftJsonSection,
  appendDraftKv,
  appendDraftTableSection,
} = {}) {
  function normalizeMemoryInspectorPayload(payload) {
    return {
      task_id: payload?.task_id ?? null,
      workspace_id: payload?.workspace_id ?? null,
      persona_id: payload?.persona_id ?? null,
      exclude_stale: payload?.exclude_stale ?? false,
      provider_strategy: payload?.provider_strategy ?? {},
      memory: payload?.memory ?? null,
    };
  }

  function buildMemoryInspectorSummary(payload) {
    return [
      `short:${payload?.memory?.counts?.short_term ?? 0}`,
      `long:${payload?.memory?.counts?.long_term ?? 0}`,
    ];
  }

  function clearMemoryInspector() {
    clearNode(memorySummaryChips);
    clearNode(memoryDetailOutput);
  }

  function setMemoryInspectorVisibility(showMemory) {
    if (memoryOps) {
      memoryOps.hidden = !showMemory;
    }
  }

  function renderMemoryInspector(payload) {
    const memory = payload?.memory ?? {};
    const providerStrategy = payload?.provider_strategy ?? {};
    const runtimeSummary = memory?.runtime_summary ?? {};
    const shortTerm = Array.isArray(memory?.short_term) ? memory.short_term : [];
    const longTerm = Array.isArray(memory?.long_term) ? memory.long_term : [];

    clearNode(memorySummaryChips);
    for (const item of [
      `provider:${memory.effective_provider ?? memory.provider ?? 'n/a'}`,
      `fallback:${memory.fallback_applied ? 'yes' : 'no'}`,
      `short:${memory.counts?.short_term ?? shortTerm.length}`,
      `long:${memory.counts?.long_term ?? longTerm.length}`,
      `stale:${runtimeSummary.stale_long_term_count ?? 0}`,
    ]) {
      memorySummaryChips.appendChild(createChip(item));
    }

    clearNode(memoryDetailOutput);
    const wrapper = document.createElement('div');
    wrapper.className = 'tool-grid';

    const providerSection = document.createElement('section');
    providerSection.className = 'draft-section';
    const providerTitle = document.createElement('strong');
    providerTitle.textContent = 'Provider Runtime';
    providerSection.appendChild(providerTitle);
    const providerGrid = document.createElement('div');
    providerGrid.className = 'draft-grid';
    appendDraftKv(providerGrid, 'Requested provider', memory.requested_provider ?? providerStrategy.requested_provider ?? 'n/a');
    appendDraftKv(providerGrid, 'Effective provider', memory.effective_provider ?? providerStrategy.effective_provider ?? 'n/a');
    appendDraftKv(providerGrid, 'Fallback applied', memory.fallback_applied ? 'yes' : 'no');
    appendDraftKv(providerGrid, 'Fallback reason', memory.fallback_reason ?? 'n/a');
    appendDraftKv(providerGrid, 'Runtime persistence', runtimeSummary.runtime_persistence ?? providerStrategy.runtime_persistence ?? 'n/a');
    appendDraftKv(providerGrid, 'Durable entries', runtimeSummary.durable_store_entry_count ?? providerStrategy.durable_store?.entry_count ?? 'n/a');
    providerSection.appendChild(providerGrid);
    appendDraftJsonSection(providerSection, 'Requested capabilities', providerStrategy.requested_capabilities ?? {});
    appendDraftJsonSection(providerSection, 'Effective capabilities', providerStrategy.effective_capabilities ?? {});
    appendDraftJsonSection(providerSection, 'Fallback chain', providerStrategy.fallback_chain ?? []);

    const scopeSection = document.createElement('section');
    scopeSection.className = 'draft-section';
    const scopeTitle = document.createElement('strong');
    scopeTitle.textContent = 'Scope And Health';
    scopeSection.appendChild(scopeTitle);
    const scopeGrid = document.createElement('div');
    scopeGrid.className = 'draft-grid';
    appendDraftKv(scopeGrid, 'Workspace', memory.workspace_id ?? 'n/a');
    appendDraftKv(scopeGrid, 'Persona', memory.persona_id ?? 'n/a');
    appendDraftKv(scopeGrid, 'Short-term count', memory.counts?.short_term ?? shortTerm.length);
    appendDraftKv(scopeGrid, 'Long-term count', memory.counts?.long_term ?? longTerm.length);
    appendDraftKv(scopeGrid, 'Stale long-term count', runtimeSummary.stale_long_term_count ?? 0);
    appendDraftKv(scopeGrid, 'Stale long-term rate', runtimeSummary.stale_long_term_rate ?? 0);
    scopeSection.appendChild(scopeGrid);

    const linkageSection = document.createElement('section');
    linkageSection.className = 'draft-section';
    const linkageTitle = document.createElement('strong');
    linkageTitle.textContent = 'Compression And Handoffs';
    linkageSection.appendChild(linkageTitle);
    const linkageGrid = document.createElement('div');
    linkageGrid.className = 'draft-grid';
    appendDraftKv(linkageGrid, 'Handoff count', runtimeSummary.handoff_count ?? 0);
    appendDraftKv(linkageGrid, 'Compression count', runtimeSummary.compression_count ?? 0);
    appendDraftKv(linkageGrid, 'Latest handoff', runtimeSummary.latest_handoff_id ?? 'n/a');
    appendDraftKv(linkageGrid, 'Latest snapshot', runtimeSummary.latest_context_snapshot_id ?? 'n/a');
    linkageSection.appendChild(linkageGrid);
    appendDraftJsonSection(linkageSection, 'Latest handoff detail', memory.linked_artifacts?.latest_handoff ?? {});
    appendDraftJsonSection(linkageSection, 'Latest compression detail', memory.linked_artifacts?.latest_compression ?? {});

    const entriesSection = document.createElement('section');
    entriesSection.className = 'draft-section';
    const entriesTitle = document.createElement('strong');
    entriesTitle.textContent = 'Memory Entries';
    entriesSection.appendChild(entriesTitle);
    appendDraftTableSection(
      entriesSection,
      'Short-term tail',
      shortTerm.slice(-6).map((entry) => ({
        memory_id: entry.memory_id,
        title: entry.title,
        phase: entry.phase,
        source: entry.source,
      })),
      [
        { key: 'memory_id', label: 'Memory ID' },
        { key: 'title', label: 'Title' },
        { key: 'phase', label: 'Phase' },
        { key: 'source', label: 'Source' },
      ],
    );
    appendDraftTableSection(
      entriesSection,
      'Long-term working set',
      longTerm.slice(0, 8).map((entry) => ({
        memory_id: entry.memory_id,
        title: entry.title,
        stale: entry.stale ? 'yes' : 'no',
        score: entry.score ?? 'n/a',
      })),
      [
        { key: 'memory_id', label: 'Memory ID' },
        { key: 'title', label: 'Title' },
        { key: 'stale', label: 'Stale' },
        { key: 'score', label: 'Score' },
      ],
    );

    wrapper.append(providerSection, scopeSection, linkageSection, entriesSection);
    memoryDetailOutput.appendChild(wrapper);
  }

  function renderMemoryInspectorPanel(showMemory, payload) {
    setMemoryInspectorVisibility(showMemory);
    if (showMemory) {
      renderMemoryInspector(payload);
      return;
    }
    clearMemoryInspector();
  }

  return {
    normalizeMemoryInspectorPayload,
    buildMemoryInspectorSummary,
    clearMemoryInspector,
    setMemoryInspectorVisibility,
    renderMemoryInspectorPanel,
    renderMemoryInspector,
  };
}
