export function createTaskActionsController({
  state,
  workspaceIdInput,
  taskIdInput,
  recoveryModeSelect,
  messageInput,
  sendButton,
  taskStatus,
  fetchJson,
  hydrateTask,
  rememberTask,
  renderInspectorTabs,
  loadInspector,
  setStatus,
  normalizeTaskId,
} = {}) {
  function setTaskStatus(text, tone = 'warn') {
    setStatus(taskStatus, text, tone);
  }

  async function sendMessage(event) {
    event.preventDefault();
    const taskId = normalizeTaskId();
    if (!taskId) {
      return;
    }

    const payload = {
      message_id: `msg_${crypto.randomUUID()}`,
      source_platform: 'web',
      source_message_id: `raw_${crypto.randomUUID()}`,
      workspace_id: workspaceIdInput.value.trim() || 'ws_demo',
      channel_id: 'console',
      conversation_id: 'conv_demo',
      thread_id: 'thread_demo',
      sender: { id: 'user_1', role: 'user', display_name: 'User' },
      recipient: { id: 'agent_main', role: 'agent', display_name: 'ToukeAgent' },
      created_at: new Date().toISOString(),
      content: [{ type: 'text', text: messageInput.value }],
      attachments: [],
      quoted_messages: [],
      intent_tags: ['planning'],
      risk_flags: [],
      persona_hint: state.personaHint,
      trace_id: taskId,
      metadata: { platform_capabilities: ['stream'] },
    };

    sendButton.disabled = true;
    setTaskStatus('sending', 'warn');

    try {
      const result = await fetchJson('/api/messages', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      rememberTask(result.task_id ?? taskId);
      await hydrateTask(result.task_id ?? taskId, { reconnect: true });
      if (result.approval_required) {
        state.activeInspector = 'approval';
        renderInspectorTabs();
        await loadInspector('approval', result.task_id ?? taskId);
      }
    } catch (error) {
      setTaskStatus(error instanceof Error ? error.message : 'send failed', 'bad');
      throw error;
    } finally {
      sendButton.disabled = false;
    }
  }

  async function recoverCurrentTask() {
    const taskId = normalizeTaskId();
    if (!taskId) {
      return;
    }

    const result = await fetchJson('/api/tasks/recover', {
      method: 'POST',
      body: JSON.stringify({
        task_id: taskId,
        mode: recoveryModeSelect.value,
        reviewer_id: 'console_operator',
        notes: 'Triggered from console',
      }),
    });
    state.activeInspector = result.recovery_drill ? 'recovery' : state.activeInspector;
    renderInspectorTabs();
    await hydrateTask(taskId, { reconnect: true });
    if (result.recovery_drill) {
      await loadInspector('recovery', taskId);
    }
  }

  async function approveCurrentTask() {
    const taskId = normalizeTaskId();
    if (!taskId) {
      return;
    }

    const approvals = await fetchJson(`/api/approvals?task_id=${encodeURIComponent(taskId)}`);
    const approval = approvals.items?.[0] ?? null;
    if (!approval) {
      setTaskStatus('no approval item', 'warn');
      return;
    }

    await fetchJson('/api/approvals/resolve', {
      method: 'POST',
      body: JSON.stringify({
        review_id: approval.review_id,
        decision: 'approved',
        reviewer_id: 'console_operator',
        notes: 'Approved from console',
      }),
    });

    await fetchJson('/api/tasks/resume', {
      method: 'POST',
      body: JSON.stringify({
        task_id: taskId,
        reviewer_id: 'console_operator',
        notes: 'Resume from console approval',
        decision: 'approved',
      }),
    });

    await hydrateTask(taskId, { reconnect: true });
    state.activeInspector = 'approval';
    renderInspectorTabs();
    await loadInspector('approval', taskId);
  }

  async function takeoverCurrentTask() {
    const taskId = normalizeTaskId();
    if (!taskId) {
      return;
    }

    await fetchJson('/api/tasks/takeover', {
      method: 'POST',
      body: JSON.stringify({
        task_id: taskId,
        reviewer_id: 'console_operator',
        notes: 'Console takeover',
      }),
    });
    await hydrateTask(taskId, { reconnect: false });
    state.activeInspector = 'task';
    renderInspectorTabs();
    await loadInspector('task', taskId);
  }

  return {
    sendMessage,
    recoverCurrentTask,
    approveCurrentTask,
    takeoverCurrentTask,
  };
}
