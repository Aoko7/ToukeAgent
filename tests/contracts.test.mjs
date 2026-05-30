import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAgentPlan,
  createAgentRunState,
  createCanonicalMessage,
  createStreamEvent,
  createToolDefinition,
  createToolCallRequest,
  createToolCallResult,
  createPersonaProfile,
  createRouteBinding,
  createAgentHandoffPacket,
  createContextCompressionSnapshot,
  createKnowledgeContract,
  createQueryAnalysis,
  createPlatformAdapterProfile,
  createPlatformDeliveryRequest,
  createPlatformDeliveryReceipt,
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
    execution_constraints: {
      network_access: false,
      filesystem_scope: 'read_only',
      shell_access: false,
      path_allowlist: ['/workspace/docs', '/workspace/config'],
      egress_allowlist: {
        hosts: ['*.deepseek.com'],
        providers: ['deepseek'],
        provider_host_bindings: [
          {
            provider: 'deepseek',
            hosts: ['api.deepseek.com'],
          },
        ],
      },
    },
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
  assert.equal(definition.execution_constraints.filesystem_scope, 'read_only');
  assert.deepEqual(definition.execution_constraints.path_allowlist, ['/workspace/docs', '/workspace/config']);
  assert.deepEqual(definition.execution_constraints.egress_allowlist.hosts, ['*.deepseek.com']);
  assert.deepEqual(definition.execution_constraints.egress_allowlist.providers, ['deepseek']);
  assert.deepEqual(definition.execution_constraints.egress_allowlist.provider_host_bindings, [
    {
      provider: 'deepseek',
      hosts: ['api.deepseek.com'],
    },
  ]);
  assert.equal(request.arguments.query, 'hello');
  assert.equal(result.status, 'success');
});

test('agent plan step preserves structured tool arguments', () => {
  const plan = createAgentPlan({
    plan_id: 'plan_args_1',
    task_id: 'task_args_1',
    trace_id: 'trace_args_1',
    persona_id: 'researcher',
    goal: 'Run a network step',
    steps: [
      {
        step_id: 'step_args_1',
        title: 'Fetch docs',
        objective: 'Use structured runtime arguments',
        kind: 'tool',
        tool_name: 'search_docs',
        arguments: {
          host: 'api.deepseek.com',
          provider: 'deepseek',
        },
      },
    ],
  });

  assert.deepEqual(plan.steps[0].arguments, {
    host: 'api.deepseek.com',
    provider: 'deepseek',
  });
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

test('agent plan and run state normalize defaults', () => {
  const plan = createAgentPlan({
    plan_id: 'plan_1',
    task_id: 'task_1',
    trace_id: 'trace_1',
    persona_id: 'researcher',
    goal: 'Build a plan',
    steps: [
      {
        step_id: 'step_1',
        title: 'Understand request',
      },
    ],
  });

  const runState = createAgentRunState({
    run_id: 'run_1',
    task_id: 'task_1',
    trace_id: 'trace_1',
    persona_id: 'researcher',
    total_steps: 1,
  });

  assert.equal(plan.steps[0].status, 'pending');
  assert.equal(runState.status, 'queued');
  assert.equal(runState.total_steps, 1);
});

test('handoff and context compression contracts normalize defaults', () => {
  const handoff = createAgentHandoffPacket({
    handoff_id: 'handoff_1',
    task_id: 'task_1',
    trace_id: 'trace_1',
    parent_agent_id: 'agent_main',
    target_agent_id: 'agent_specialist',
    role: 'reviewer',
    objective: 'Review the draft',
    input_summary: 'Please review the draft',
  });

  const snapshot = createContextCompressionSnapshot({
    snapshot_id: 'ctx_1',
    task_id: 'task_1',
    trace_id: 'trace_1',
    scope: 'task',
    model_name: 'deepseek-chat',
    compression_strategy: 'hybrid',
    source_ranges: ['stream:1-3'],
    token_budget: 1200,
    token_estimate: 450,
    must_keep: ['current step objective'],
    summary: 'Compressed state',
    unresolved_items: [],
    evidence_refs: [],
    memory_refs: [],
  });

  assert.equal(handoff.status, 'created');
  assert.equal(handoff.role, 'reviewer');
  assert.equal(snapshot.scope, 'task');
  assert.equal(snapshot.compression_strategy, 'hybrid');
});

test('knowledge contract and query analysis normalize governance fields', () => {
  const contract = createKnowledgeContract({
    required_context: ['provider_name', 'freshness_scope'],
    retrieval_hints: ['deepseek', 'pricing'],
    owner: 'provider_ops',
    ttl_seconds: 3600,
    version: 'v2',
    source_of_truth: 'provider_wiki',
    contract_source: 'explicit',
  });

  const analysis = createQueryAnalysis({
    query_text: '只看 ACL 2024 的版本状态',
    terms: ['ACL', '2024', '版本'],
    term_count: 3,
    query_mode: 'status_lookup',
    intent_tags: ['dynamic_lookup', 'version_lookup'],
    filter_hints: {
      conference_ids: ['acl'],
      publication_years: [2024],
      explicit_scope: true,
    },
    decomposition: {
      enabled: false,
      strategy: 'single_pass',
      subqueries: [],
    },
    rewrites: {
      enabled: true,
      strategy: 'decompose_then_expand',
      variants: [{ variant_id: 'rewrite_1', text: 'ACL 2024 version status' }],
    },
    clarification: {
      required: false,
      missing_context: [],
      questions: [],
    },
    boundary: {
      action: 'answer',
      reason: 'query is specific enough for direct retrieval',
      explicit_scope_required: true,
    },
  });

  assert.equal(contract.contract_source, 'explicit');
  assert.equal(contract.owner, 'provider_ops');
  assert.equal(analysis.boundary.explicit_scope_required, true);
  assert.equal(analysis.rewrites.variants.length, 1);
  assert.equal(analysis.filter_hints.explicit_scope, true);
});

test('platform delivery contracts normalize adapter, request, and receipt fields', () => {
  const profile = createPlatformAdapterProfile({
    platform_id: 'slack',
    label: 'Slack',
    render_mode: 'blocks',
    callback_supported: true,
    capabilities: {
      supports_blocks: true,
      supports_threads: true,
    },
    transport: {
      mode: 'webhook',
    },
  });

  const request = createPlatformDeliveryRequest({
    delivery_id: 'delivery_1',
    task_id: 'task_1',
    trace_id: 'trace_1',
    source_platform: 'web',
    target_platform: 'slack',
    rendered_payload: {
      text: 'hello',
    },
    status: 'queued',
    callback_state: 'pending',
  });

  const receipt = createPlatformDeliveryReceipt({
    receipt_id: 'receipt_1',
    delivery_id: request.delivery_id,
    task_id: request.task_id,
    trace_id: request.trace_id,
    target_platform: request.target_platform,
    status: 'sent',
    callback_state: 'awaiting_callback',
    provider_reference: 'provider_1',
  });

  assert.equal(profile.label, 'Slack');
  assert.equal(profile.capabilities.supports_blocks, true);
  assert.equal(request.target_platform, 'slack');
  assert.equal(request.callback_state, 'pending');
  assert.equal(receipt.status, 'sent');
  assert.equal(receipt.callback_state, 'awaiting_callback');
});
