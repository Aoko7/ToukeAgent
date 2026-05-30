import test from 'node:test';
import assert from 'node:assert/strict';
import { createRestrictedExecutionEnvironment } from '../apps/platform/src/restricted-exec.mjs';

test('restricted execution blocks approval-gated high-risk tools', async () => {
  const environment = createRestrictedExecutionEnvironment({ enforceApproval: true });
  let handlerCalls = 0;

  const result = await environment.execute({
    definition: {
      tool_name: 'approval_tool',
      risk_level: 'high',
      requires_approval: true,
    },
    request: {
      call_id: 'call_restricted_1',
    },
    handler: async () => {
      handlerCalls += 1;
      return {
        call_id: 'call_restricted_1',
        status: 'success',
      };
    },
    context: {
      approved: false,
    },
  });

  assert.equal(handlerCalls, 0);
  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'approval_required');
  assert.equal(result.metrics.blocked, true);
  assert.equal(result.metrics.restricted, true);
});

test('restricted execution redacts tool outputs before returning', async () => {
  const environment = createRestrictedExecutionEnvironment();

  const result = await environment.execute({
    definition: {
      tool_name: 'secret_tool',
      risk_level: 'low',
      requires_approval: false,
    },
    request: {
      call_id: 'call_restricted_2',
    },
    handler: async () => ({
      call_id: 'call_restricted_2',
      status: 'success',
      summary: 'done',
      result: {
        token: 'sk-1234567890abcdef1234567890abcdef',
        nested: {
          password: 'plain-password',
        },
      },
      evidence: [
        { secret: 'plain-secret' },
      ],
      metrics: {
        latency_ms: 1,
      },
    }),
  });

  assert.equal(result.status, 'success');
  assert.equal(result.result.token, '[REDACTED:api_key]');
  assert.equal(result.result.nested.password, '[REDACTED:credential]');
  assert.equal(result.evidence[0].secret, '[REDACTED:credential]');
  assert.equal(result.metrics.environment, 'restricted');
  assert.equal(result.metrics.restricted, true);
  assert.equal(result.metrics.approved, false);
});

test('restricted execution blocks tools that require network access outside the active sandbox policy', async () => {
  const environment = createRestrictedExecutionEnvironment({
    policy: {
      allowNetwork: false,
      filesystemScope: 'read_only',
      allowShell: false,
    },
  });
  let handlerCalls = 0;

  const result = await environment.execute({
    definition: {
      tool_name: 'network_tool',
      risk_level: 'medium',
      requires_approval: false,
      execution_constraints: {
        network_access: true,
        filesystem_scope: 'none',
        shell_access: false,
      },
    },
    request: {
      call_id: 'call_restricted_3',
    },
    handler: async () => {
      handlerCalls += 1;
      return {
        call_id: 'call_restricted_3',
        status: 'success',
      };
    },
  });

  assert.equal(handlerCalls, 0);
  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'network_access_blocked');
  assert.equal(result.metrics.blocked, true);
  assert.equal(result.metrics.environment_policy.allowNetwork, false);
});

test('restricted execution blocks filesystem paths outside the active allowlist', async () => {
  const environment = createRestrictedExecutionEnvironment({
    policy: {
      allowNetwork: false,
      filesystemScope: 'workspace_write',
      allowShell: false,
      allowedPaths: ['/workspace/docs', '/workspace/config'],
    },
  });
  let handlerCalls = 0;

  const result = await environment.execute({
    definition: {
      tool_name: 'file_tool',
      risk_level: 'low',
      requires_approval: false,
      execution_constraints: {
        network_access: false,
        filesystem_scope: 'read_only',
        shell_access: false,
        path_allowlist: ['/workspace/docs'],
      },
    },
    request: {
      call_id: 'call_restricted_4',
      arguments: {
        file_path: '/workspace/private/secrets.txt',
      },
    },
    handler: async () => {
      handlerCalls += 1;
      return {
        call_id: 'call_restricted_4',
        status: 'success',
      };
    },
  });

  assert.equal(handlerCalls, 0);
  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'filesystem_path_blocked');
  assert.equal(result.metrics.blocked, true);
  assert.deepEqual(result.metrics.requested_paths, ['/workspace/private/secrets.txt']);
  assert.deepEqual(result.metrics.allowed_paths, ['/workspace/docs']);
  assert.deepEqual(result.metrics.blocked_paths, ['/workspace/private/secrets.txt']);
});

test('restricted execution blocks network egress targets outside the active allowlist', async () => {
  const environment = createRestrictedExecutionEnvironment({
    policy: {
      allowNetwork: true,
      filesystemScope: 'none',
      allowShell: false,
      egressAllowlist: {
        hosts: ['api.deepseek.com'],
        providers: ['deepseek'],
      },
    },
  });
  let handlerCalls = 0;

  const result = await environment.execute({
    definition: {
      tool_name: 'networked_provider_tool',
      risk_level: 'medium',
      requires_approval: false,
      execution_constraints: {
        network_access: true,
        filesystem_scope: 'none',
        shell_access: false,
        egress_allowlist: {
          hosts: ['api.deepseek.com'],
          providers: ['deepseek'],
        },
      },
    },
    request: {
      call_id: 'call_restricted_5',
      arguments: {
        host: 'api.openai.com',
        provider: 'openai',
      },
    },
    handler: async () => {
      handlerCalls += 1;
      return {
        call_id: 'call_restricted_5',
        status: 'success',
      };
    },
  });

  assert.equal(handlerCalls, 0);
  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'network_egress_blocked');
  assert.equal(result.metrics.blocked, true);
  assert.deepEqual(result.metrics.requested_hosts, ['api.openai.com']);
  assert.deepEqual(result.metrics.requested_providers, ['openai']);
  assert.deepEqual(result.metrics.blocked_hosts, ['api.openai.com']);
  assert.deepEqual(result.metrics.blocked_providers, ['openai']);
  assert.deepEqual(result.metrics.allowed_hosts, ['api.deepseek.com']);
  assert.deepEqual(result.metrics.allowed_providers, ['deepseek']);
});

test('restricted execution allows host suffix rules and URL-derived hosts inside the active allowlist', async () => {
  const environment = createRestrictedExecutionEnvironment({
    policy: {
      allowNetwork: true,
      filesystemScope: 'none',
      allowShell: false,
      egressAllowlist: {
        hosts: ['*.deepseek.com'],
        providers: ['deepseek'],
      },
    },
  });
  let handlerCalls = 0;

  const result = await environment.execute({
    definition: {
      tool_name: 'networked_suffix_tool',
      risk_level: 'medium',
      requires_approval: false,
      execution_constraints: {
        network_access: true,
        filesystem_scope: 'none',
        shell_access: false,
        egress_allowlist: {
          hosts: ['api.deepseek.com'],
          providers: ['deepseek'],
        },
      },
    },
    request: {
      call_id: 'call_restricted_6',
      arguments: {
        url: 'https://api.deepseek.com/v1/chat/completions',
        provider: 'deepseek',
      },
    },
    handler: async () => {
      handlerCalls += 1;
      return {
        call_id: 'call_restricted_6',
        status: 'success',
        summary: 'ok',
        result: { ok: true },
        evidence: [],
        metrics: { latency_ms: 1 },
      };
    },
  });

  assert.equal(handlerCalls, 1);
  assert.equal(result.status, 'success');
});

test('restricted execution narrows host suffix rules by intersection instead of union', async () => {
  const environment = createRestrictedExecutionEnvironment({
    policy: {
      allowNetwork: true,
      filesystemScope: 'none',
      allowShell: false,
      egressAllowlist: {
        hosts: ['*.deepseek.com'],
        providers: ['deepseek'],
      },
    },
  });
  let handlerCalls = 0;

  const result = await environment.execute({
    definition: {
      tool_name: 'networked_suffix_intersection_tool',
      risk_level: 'medium',
      requires_approval: false,
      execution_constraints: {
        network_access: true,
        filesystem_scope: 'none',
        shell_access: false,
        egress_allowlist: {
          hosts: ['*.api.deepseek.com'],
          providers: ['deepseek'],
        },
      },
    },
    request: {
      call_id: 'call_restricted_7',
      arguments: {
        host: 'foo.deepseek.com',
        provider: 'deepseek',
      },
    },
    handler: async () => {
      handlerCalls += 1;
      return {
        call_id: 'call_restricted_7',
        status: 'success',
      };
    },
  });

  assert.equal(handlerCalls, 0);
  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'network_egress_blocked');
  assert.deepEqual(result.metrics.allowed_hosts, ['*.api.deepseek.com']);
  assert.deepEqual(result.metrics.blocked_hosts, ['foo.deepseek.com']);
});

test('restricted execution blocks provider-host combinations outside the active joint bindings', async () => {
  const environment = createRestrictedExecutionEnvironment({
    policy: {
      allowNetwork: true,
      filesystemScope: 'none',
      allowShell: false,
      egressAllowlist: {
        hosts: ['*.deepseek.com'],
        providers: ['deepseek', 'openai'],
        providerHostBindings: [
          {
            provider: 'deepseek',
            hosts: ['api.deepseek.com'],
          },
          {
            provider: 'openai',
            hosts: ['api.openai.com'],
          },
        ],
      },
    },
  });
  let handlerCalls = 0;

  const result = await environment.execute({
    definition: {
      tool_name: 'joint_network_tool',
      risk_level: 'medium',
      requires_approval: false,
      execution_constraints: {
        network_access: true,
        filesystem_scope: 'none',
        shell_access: false,
        egress_allowlist: {
          hosts: ['*'],
          providers: ['deepseek'],
          provider_host_bindings: [
            {
              provider: 'deepseek',
              hosts: ['api.deepseek.com'],
            },
          ],
        },
      },
    },
    request: {
      call_id: 'call_restricted_8',
      arguments: {
        host: 'foo.deepseek.com',
        provider: 'deepseek',
      },
    },
    handler: async () => {
      handlerCalls += 1;
      return {
        call_id: 'call_restricted_8',
        status: 'success',
      };
    },
  });

  assert.equal(handlerCalls, 0);
  assert.equal(result.status, 'error');
  assert.equal(result.error_code, 'network_egress_blocked');
  assert.deepEqual(result.metrics.blocked_provider_host_pairs, [
    { provider: 'deepseek', host: 'foo.deepseek.com' },
  ]);
  assert.deepEqual(result.metrics.allowed_provider_host_bindings, [
    { provider: 'deepseek', hosts: ['api.deepseek.com'] },
  ]);
});

test('restricted execution narrows provider-host bindings by intersection', async () => {
  const environment = createRestrictedExecutionEnvironment({
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
  });
  let handlerCalls = 0;

  const result = await environment.execute({
    definition: {
      tool_name: 'joint_network_exact_tool',
      risk_level: 'medium',
      requires_approval: false,
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
    },
    request: {
      call_id: 'call_restricted_9',
      arguments: {
        url: 'https://api.deepseek.com/v1/chat/completions',
        provider: 'deepseek',
      },
    },
    handler: async () => {
      handlerCalls += 1;
      return {
        call_id: 'call_restricted_9',
        status: 'success',
        summary: 'ok',
        result: { ok: true },
        evidence: [],
        metrics: { latency_ms: 1 },
      };
    },
  });

  assert.equal(handlerCalls, 1);
  assert.equal(result.status, 'success');
});
