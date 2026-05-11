import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCanonicalMessage,
  createStreamEvent,
  createToolDefinition,
  createToolCallRequest,
  createToolCallResult,
  createPersonaProfile,
  createRouteBinding,
} from '../packages/contracts/src/index.mjs';

test('canonical message normalizes content and defaults', () => {
  const message = createCanonicalMessage({
    message_id: 'msg_1',
    source_platform: 'web',
    source_message_id: 'raw_1',
    workspace_id: 'ws_1',
    channel_id: 'channel_1',
    conversation_id: 'conv_1',
    sender: { id: 'u1', role: 'user' },
    recipient: { id: 'agent', role: 'agent' },
    content: [{ type: 'text', text: 'hello' }],
    trace_id: 'trace_1',
  });

  assert.equal(message.persona_hint, null);
  assert.equal(message.thread_id, null);
  assert.equal(message.metadata.constructor, Object);
  assert.equal(message.content[0].type, 'text');
  assert.equal(message.content[0].text, 'hello');
});

test('stream event infers terminal state and validates payload', () => {
  const event = createStreamEvent({
    event_type: 'done',
    trace_id: 'trace_1',
    task_id: 'task_1',
    payload: { finish_reason: 'completed' },
  });

  assert.equal(event.is_terminal, true);
  assert.equal(event.payload.finish_reason, 'completed');
  assert.match(event.event_id, /^evt_/);
});

test('tool contracts normalize definitions and calls', () => {
  const definition = createToolDefinition({
    tool_name: 'search_docs',
    permissions: ['read_docs'],
    input_schema: {},
    output_schema: {},
  });
  const request = createToolCallRequest({
    call_id: 'call_1',
    tool_name: 'search_docs',
    trace_id: 'trace_1',
    caller: { task_id: 'task_1' },
    arguments: { query: 'hello' },
  });
  const result = createToolCallResult({
    call_id: 'call_1',
    status: 'success',
    summary: 'ok',
  });

  assert.equal(definition.risk_level, 'low');
  assert.equal(request.arguments.query, 'hello');
  assert.equal(result.status, 'success');
});

test('persona and route binding normalize defaults', () => {
  const persona = createPersonaProfile({
    persona_id: 'reviewer',
    name: 'Reviewer',
    boundaries: ['no_hidden_risk'],
  });

  const binding = createRouteBinding({
    binding_id: 'bind_1',
    workspace_id: 'ws_1',
    channel_pattern: 'web/*',
    agent_id: 'agent_1',
    persona_id: 'reviewer',
    model_policy_id: 'policy_1',
    toolset_id: 'toolset_1',
  });

  assert.equal(persona.style.tone, 'neutral');
  assert.equal(binding.status, 'active');
  assert.equal(binding.streaming_enabled, true);
});
