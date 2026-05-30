export function createRecoveryInspectorController({
  state,
  recoveryOps,
  recoveryStatusFilter,
  recoverySelectedId,
  recoverySummaryChips,
  recoveryList,
  recoveryDetailOutput,
  taskStatus,
  clearNode,
  createChip,
  appendDraftJsonSection,
  appendDraftKv,
  formatTimestamp,
  fetchJson,
  loadInspector,
  renderInspectorTabs,
  setStatus,
  normalizeTaskId,
  syncSelectOptions,
  controls = {},
} = {}) {
  let eventsBound = false;

  const {
    refreshRecoveryDrillsButton,
  } = controls;

  function normalizeRecoveryInspectorPayload(payload) {
    return {
      task_id: payload?.task_id ?? null,
      items: Array.isArray(payload?.items) ? payload.items : [],
    };
  }

  function buildRecoveryInspectorSummary(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return [
      `count:${items.length}`,
      `running:${items.filter((item) => item.status === 'running').length}`,
      `completed:${items.filter((item) => item.status === 'completed').length}`,
      `failed:${items.filter((item) => item.status === 'failed').length}`,
    ];
  }

  function buildRecoveryEndpoint(taskId = state.taskId) {
    const params = new URLSearchParams({
      task_id: taskId,
    });
    if (recoveryStatusFilter?.value && recoveryStatusFilter.value !== 'all') {
      params.set('status', recoveryStatusFilter.value);
    }
    return `/api/recovery/drills?${params.toString()}`;
  }

  async function loadRecoveryInspectorData(taskId = state.taskId) {
    const payload = await fetchJson(buildRecoveryEndpoint(taskId));
    return normalizeRecoveryInspectorPayload(payload);
  }

  function clearRecoveryInspector() {
    clearNode(recoverySummaryChips);
    clearNode(recoveryList);
    clearNode(recoveryDetailOutput);
    if (recoverySelectedId) {
      recoverySelectedId.value = '';
    }
  }

  function setRecoveryInspectorVisibility(showRecovery) {
    if (recoveryOps) {
      recoveryOps.hidden = !showRecovery;
    }
  }

  function renderRecoveryDetail(drill) {
    clearNode(recoveryDetailOutput);
    const wrapper = document.createElement('div');
    wrapper.className = 'draft-detail';

    if (!drill) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'Select a recovery drill to inspect the replay result';
      wrapper.appendChild(empty);
      recoveryDetailOutput.appendChild(wrapper);
      return;
    }

    const summary = document.createElement('section');
    summary.className = 'draft-section';
    const grid = document.createElement('div');
    grid.className = 'draft-grid';
    appendDraftKv(grid, 'Drill ID', drill.drill_id ?? 'n/a');
    appendDraftKv(grid, 'Task ID', drill.task_id ?? 'n/a');
    appendDraftKv(grid, 'Scenario', drill.scenario ?? 'n/a');
    appendDraftKv(grid, 'Mode', drill.recovery_mode ?? 'n/a');
    appendDraftKv(grid, 'Status', drill.status ?? 'n/a');
    appendDraftKv(grid, 'Created At', formatTimestamp(drill.created_at));
    appendDraftKv(grid, 'Completed At', formatTimestamp(drill.completed_at));
    summary.appendChild(grid);
    wrapper.appendChild(summary);

    const chips = document.createElement('div');
    chips.className = 'chip-row';
    if (drill.result?.task_status) {
      chips.appendChild(createChip(`task:${drill.result.task_status}`));
    }
    if (drill.result?.approval_required) {
      chips.appendChild(createChip('approval-required', 'warn'));
    }
    if (drill.result?.recovered) {
      chips.appendChild(createChip('recovered', 'good'));
    }
    wrapper.appendChild(chips);

    appendDraftJsonSection(wrapper, 'Recovery Result', drill.result ?? {});
    appendDraftJsonSection(wrapper, 'Recovery Metadata', drill.metadata ?? {});

    recoveryDetailOutput.appendChild(wrapper);
  }

  function renderRecoveryInspector(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    state.recoveryItems = items;

    syncSelectOptions(recoveryStatusFilter, items.map((item) => item.status), {
      baseValue: 'all',
      baseLabel: 'all',
    });

    if (!items.some((item) => item.drill_id === state.recoverySelectedId)) {
      state.recoverySelectedId = items[0]?.drill_id ?? null;
    }
    if (recoverySelectedId) {
      recoverySelectedId.value = state.recoverySelectedId ?? '';
    }

    const selected = items.find((item) => item.drill_id === state.recoverySelectedId) ?? items[0] ?? null;

    clearNode(recoverySummaryChips);
    const summaryItems = [
      `items:${items.length}`,
      `running:${items.filter((item) => item.status === 'running').length}`,
      `completed:${items.filter((item) => item.status === 'completed').length}`,
      `failed:${items.filter((item) => item.status === 'failed').length}`,
    ];
    if (selected) {
      summaryItems.push(`selected:${selected.scenario ?? selected.status ?? 'n/a'}`);
      summaryItems.push(`mode:${selected.recovery_mode ?? 'n/a'}`);
    }
    for (const item of summaryItems) {
      recoverySummaryChips.appendChild(createChip(item));
    }

    clearNode(recoveryList);
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No recovery drills found';
      recoveryList.appendChild(empty);
    } else {
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'list-item';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-task-link';
        button.dataset.active = String(item.drill_id === state.recoverySelectedId);
        button.textContent = `${item.drill_id} · ${item.status ?? 'planned'} · ${item.recovery_mode ?? 'resume'}`;
        button.addEventListener('click', () => {
          state.recoverySelectedId = item.drill_id;
          renderRecoveryInspector(payload);
        });

        const meta = document.createElement('div');
        meta.className = 'tiny muted';
        meta.textContent = `${item.task_id ?? 'n/a'} · ${formatTimestamp(item.created_at)} · ${item.summary ?? 'recovery drill'}`;

        row.append(button, meta);
        recoveryList.appendChild(row);
      }
    }

    renderRecoveryDetail(selected);
  }

  function renderRecoveryInspectorPanel(showRecovery, payload) {
    setRecoveryInspectorVisibility(showRecovery);
    if (showRecovery) {
      renderRecoveryInspector(payload);
      return;
    }
    clearRecoveryInspector();
  }

  async function refreshRecoveryDrills() {
    const taskId = normalizeTaskId();
    if (!taskId) {
      setStatus(taskStatus, 'task id required for recovery drills', 'warn');
      return;
    }
    state.activeInspector = 'recovery';
    renderInspectorTabs();
    await loadInspector('recovery', taskId);
  }

  function bindRecoveryInspectorEvents() {
    if (eventsBound) {
      return;
    }
    eventsBound = true;

    refreshRecoveryDrillsButton?.addEventListener('click', () => void refreshRecoveryDrills());
    recoveryStatusFilter?.addEventListener('change', () => {
      state.recoverySelectedId = null;
      if (state.activeInspector === 'recovery') {
        void loadInspector('recovery');
      }
    });
  }

  return {
    bindRecoveryInspectorEvents,
    normalizeRecoveryInspectorPayload,
    buildRecoveryInspectorSummary,
    buildRecoveryEndpoint,
    loadRecoveryInspectorData,
    clearRecoveryInspector,
    setRecoveryInspectorVisibility,
    renderRecoveryInspectorPanel,
    renderRecoveryInspector,
    renderRecoveryDetail,
    refreshRecoveryDrills,
  };
}
