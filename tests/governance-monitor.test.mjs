import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlertStore } from '../apps/platform/src/alert-store.mjs';
import { createGovernanceMonitor, summarizeToolGovernance } from '../apps/platform/src/governance-monitor.mjs';

test('governance monitor records SLO and budget alerts', () => {
  const alertStore = createAlertStore();
  const monitor = createGovernanceMonitor({
    alertStore,
    policy: {
      online: {
        max_task_duration_ms: 100,
        max_stream_events: 1,
        max_review_count: 0,
        min_quality_score: 0.8,
      },
      async: {
        max_queue_depth: 1,
        max_active_workers: 1,
      },
      budget: {
        max_tool_calls: 1,
        max_audit_entries: 1,
        max_estimated_cost_units: 1,
      },
    },
  });

  const task = {
    task_id: 'task_governance_1',
    trace_id: 'trace_governance_1',
    created_at: '2026-05-11T10:00:00.000Z',
    updated_at: '2026-05-11T10:00:02.000Z',
  };
  const traceBundle = {
    task_id: 'task_governance_1',
    trace_id: 'trace_governance_1',
    metrics: {
      event_count: 4,
      audit_count: 3,
      tool_call_count: 2,
      review_count: 1,
      quality_score: 0.5,
      quality_decision: 'review',
    },
    stream_events: [
      { timestamp: '2026-05-11T10:00:00.000Z' },
      { timestamp: '2026-05-11T10:00:02.000Z' },
    ],
  };
  const workerSnapshot = {
    queued: 3,
    active: 2,
  };

  const result = monitor.evaluateTask({ task, traceBundle, workerSnapshot });

  assert.equal(result.status, 'breached');
  assert.ok(result.alerts.some((alert) => alert.code === 'task_latency_breach'));
  assert.ok(result.alerts.some((alert) => alert.code === 'stream_budget_breach'));
  assert.ok(result.alerts.some((alert) => alert.code === 'tool_budget_breach'));
  assert.ok(result.alerts.some((alert) => alert.code === 'audit_budget_breach'));
  assert.ok(result.alerts.some((alert) => alert.code === 'review_backlog_breach'));
  assert.ok(result.alerts.some((alert) => alert.code === 'quality_slo_breach'));
  assert.ok(result.alerts.some((alert) => alert.code === 'quality_gate_breach'));
  assert.ok(result.alerts.some((alert) => alert.code === 'cost_budget_breach'));
  assert.ok(result.alerts.some((alert) => alert.code === 'async_queue_backlog'));
  assert.ok(result.alerts.some((alert) => alert.code === 'async_worker_saturation'));
  assert.equal(alertStore.list({ taskId: 'task_governance_1' }).length, 8);
  assert.equal(alertStore.list({ scope: 'system' }).length, 2);
});

test('tool governance summary projects runtime, toolset enforcement, and catalog risk', () => {
  const summary = summarizeToolGovernance({
    task: {
      task_id: 'task_governance_summary_1',
      trace_id: 'trace_governance_summary_1',
      persona_id: 'researcher',
    },
    traceBundle: {
      task_id: 'task_governance_summary_1',
      trace_id: 'trace_governance_summary_1',
      metrics: {
        tool_call_count: 3,
        tool_result_count: 3,
        blocked_tool_result_count: 1,
        blocked_tool_error_codes: {
          tool_release_channel_blocked: 1,
        },
        blocked_tool_names: ['beta_tool'],
        sandbox_blocked_tool_result_count: 1,
        sandbox_blocked_error_codes: {
          filesystem_path_blocked: 1,
        },
        sandbox_blocked_tool_names: ['beta_tool'],
        sandbox_environment_policy: {
          environment_name: 'restricted',
          allowNetwork: false,
          filesystemScope: 'workspace_write',
          allowShell: false,
          allowedPaths: ['/workspace/docs'],
          egressAllowlist: {
            hosts: ['api.deepseek.com'],
            providers: ['deepseek'],
            providerHostBindings: [
              {
                provider: 'deepseek',
                hosts: ['api.deepseek.com'],
              },
            ],
          },
        },
      },
    },
    alerts: [
      {
        code: 'quality_gate_breach',
        category: 'slo',
        severity: 'high',
        status: 'open',
      },
    ],
    persona: {
      persona_id: 'researcher',
      name: 'Researcher',
      metadata: {
        default_toolset_id: 'analysis_toolset',
      },
      tool_access_policy: {
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
    },
    toolsets: [
      {
        toolset_id: 'analysis_toolset',
        label: 'Analysis Toolset',
        allowed_permissions: ['read_docs'],
        required_capabilities: ['retrieval'],
        allowed_release_channels: ['stable'],
        allow_side_effects: false,
      },
    ],
    toolDefinitions: [
      {
        tool_name: 'search_docs',
        permissions: ['read_docs'],
        side_effect_scope: 'none',
        enabled: true,
        release_channel: 'stable',
        capabilities: ['retrieval'],
        risk_level: 'low',
        requires_approval: false,
      },
      {
        tool_name: 'beta_tool',
        permissions: ['read_docs'],
        side_effect_scope: 'none',
        enabled: true,
        release_channel: 'beta',
        capabilities: ['retrieval'],
        risk_level: 'low',
        requires_approval: false,
      },
      {
        tool_name: 'disabled_tool',
        permissions: ['read_docs'],
        side_effect_scope: 'none',
        enabled: false,
        release_channel: 'stable',
        capabilities: ['retrieval'],
        risk_level: 'medium',
        requires_approval: false,
      },
    ],
  });

  assert.equal(summary.task_context.active_toolset_id, 'analysis_toolset');
  assert.equal(summary.runtime.blocked_tool_result_count, 1);
  assert.equal(summary.runtime.blocked_rate, 0.3333);
  assert.equal(summary.runtime.sandbox_blocked_tool_result_count, 1);
  assert.equal(summary.alerts.open_count, 1);
  assert.equal(summary.enforcement.mode, 'enforced');
  assert.equal(summary.enforcement.projected.allowed_tool_count, 1);
  assert.equal(summary.enforcement.projected.blocked_tool_count, 2);
  assert.equal(summary.enforcement.projected.blocked_by_reason.tool_release_channel_blocked, 1);
  assert.equal(summary.enforcement.projected.blocked_by_reason.tool_disabled, 1);
  assert.equal(summary.sandbox.environment_name, 'restricted');
  assert.equal(summary.sandbox.filesystem_scope, 'workspace_write');
  assert.deepEqual(summary.sandbox.allowed_paths, ['/workspace/docs']);
  assert.deepEqual(summary.sandbox.allowed_hosts, ['api.deepseek.com']);
  assert.deepEqual(summary.sandbox.allowed_providers, ['deepseek']);
  assert.deepEqual(summary.sandbox.provider_host_bindings, [
    {
      provider: 'deepseek',
      hosts: ['api.deepseek.com'],
    },
  ]);
  assert.deepEqual(summary.sandbox.dynamic_allowed_hosts, ['api.deepseek.com']);
  assert.deepEqual(summary.sandbox.dynamic_allowed_providers, ['deepseek']);
  assert.deepEqual(summary.sandbox.dynamic_provider_host_bindings, [
    {
      provider: 'deepseek',
      hosts: ['api.deepseek.com'],
    },
  ]);
  assert.equal(summary.sandbox.blocked_by_reason.filesystem_path_blocked, 1);
  assert.equal(summary.catalog.total_tools, 3);
  assert.equal(summary.catalog.disabled_tools, 1);
  assert.equal(summary.catalog.beta_tools, 1);
});
