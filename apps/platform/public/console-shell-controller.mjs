export function createConsoleShellController({
  state,
  storageKey,
  personaHidden,
  personaStatus,
  personaSwitcher,
  inspectorTabs,
  recentTaskList,
  taskIdInput,
  clearNode,
  fetchJson,
  defaultPersonaOptions = [],
  inspectorViews = [],
  controls = {},
  actions = {},
} = {}) {
  let eventsBound = false;
  let personaOptions = [...defaultPersonaOptions];

  const {
    messageForm,
    refreshButton,
    reloadInspectorButton,
    exportTraceBundleButton,
    exportAuditSnapshotButton,
    replayButton,
    recoverButton,
    approveButton,
    takeoverButton,
    loadButton,
    disconnectButton,
  } = controls;

  const {
    loadWikiCatalog,
    loadInspector,
    hydrateTask,
    sendMessage,
    recoverCurrentTask,
    approveCurrentTask,
    takeoverCurrentTask,
    reloadCurrentTask,
    exportTraceBundleCurrentTask,
    exportAuditSnapshotCurrentTask,
    replayCurrentTask,
    loadCurrentTask,
    disconnectStream,
    bindWikiInspectorEvents,
    bindHarnessInspectorEvents,
    bindDeliveryInspectorEvents,
    bindQueueInspectorEvents,
    bindDeadLetterInspectorEvents,
    bindRecoveryInspectorEvents,
    normalizeTaskId,
    setTaskStatus,
    setStreamStatus,
    setWikiStatus,
    renderWikiLists,
  } = actions;

  state.recentTasks = loadRecentTasks();

  function loadRecentTasks() {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveRecentTasks() {
    localStorage.setItem(storageKey, JSON.stringify(state.recentTasks.slice(0, 8)));
  }

  function renderPersonaSwitcher() {
    clearNode(personaSwitcher);
    for (const persona of personaOptions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.active = String(persona === state.personaHint);
      button.textContent = persona;
      button.addEventListener('click', () => setPersona(persona));
      personaSwitcher.appendChild(button);
    }
    personaHidden.value = state.personaHint;
    personaStatus.textContent = state.personaHint;
  }

  function setPersona(persona) {
    state.personaHint = persona;
    personaHidden.value = persona;
    renderPersonaSwitcher();
  }

  async function loadPersonaCatalog() {
    try {
      const payload = await fetchJson('/api/personas');
      const items = Array.isArray(payload?.personas) ? payload.personas : [];
      const nextOptions = items
        .map((item) => item?.persona_id)
        .filter(Boolean);
      personaOptions = nextOptions.length > 0 ? nextOptions : [...defaultPersonaOptions];
      state.personaCatalog = payload;
      if (!personaOptions.includes(state.personaHint)) {
        state.personaHint = payload?.default_persona_id && personaOptions.includes(payload.default_persona_id)
          ? payload.default_persona_id
          : personaOptions[0];
      }
    } catch {
      personaOptions = [...defaultPersonaOptions];
      state.personaCatalog = null;
      if (!personaOptions.includes(state.personaHint)) {
        state.personaHint = personaOptions[0];
      }
    }
    renderPersonaSwitcher();
  }

  function renderInspectorTabs() {
    clearNode(inspectorTabs);
    for (const [view, label] of inspectorViews) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.active = String(view === state.activeInspector);
      button.textContent = label;
      button.addEventListener('click', () => {
        state.activeInspector = view;
        renderInspectorTabs();
        if (view === 'wiki') {
          void loadWikiCatalog();
          return;
        }
        void loadInspector(view);
      });
      inspectorTabs.appendChild(button);
    }
  }

  function renderRecentTasks() {
    clearNode(recentTaskList);
    if (state.recentTasks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No recent tasks yet';
      recentTaskList.appendChild(empty);
      return;
    }

    for (const taskId of state.recentTasks) {
      const item = document.createElement('div');
      item.className = 'list-item';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recent-task-link';
      button.textContent = taskId;
      button.addEventListener('click', () => {
        taskIdInput.value = taskId;
        void hydrateTask(taskId, { reconnect: true });
      });

      const note = document.createElement('div');
      note.className = 'tiny muted';
      note.textContent = taskId === state.taskId ? 'active' : 'recent';

      item.append(button, note);
      recentTaskList.appendChild(item);
    }
  }

  function rememberTask(taskId) {
    if (!taskId) {
      return;
    }

    state.recentTasks = [taskId, ...state.recentTasks.filter((item) => item !== taskId)].slice(0, 8);
    saveRecentTasks();
    renderRecentTasks();
  }

  function bindConsoleShellEvents() {
    if (eventsBound) {
      return;
    }
    eventsBound = true;

    messageForm?.addEventListener('submit', (event) => {
      void sendMessage(event);
    });
    refreshButton?.addEventListener('click', () => void reloadCurrentTask(normalizeTaskId));
    reloadInspectorButton?.addEventListener('click', () => {
      if (state.activeInspector === 'wiki') {
        void loadWikiCatalog();
        return;
      }
      void loadInspector(state.activeInspector);
    });
    exportTraceBundleButton?.addEventListener('click', () => void exportTraceBundleCurrentTask(normalizeTaskId));
    exportAuditSnapshotButton?.addEventListener('click', () => void exportAuditSnapshotCurrentTask(normalizeTaskId));
    replayButton?.addEventListener('click', () => void replayCurrentTask(normalizeTaskId));
    recoverButton?.addEventListener('click', () => void recoverCurrentTask());
    approveButton?.addEventListener('click', () => void approveCurrentTask());
    takeoverButton?.addEventListener('click', () => void takeoverCurrentTask());
    loadButton?.addEventListener('click', () => void loadCurrentTask(normalizeTaskId));
    disconnectButton?.addEventListener('click', () => disconnectStream({ manual: true }));
    bindWikiInspectorEvents?.();
    bindHarnessInspectorEvents?.();
    bindDeliveryInspectorEvents?.();
    bindQueueInspectorEvents?.();
    bindDeadLetterInspectorEvents?.();
    bindRecoveryInspectorEvents?.();
  }

  async function bootstrapConsoleShell() {
    state.recentTasks = loadRecentTasks();
    await loadPersonaCatalog();
    renderInspectorTabs();
    renderRecentTasks();
    bindConsoleShellEvents();
    setTaskStatus?.('idle', 'warn');
    setStreamStatus?.('disconnected', 'warn');
    setWikiStatus?.('idle', 'warn');
    renderWikiLists?.();
    void loadWikiCatalog?.({ renderInspector: false }).catch(() => {});
    void hydrateTask?.(state.taskId, { reconnect: true }).catch(() => {});
  }

  return {
    loadRecentTasks,
    saveRecentTasks,
    renderPersonaSwitcher,
    setPersona,
    loadPersonaCatalog,
    renderInspectorTabs,
    renderRecentTasks,
    rememberTask,
    bindConsoleShellEvents,
    bootstrapConsoleShell,
  };
}
