export function createDeadLetterInspectorController({
  state,
  taskIdInput,
  recoveryModeSelect,
  deadLetterOps,
  deadLetterStatusFilter,
  deadLetterReplayableFilter,
  deadLetterSelectedId,
  deadLetterSummaryChips,
  deadLetterList,
  deadLetterDetailOutput,
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
  hydrateTask,
  controls = {},
} = {}) {
  let eventsBound = false;

  const {
    refreshDeadLettersButton,
    replayDeadLetterButton,
    recoverDeadLetterTaskButton,
  } = controls;

  function normalizeDeadLetterInspectorPayload(payload) {
    return {
      task_id: payload?.task_id ?? null,
      items: Array.isArray(payload?.items) ? payload.items : [],
    };
  }

  function buildDeadLetterInspectorSummary(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return [
      `count:${items.length}`,
      `open:${items.filter((item) => item.status === 'open').length}`,
      `replayed:${items.filter((item) => item.status === 'replayed').length}`,
      `resolved:${items.filter((item) => item.status === 'resolved').length}`,
    ];
  }

  function buildDeadLettersEndpoint(taskId = state.taskId) {
    const params = new URLSearchParams({
      task_id: taskId,
    });
    if (deadLetterStatusFilter?.value && deadLetterStatusFilter.value !== 'all') {
      params.set('status', deadLetterStatusFilter.value);
    }
    if (deadLetterReplayableFilter?.value && deadLetterReplayableFilter.value !== 'all') {
      params.set('replayable', deadLetterReplayableFilter.value);
    }
    return `/api/dead-letters?${params.toString()}`;
  }

  async function loadDeadLetterInspectorData(taskId = state.taskId) {
    const payload = await fetchJson(buildDeadLettersEndpoint(taskId));
    return normalizeDeadLetterInspectorPayload(payload);
  }

  function clearDeadLetterInspector() {
    clearNode(deadLetterSummaryChips);
    clearNode(deadLetterList);
    clearNode(deadLetterDetailOutput);
    if (deadLetterSelectedId) {
      deadLetterSelectedId.value = '';
    }
  }

  function setDeadLetterInspectorVisibility(showDeadLetters) {
    if (deadLetterOps) {
      deadLetterOps.hidden = !showDeadLetters;
    }
  }

  function renderDeadLetterDetail(record) {
    clearNode(deadLetterDetailOutput);
    const wrapper = document.createElement('div');
    wrapper.className = 'draft-detail';

    if (!record) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'Select a dead-letter item to inspect its replay context';
      wrapper.appendChild(empty);
      deadLetterDetailOutput.appendChild(wrapper);
      return;
    }

    const summary = document.createElement('section');
    summary.className = 'draft-section';
    const grid = document.createElement('div');
    grid.className = 'draft-grid';
    appendDraftKv(grid, 'Dead-letter ID', record.dead_letter_id ?? 'n/a');
    appendDraftKv(grid, 'Task ID', record.task_id ?? 'n/a');
    appendDraftKv(grid, 'Status', record.status ?? 'n/a');
    appendDraftKv(grid, 'Reason', record.reason ?? 'n/a');
    appendDraftKv(grid, 'Replayable', record.replayable ? 'yes' : 'no');
    appendDraftKv(grid, 'Failure Count', record.failure_count ?? 0);
    appendDraftKv(grid, 'Created At', formatTimestamp(record.created_at));
    appendDraftKv(grid, 'Updated At', formatTimestamp(record.updated_at));
    appendDraftKv(grid, 'Last Replayed', formatTimestamp(record.last_replayed_at));
    appendDraftKv(grid, 'Resolved At', formatTimestamp(record.resolved_at));
    summary.appendChild(grid);
    wrapper.appendChild(summary);

    const chips = document.createElement('div');
    chips.className = 'chip-row';
    if (record.payload?.worker_job?.job_type) {
      chips.appendChild(createChip(`worker:${record.payload.worker_job.job_type}`));
    }
    if (record.payload?.worker_job?.job_id) {
      chips.appendChild(createChip(`job:${record.payload.worker_job.job_id}`));
    }
    if (record.payload?.task?.status) {
      chips.appendChild(createChip(`task:${record.payload.task.status}`));
    }
    if (record.payload?.task?.current_step_id) {
      chips.appendChild(createChip(`step:${record.payload.task.current_step_id}`));
    }
    if (record.resolution?.decision) {
      chips.appendChild(createChip(`resolution:${record.resolution.decision}`));
    }
    wrapper.appendChild(chips);

    appendDraftJsonSection(wrapper, 'Dead-letter Payload', {
      error: record.payload?.worker_error ?? record.payload?.error ?? record.payload?.task?.metadata?.dead_letter_error ?? null,
      worker_job: record.payload?.worker_job ?? null,
      worker_input: record.payload?.worker_input ?? null,
      task_snapshot: record.payload?.task ? {
        task_id: record.payload.task.task_id ?? null,
        status: record.payload.task.status ?? null,
        phase: record.payload.task.phase ?? null,
        current_step_id: record.payload.task.current_step_id ?? null,
        has_message_snapshot: Boolean(record.payload.task.message_snapshot),
        has_plan: Boolean(record.payload.task.plan),
        has_run_state: Boolean(record.payload.task.run_state),
      } : null,
    });
    appendDraftJsonSection(wrapper, 'Dead-letter Metadata', record.metadata ?? {});
    if (record.resolution) {
      appendDraftJsonSection(wrapper, 'Resolution', record.resolution);
    }

    deadLetterDetailOutput.appendChild(wrapper);
  }

  function renderDeadLetterInspector(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    state.deadLetterItems = items;

    syncSelectOptions(deadLetterStatusFilter, items.map((item) => item.status), {
      baseValue: 'all',
      baseLabel: 'all',
    });
    if (deadLetterReplayableFilter) {
      deadLetterReplayableFilter.value = ['all', 'true', 'false'].includes(deadLetterReplayableFilter.value)
        ? deadLetterReplayableFilter.value
        : 'all';
    }

    if (!items.some((item) => item.dead_letter_id === state.deadLetterSelectedId)) {
      state.deadLetterSelectedId = items[0]?.dead_letter_id ?? null;
    }
    if (deadLetterSelectedId) {
      deadLetterSelectedId.value = state.deadLetterSelectedId ?? '';
    }

    const selected = items.find((item) => item.dead_letter_id === state.deadLetterSelectedId) ?? items[0] ?? null;

    clearNode(deadLetterSummaryChips);
    const summaryItems = [
      `items:${items.length}`,
      `open:${items.filter((item) => item.status === 'open').length}`,
      `replayed:${items.filter((item) => item.status === 'replayed').length}`,
      `resolved:${items.filter((item) => item.status === 'resolved').length}`,
    ];
    if (selected) {
      summaryItems.push(`selected:${selected.reason ?? selected.status ?? 'n/a'}`);
      summaryItems.push(selected.replayable ? 'replayable' : 'locked');
    }
    for (const item of summaryItems) {
      deadLetterSummaryChips.appendChild(createChip(item, item === 'locked' ? 'bad' : null));
    }

    clearNode(deadLetterList);
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No dead-letter records found';
      deadLetterList.appendChild(empty);
    } else {
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'list-item';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-task-link';
        button.dataset.active = String(item.dead_letter_id === state.deadLetterSelectedId);
        button.textContent = `${item.dead_letter_id} · ${item.status ?? 'open'} · ${item.reason ?? 'dead-letter'}`;
        button.addEventListener('click', () => {
          state.deadLetterSelectedId = item.dead_letter_id;
          renderDeadLetterInspector(payload);
        });

        const meta = document.createElement('div');
        meta.className = 'tiny muted';
        meta.textContent = `${item.task_id ?? 'n/a'} · ${formatTimestamp(item.created_at)} · replayable:${item.replayable ? 'yes' : 'no'}`;

        row.append(button, meta);
        deadLetterList.appendChild(row);
      }
    }

    renderDeadLetterDetail(selected);
  }

  function renderDeadLetterInspectorPanel(showDeadLetters, payload) {
    setDeadLetterInspectorVisibility(showDeadLetters);
    if (showDeadLetters) {
      renderDeadLetterInspector(payload);
      return;
    }
    clearDeadLetterInspector();
  }

  async function refreshDeadLetters() {
    const taskId = normalizeTaskId();
    if (!taskId) {
      setStatus(taskStatus, 'task id required for dead letters', 'warn');
      return;
    }
    state.activeInspector = 'deadLetters';
    renderInspectorTabs();
    await loadInspector('deadLetters', taskId);
  }

  async function replaySelectedDeadLetter() {
    if (!state.deadLetterSelectedId) {
      setStatus(taskStatus, 'select a dead-letter item first', 'warn');
      return;
    }

    setStatus(taskStatus, 'replaying dead-letter worker job', 'warn');
    try {
      state.activeInspector = 'deadLetters';
      renderInspectorTabs();
      const result = await fetchJson('/api/dead-letters/replay', {
        method: 'POST',
        body: JSON.stringify({
          dead_letter_id: state.deadLetterSelectedId,
          operator_id: 'console_operator',
          notes: 'Replay from dead-letter inspector',
        }),
      });
      const selectedTaskId = result?.dead_letter?.task_id ?? state.deadLetterItems.find((item) => item.dead_letter_id === state.deadLetterSelectedId)?.task_id ?? null;
      if (selectedTaskId) {
        taskIdInput.value = selectedTaskId;
        state.taskId = selectedTaskId;
        await hydrateTask(selectedTaskId, { reconnect: false });
      } else {
        await loadInspector('deadLetters');
      }
      setStatus(taskStatus, result?.replay?.job?.status ? `dead-letter ${result.replay.job.status}` : 'dead-letter replayed', 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'dead-letter replay failed', 'bad');
    }
  }

  async function recoverTaskFromSelectedDeadLetter() {
    const selectedRecord = state.deadLetterItems.find((item) => item.dead_letter_id === state.deadLetterSelectedId) ?? null;
    const taskId = selectedRecord?.task_id ?? normalizeTaskId();
    if (!taskId) {
      setStatus(taskStatus, 'task id required for recovery', 'warn');
      return;
    }

    setStatus(taskStatus, `recovering ${taskId} via ${recoveryModeSelect.value}`, 'warn');
    try {
      const result = await fetchJson('/api/tasks/recover', {
        method: 'POST',
        body: JSON.stringify({
          task_id: taskId,
          mode: recoveryModeSelect.value,
          reviewer_id: 'console_operator',
          notes: `Recover from dead-letter ${state.deadLetterSelectedId ?? 'console'}`,
        }),
      });
      state.taskId = taskId;
      taskIdInput.value = taskId;
      state.activeInspector = result?.recovery_drill ? 'recovery' : 'task';
      renderInspectorTabs();
      await hydrateTask(taskId, { reconnect: true });
      if (result?.recovery_drill) {
        await loadInspector('recovery', taskId);
      }
      setStatus(taskStatus, result?.approval_required ? 'recovery paused for approval' : `recovered ${taskId}`, result?.approval_required ? 'warn' : 'good');
    } catch (error) {
      setStatus(taskStatus, error instanceof Error ? error.message : 'task recovery failed', 'bad');
    }
  }

  function bindDeadLetterInspectorEvents() {
    if (eventsBound) {
      return;
    }
    eventsBound = true;

    refreshDeadLettersButton?.addEventListener('click', () => void refreshDeadLetters());
    replayDeadLetterButton?.addEventListener('click', () => void replaySelectedDeadLetter());
    recoverDeadLetterTaskButton?.addEventListener('click', () => void recoverTaskFromSelectedDeadLetter());
    deadLetterStatusFilter?.addEventListener('change', () => {
      state.deadLetterSelectedId = null;
      if (state.activeInspector === 'deadLetters') {
        void loadInspector('deadLetters');
      }
    });
    deadLetterReplayableFilter?.addEventListener('change', () => {
      state.deadLetterSelectedId = null;
      if (state.activeInspector === 'deadLetters') {
        void loadInspector('deadLetters');
      }
    });
  }

  return {
    bindDeadLetterInspectorEvents,
    normalizeDeadLetterInspectorPayload,
    buildDeadLetterInspectorSummary,
    buildDeadLettersEndpoint,
    loadDeadLetterInspectorData,
    clearDeadLetterInspector,
    setDeadLetterInspectorVisibility,
    renderDeadLetterInspectorPanel,
    renderDeadLetterInspector,
    renderDeadLetterDetail,
    refreshDeadLetters,
    replaySelectedDeadLetter,
    recoverTaskFromSelectedDeadLetter,
  };
}
