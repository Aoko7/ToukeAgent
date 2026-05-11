const output = document.getElementById('stream-output');
const eventLog = document.getElementById('event-log');
const streamState = document.getElementById('stream-state');
const taskIdInput = document.getElementById('task-id');
const form = document.getElementById('message-form');
const connectButton = document.getElementById('connect');
const disconnectButton = document.getElementById('disconnect');

let source = null;

function appendLine(text) {
  output.textContent += `${text}\n`;
  output.scrollTop = output.scrollHeight;
}

function addEventCard(kind, payload) {
  const card = document.createElement('div');
  card.className = 'event';
  card.innerHTML = `<span class="tag">${kind}</span><pre>${JSON.stringify(payload, null, 2)}</pre>`;
  eventLog.prepend(card);
}

function connect() {
  disconnect();
  const taskId = taskIdInput.value.trim();
  if (!taskId) return;
  source = new EventSource(`/api/stream?task_id=${encodeURIComponent(taskId)}`);
  streamState.textContent = 'connecting...';

  const wire = (type) => {
    source.addEventListener(type, (event) => {
      const payload = JSON.parse(event.data);
      addEventCard(type, payload);
      appendLine(`${type}: ${payload.payload?.message ?? payload.payload?.text ?? payload.payload?.state ?? ''}`.trim());
    });
  };

  ['start', 'delta', 'tool_call', 'tool_result', 'status', 'error', 'done', 'cancel', 'heartbeat'].forEach(wire);

  source.onopen = () => {
    streamState.textContent = 'connected';
  };

  source.onerror = () => {
    streamState.textContent = 'error / reconnecting';
  };
}

function disconnect() {
  if (source) {
    source.close();
    source = null;
  }
  streamState.textContent = 'disconnected';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const task_id = data.get('trace_id');
  taskIdInput.value = task_id;
  const payload = {
    message_id: `msg_${crypto.randomUUID()}`,
    source_platform: 'web',
    source_message_id: `raw_${crypto.randomUUID()}`,
    workspace_id: data.get('workspace_id'),
    channel_id: 'console',
    conversation_id: 'conv_demo',
    thread_id: 'thread_demo',
    sender: { id: 'user_1', role: 'user', display_name: 'User' },
    recipient: { id: 'agent_main', role: 'agent', display_name: 'ToukeAgent' },
    created_at: new Date().toISOString(),
    content: [{ type: 'text', text: data.get('content') }],
    attachments: [],
    quoted_messages: [],
    intent_tags: ['planning'],
    risk_flags: [],
    persona_hint: data.get('persona_hint'),
    trace_id: task_id,
    metadata: { platform_capabilities: ['stream'] },
  };
  const response = await fetch('/api/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await response.json();
  addEventCard('message_accepted', json);
  connect();
});

connectButton.addEventListener('click', connect);
disconnectButton.addEventListener('click', disconnect);

connect();
