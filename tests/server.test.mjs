import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSseEvent, processInboundMessage, getTaskSnapshot, getTraceEntries } from '../apps/platform/server.mjs';
import { createStreamStore } from '../apps/platform/src/stream-store.mjs';

test('server pipeline builds plan, run state, and stores stream events', async () => {
  const store = createStreamStore();
  const message = {
    message_id: 'msg_test_1',
    source_platform: 'web',
    source_message_id: 'raw_test_1',
    workspace_id: 'ws_test',
    channel_id: 'console',
    conversation_id: 'conv_test',
    sender: { id: 'user_1', role: 'user' },
    recipient: { id: 'agent_1', role: 'agent' },
    content: [{ type: 'text', text: 'hello world' }],
    trace_id: 'trace_test',
    persona_hint: 'researcher',
  };

  const result = await processInboundMessage(message, store);
  const replay = store.replay('trace_test', 0);
  const sseText = replay.map(formatSseEvent).join('');

  assert.equal(result.task_id, 'trace_test');
  assert.equal(result.persona.persona_id, 'researcher');
  assert.equal(result.plan.steps.length, 3);
  assert.equal(result.run_state.status, 'completed');
  assert.match(result.task_url, /\/api\/tasks\?task_id=/);
  assert.equal(replay[0].event_type, 'start');
  assert.equal(replay.at(-1).event_type, 'done');
  assert.equal(replay[2].event_type, 'delta');
  assert.ok(replay.some((event) => event.event_type === 'tool_call'));
  assert.ok(replay.some((event) => event.event_type === 'tool_result'));
  assert.ok(replay.some((event) => event.event_type === 'status' && event.payload.state === 'worker_queued'));
  assert.ok(replay.some((event) => event.event_type === 'status' && event.payload.state === 'worker_running'));
  assert.ok(replay.some((event) => event.event_type === 'status' && event.payload.state === 'worker_completed'));
  assert.match(sseText, /event: start/);
  assert.match(sseText, /event: done/);
  assert.match(sseText, /trace_test/);
  assert.match(sseText, /Plan ready/);

  const traceEntries = getTraceEntries('trace_test');
  assert.ok(traceEntries.some((entry) => entry.kind === 'message.received'));
  assert.ok(traceEntries.some((entry) => entry.kind === 'plan.created'));
  assert.ok(traceEntries.some((entry) => entry.kind === 'worker.job.queued'));
  assert.ok(traceEntries.some((entry) => entry.kind === 'worker.job.completed'));
  assert.ok(traceEntries.some((entry) => entry.kind === 'run.completed'));

  const task = getTaskSnapshot('trace_test');
  assert.equal(task.task_id, 'trace_test');
  assert.equal(task.status, 'completed');
  assert.equal(task.phase, 'completed');
  assert.equal(task.plan.plan_id, result.plan.plan_id);
  assert.equal(task.total_steps, 3);
  assert.equal(task.completed_steps, 3);
  assert.ok(task.checkpoints.some((entry) => entry.kind === 'plan.created'));
  assert.ok(task.checkpoints.some((entry) => entry.kind === 'run.completed'));
});
