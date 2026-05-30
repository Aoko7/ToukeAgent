export function createWikiInspectorController({
  state,
  wikiStatus,
  wikiEntryIdInput,
  wikiProposalIdInput,
  wikiBaseVersionInput,
  wikiTargetVersionInput,
  wikiReviewerIdInput,
  wikiMergeStrategySelect,
  wikiTitleInput,
  wikiSummaryInput,
  wikiFactsInput,
  wikiTagsInput,
  wikiQueryInput,
  wikiMarkdownInput,
  wikiSummaryChips,
  wikiEntryList,
  wikiProposalList,
  wikiHistoryList,
  wikiOutput,
  clearNode,
  createChip,
  setStatus,
  splitWikiLines,
  splitWikiCsv,
  fetchJson,
  renderInspectorData,
  controls = {},
} = {}) {
  let eventsBound = false;

  const {
    wikiRefreshButton,
    wikiLoadEntryButton,
    wikiLoadProposalButton,
    wikiSubmitProposalButton,
    wikiImportMarkdownButton,
    wikiApproveProposalButton,
    wikiRejectProposalButton,
    wikiRollbackButton,
    wikiRefreshHistoryButton,
  } = controls;

  function setWikiStatus(text, tone = 'warn') {
    setStatus(wikiStatus, text, tone);
  }

  function renderWikiLists() {
    clearNode(wikiSummaryChips);
    clearNode(wikiEntryList);
    clearNode(wikiProposalList);
    clearNode(wikiHistoryList);

    const summaryItems = [
      `entries:${state.wikiEntries.length}`,
      `proposals:${state.wikiProposals.length}`,
      `history:${state.wikiHistory.length}`,
    ];
    if (state.wikiRuntimeSummary?.provider) {
      summaryItems.push(`provider:${state.wikiRuntimeSummary.provider}`);
    }
    if (state.wikiRuntimeSummary?.cache_backend) {
      summaryItems.push(`cache:${state.wikiRuntimeSummary.cache_backend}`);
    }
    if (state.wikiCurrentEntry) {
      summaryItems.push(`entry:${state.wikiCurrentEntry.entry_id}`);
      summaryItems.push(`v${state.wikiCurrentEntry.version}`);
    }
    if (state.wikiCurrentProposal) {
      summaryItems.push(`proposal:${state.wikiCurrentProposal.proposal_id}`);
      summaryItems.push(state.wikiCurrentProposal.status ?? 'pending');
    }
    for (const item of summaryItems) {
      wikiSummaryChips.appendChild(createChip(item));
    }

    if (state.wikiEntries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No wiki entries loaded';
      wikiEntryList.appendChild(empty);
    } else {
      for (const entry of state.wikiEntries) {
        const item = document.createElement('div');
        item.className = 'list-item';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-task-link';
        button.textContent = `${entry.title ?? entry.entry_id} (${entry.entry_id})`;
        button.addEventListener('click', () => {
          wikiEntryIdInput.value = entry.entry_id;
          void loadWikiEntry(entry.entry_id);
        });

        const meta = document.createElement('div');
        meta.className = 'tiny muted';
        meta.textContent = `${entry.source_type ?? 'wiki'} · ${entry.status ?? 'active'} · v${entry.version ?? '?'}`;

        item.append(button, meta);
        wikiEntryList.appendChild(item);
      }
    }

    if (state.wikiProposals.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No wiki proposals loaded';
      wikiProposalList.appendChild(empty);
    } else {
      for (const proposal of state.wikiProposals) {
        const item = document.createElement('div');
        item.className = 'list-item';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-task-link';
        button.textContent = `${proposal.proposal_id} · ${proposal.status ?? 'pending_review'}`;
        button.addEventListener('click', () => {
          wikiProposalIdInput.value = proposal.proposal_id;
          if (proposal.entry_id) {
            wikiEntryIdInput.value = proposal.entry_id;
          }
          void loadWikiProposal(proposal.proposal_id);
        });

        const meta = document.createElement('div');
        meta.className = 'tiny muted';
        meta.textContent = `${proposal.entry_id ?? 'n/a'} · base v${proposal.base_version ?? '?'}`;

        item.append(button, meta);
        wikiProposalList.appendChild(item);
      }
    }

    if (state.wikiHistory.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No history loaded';
      wikiHistoryList.appendChild(empty);
    } else {
      for (const snapshot of state.wikiHistory) {
        const item = document.createElement('div');
        item.className = 'list-item';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-task-link';
        button.textContent = `v${snapshot.version} · ${snapshot.summary ?? snapshot.title}`;
        button.addEventListener('click', () => {
          wikiTargetVersionInput.value = String(snapshot.version);
        });

        const meta = document.createElement('div');
        meta.className = 'tiny muted';
        meta.textContent = `${snapshot.status ?? 'active'} · ${snapshot.updated_at ?? ''}`;

        item.append(button, meta);
        wikiHistoryList.appendChild(item);
      }
    }

    wikiOutput.textContent = JSON.stringify({
      selected_entry: state.wikiCurrentEntry,
      selected_proposal: state.wikiCurrentProposal,
      entries: state.wikiEntries,
      proposals: state.wikiProposals,
      history: state.wikiHistory,
      provider_strategy: state.wikiProviderStrategy,
      runtime_summary: state.wikiRuntimeSummary,
    }, null, 2);
  }

  function applyWikiEntry(entry) {
    if (!entry) {
      return;
    }

    state.wikiCurrentEntry = entry;
    wikiEntryIdInput.value = entry.entry_id ?? wikiEntryIdInput.value;
    wikiTitleInput.value = entry.title ?? '';
    wikiSummaryInput.value = entry.summary ?? '';
    wikiFactsInput.value = Array.isArray(entry.facts) ? entry.facts.join('\n') : '';
    wikiTagsInput.value = Array.isArray(entry.tags) ? entry.tags.join(', ') : '';
    wikiBaseVersionInput.value = String(entry.version ?? 1);
  }

  function applyWikiProposal(proposal) {
    if (!proposal) {
      return;
    }

    state.wikiCurrentProposal = proposal;
    wikiProposalIdInput.value = proposal.proposal_id ?? wikiProposalIdInput.value;
    wikiEntryIdInput.value = proposal.entry_id ?? wikiEntryIdInput.value;
    if (proposal.proposed_entry) {
      wikiTitleInput.value = proposal.proposed_entry.title ?? wikiTitleInput.value;
      wikiSummaryInput.value = proposal.proposed_entry.summary ?? wikiSummaryInput.value;
      wikiFactsInput.value = Array.isArray(proposal.proposed_entry.facts) ? proposal.proposed_entry.facts.join('\n') : wikiFactsInput.value;
      wikiTagsInput.value = Array.isArray(proposal.proposed_entry.tags) ? proposal.proposed_entry.tags.join(', ') : wikiTagsInput.value;
    }
    wikiBaseVersionInput.value = String(proposal.base_version ?? wikiBaseVersionInput.value);
    if (proposal.current_version !== null && proposal.current_version !== undefined) {
      wikiTargetVersionInput.value = String(proposal.current_version);
    }
  }

  function renderWikiInspectorSnapshot(query = null) {
    renderInspectorData('wiki', {
      entries: state.wikiEntries,
      proposals: state.wikiProposals,
      history: state.wikiHistory,
      entry: state.wikiCurrentEntry,
      proposal: state.wikiCurrentProposal,
      provider_strategy: state.wikiProviderStrategy,
      runtime_summary: state.wikiRuntimeSummary,
      query,
      items: state.wikiEntries,
    });
  }

  async function loadWikiCatalog({ renderInspector = state.activeInspector === 'wiki' } = {}) {
    const query = wikiQueryInput.value.trim();
    setWikiStatus(query ? `searching "${query}"` : 'loading wiki', 'warn');

    const entriesEndpoint = query
      ? `/api/wiki?q=${encodeURIComponent(query)}`
      : '/api/wiki';
    const proposalsEndpoint = '/api/wiki/proposals?include_resolved=1';
    const entryId = state.wikiCurrentEntry?.entry_id ?? wikiEntryIdInput.value.trim();
    const [entriesPayload, proposalsPayload, historyPayload] = await Promise.all([
      fetchJson(entriesEndpoint),
      fetchJson(proposalsEndpoint),
      entryId ? fetchJson(`/api/wiki/history?entry_id=${encodeURIComponent(entryId)}`) : Promise.resolve(null),
    ]);

    state.wikiEntries = Array.isArray(entriesPayload?.items ?? entriesPayload?.entries) ? (entriesPayload.items ?? entriesPayload.entries) : [];
    state.wikiProposals = Array.isArray(proposalsPayload?.proposals) ? proposalsPayload.proposals : [];
    state.wikiProviderStrategy = entriesPayload?.provider_strategy ?? state.wikiProviderStrategy;
    state.wikiRuntimeSummary = entriesPayload?.runtime_summary ?? state.wikiRuntimeSummary;
    if (historyPayload) {
      state.wikiCurrentEntry = historyPayload?.current ?? state.wikiCurrentEntry;
      state.wikiHistory = Array.isArray(historyPayload?.history) ? historyPayload.history : state.wikiHistory;
    }
    if (renderInspector) {
      renderWikiInspectorSnapshot(query || null);
    }
    renderWikiLists();
    setWikiStatus(query ? `query: ${query}` : 'wiki loaded', 'good');
  }

  async function loadWikiEntry(entryId = wikiEntryIdInput.value.trim()) {
    const normalizedEntryId = entryId.trim();
    if (!normalizedEntryId) {
      setWikiStatus('entry id required', 'warn');
      return;
    }

    setWikiStatus(`loading entry ${normalizedEntryId}`, 'warn');
    const [entryPayload, historyPayload] = await Promise.all([
      fetchJson(`/api/wiki?entry_id=${encodeURIComponent(normalizedEntryId)}`),
      fetchJson(`/api/wiki/history?entry_id=${encodeURIComponent(normalizedEntryId)}`),
    ]);

    state.wikiCurrentEntry = entryPayload?.entry ?? null;
    state.wikiProviderStrategy = entryPayload?.provider_strategy ?? state.wikiProviderStrategy;
    state.wikiRuntimeSummary = entryPayload?.runtime_summary ?? state.wikiRuntimeSummary;
    state.wikiHistory = Array.isArray(historyPayload?.history) ? historyPayload.history : [];
    if (state.wikiCurrentEntry) {
      applyWikiEntry(state.wikiCurrentEntry);
    }
    if (state.activeInspector === 'wiki') {
      renderWikiInspectorSnapshot();
    }
    renderWikiLists();
    setWikiStatus(`entry ${normalizedEntryId} loaded`, 'good');
  }

  async function loadWikiProposal(proposalId = wikiProposalIdInput.value.trim()) {
    const normalizedProposalId = proposalId.trim();
    if (!normalizedProposalId) {
      setWikiStatus('proposal id required', 'warn');
      return;
    }

    setWikiStatus(`loading proposal ${normalizedProposalId}`, 'warn');
    const payload = await fetchJson(`/api/wiki/proposals?proposal_id=${encodeURIComponent(normalizedProposalId)}`);
    state.wikiCurrentProposal = payload?.proposal ?? null;
    if (state.wikiCurrentProposal) {
      applyWikiProposal(state.wikiCurrentProposal);
    }
    if (state.activeInspector === 'wiki') {
      renderWikiInspectorSnapshot();
    }
    renderWikiLists();
    setWikiStatus(`proposal ${normalizedProposalId} loaded`, 'good');
  }

  async function refreshWikiHistory(entryId = wikiEntryIdInput.value.trim()) {
    const normalizedEntryId = entryId.trim();
    if (!normalizedEntryId) {
      setWikiStatus('entry id required', 'warn');
      return;
    }

    setWikiStatus(`refreshing history ${normalizedEntryId}`, 'warn');
    const payload = await fetchJson(`/api/wiki/history?entry_id=${encodeURIComponent(normalizedEntryId)}`);
    state.wikiCurrentEntry = payload?.current ?? state.wikiCurrentEntry;
    state.wikiHistory = Array.isArray(payload?.history) ? payload.history : [];
    if (state.activeInspector === 'wiki') {
      renderWikiInspectorSnapshot();
    }
    renderWikiLists();
    setWikiStatus(`history ${normalizedEntryId} loaded`, 'good');
  }

  async function submitWikiProposal() {
    const entryId = wikiEntryIdInput.value.trim();
    if (!entryId) {
      setWikiStatus('entry id required', 'warn');
      return;
    }

    const payload = {
      entry_id: entryId,
      base_version: Number(wikiBaseVersionInput.value ?? 0) || null,
      title: wikiTitleInput.value.trim(),
      summary: wikiSummaryInput.value.trim(),
      facts: splitWikiLines(wikiFactsInput.value),
      tags: splitWikiCsv(wikiTagsInput.value),
      source: 'llm',
      source_trace_id: state.taskId || 'console_wiki',
    };

    setWikiStatus('submitting proposal', 'warn');
    const result = await fetchJson('/api/wiki/proposals', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    state.wikiCurrentProposal = result?.proposal ?? null;
    if (state.wikiCurrentProposal) {
      applyWikiProposal(state.wikiCurrentProposal);
    }
    await loadWikiCatalog();
    setWikiStatus(`proposal ${state.wikiCurrentProposal?.proposal_id ?? 'created'}`, 'good');
  }

  async function importWikiMarkdown() {
    const markdown = wikiMarkdownInput?.value?.trim() ?? '';
    if (!markdown) {
      setWikiStatus('markdown required', 'warn');
      return;
    }

    setWikiStatus('importing markdown', 'warn');
    const result = await fetchJson('/api/wiki/import-markdown', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'proposal',
        markdown,
        entry_id: wikiEntryIdInput.value.trim() || null,
        base_version: Number(wikiBaseVersionInput.value ?? 0) || null,
        source_trace_id: state.taskId || 'console_wiki_markdown',
      }),
    });

    state.wikiCurrentProposal = result?.proposal ?? state.wikiCurrentProposal;
    if (state.wikiCurrentProposal) {
      applyWikiProposal(state.wikiCurrentProposal);
    }
    await loadWikiCatalog();
    setWikiStatus(`markdown imported as ${result?.mode ?? 'proposal'}`, 'good');
  }

  async function reviewWikiProposal(decision) {
    const proposalId = wikiProposalIdInput.value.trim();
    if (!proposalId) {
      setWikiStatus('proposal id required', 'warn');
      return;
    }

    setWikiStatus(`${decision} proposal`, 'warn');
    const result = await fetchJson('/api/wiki/proposals/review', {
      method: 'POST',
      body: JSON.stringify({
        proposal_id: proposalId,
        decision,
        reviewer_id: wikiReviewerIdInput.value.trim() || 'console_operator',
        notes: `Console ${decision}`,
        merge_strategy: wikiMergeStrategySelect.value,
        metadata: {
          source: 'console',
        },
      }),
    });
    state.wikiCurrentProposal = result?.proposal ?? null;
    state.wikiCurrentEntry = result?.entry ?? state.wikiCurrentEntry;
    if (state.wikiCurrentEntry) {
      applyWikiEntry(state.wikiCurrentEntry);
    }
    await loadWikiCatalog();
    setWikiStatus(`proposal ${decision}`, 'good');
  }

  async function rollbackWikiEntry() {
    const entryId = wikiEntryIdInput.value.trim();
    if (!entryId) {
      setWikiStatus('entry id required', 'warn');
      return;
    }

    const targetVersion = Number(wikiTargetVersionInput.value ?? 0);
    if (!Number.isFinite(targetVersion) || targetVersion <= 0) {
      setWikiStatus('target version required', 'warn');
      return;
    }

    setWikiStatus(`rolling back ${entryId}`, 'warn');
    const result = await fetchJson('/api/wiki/rollback', {
      method: 'POST',
      body: JSON.stringify({
        entry_id: entryId,
        target_version: targetVersion,
        reviewer_id: wikiReviewerIdInput.value.trim() || 'console_operator',
        reason: 'Console rollback',
        source_trace_id: state.taskId || 'console_wiki',
      }),
    });
    state.wikiCurrentEntry = result?.entry ?? state.wikiCurrentEntry;
    if (state.wikiCurrentEntry) {
      applyWikiEntry(state.wikiCurrentEntry);
    }
    await loadWikiCatalog();
    setWikiStatus(`rolled back to v${targetVersion}`, 'good');
  }

  function bindWikiInspectorEvents() {
    if (eventsBound) {
      return;
    }
    eventsBound = true;

    wikiRefreshButton?.addEventListener('click', () => void loadWikiCatalog());
    wikiLoadEntryButton?.addEventListener('click', () => void loadWikiEntry());
    wikiLoadProposalButton?.addEventListener('click', () => void loadWikiProposal());
    wikiSubmitProposalButton?.addEventListener('click', () => void submitWikiProposal());
    wikiImportMarkdownButton?.addEventListener('click', () => void importWikiMarkdown());
    wikiApproveProposalButton?.addEventListener('click', () => void reviewWikiProposal('approved'));
    wikiRejectProposalButton?.addEventListener('click', () => void reviewWikiProposal('rejected'));
    wikiRollbackButton?.addEventListener('click', () => void rollbackWikiEntry());
    wikiRefreshHistoryButton?.addEventListener('click', () => void refreshWikiHistory());
  }

  return {
    setWikiStatus,
    renderWikiLists,
    applyWikiEntry,
    applyWikiProposal,
    loadWikiCatalog,
    loadWikiEntry,
    loadWikiProposal,
    refreshWikiHistory,
    submitWikiProposal,
    importWikiMarkdown,
    reviewWikiProposal,
    rollbackWikiEntry,
    bindWikiInspectorEvents,
  };
}
