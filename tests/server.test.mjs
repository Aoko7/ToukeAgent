import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSseEvent, processInboundMessage } from '../apps/platform/server.mjs';
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
  assert.equal(replay.length, 10);
  assert.equal(replay[0].event_type, 'start');
  assert.equal(replay.at(-1).event_type, 'done');
  assert.equal(replay[2].event_type, 'delta');
  assert.equal(replay[5].event_type, 'tool_call');
  assert.match(sseText, /event: start/);
  assert.match(sseText, /event: done/);
  assert.match(sseText, /trace_test/);
  assert.match(sseText, /Plan ready/);
});
