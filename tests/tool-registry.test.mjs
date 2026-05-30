import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolRegistry } from '../apps/platform/src/tool-registry.mjs';
import { createRestrictedExecutionEnvironment } from '../apps/platform/src/restricted-exec.mjs';

test('tool registry retries idempotent low-risk tools on transient failure', async () => {
  const registry = createToolRegistry();
  let attempts = 0;

  registry.register({
    tool_name: 'retryable_tool',
    permissions: ['read_docs'],
    input_schema: { type: 'object', required: ['query'] },
    output_schema: { type: 'object' },
    risk_level: 'low',
    timeout_ms: 100,
    retry_policy: {
      max_attempts: 2,
      retry_on: ['error', 'timeout'],
    },
    idempotent: true,
    side_effect_scope: 'none',
    requires_approval: false,
  }, async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error('transient failure');
    }

    return {
      status: 'success',
      summary: 'Recovered after retry',
      result: { ok: true },
      evidence: [],
      metrics: { latency_ms: 5 },
    };
  });

  const result = await registry.invoke({
    call_id: 'call_retry_1',
    tool_name: 'retryable_tool',
    trace_id: 'trace_retry_1',
    caller: { task_id: 'task_retry_1', persona_id: 'researcher' },
    arguments: { query: 'hello' },
  });

  assert.equal(result.status, 'success');
  assert.equal(attempts, 2);
  assert.equal(result.metrics.attempt_count, 2);
  assert.equal(result.metrics.retry_count, 1);
});

test('tool registry caches successful idempotent calls', async () => {
  const registry = createToolRegistry();
  let attempts = 0;

  registry.register({
    tool_name: 'cached_tool',
    permissions: ['read_docs'],
    input_schema: { type: 'object', required: ['query'] },
    output_schema: { type: 'object' },
    risk_level: 'low',
    timeout_ms: 100,
    retry_policy: { max_attempts: 2, retry_on: ['error', 'timeout'] },
    idempotent: true,
    side_effect_scope: 'none',
    requires_approval: false,
  }, async () => {
    attempts += 1;
    return {
      status: 'success',
      summary: 'Fresh result',
      result: { attempts },
      evidence: [],
      metrics: { latency_ms: 1 },
    };
  });

  const first = await registry.invoke({
    call_id: 'call_cache_1',
    tool_name: 'cached_tool',
    trace_id: 'trace_cache_1',
    caller: { task_id: 'task_cache_1', persona_id: 'researcher' },
    arguments: { query: 'hello' },
  });
  const second = await registry.invoke({
    call_id: 'call_cache_1',
    tool_name: 'cached_tool',
    trace_id: 'trace_cache_1',
    caller: { task_id: 'task_cache_1', persona_id: 'researcher' },
    arguments: { query: 'hello' },
  });

  assert.equal(attempts, 1);
  assert.equal(first.result.attempts, 1);
  assert.equal(second.result.attempts, 1);
  assert.equal(second.metrics.cache_hit, true);
});

test('tool registry does not auto-retry high-risk tools by default', async () => {
  const registry = createToolRegistry();
  let attempts = 0;

  registry.register({
    tool_name: 'high_risk_tool',
    permissions: ['write_state'],
    input_schema: { type: 'object', required: ['value'] },
    output_schema: { type: 'object' },
    risk_level: 'high',
    timeout_ms: 100,
    idempotent: true,
    side_effect_scope: 'external_state',
    requires_approval: false,
  }, async () => {
    attempts += 1;
    throw new Error('permanent failure');
  });

  const result = await registry.invoke({
    call_id: 'call_high_1',
    tool_name: 'high_risk_tool',
    trace_id: 'trace_high_1',
    caller: { task_id: 'task_high_1', persona_id: 'operator' },
    arguments: { value: 'x' },
  });

  assert.equal(result.status, 'error');
  assert.equal(attempts, 1);
  assert.equal(result.metrics.attempt_count, 1);
  assert.equal(result.metrics.retry_count, 0);
});

test('tool registry respects approval-gated execution environments', async () => {
  const registry = createToolRegistry({
    executionEnvironment: createRestrictedExecutionEnvironment({ enforceApproval: true }),
  });
  let attempts = 0;

  registry.register({
    tool_name: 'gated_tool',
    permissions: ['write_state'],
    input_schema: { type: 'object', required: ['value'] },
    output_schema: { type: 'object' },
    risk_level: 'high',
    timeout_ms: 100,
    idempotent: true,
    side_effect_scope: 'external_state',
    requires_approval: true,
  }, async () => {
    attempts += 1;
    return {
      status: 'success',
      summary: 'Should not execute',
      result: { ok: true },
      evidence: [],
      metrics: { latency_ms: 1 },
    };
  });

  const result = await registry.invoke({
    call_id: 'call_gated_1',
    tool_name: 'gated_tool',
    trace_id: 'trace_gated_1',
    caller: { task_id: 'task_gated_1', persona_id: 'operator' },
    arguments: { value: 'x' },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'approval_required');
  assert.equal(attempts, 0);
  assert.equal(result.metrics.restricted, true);
  assert.equal(result.metrics.blocked, true);
  assert.equal(result.metrics.execution_environment, 'restricted');
});

test('tool registry blocks disallowed tools from persona access policy', async () => {
  const registry = createToolRegistry();
  let attempts = 0;

  registry.register({
    tool_name: 'blocked_tool',
    permissions: ['read_docs'],
    input_schema: { type: 'object', required: ['query'] },
    output_schema: { type: 'object' },
    risk_level: 'low',
    timeout_ms: 100,
    idempotent: true,
    side_effect_scope: 'none',
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

  const result = await registry.invoke({
    call_id: 'call_blocked_tool_1',
    tool_name: 'blocked_tool',
    trace_id: 'trace_blocked_tool_1',
    caller: { task_id: 'task_blocked_tool_1', persona_id: 'reviewer' },
    access_policy: {
      toolset_id: 'review_toolset',
      allowed_permissions: ['read_docs'],
      allow_side_effects: false,
      allow_unlisted_tools: true,
      disallowed_tools: ['blocked_tool'],
    },
    arguments: { query: 'hello' },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'tool_disallowed');
  assert.equal(attempts, 0);
  assert.equal(result.metrics.blocked, true);
  assert.equal(result.metrics.access_policy_applied, true);
});

test('tool registry blocks tools whose permissions exceed persona access policy', async () => {
  const registry = createToolRegistry();
  let attempts = 0;

  registry.register({
    tool_name: 'write_tool',
    permissions: ['write_state'],
    input_schema: { type: 'object', required: ['value'] },
    output_schema: { type: 'object' },
    risk_level: 'medium',
    timeout_ms: 100,
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

  const result = await registry.invoke({
    call_id: 'call_write_tool_1',
    tool_name: 'write_tool',
    trace_id: 'trace_write_tool_1',
    caller: { task_id: 'task_write_tool_1', persona_id: 'researcher' },
    access_policy: {
      toolset_id: 'analysis_toolset',
      allowed_permissions: ['read_docs', 'read_wiki'],
      allow_side_effects: false,
      allow_unlisted_tools: true,
      disallowed_tools: [],
    },
    arguments: { value: 'x' },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'permission_denied');
  assert.equal(attempts, 0);
  assert.deepEqual(result.metrics.missing_permissions, ['write_state']);
  assert.equal(result.metrics.blocked, true);
});

test('tool registry blocks disabled tools before execution', async () => {
  const registry = createToolRegistry();
  let attempts = 0;

  registry.register({
    tool_name: 'disabled_tool',
    permissions: ['read_docs'],
    input_schema: { type: 'object', required: ['query'] },
    output_schema: { type: 'object' },
    risk_level: 'low',
    timeout_ms: 100,
    idempotent: true,
    side_effect_scope: 'none',
    requires_approval: false,
    enabled: false,
    release_channel: 'stable',
    capabilities: ['retrieval'],
  }, async () => {
    attempts += 1;
    return {
      status: 'success',
      summary: 'Should not execute',
      result: { ok: true },
      evidence: [],
      metrics: { latency_ms: 1 },
    };
  });

  const result = await registry.invoke({
    call_id: 'call_disabled_tool_1',
    tool_name: 'disabled_tool',
    trace_id: 'trace_disabled_tool_1',
    caller: { task_id: 'task_disabled_tool_1', persona_id: 'researcher' },
    access_policy: {
      toolset_id: 'analysis_toolset',
      allowed_permissions: ['read_docs'],
      allow_side_effects: false,
      allow_unlisted_tools: true,
      disallowed_tools: [],
      allowed_release_channels: ['stable'],
      required_capabilities: ['retrieval'],
    },
    arguments: { query: 'hello' },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'tool_disabled');
  assert.equal(attempts, 0);
  assert.equal(result.metrics.blocked, true);
});

test('tool registry blocks tools outside the allowed release channel', async () => {
  const registry = createToolRegistry();
  let attempts = 0;

  registry.register({
    tool_name: 'beta_tool',
    permissions: ['read_docs'],
    input_schema: { type: 'object', required: ['query'] },
    output_schema: { type: 'object' },
    risk_level: 'low',
    timeout_ms: 100,
    idempotent: true,
    side_effect_scope: 'none',
    requires_approval: false,
    enabled: true,
    release_channel: 'beta',
    capabilities: ['retrieval'],
  }, async () => {
    attempts += 1;
    return {
      status: 'success',
      summary: 'Should not execute',
      result: { ok: true },
      evidence: [],
      metrics: { latency_ms: 1 },
    };
  });

  const result = await registry.invoke({
    call_id: 'call_beta_tool_1',
    tool_name: 'beta_tool',
    trace_id: 'trace_beta_tool_1',
    caller: { task_id: 'task_beta_tool_1', persona_id: 'researcher' },
    access_policy: {
      toolset_id: 'analysis_toolset',
      allowed_permissions: ['read_docs'],
      allow_side_effects: false,
      allow_unlisted_tools: true,
      disallowed_tools: [],
      allowed_release_channels: ['stable'],
      required_capabilities: ['retrieval'],
    },
    arguments: { query: 'hello' },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'tool_release_channel_blocked');
  assert.equal(attempts, 0);
  assert.equal(result.metrics.blocked, true);
});

test('tool registry blocks tools that miss required capabilities from the active toolset', async () => {
  const registry = createToolRegistry();
  let attempts = 0;

  registry.register({
    tool_name: 'docs_only_tool',
    permissions: ['read_docs'],
    input_schema: { type: 'object', required: ['query'] },
    output_schema: { type: 'object' },
    risk_level: 'low',
    timeout_ms: 100,
    idempotent: true,
    side_effect_scope: 'none',
    requires_approval: false,
    enabled: true,
    release_channel: 'stable',
    capabilities: ['docs_lookup'],
  }, async () => {
    attempts += 1;
    return {
      status: 'success',
      summary: 'Should not execute',
      result: { ok: true },
      evidence: [],
      metrics: { latency_ms: 1 },
    };
  });

  const result = await registry.invoke({
    call_id: 'call_docs_only_tool_1',
    tool_name: 'docs_only_tool',
    trace_id: 'trace_docs_only_tool_1',
    caller: { task_id: 'task_docs_only_tool_1', persona_id: 'researcher' },
    access_policy: {
      toolset_id: 'analysis_toolset',
      allowed_permissions: ['read_docs'],
      allow_side_effects: false,
      allow_unlisted_tools: true,
      disallowed_tools: [],
      allowed_release_channels: ['stable'],
      required_capabilities: ['retrieval'],
    },
    arguments: { query: 'hello' },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'tool_capability_mismatch');
  assert.equal(attempts, 0);
  assert.equal(result.metrics.blocked, true);
});

test('tool registry does not retry tools blocked by restricted execution policy', async () => {
  const registry = createToolRegistry({
    executionEnvironment: createRestrictedExecutionEnvironment({
      policy: {
        allowNetwork: false,
        filesystemScope: 'read_only',
        allowShell: false,
      },
    }),
  });
  let attempts = 0;

  registry.register({
    tool_name: 'networked_tool',
    permissions: ['read_docs'],
    input_schema: { type: 'object', required: ['query'] },
    output_schema: { type: 'object' },
    risk_level: 'low',
    timeout_ms: 100,
    retry_policy: {
      max_attempts: 3,
      retry_on: ['error', 'timeout'],
    },
    idempotent: true,
    side_effect_scope: 'none',
    requires_approval: false,
    enabled: true,
    release_channel: 'stable',
    capabilities: ['retrieval'],
    execution_constraints: {
      network_access: true,
      filesystem_scope: 'none',
      shell_access: false,
    },
  }, async () => {
    attempts += 1;
    return {
      status: 'success',
      summary: 'Should not execute',
      result: { ok: true },
      evidence: [],
      metrics: { latency_ms: 1 },
    };
  });

  const result = await registry.invoke({
    call_id: 'call_networked_tool_1',
    tool_name: 'networked_tool',
    trace_id: 'trace_networked_tool_1',
    caller: { task_id: 'task_networked_tool_1', persona_id: 'researcher' },
    access_policy: {
      toolset_id: 'analysis_toolset',
      allowed_permissions: ['read_docs'],
      allow_side_effects: false,
      allow_unlisted_tools: true,
      disallowed_tools: [],
      allowed_release_channels: ['stable'],
      required_capabilities: ['retrieval'],
    },
    arguments: { query: 'hello' },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'network_access_blocked');
  assert.equal(attempts, 0);
  assert.equal(result.metrics.attempt_count, 1);
  assert.equal(result.metrics.retry_count, 0);
  assert.equal(result.metrics.blocked_by_policy, true);
  assert.equal(result.metrics.execution_constraints.network_access, true);
});

test('tool registry does not retry tools blocked by restricted filesystem path policy', async () => {
  const registry = createToolRegistry({
    executionEnvironment: createRestrictedExecutionEnvironment({
      policy: {
        allowNetwork: false,
        filesystemScope: 'workspace_write',
        allowShell: false,
        allowedPaths: ['/workspace/docs'],
      },
    }),
  });
  let attempts = 0;

  registry.register({
    tool_name: 'file_reader_tool',
    permissions: ['read_docs'],
    input_schema: { type: 'object', required: ['file_path'] },
    output_schema: { type: 'object' },
    risk_level: 'low',
    timeout_ms: 100,
    retry_policy: {
      max_attempts: 3,
      retry_on: ['error', 'timeout'],
    },
    idempotent: true,
    side_effect_scope: 'none',
    requires_approval: false,
    enabled: true,
    release_channel: 'stable',
    capabilities: ['retrieval'],
    execution_constraints: {
      network_access: false,
      filesystem_scope: 'read_only',
      shell_access: false,
      path_allowlist: ['/workspace/docs'],
    },
  }, async () => {
    attempts += 1;
    return {
      status: 'success',
      summary: 'Should not execute',
      result: { ok: true },
      evidence: [],
      metrics: { latency_ms: 1 },
    };
  });

  const result = await registry.invoke({
    call_id: 'call_file_reader_tool_1',
    tool_name: 'file_reader_tool',
    trace_id: 'trace_file_reader_tool_1',
    caller: { task_id: 'task_file_reader_tool_1', persona_id: 'researcher' },
    access_policy: {
      toolset_id: 'analysis_toolset',
      allowed_permissions: ['read_docs'],
      allow_side_effects: false,
      allow_unlisted_tools: true,
      disallowed_tools: [],
      allowed_release_channels: ['stable'],
      required_capabilities: ['retrieval'],
    },
    arguments: { file_path: '/workspace/private/notes.txt' },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'filesystem_path_blocked');
  assert.equal(attempts, 0);
  assert.equal(result.metrics.attempt_count, 1);
  assert.equal(result.metrics.retry_count, 0);
  assert.equal(result.metrics.blocked_by_policy, true);
  assert.deepEqual(result.metrics.allowed_paths, ['/workspace/docs']);
  assert.deepEqual(result.metrics.blocked_paths, ['/workspace/private/notes.txt']);
});

test('tool registry does not retry tools blocked by restricted network egress policy', async () => {
  const registry = createToolRegistry({
    executionEnvironment: createRestrictedExecutionEnvironment({
      policy: {
        allowNetwork: true,
        filesystemScope: 'none',
        allowShell: false,
        egressAllowlist: {
          hosts: ['api.deepseek.com'],
          providers: ['deepseek'],
        },
      },
    }),
  });
  let attempts = 0;

  registry.register({
    tool_name: 'provider_network_tool',
    permissions: ['read_docs'],
    input_schema: { type: 'object', required: ['provider'] },
    output_schema: { type: 'object' },
    risk_level: 'low',
    timeout_ms: 100,
    retry_policy: {
      max_attempts: 3,
      retry_on: ['error', 'timeout'],
    },
    idempotent: true,
    side_effect_scope: 'none',
    requires_approval: false,
    enabled: true,
    release_channel: 'stable',
    capabilities: ['retrieval'],
    execution_constraints: {
      network_access: true,
      filesystem_scope: 'none',
      shell_access: false,
      egress_allowlist: {
        hosts: ['api.deepseek.com'],
        providers: ['deepseek'],
      },
    },
  }, async () => {
    attempts += 1;
    return {
      status: 'success',
      summary: 'Should not execute',
      result: { ok: true },
      evidence: [],
      metrics: { latency_ms: 1 },
    };
  });

  const result = await registry.invoke({
    call_id: 'call_provider_network_tool_1',
    tool_name: 'provider_network_tool',
    trace_id: 'trace_provider_network_tool_1',
    caller: { task_id: 'task_provider_network_tool_1', persona_id: 'researcher' },
    access_policy: {
      toolset_id: 'analysis_toolset',
      allowed_permissions: ['read_docs'],
      allow_side_effects: false,
      allow_unlisted_tools: true,
      disallowed_tools: [],
      allowed_release_channels: ['stable'],
      required_capabilities: ['retrieval'],
    },
    arguments: {
      provider: 'openai',
      host: 'api.openai.com',
    },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'network_egress_blocked');
  assert.equal(attempts, 0);
  assert.equal(result.metrics.attempt_count, 1);
  assert.equal(result.metrics.retry_count, 0);
  assert.equal(result.metrics.blocked_by_policy, true);
  assert.deepEqual(result.metrics.allowed_hosts, ['api.deepseek.com']);
  assert.deepEqual(result.metrics.allowed_providers, ['deepseek']);
  assert.deepEqual(result.metrics.blocked_hosts, ['api.openai.com']);
  assert.deepEqual(result.metrics.blocked_providers, ['openai']);
});

test('tool registry honors host suffix egress rules and still blocks out-of-scope subdomains without retry', async () => {
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
    tool_name: 'provider_network_suffix_tool',
    permissions: ['read_docs'],
    input_schema: { type: 'object', required: ['host', 'provider'] },
    output_schema: { type: 'object' },
    risk_level: 'low',
    timeout_ms: 100,
    retry_policy: {
      max_attempts: 3,
      retry_on: ['error', 'timeout'],
    },
    idempotent: true,
    side_effect_scope: 'none',
    requires_approval: false,
    enabled: true,
    release_channel: 'stable',
    capabilities: ['retrieval'],
    execution_constraints: {
      network_access: true,
      filesystem_scope: 'none',
      shell_access: false,
      egress_allowlist: {
        hosts: ['*.api.deepseek.com'],
        providers: ['deepseek'],
      },
    },
  }, async () => {
    attempts += 1;
    return {
      status: 'success',
      summary: 'Should not execute',
      result: { ok: true },
      evidence: [],
      metrics: { latency_ms: 1 },
    };
  });

  const result = await registry.invoke({
    call_id: 'call_provider_network_suffix_tool_1',
    tool_name: 'provider_network_suffix_tool',
    trace_id: 'trace_provider_network_suffix_tool_1',
    caller: { task_id: 'task_provider_network_suffix_tool_1', persona_id: 'researcher' },
    access_policy: {
      toolset_id: 'analysis_toolset',
      allowed_permissions: ['read_docs'],
      allow_side_effects: false,
      allow_unlisted_tools: true,
      disallowed_tools: [],
      allowed_release_channels: ['stable'],
      required_capabilities: ['retrieval'],
    },
    arguments: {
      host: 'foo.deepseek.com',
      provider: 'deepseek',
    },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'network_egress_blocked');
  assert.equal(attempts, 0);
  assert.equal(result.metrics.blocked_by_policy, true);
  assert.deepEqual(result.metrics.allowed_hosts, ['*.api.deepseek.com']);
  assert.deepEqual(result.metrics.blocked_hosts, ['foo.deepseek.com']);
});

test('tool registry does not retry tools blocked by provider-host joint bindings', async () => {
  const registry = createToolRegistry({
    executionEnvironment: createRestrictedExecutionEnvironment({
      policy: {
        allowNetwork: true,
        filesystemScope: 'none',
        allowShell: false,
        egressAllowlist: {
          hosts: ['*.deepseek.com'],
          providers: ['deepseek'],
          providerHostBindings: [
            {
              provider: 'deepseek',
              hosts: ['api.deepseek.com'],
            },
          ],
        },
      },
    }),
  });
  let attempts = 0;

  registry.register({
    tool_name: 'provider_host_joint_tool',
    permissions: ['read_docs'],
    input_schema: { type: 'object', required: ['host', 'provider'] },
    output_schema: { type: 'object' },
    risk_level: 'low',
    timeout_ms: 100,
    retry_policy: {
      max_attempts: 3,
      retry_on: ['error', 'timeout'],
    },
    idempotent: true,
    side_effect_scope: 'none',
    requires_approval: false,
    enabled: true,
    release_channel: 'stable',
    capabilities: ['retrieval'],
    execution_constraints: {
      network_access: true,
      filesystem_scope: 'none',
      shell_access: false,
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
  }, async () => {
    attempts += 1;
    return {
      status: 'success',
      summary: 'Should not execute',
      result: { ok: true },
      evidence: [],
      metrics: { latency_ms: 1 },
    };
  });

  const result = await registry.invoke({
    call_id: 'call_provider_host_joint_tool_1',
    tool_name: 'provider_host_joint_tool',
    trace_id: 'trace_provider_host_joint_tool_1',
    caller: { task_id: 'task_provider_host_joint_tool_1', persona_id: 'researcher' },
    access_policy: {
      toolset_id: 'analysis_toolset',
      allowed_permissions: ['read_docs'],
      allow_side_effects: false,
      allow_unlisted_tools: true,
      disallowed_tools: [],
      allowed_release_channels: ['stable'],
      required_capabilities: ['retrieval'],
    },
    arguments: {
      provider: 'deepseek',
      host: 'foo.deepseek.com',
    },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'network_egress_blocked');
  assert.equal(attempts, 0);
  assert.equal(result.metrics.blocked_by_policy, true);
  assert.deepEqual(result.metrics.blocked_provider_host_pairs, [
    { provider: 'deepseek', host: 'foo.deepseek.com' },
  ]);
  assert.deepEqual(result.metrics.allowed_provider_host_bindings, [
    { provider: 'deepseek', hosts: ['api.deepseek.com'] },
  ]);
});

test('tool registry narrows network egress by runtime access policy before tool constraints', async () => {
  const registry = createToolRegistry({
    executionEnvironment: createRestrictedExecutionEnvironment({
      policy: {
        allowNetwork: true,
        filesystemScope: 'none',
        allowShell: false,
        egressAllowlist: {
          hosts: ['*.deepseek.com'],
          providers: ['deepseek'],
          providerHostBindings: [
            {
              provider: 'deepseek',
              hosts: ['*.deepseek.com'],
            },
          ],
        },
      },
    }),
  });
  let attempts = 0;

  registry.register({
    tool_name: 'dynamic_slice_network_tool',
    permissions: ['read_docs'],
    input_schema: { type: 'object', required: ['host', 'provider'] },
    output_schema: { type: 'object' },
    risk_level: 'low',
    timeout_ms: 100,
    retry_policy: {
      max_attempts: 3,
      retry_on: ['error', 'timeout'],
    },
    idempotent: true,
    side_effect_scope: 'none',
    requires_approval: false,
    enabled: true,
    release_channel: 'stable',
    capabilities: ['retrieval'],
    execution_constraints: {
      network_access: true,
      filesystem_scope: 'none',
      shell_access: false,
      egress_allowlist: {
        hosts: ['*.deepseek.com'],
        providers: ['deepseek'],
        provider_host_bindings: [
          {
            provider: 'deepseek',
            hosts: ['*.deepseek.com'],
          },
        ],
      },
    },
  }, async () => {
    attempts += 1;
    return {
      status: 'success',
      summary: 'Should not execute',
      result: { ok: true },
      evidence: [],
      metrics: { latency_ms: 1 },
    };
  });

  const result = await registry.invoke({
    call_id: 'call_dynamic_slice_network_tool_1',
    tool_name: 'dynamic_slice_network_tool',
    trace_id: 'trace_dynamic_slice_network_tool_1',
    caller: { task_id: 'task_dynamic_slice_network_tool_1', persona_id: 'researcher' },
    access_policy: {
      toolset_id: 'analysis_toolset',
      allowed_permissions: ['read_docs'],
      allow_side_effects: false,
      allow_unlisted_tools: true,
      disallowed_tools: [],
      allowed_release_channels: ['stable'],
      required_capabilities: ['retrieval'],
      egress_allowlist: {
        hosts: ['api.deepseek.com'],
        providers: ['deepseek'],
        provider_host_bindings: [
          {
            provider: 'deepseek',
            hosts: ['api.deepseek.com'],
          },
        ],
      },
    },
    arguments: {
      provider: 'deepseek',
      host: 'foo.deepseek.com',
    },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'network_egress_blocked');
  assert.equal(attempts, 0);
  assert.equal(result.metrics.blocked_by_policy, true);
  assert.deepEqual(result.metrics.dynamic_allowed_hosts, ['api.deepseek.com']);
  assert.deepEqual(result.metrics.dynamic_allowed_providers, ['deepseek']);
  assert.deepEqual(result.metrics.dynamic_allowed_provider_host_bindings, [
    { provider: 'deepseek', hosts: ['api.deepseek.com'] },
  ]);
  assert.deepEqual(result.metrics.allowed_hosts, ['api.deepseek.com']);
  assert.deepEqual(result.metrics.blocked_hosts, ['foo.deepseek.com']);
  assert.deepEqual(result.metrics.blocked_provider_host_pairs, [
    { provider: 'deepseek', host: 'foo.deepseek.com' },
  ]);
});
