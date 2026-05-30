export function createQueueInspectorController({
  state,
  taskIdInput,
  queueOps,
  queueTaskFilter,
  queueTraceFilter,
  queueWorkerFilter,
  queueStatusFilter,
  queueSelectedId,
  queueSummaryChips,
  queueJobList,
  queueDetailOutput,
  taskStatus,
  clearNode,
  createChip,
  formatTimestamp,
  fetchJson,
  loadInspector,
  renderInspectorTabs,
  renderTextDetail,
  setStatus,
  normalizeTaskId,
  syncSelectOptions,
  controls = {},
} = {}) {
  let eventsBound = false;

  const {
    queueRefreshButton,
    queueRequeueStaleButton,
    inspectQueueDeadLettersButton,
    inspectQueueRecoveryButton,
    inspectQueueGovernanceButton,
    queueClearFiltersButton,
  } = controls;

  function buildQueueQueryParams(taskId = state.taskId) {
    const params = new URLSearchParams();
    const taskFilter = queueTaskFilter?.value?.trim();
    const traceFilter = queueTraceFilter?.value?.trim();
    const workerFilter = queueWorkerFilter?.value?.trim();
    const statusFilter = queueStatusFilter?.value?.trim();

    if (taskFilter) {
      params.set('task_id', taskFilter);
    } else if (!state.queueFilterPrimed && taskId) {
      params.set('task_id', taskId);
    }
    if (traceFilter) {
      params.set('trace_id', traceFilter);
    }
    if (workerFilter) {
      params.set('worker_id', workerFilter);
    }
    if (statusFilter && statusFilter !== 'all') {
      params.set('status', statusFilter);
    }

    return params;
  }

  function buildQueueEndpoint(taskId = state.taskId) {
    const params = buildQueueQueryParams(taskId);
    return `/api/worker-queue${params.toString() ? `?${params.toString()}` : ''}`;
  }

  function getSelectedQueueJob(payload = state.currentInspector) {
    const queue = payload?.queue ?? null;
    const jobs = Array.isArray(queue?.filtered_jobs)
      ? queue.filtered_jobs
      : Array.isArray(queue?.jobs)
        ? queue.jobs
        : [];
    return jobs.find((job) => job.job_id === state.queueSelectedJobId) ?? jobs[0] ?? null;
  }

  function normalizeQueueInspectorPayload(payload) {
    const queue = payload?.queue ?? null;
    return {
      task_id: payload?.task_id ?? queue?.filters?.task_id ?? null,
      filters: queue?.filters ?? payload?.filters ?? {},
      queue,
      jobs: Array.isArray(queue?.jobs) ? queue.jobs : [],
      filtered_jobs: Array.isArray(queue?.filtered_jobs)
        ? queue.filtered_jobs
        : Array.isArray(queue?.jobs)
          ? queue.jobs
          : [],
    };
  }

  function buildQueueInspectorSummary(payload) {
    const queue = payload?.queue ?? {};
    const filters = queue?.filters ?? {};
    return [
      `queued:${queue?.queued ?? 0}`,
      `running:${queue?.running ?? 0}`,
      `filtered:${queue?.filtered_total ?? queue?.filtered_jobs?.length ?? 0}`,
      `stale:${queue?.stale_count ?? 0}`,
      `scope:${filters.task_id ?? 'all'}`,
    ];
  }

  async function loadQueueInspectorData(taskId = state.taskId) {
    const payload = await fetchJson(buildQueueEndpoint(taskId));
    return normalizeQueueInspectorPayload(payload);
  }

  function clearQueueInspector() {
    clearNode(queueSummaryChips);
    clearNode(queueJobList);
    if (queueDetailOutput) {
      queueDetailOutput.textContent = '';
    }
    if (queueSelectedId) {
      queueSelectedId.value = '';
    }
  }

  function setQueueInspectorVisibility(showQueue) {
    if (queueOps) {
      queueOps.hidden = !showQueue;
    }
  }

  function renderQueueInspectorPanel(showQueue, payload) {
    setQueueInspectorVisibility(showQueue);
    if (showQueue) {
      renderQueueInspector(payload);
      return;
    }
    clearQueueInspector();
  }

  function renderQueueInspector(payload) {
    const queue = payload?.queue ?? {};
    const jobs = Array.isArray(queue?.jobs) ? queue.jobs : [];
    const filteredJobs = Array.isArray(queue?.filtered_jobs) ? queue.filtered_jobs : jobs;
    const filters = queue?.filters ?? {};
    const selectedJob = getSelectedQueueJob(payload);
    const nowMs = Date.now();
    const staleJobs = jobs.filter((job) => (
      job.status === 'running'
      && job.lease_expires_at
      && !Number.isNaN(Date.parse(job.lease_expires_at))
      && Date.parse(job.lease_expires_at) <= nowMs
    ));

    state.queueSelectedJobId = selectedJob?.job_id ?? null;
    state.queueFilterPrimed = true;

    if (queueTaskFilter) {
      queueTaskFilter.value = filters.task_id ?? '';
    }
    if (queueTraceFilter) {
      queueTraceFilter.value = filters.trace_id ?? '';
    }
    if (queueWorkerFilter) {
      queueWorkerFilter.value = filters.worker_id ?? '';
    }
    syncSelectOptions(queueStatusFilter, jobs.map((job) => job.status), {
      baseValue: 'all',
      baseLabel: 'all',
    });
    if (queueStatusFilter) {
      queueStatusFilter.value = filters.status ?? 'all';
    }
    if (queueSelectedId) {
      queueSelectedId.value = state.queueSelectedJobId ?? '';
    }

    clearNode(queueSummaryChips);
    const linkedContext = selectedJob?.linked_context ?? null;
    for (const item of [
      `queued:${queue.queued ?? 0}`,
      `running:${queue.running ?? 0}`,
      `completed:${queue.completed ?? 0}`,
      `failed:${queue.failed ?? 0}`,
      `filtered:${filteredJobs.length}`,
      `stale:${queue.stale_count ?? staleJobs.length}`,
      `scope:${filters.task_id ?? 'all'}`,
      `dlq:${linkedContext?.dead_letters?.count ?? 0}`,
      `drills:${linkedContext?.recovery_drills?.count ?? 0}`,
      `alerts:${linkedContext?.alerts?.open_count ?? 0}`,
    ]) {
      queueSummaryChips.appendChild(createChip(item, item.startsWith('alerts:') && (linkedContext?.alerts?.open_count ?? 0) > 0 ? 'warn' : null));
    }

    clearNode(queueJobList);
    if (filteredJobs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No queue jobs match the current filters';
      queueJobList.appendChild(empty);
    } else {
      for (const job of filteredJobs) {
        const row = document.createElement('div');
        row.className = 'list-item';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-task-link';
        button.dataset.active = String(job.job_id === state.queueSelectedJobId);
        button.textContent = `${job.job_id} · ${job.status ?? 'queued'} · ${job.job_type ?? 'unknown'}`;
        button.addEventListener('click', () => {
          state.queueSelectedJobId = job.job_id;
          if (queueSelectedId) {
            queueSelectedId.value = job.job_id;
          }
          renderQueueInspector(payload);
        });

        const meta = document.createElement('div');
        meta.className = 'tiny muted';
        meta.textContent = [
          `task:${job.task_id ?? 'n/a'}`,
          `trace:${job.trace_id ?? 'n/a'}`,
          `worker:${job.worker_id ?? 'n/a'}`,
          `attempts:${job.attempts ?? 0}`,
          `queued:${formatTimestamp(job.queued_at)}`,
        ].join(' · ');

        row.append(button, meta);
        queueJobList.appendChild(row);
      }
    }

    renderTextDetail(queueDetailOutput, JSON.stringify({
      selected_job: selectedJob,
      filters,
      queue_snapshot: queue,
      filtered_jobs: filteredJobs,
      stale_jobs: staleJobs,
    }, null, 2));
  }

  async function inspectSelectedQueueTask(view) {
    const selectedJob = getSelectedQueueJob();
    const taskId = selectedJob?.task_id ?? normalizeTaskId();
    if (!taskId) {
      setStatus(taskStatus, 'select a queue job with task context first', 'warn');
      return;
    }

    state.taskId = taskId;
    taskIdInput.value = taskId;
    if (view === 'deadLetters') {
      state.deadLetterSelectedId = selectedJob?.linked_context?.dead_letters?.latest?.dead_letter_id ?? null;
    }
    if (view === 'recovery') {
      state.recoverySelectedId = selectedJob?.linked_context?.recovery_drills?.latest?.drill_id ?? null;
    }
    state.activeInspector = view;
    renderInspectorTabs();
    await loadInspector(view, taskId);
  }

  async function requeueStaleJobs() {
    try {
      await fetchJson('/api/worker-queue/requeue-stale', { method: 'POST' });
      await loadInspector('queue');
    } catch {
      /* ignore queue refresh failures */
    }
  }

  function clearQueueFilters() {
    if (queueTaskFilter) {
      queueTaskFilter.value = '';
    }
    if (queueTraceFilter) {
      queueTraceFilter.value = '';
    }
    if (queueWorkerFilter) {
      queueWorkerFilter.value = '';
    }
    if (queueStatusFilter) {
      queueStatusFilter.value = 'all';
    }
    state.queueSelectedJobId = null;
    if (state.activeInspector === 'queue') {
      void loadInspector('queue');
    }
  }

  function bindQueueInspectorEvents() {
    if (eventsBound) {
      return;
    }
    eventsBound = true;

    queueRefreshButton?.addEventListener('click', () => void loadInspector('queue'));
    queueRequeueStaleButton?.addEventListener('click', () => void requeueStaleJobs());
    inspectQueueDeadLettersButton?.addEventListener('click', () => void inspectSelectedQueueTask('deadLetters'));
    inspectQueueRecoveryButton?.addEventListener('click', () => void inspectSelectedQueueTask('recovery'));
    inspectQueueGovernanceButton?.addEventListener('click', () => void inspectSelectedQueueTask('governance'));
    queueClearFiltersButton?.addEventListener('click', clearQueueFilters);
    queueStatusFilter?.addEventListener('change', () => {
      state.queueSelectedJobId = null;
      if (state.activeInspector === 'queue') {
        void loadInspector('queue');
      }
    });
    queueTaskFilter?.addEventListener('change', () => {
      state.queueSelectedJobId = null;
      if (state.activeInspector === 'queue') {
        void loadInspector('queue');
      }
    });
    queueTraceFilter?.addEventListener('change', () => {
      state.queueSelectedJobId = null;
      if (state.activeInspector === 'queue') {
        void loadInspector('queue');
      }
    });
    queueWorkerFilter?.addEventListener('change', () => {
      state.queueSelectedJobId = null;
      if (state.activeInspector === 'queue') {
        void loadInspector('queue');
      }
    });
  }

  return {
    bindQueueInspectorEvents,
    buildQueueQueryParams,
    buildQueueEndpoint,
    getSelectedQueueJob,
    normalizeQueueInspectorPayload,
    buildQueueInspectorSummary,
    loadQueueInspectorData,
    clearQueueInspector,
    setQueueInspectorVisibility,
    renderQueueInspectorPanel,
    renderQueueInspector,
    inspectSelectedQueueTask,
    requeueStaleJobs,
    clearQueueFilters,
  };
}
