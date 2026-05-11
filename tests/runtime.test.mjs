import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamStore } from '../apps/platform/src/stream-store.mjs';
import { createToolRegistry } from '../apps/platform/src/tool-registry.mjs';
import { runAgentTask } from '../apps/platform/src/runtime.mjs';

test('runtime marks tool step as failed when tool execution fails', async () => {
  const streamStore = createStreamStore();
  const registry = createToolRegistry();
  registry.register({
    tool_name: 'unstable_tool',
    permissions: ['read_docs'],
    input_schema: { type: 'object', required: ['query'] },
    output_schema: { type: 'object' },
    risk_level: 'low',
    timeout_ms: 50,
    retry_policy: { max_attempts: 1, retry_on: ['error', 'timeout'] },
    idempotent: true,
    side_effect_scope: 'none',
    requires_approval: false,
  }, async () => {
    throw new Error('tool crashed');
  });

  const plan = {
    plan_id: 'plan_runtime_1',
    goal: 'Check failure handling',
    summary: 'Check failure handling',
    steps: [
      {
        step_id: 'step_1',
        title: 'Run unstable tool',
        objective: 'Exercise failure path',
        kind: 'tool',
        tool_name: 'unstable_tool',
        status: 'pending',
      },
      {
        step_id: 'step_2',
        title: 'Respond',
        objective: 'Finish task',
        kind: 'respond',
        status: 'pending',
      },
    ],
  };

  const result = await runAgentTask({
    message: {
      message_id: 'msg_runtime_1',
      trace_id: 'trace_runtime_1',
      content: [{ type: 'text', text: 'hello' }],
    },
    persona: {
      persona_id: 'researcher',
      name: 'Researcher',
    },
    plan,
    toolRegistry: registry,
    store: streamStore,
    responseComposer: {
      async compose() {
        return 'fallback response';
      },
    },
  });

  const toolStep = result.runState.step_results.find((item) => item.step_id === 'step_1');
  assert.equal(toolStep.status, 'failed');
  assert.equal(toolStep.error.code, 'tool_execution_error');
  assert.equal(result.runState.status, 'completed');
  assert.equal(result.runState.output.final_text, 'fallback response');
});
