export function createInspectorShellController({
  state,
  output,
  inspectorSummary,
  inspectorHint,
  clearNode,
  createChip,
  fetchJson,
  renderInspectorTabs,
  buildHarnessRunsEndpoint,
  buildDeliveriesEndpoint,
  buildQueueEndpoint,
  buildDeadLettersEndpoint,
  buildRecoveryEndpoint,
  loadHarnessInspectorData,
  loadDeliveryInspectorData,
  loadQueueInspectorData,
  loadDeadLetterInspectorData,
  loadRecoveryInspectorData,
  normalizeToolsInspectorPayload,
  normalizeHarnessInspectorPayload,
  normalizeModelInspectorPayload,
  normalizeKnowledgeInspectorPayload,
  normalizeMemoryInspectorPayload,
  normalizeDeliveryInspectorPayload,
  normalizeQueueInspectorPayload,
  normalizeApprovalInspectorPayload,
  normalizeGovernanceInspectorPayload,
  normalizeDeadLetterInspectorPayload,
  normalizeRecoveryInspectorPayload,
  buildToolsInspectorSummary,
  buildHarnessInspectorSummary,
  buildModelInspectorSummary,
  buildKnowledgeInspectorSummary,
  buildMemoryInspectorSummary,
  buildDeliveryInspectorSummary,
  buildQueueInspectorSummary,
  buildApprovalInspectorSummary,
  buildGovernanceInspectorSummary,
  buildDeadLetterInspectorSummary,
  buildRecoveryInspectorSummary,
  setHarnessInspectorVisibility,
  setDeliveryInspectorVisibility,
  setQueueInspectorVisibility,
  setModelInspectorVisibility,
  setKnowledgeInspectorVisibility,
  setMemoryInspectorVisibility,
  setToolsInspectorVisibility,
  setGovernanceInspectorVisibility,
  setApprovalInspectorVisibility,
  setDeadLetterInspectorVisibility,
  setRecoveryInspectorVisibility,
  renderHarnessInspectorPanel,
  renderDeliveryInspectorPanel,
  renderQueueInspectorPanel,
  renderModelInspectorPanel,
  renderKnowledgeInspectorPanel,
  renderMemoryInspectorPanel,
  renderToolsInspectorPanel,
  renderGovernanceInspectorPanel,
  renderApprovalInspectorPanel,
  renderDeadLetterInspectorPanel,
  renderRecoveryInspectorPanel,
} = {}) {
  function setInspectorSummary(items = []) {
    clearNode(inspectorSummary);
    for (const item of items) {
      inspectorSummary.appendChild(createChip(item));
    }
  }

  function renderSpecializedInspectorPanels(view, payload) {
    const showHarness = view === 'harness';
    const showDeliveries = view === 'deliveries';
    const showQueue = view === 'queue';
    const showModel = view === 'model';
    const showKnowledge = view === 'knowledge';
    const showMemory = view === 'memory';
    const showTools = view === 'tools';
    const showGovernance = view === 'governance';
    const showApproval = view === 'approval';
    const showDeadLetters = view === 'deadLetters';
    const showRecovery = view === 'recovery';

    setHarnessInspectorVisibility(showHarness);
    setDeliveryInspectorVisibility(showDeliveries);
    setQueueInspectorVisibility(showQueue);
    setModelInspectorVisibility(showModel);
    setKnowledgeInspectorVisibility(showKnowledge);
    setMemoryInspectorVisibility(showMemory);
    setToolsInspectorVisibility(showTools);
    setGovernanceInspectorVisibility(showGovernance);
    setApprovalInspectorVisibility(showApproval);
    setDeadLetterInspectorVisibility(showDeadLetters);
    setRecoveryInspectorVisibility(showRecovery);

    renderHarnessInspectorPanel(showHarness, payload);
    renderDeliveryInspectorPanel(showDeliveries, payload);
    renderQueueInspectorPanel(showQueue, payload);
    renderModelInspectorPanel(showModel, payload);
    renderKnowledgeInspectorPanel(showKnowledge, payload);
    renderMemoryInspectorPanel(showMemory, payload);
    renderToolsInspectorPanel(showTools, payload);
    renderGovernanceInspectorPanel(showGovernance, payload);
    renderApprovalInspectorPanel(showApproval, payload);
    renderDeadLetterInspectorPanel(showDeadLetters, payload);
    renderRecoveryInspectorPanel(showRecovery, payload);
  }

  function normalizeInspectorPayload(view, payload) {
    if (view === 'tools') return normalizeToolsInspectorPayload(payload);
    if (view === 'harness') return normalizeHarnessInspectorPayload(payload);
    if (view === 'model') return normalizeModelInspectorPayload(payload);
    if (view === 'knowledge') return normalizeKnowledgeInspectorPayload(payload);
    if (view === 'memory') return normalizeMemoryInspectorPayload(payload);
    if (view === 'wiki') {
      return {
        entries: Array.isArray(payload?.entries) ? payload.entries : [],
        entry: payload?.entry ?? null,
        query: payload?.query ?? null,
        items: Array.isArray(payload?.items) ? payload.items : [],
        proposals: Array.isArray(payload?.proposals) ? payload.proposals : [],
        history: Array.isArray(payload?.history) ? payload.history : [],
      };
    }
    if (view === 'deliveries') return normalizeDeliveryInspectorPayload(payload);
    if (view === 'queue') return normalizeQueueInspectorPayload(payload);
    if (view === 'approval') return normalizeApprovalInspectorPayload(payload);
    if (view === 'governance') return normalizeGovernanceInspectorPayload(payload);
    if (view === 'deadLetters') return normalizeDeadLetterInspectorPayload(payload);
    if (view === 'recovery') return normalizeRecoveryInspectorPayload(payload);
    if (view === 'handoffs') {
      return {
        task_id: payload?.task_id ?? null,
        items: Array.isArray(payload?.handoffs) ? payload.handoffs : [],
        aggregate: payload?.aggregate ?? null,
        coordination: payload?.coordination ?? null,
      };
    }
    return payload;
  }

  function buildSummary(view, payload) {
    const summary = [];
    if (view === 'task') {
      const task = payload?.task ?? null;
      if (task) {
        summary.push(task.status ?? 'unknown');
        summary.push(task.phase ?? 'n/a');
        summary.push(`steps:${task.completed_steps ?? 0}/${task.total_steps ?? 0}`);
      }
    } else if (view === 'trace') {
      summary.push(`events:${payload?.metrics?.event_count ?? 0}`);
      summary.push(`final:${payload?.metrics?.final_status ?? 'n/a'}`);
      summary.push(`deliveries:${payload?.metrics?.delivery_count ?? 0}`);
      summary.push(`retrieval:${payload?.metrics?.retrieval_score ?? 'n/a'}`);
      summary.push(`blocked:${payload?.metrics?.blocked_tool_result_count ?? 0}`);
    } else if (view === 'tools') {
      summary.push(...buildToolsInspectorSummary(payload));
    } else if (view === 'harness') {
      summary.push(...buildHarnessInspectorSummary(payload));
    } else if (view === 'model') {
      summary.push(...buildModelInspectorSummary(payload));
    } else if (view === 'evaluation') {
      summary.push(`count:${payload?.evaluations?.length ?? 0}`);
      summary.push(`latest:${payload?.latest?.decision ?? 'n/a'}`);
      summary.push(`overall:${payload?.latest?.overall_score ?? 'n/a'}`);
      summary.push(`retrieval:${payload?.latest?.evidence?.retrieval_score ?? 'n/a'}`);
    } else if (view === 'deliveries') {
      summary.push(...buildDeliveryInspectorSummary(payload));
    } else if (view === 'queue') {
      summary.push(...buildQueueInspectorSummary(payload));
    } else if (view === 'knowledge') {
      summary.push(...buildKnowledgeInspectorSummary(payload));
    } else if (view === 'memory') {
      summary.push(...buildMemoryInspectorSummary(payload));
    } else if (view === 'review') {
      summary.push(`count:${payload?.items?.length ?? 0}`);
    } else if (view === 'approval') {
      summary.push(...buildApprovalInspectorSummary(payload));
    } else if (view === 'handoffs') {
      summary.push(`count:${payload?.items?.length ?? 0}`);
      summary.push(`mode:${payload?.coordination?.recommended_mode ?? 'n/a'}`);
      summary.push(`join:${payload?.coordination?.join_strategy?.mode ?? payload?.aggregate?.fallback?.strategy ?? 'n/a'}`);
    } else if (view === 'context') {
      summary.push(`budget:${payload?.token_budget ?? 0}`);
      summary.push(`estimate:${payload?.token_estimate ?? 0}`);
    } else if (view === 'rl') {
      summary.push(`rewards:${payload?.rewards?.length ?? 0}`);
      summary.push(`gates:${payload?.safety_gates?.length ?? 0}`);
    } else if (view === 'governance') {
      summary.push(...buildGovernanceInspectorSummary(payload));
    } else if (view === 'deadLetters') {
      summary.push(...buildDeadLetterInspectorSummary(payload));
    } else if (view === 'recovery') {
      summary.push(...buildRecoveryInspectorSummary(payload));
    } else if (view === 'wiki') {
      summary.push(`entries:${payload?.entries?.length ?? state.wikiEntries.length ?? 0}`);
      summary.push(`proposals:${payload?.proposals?.length ?? state.wikiProposals.length ?? 0}`);
      summary.push(`history:${payload?.history?.length ?? state.wikiHistory.length ?? 0}`);
      if (payload?.runtime_summary?.provider) {
        summary.push(`provider:${payload.runtime_summary.provider}`);
      }
      if (payload?.runtime_summary?.cache_backend) {
        summary.push(`cache:${payload.runtime_summary.cache_backend}`);
      }
      if (payload?.entry?.entry_id) {
        summary.push(`entry:${payload.entry.entry_id}`);
      }
      if (payload?.proposal?.proposal_id) {
        summary.push(`proposal:${payload.proposal.proposal_id}`);
      }
    }
    return summary;
  }

  function renderInspectorData(view, payload) {
    state.currentInspector = payload;
    inspectorHint.textContent = view;
    output.textContent = JSON.stringify(payload ?? {}, null, 2);
    setInspectorSummary(buildSummary(view, payload));
    renderSpecializedInspectorPanels(view, payload);
    renderInspectorTabs();
  }

  async function loadInspector(view = state.activeInspector, taskId = state.taskId) {
    if (!taskId && view !== 'wiki' && view !== 'harness' && view !== 'tools' && view !== 'queue') {
      return;
    }

    const pathMap = {
      task: `/api/tasks?task_id=${encodeURIComponent(taskId)}`,
      trace: `/api/traces/bundle?task_id=${encodeURIComponent(taskId)}`,
      tools: '/api/tools',
      harness: buildHarnessRunsEndpoint(),
      wiki: '/api/wiki',
      model: `/api/traces/bundle?task_id=${encodeURIComponent(taskId)}`,
      deliveries: buildDeliveriesEndpoint(taskId),
      queue: buildQueueEndpoint(taskId),
      knowledge: `/api/knowledge?task_id=${encodeURIComponent(taskId)}`,
      memory: `/api/memory?task_id=${encodeURIComponent(taskId)}`,
      evaluation: `/api/evaluations?task_id=${encodeURIComponent(taskId)}`,
      review: `/api/reviews?task_id=${encodeURIComponent(taskId)}`,
      approval: `/api/approvals?task_id=${encodeURIComponent(taskId)}`,
      handoffs: `/api/multi-agent?task_id=${encodeURIComponent(taskId)}`,
      context: `/api/context/budget?task_id=${encodeURIComponent(taskId)}`,
      rl: `/api/rl?task_id=${encodeURIComponent(taskId)}`,
      governance: `/api/governance?task_id=${encodeURIComponent(taskId)}`,
      deadLetters: buildDeadLettersEndpoint(taskId),
      recovery: buildRecoveryEndpoint(taskId),
    };

    const payload = view === 'harness'
      ? await loadHarnessInspectorData()
      : view === 'deliveries'
        ? await loadDeliveryInspectorData(taskId)
        : view === 'queue'
          ? await loadQueueInspectorData(taskId)
          : view === 'deadLetters'
            ? await loadDeadLetterInspectorData(taskId)
            : view === 'recovery'
              ? await loadRecoveryInspectorData(taskId)
              : await fetchJson(pathMap[view]);

    renderInspectorData(view, normalizeInspectorPayload(view, payload));
  }

  return {
    setInspectorSummary,
    renderSpecializedInspectorPanels,
    normalizeInspectorPayload,
    renderInspectorData,
    loadInspector,
  };
}
