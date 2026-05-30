export function createTaskTraceController({
  state,
  taskIdInput,
  streamTimeline,
  streamHint,
  streamState,
  taskStatus,
  taskRef,
  taskChips,
  taskMeta,
  output,
  inspectorHint,
  clearNode,
  createChip,
  setStatus,
  fetchJson,
  loadInspector,
  rememberTask,
  renderInspectorTabs,
  setInspectorSummary,
  toneForTaskStatus,
} = {}) {
  function describeEvent(event) {
    const payload = event.payload ?? {};
    return payload.summary ??
      payload.message ??
      payload.text ??
      payload.state ??
      payload.finish_reason ??
      payload.title ??
      event.event_type;
  }

  function renderTimeline(events, { replace = false } = {}) {
    if (replace) {
      state.streamEvents = [];
    }

    const existing = new Map(state.streamEvents.map((event) => [event.seq ?? event.event_id, event]));
    for (const event of events) {
      const key = event.seq ?? event.event_id;
      existing.set(key, event);
    }

    state.streamEvents = Array.from(existing.values()).sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));
    clearNode(streamTimeline);

    const limited = state.streamEvents.slice(-60);
    for (const event of limited) {
      const card = document.createElement('div');
      card.className = 'event';

      const head = document.createElement('div');
      head.className = 'event-head';
      head.appendChild(createChip(`#${event.seq ?? '-'}`));
      head.appendChild(createChip(event.event_type));
      if (event.step_id) {
        head.appendChild(createChip(`step:${event.step_id}`));
      }
      if (event.timestamp) {
        head.appendChild(createChip(new Date(event.timestamp).toLocaleTimeString()));
      }

      const title = document.createElement('div');
      title.className = 'event-title';
      title.textContent = describeEvent(event);

      const body = document.createElement('div');
      body.className = 'event-body';
      body.textContent = JSON.stringify({
        payload: event.payload ?? {},
        metadata: event.metadata ?? {},
        usage: event.usage ?? null,
      }, null, 2);

      card.append(head, title, body);
      streamTimeline.appendChild(card);
    }

    const count = state.streamEvents.length;
    const tail = state.streamEvents.at(-1);
    streamHint.textContent = tail ? `${count} events, last seq ${tail.seq}` : `${count} events`;
  }

  function renderTaskSummary(task, bundle) {
    state.currentTask = task ?? null;
    state.currentBundle = bundle ?? null;

    taskRef.textContent = state.taskId || 'no task';
    clearNode(taskChips);
    clearNode(taskMeta);

    const chips = [];
    if (task?.status) chips.push(`status:${task.status}`);
    if (task?.phase) chips.push(`phase:${task.phase}`);
    if (task?.persona_id) chips.push(`persona:${task.persona_id}`);
    if (task?.current_step_id) chips.push(`step:${task.current_step_id}`);
    if (task?.metadata?.approval_required) chips.push('approval');
    if (task?.metadata?.multi_agent_enabled) chips.push('multi-agent');
    const modelRoute = task?.run_state?.output?.model_route ?? task?.output?.model_route ?? null;
    const fallbackState = task?.run_state?.output?.fallback ?? task?.output?.fallback ?? null;
    if (modelRoute?.provider) {
      chips.push(`model:${modelRoute.provider}/${modelRoute.profile ?? 'n/a'}`);
    }
    if (fallbackState?.applied) {
      chips.push(`fallback:${fallbackState.strategy ?? 'local'}`);
    }
    if (bundle?.metrics?.delivery_count !== undefined) {
      chips.push(`deliveries:${bundle.metrics.delivery_count ?? 0}`);
    }
    if (bundle?.metrics?.retrieval_score !== undefined && bundle.metrics.retrieval_score !== null) {
      chips.push(`retrieval:${bundle.metrics.retrieval_score}`);
    }
    if (bundle?.metrics?.tool_compliance_rate !== undefined) {
      chips.push(`tool:${Math.round((bundle.metrics.tool_compliance_rate ?? 0) * 100)}%`);
    }
    for (const chip of chips) {
      taskChips.appendChild(createChip(chip));
    }

    const metrics = [
      ['Events', bundle?.metrics?.event_count ?? 0],
      ['Audits', bundle?.metrics?.audit_count ?? 0],
      ['Handoffs', bundle?.metrics?.handoff_count ?? 0],
      ['Snapshots', bundle?.metrics?.compression_count ?? 0],
      ['Deliveries', bundle?.metrics?.delivery_count ?? 0],
      ['Rewards', bundle?.metrics?.reward_count ?? 0],
      ['Alerts', bundle?.metrics?.alert_count ?? 0],
    ];

    for (const [label, value] of metrics) {
      const metric = document.createElement('div');
      metric.className = 'metric';
      const caption = document.createElement('div');
      caption.className = 'tiny muted';
      caption.textContent = label;
      const strong = document.createElement('strong');
      strong.textContent = String(value);
      metric.append(caption, strong);
      taskMeta.appendChild(metric);
    }
  }

  async function hydrateTask(taskId, { reconnect = false } = {}) {
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) {
      return;
    }

    state.taskId = normalizedTaskId;
    taskIdInput.value = normalizedTaskId;
    rememberTask(normalizedTaskId);
    setStatus(taskStatus, 'loading', 'warn');

    const [taskResponse, traceResponse] = await Promise.all([
      fetchJson(`/api/tasks?task_id=${encodeURIComponent(normalizedTaskId)}`),
      fetchJson(`/api/traces/bundle?task_id=${encodeURIComponent(normalizedTaskId)}`),
    ]);

    const task = taskResponse.task ?? null;
    const bundle = traceResponse ?? null;
    state.lastSeq = bundle?.stream_events?.at(-1)?.seq ?? 0;

    renderTaskSummary(task, bundle);
    renderTimeline(bundle?.stream_events ?? [], { replace: true });
    setStatus(taskStatus, task?.status ?? 'idle', toneForTaskStatus(task?.status));
    await loadInspector(state.activeInspector, normalizedTaskId);

    if (reconnect) {
      connectStream(normalizedTaskId);
    }
  }

  function disconnectStream({ manual = true } = {}) {
    state.manualDisconnect = manual;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state.source) {
      state.source.close();
      state.source = null;
    }
    if (manual) {
      setStatus(streamState, 'disconnected', 'warn');
    }
  }

  function scheduleReconnect(taskId) {
    if (state.manualDisconnect || state.reconnectTimer) {
      return;
    }
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      connectStream(taskId);
    }, 1200);
  }

  function connectStream(taskId = state.taskId) {
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) {
      setStatus(streamState, 'no task', 'warn');
      return;
    }

    disconnectStream({ manual: false });
    state.manualDisconnect = false;

    const params = new URLSearchParams({ task_id: normalizedTaskId });
    if (state.lastSeq > 0) {
      params.set('last_seq', String(state.lastSeq));
    }
    const source = new EventSource(`/api/stream?${params.toString()}`);
    state.source = source;
    setStatus(streamState, `connecting @ ${state.lastSeq || 0}`, 'warn');

    const handlePayload = (type, raw) => {
      if (type === 'heartbeat') {
        setStatus(streamState, `live @ ${state.lastSeq || 0}`, 'good');
        return;
      }

      let payload = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = { event_type: type, payload: { raw } };
      }

      const normalized = {
        ...payload,
        event_type: payload.event_type ?? type,
      };
      state.lastSeq = Math.max(state.lastSeq, normalized.seq ?? 0);
      renderTimeline([normalized]);
      setStatus(streamState, `live @ ${state.lastSeq || normalized.seq || 0}`, 'good');

      if (normalized.event_type === 'done' || normalized.event_type === 'cancel' || normalized.event_type === 'error') {
        void hydrateTask(normalizedTaskId, { reconnect: false }).catch(() => {});
      }

      if (normalized.event_type === 'status' && normalized.payload?.state === 'waiting_approval') {
        state.activeInspector = 'approval';
        renderInspectorTabs();
        void loadInspector('approval', normalizedTaskId).catch(() => {});
      }
    };

    ['start', 'delta', 'tool_call', 'tool_result', 'status', 'error', 'done', 'cancel', 'heartbeat'].forEach((type) => {
      source.addEventListener(type, (event) => handlePayload(type, event.data));
    });

    source.onopen = () => {
      setStatus(streamState, `connected @ ${state.lastSeq || 0}`, 'good');
    };

    source.onerror = () => {
      setStatus(streamState, 'reconnecting', 'warn');
      if (!state.manualDisconnect) {
        source.close();
        state.source = null;
        scheduleReconnect(normalizedTaskId);
      }
    };
  }

  async function reloadCurrentTask(normalizeTaskId) {
    const taskId = normalizeTaskId();
    if (!taskId) {
      return;
    }
    await hydrateTask(taskId, { reconnect: false });
  }

  async function replayCurrentTask(normalizeTaskId) {
    const taskId = normalizeTaskId();
    if (!taskId) {
      return;
    }
    const result = await fetchJson(`/api/replay?task_id=${encodeURIComponent(taskId)}&after_seq=${encodeURIComponent(state.lastSeq || 0)}`);
    setInspectorSummary([
      `replayed:${result.stream_events?.length ?? 0}`,
      `audits:${result.audit_entries?.length ?? 0}`,
    ]);
    inspectorHint.textContent = 'replay';
    output.textContent = JSON.stringify(result, null, 2);
  }

  function triggerDownload(url) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.rel = 'noopener';
    anchor.target = '_blank';
    anchor.download = '';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function exportTraceBundleCurrentTask(normalizeTaskId) {
    const taskId = normalizeTaskId();
    if (!taskId) {
      return;
    }
    triggerDownload(`/api/traces/bundle?task_id=${encodeURIComponent(taskId)}&download=1`);
  }

  async function exportAuditSnapshotCurrentTask(normalizeTaskId) {
    const taskId = normalizeTaskId();
    if (!taskId) {
      return;
    }
    triggerDownload(`/api/traces?task_id=${encodeURIComponent(taskId)}&download=1`);
  }

  async function loadCurrentTask(normalizeTaskId) {
    const taskId = normalizeTaskId();
    if (!taskId) {
      return;
    }
    await hydrateTask(taskId, { reconnect: false });
  }

  return {
    describeEvent,
    renderTimeline,
    renderTaskSummary,
    hydrateTask,
    disconnectStream,
    scheduleReconnect,
    connectStream,
    reloadCurrentTask,
    replayCurrentTask,
    triggerDownload,
    exportTraceBundleCurrentTask,
    exportAuditSnapshotCurrentTask,
    loadCurrentTask,
  };
}
