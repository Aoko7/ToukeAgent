import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamStore } from '../apps/platform/src/stream-store.mjs';
import { createToolRegistry, registerDefaultTools } from '../apps/platform/src/tool-registry.mjs';
import { createRestrictedExecutionEnvironment } from '../apps/platform/src/restricted-exec.mjs';
import { resumeAgentTask, runAgentTask } from '../apps/platform/src/runtime.mjs';

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

test('runtime pauses for approval and resumes after approval is granted', async () => {
  const streamStore = createStreamStore();
  const registry = createToolRegistry({
    executionEnvironment: createRestrictedExecutionEnvironment({ enforceApproval: true }),
  });
  registry.register({
    tool_name: 'approval_sensitive_tool',
    permissions: ['write_state'],
    input_schema: { type: 'object', required: ['query'] },
    output_schema: { type: 'object' },
    risk_level: 'high',
    timeout_ms: 50,
    idempotent: false,
    side_effect_scope: 'external_state',
    requires_approval: true,
  }, async () => ({
    status: 'success',
    summary: 'Approved risky action',
    result: { ok: true },
    evidence: [],
    metrics: { latency_ms: 3 },
  }));

  const plan = {
    plan_id: 'plan_runtime_approval',
    goal: 'Perform a risky action',
    summary: 'Perform a risky action',
    steps: [
      {
        step_id: 'step_a',
        title: 'Understand request',
        objective: 'Interpret the request',
        kind: 'reason',
        status: 'pending',
      },
      {
        step_id: 'step_b',
        title: 'Approve risky action',
        objective: 'Obtain approval',
        kind: 'tool',
        tool_name: 'approval_sensitive_tool',
        status: 'pending',
      },
      {
        step_id: 'step_c',
        title: 'Respond',
        objective: 'Finish task',
        kind: 'respond',
        status: 'pending',
      },
    ],
  };

  const paused = await runAgentTask({
    message: {
      message_id: 'msg_runtime_approval_1',
      trace_id: 'trace_runtime_approval_1',
      content: [{ type: 'text', text: 'please run approval sensitive step' }],
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
        return 'final after resume';
      },
    },
  });

  assert.equal(paused.runState.status, 'waiting_approval');
  assert.equal(paused.paused, true);

  const resumed = await resumeAgentTask({
    message: {
      message_id: 'msg_runtime_approval_1',
      trace_id: 'trace_runtime_approval_1',
      content: [{ type: 'text', text: 'please run approval sensitive step' }],
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
        return 'final after resume';
      },
    },
    resumeState: paused.runState,
    approvalContext: {
      approved: true,
      approval_id: 'approval_runtime_1',
      reviewer_id: 'human',
    },
  });

  assert.equal(resumed.runState.status, 'completed');
  assert.equal(resumed.runState.output.final_text, 'final after resume');
  assert.ok(resumed.runState.step_results.some((item) => item.step_id === 'step_b' && item.status === 'completed'));
});

test('runtime records model routing metadata from structured response composers', async () => {
  const streamStore = createStreamStore();
  const registry = createToolRegistry();
  const result = await runAgentTask({
    message: {
      message_id: 'msg_runtime_route_1',
      trace_id: 'trace_runtime_route_1',
      content: [{ type: 'text', text: 'route this response' }],
      metadata: {
        budget_tier: 'low',
      },
    },
    persona: {
      persona_id: 'researcher',
      name: 'Researcher',
    },
    plan: {
      plan_id: 'plan_runtime_route_1',
      goal: 'Route response',
      summary: 'Route response',
      steps: [
        {
          step_id: 'step_route_1',
          title: 'Respond',
          objective: 'Finish task',
          kind: 'respond',
          status: 'pending',
        },
      ],
    },
    toolRegistry: registry,
    store: streamStore,
    responseComposer: {
      async compose() {
        return {
          content: 'routed response',
          model_route: {
            provider: 'deepseek',
            model: 'deepseek-v4-flash',
            profile: 'fast',
            reasoning_effort: 'low',
          },
          fallback: {
            applied: false,
            reason: null,
            strategy: null,
          },
        };
      },
    },
  });

  assert.equal(result.runState.output.final_text, 'routed response');
  assert.equal(result.runState.output.model_route.provider, 'deepseek');
  assert.equal(result.runState.output.model_route.profile, 'fast');
  assert.equal(result.runState.step_results.at(-1).output.model_route.model, 'deepseek-v4-flash');
});

test('runtime can complete through langgraph_mvp mode', async () => {
  const streamStore = createStreamStore();
  const registry = createToolRegistry();
  const composedText = 'graph mode composed response';
  const result = await runAgentTask({
    message: {
      message_id: 'msg_runtime_graph_1',
      trace_id: 'trace_runtime_graph_1',
      content: [{ type: 'text', text: '请告诉我最新版本和价格状态' }],
    },
    persona: {
      persona_id: 'researcher',
      name: 'Researcher',
      purpose: 'Design careful systems',
    },
    plan: {
      plan_id: 'plan_runtime_graph_1',
      goal: 'Answer with graph orchestrator',
      summary: 'Answer with graph orchestrator',
      steps: [
        {
          step_id: 'step_graph_1',
          title: 'Respond',
          objective: 'Finish task',
          kind: 'respond',
          status: 'pending',
        },
      ],
    },
    toolRegistry: registry,
    store: streamStore,
    responseComposer: {
      async compose() {
        return {
          content: composedText,
          model_route: {
            provider: 'deepseek',
            model: 'deepseek-v4-flash',
            profile: 'fast',
            reasoning_effort: 'low',
          },
          fallback: {
            applied: false,
            reason: null,
            strategy: null,
          },
        };
      },
    },
    orchestratorMode: 'langgraph_mvp',
  });

  assert.equal(result.runState.status, 'completed');
  assert.equal(result.runState.output.orchestrator_mode, 'langgraph_mvp');
  assert.equal(result.runState.output.executor_backend, 'compat_graph_runner');
  assert.equal(result.runState.output.final_text, composedText);
  assert.equal(result.runState.output.model_route.provider, 'deepseek');
  assert.ok(result.runState.step_results.some((item) => item.step_id === 'graph_orchestrator'));
});

test('runtime legacy and langgraph_mvp can converge on the same composed output', async () => {
  const composedText = 'shared composed response';

  async function run(orchestratorMode) {
    const streamStore = createStreamStore();
    const registry = createToolRegistry();
    registerDefaultTools(registry);
    return runAgentTask({
      message: {
        message_id: `msg_runtime_compare_${orchestratorMode}`,
        trace_id: `trace_runtime_compare_${orchestratorMode}`,
        content: [{ type: 'text', text: '请告诉我最新版本和价格状态' }],
      },
      persona: {
        persona_id: 'researcher',
        name: 'Researcher',
        purpose: 'Design careful systems',
      },
      plan: {
        plan_id: `plan_runtime_compare_${orchestratorMode}`,
        goal: 'Compare runtime modes',
        summary: 'Compare runtime modes',
        steps: [
          {
            step_id: 'step_compare_1',
            title: 'Route retrieval',
            objective: 'Fetch support',
            kind: 'tool',
            tool_name: 'hybrid_retrieve',
            status: 'pending',
          },
          {
            step_id: 'step_compare_2',
            title: 'Respond',
            objective: 'Finish task',
            kind: 'respond',
            status: 'pending',
          },
        ],
      },
      toolRegistry: registry,
      store: streamStore,
      responseComposer: {
        async compose() {
          return {
            content: composedText,
            model_route: {
              provider: 'deepseek',
              model: 'deepseek-v4-flash',
              profile: 'fast',
              reasoning_effort: 'low',
            },
            fallback: {
              applied: false,
              reason: null,
              strategy: null,
            },
          };
        },
      },
      orchestratorMode,
    });
  }

  const legacy = await run('legacy');
  const graph = await run('langgraph_mvp');

  assert.equal(legacy.runState.output.final_text, composedText);
  assert.equal(graph.runState.output.final_text, composedText);
  assert.equal(legacy.runState.output.model_route.provider, 'deepseek');
  assert.equal(graph.runState.output.model_route.provider, 'deepseek');
});

test('runtime forwards persona tool access policy to tool execution', async () => {
  const streamStore = createStreamStore();
  const registry = createToolRegistry();
  let attempts = 0;

  registry.register({
    tool_name: 'write_blocked_tool',
    permissions: ['write_state'],
    input_schema: { type: 'object', required: ['query'] },
    output_schema: { type: 'object' },
    risk_level: 'medium',
    timeout_ms: 50,
    retry_policy: { max_attempts: 1, retry_on: ['error'] },
    idempotent: false,
    side_effect_scope: 'external_state',
    requires_approval: false,
  }, async () => {
    attempts += 1;
    return {
      status: 'success',
      summary: 'Should never execute',
      result: { ok: true },
      evidence: [],
      metrics: { latency_ms: 1 },
    };
  });

  const result = await runAgentTask({
    message: {
      message_id: 'msg_runtime_tool_access_1',
      trace_id: 'trace_runtime_tool_access_1',
      content: [{ type: 'text', text: 'please run the write tool' }],
    },
    persona: {
      persona_id: 'reviewer',
      name: 'Reviewer',
      tool_access_policy: {
        toolset_id: 'review_toolset',
        allowed_permissions: ['read_docs', 'read_wiki'],
        allow_side_effects: false,
        allow_unlisted_tools: true,
        disallowed_tools: [],
      },
    },
    plan: {
      plan_id: 'plan_runtime_tool_access_1',
      goal: 'Check tool access policy forwarding',
      summary: 'Check tool access policy forwarding',
      steps: [
        {
          step_id: 'step_tool_access_1',
          title: 'Try blocked write tool',
          objective: 'Exercise access policy path',
          kind: 'tool',
          tool_name: 'write_blocked_tool',
          status: 'pending',
        },
        {
          step_id: 'step_tool_access_2',
          title: 'Respond',
          objective: 'Finish task',
          kind: 'respond',
          status: 'pending',
        },
      ],
    },
    toolRegistry: registry,
    store: streamStore,
    responseComposer: {
      async compose() {
        return 'tool access handled';
      },
    },
  });

  const toolStep = result.runState.step_results.find((item) => item.step_id === 'step_tool_access_1');
  const toolResultEvent = result.events.find((event) => event.event_type === 'tool_result' && event.step_id === 'step_tool_access_1');
  assert.equal(attempts, 0);
  assert.equal(toolStep.status, 'failed');
  assert.equal(toolStep.error.code, 'permission_denied');
  assert.equal(toolResultEvent.payload.tool_name, 'write_blocked_tool');
  assert.equal(toolResultEvent.payload.error_code, 'permission_denied');
  assert.equal(toolResultEvent.usage.blocked, true);
  assert.equal(result.runState.output.final_text, 'tool access handled');
});

test('runtime forwards persona egress slice to restricted execution', async () => {
  const streamStore = createStreamStore();
  const registry = createToolRegistry({
    executionEnvironment: createRestrictedExecutionEnvironment({
      policy: {
        allowNetwork: true,
        filesystemScope: 'none',
        allowShell: false,
        egressAllowlist: {
          hosts: ['*.deepseek.com'],
          providers: ['deepseek'],
        },
      },
    }),
  });
  let attempts = 0;

  registry.register({
    tool_name: 'persona_network_tool',
    permissions: ['read_docs'],
    input_schema: { type: 'object', required: ['query', 'host', 'provider'] },
    output_schema: { type: 'object' },
    risk_level: 'low',
    timeout_ms: 50,
    retry_policy: { max_attempts: 1, retry_on: ['error'] },
    idempotent: false,
    side_effect_scope: 'none',
    requires_approval: false,
    execution_constraints: {
      network_access: true,
      filesystem_scope: 'none',
      shell_access: false,
      egress_allowlist: {
        hosts: ['*.deepseek.com'],
        providers: ['deepseek'],
      },
    },
  }, async () => {
    attempts += 1;
    return {
      status: 'success',
      summary: 'Should never execute',
      result: { ok: true },
      evidence: [],
      metrics: { latency_ms: 1 },
    };
  });

  const result = await runAgentTask({
    message: {
      message_id: 'msg_runtime_egress_1',
      trace_id: 'trace_runtime_egress_1',
      content: [{ type: 'text', text: 'please fetch the hosted docs' }],
    },
    persona: {
      persona_id: 'reviewer',
      name: 'Reviewer',
      tool_access_policy: {
        toolset_id: 'review_toolset',
        allowed_permissions: ['read_docs'],
        allow_side_effects: false,
        allow_unlisted_tools: true,
        disallowed_tools: [],
        allowed_release_channels: ['stable'],
        required_capabilities: [],
        egress_allowlist: {
          hosts: ['api.deepseek.com'],
          providers: ['deepseek'],
        },
      },
    },
    plan: {
      plan_id: 'plan_runtime_egress_1',
      goal: 'Check dynamic egress forwarding',
      summary: 'Check dynamic egress forwarding',
      steps: [
        {
          step_id: 'step_egress_1',
          title: 'Try persona-scoped network tool',
          objective: 'Exercise egress policy path',
          kind: 'tool',
          tool_name: 'persona_network_tool',
          arguments: {
            host: 'foo.deepseek.com',
            provider: 'deepseek',
          },
          status: 'pending',
        },
        {
          step_id: 'step_egress_2',
          title: 'Respond',
          objective: 'Finish task',
          kind: 'respond',
          status: 'pending',
        },
      ],
    },
    toolRegistry: registry,
    store: streamStore,
    responseComposer: {
      async compose() {
        return 'dynamic egress handled';
      },
    },
  });

  const toolResultEvent = result.events.find((event) => event.event_type === 'tool_result' && event.step_id === 'step_egress_1');
  assert.equal(attempts, 0);
  assert.equal(toolResultEvent.payload.error_code, 'network_egress_blocked');
  assert.deepEqual(toolResultEvent.usage.dynamic_allowed_hosts, ['api.deepseek.com']);
});
