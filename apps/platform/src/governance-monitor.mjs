import { callPythonCore } from './python-core-bridge.mjs';

function clone(value) {
  return structuredClone(value);
}

function asStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

function incrementCount(target, key) {
  if (!key) {
    return;
  }
  target[key] = (target[key] ?? 0) + 1;
}

function roundNumber(value, digits = 4) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function summarizeSandboxPolicy(accessPolicy = {}) {
  return {
    environment_name: accessPolicy.environment_name ?? null,
    network_allowed: accessPolicy.allowNetwork ?? null,
    shell_allowed: accessPolicy.allowShell ?? null,
    filesystem_scope: accessPolicy.filesystemScope ?? null,
    allowed_paths: Array.isArray(accessPolicy.allowedPaths) ? clone(accessPolicy.allowedPaths) : [],
    allowed_hosts: Array.isArray(accessPolicy.egressAllowlist?.hosts) ? clone(accessPolicy.egressAllowlist.hosts) : [],
    allowed_providers: Array.isArray(accessPolicy.egressAllowlist?.providers) ? clone(accessPolicy.egressAllowlist.providers) : [],
    provider_host_bindings: Array.isArray(accessPolicy.egressAllowlist?.providerHostBindings)
      ? clone(accessPolicy.egressAllowlist.providerHostBindings)
      : [],
  };
}

function summarizeAccessPolicyEgress(accessPolicy = {}) {
  const egress = accessPolicy?.egress_allowlist;
  return {
    hosts: Array.isArray(egress?.hosts) ? clone(egress.hosts) : [],
    providers: Array.isArray(egress?.providers) ? clone(egress.providers) : [],
    provider_host_bindings: Array.isArray(egress?.provider_host_bindings)
      ? clone(egress.provider_host_bindings)
      : [],
  };
}

function normalizeToolAccessProjection({ persona = null, toolsets = [] } = {}) {
  const rawPolicy = persona?.tool_access_policy && typeof persona.tool_access_policy === 'object'
    ? clone(persona.tool_access_policy)
    : null;
  const defaultToolsetId = persona?.metadata?.default_toolset_id ?? null;
  const activeToolsetId = rawPolicy?.toolset_id ?? defaultToolsetId ?? null;
  const activeToolset = Array.isArray(toolsets)
    ? toolsets.find((item) => item?.toolset_id === activeToolsetId) ?? null
    : null;

  if (!rawPolicy) {
    return {
      mode: activeToolset ? 'catalog_only' : 'unbound',
      active_toolset: activeToolset ? clone(activeToolset) : null,
      access_policy: null,
      access_policy_present: false,
    };
  }

  return {
    mode: 'enforced',
    active_toolset: activeToolset ? clone(activeToolset) : null,
    access_policy_present: true,
    access_policy: {
      ...rawPolicy,
      toolset_id: activeToolsetId,
      allowed_permissions: asStringList(
        rawPolicy.allowed_permissions?.length
          ? rawPolicy.allowed_permissions
          : activeToolset?.allowed_permissions,
      ),
      allowed_tools: asStringList(rawPolicy.allowed_tools),
      disallowed_tools: asStringList(rawPolicy.disallowed_tools),
      allow_side_effects: rawPolicy.allow_side_effects !== undefined
        ? Boolean(rawPolicy.allow_side_effects)
        : Boolean(activeToolset?.allow_side_effects ?? true),
      allow_unlisted_tools: rawPolicy.allow_unlisted_tools !== undefined
        ? Boolean(rawPolicy.allow_unlisted_tools)
        : true,
      allowed_release_channels: asStringList(
        rawPolicy.allowed_release_channels?.length
          ? rawPolicy.allowed_release_channels
          : activeToolset?.allowed_release_channels,
      ),
      required_capabilities: asStringList(
        rawPolicy.required_capabilities?.length
          ? rawPolicy.required_capabilities
          : activeToolset?.required_capabilities,
      ),
      egress_allowlist: {
        hosts: asStringList(
          rawPolicy.egress_allowlist?.hosts?.length
            ? rawPolicy.egress_allowlist.hosts
            : activeToolset?.egress_allowlist?.hosts,
        ),
        providers: asStringList(
          rawPolicy.egress_allowlist?.providers?.length
            ? rawPolicy.egress_allowlist.providers
            : activeToolset?.egress_allowlist?.providers,
        ),
        provider_host_bindings: Array.isArray(rawPolicy.egress_allowlist?.provider_host_bindings)
          && rawPolicy.egress_allowlist.provider_host_bindings.length > 0
          ? clone(rawPolicy.egress_allowlist.provider_host_bindings)
          : Array.isArray(activeToolset?.egress_allowlist?.provider_host_bindings)
            ? clone(activeToolset.egress_allowlist.provider_host_bindings)
            : [],
      },
    },
  };
}

function summarizeAlertDistribution(alerts = []) {
  const byCategory = {};
  const bySeverity = {};
  const openCount = alerts.filter((alert) => alert?.status === 'open').length;

  for (const alert of alerts) {
    incrementCount(byCategory, String(alert?.category ?? 'unknown'));
    incrementCount(bySeverity, String(alert?.severity ?? 'unknown'));
  }

  return {
    total: alerts.length,
    open_count: openCount,
    by_category: byCategory,
    by_severity: bySeverity,
    latest_code: alerts.at(-1)?.code ?? null,
  };
}

function summarizeToolCatalog(toolDefinitions = []) {
  const byReleaseChannel = {};
  const byRiskLevel = {};
  const byCapability = {};

  for (const definition of toolDefinitions) {
    incrementCount(byReleaseChannel, String(definition?.release_channel ?? 'stable'));
    incrementCount(byRiskLevel, String(definition?.risk_level ?? 'unknown'));
    for (const capability of asStringList(definition?.capabilities)) {
      incrementCount(byCapability, capability);
    }
  }

  return {
    total_tools: toolDefinitions.length,
    enabled_tools: toolDefinitions.filter((definition) => definition?.enabled !== false).length,
    disabled_tools: toolDefinitions.filter((definition) => definition?.enabled === false).length,
    beta_tools: toolDefinitions.filter((definition) => definition?.release_channel === 'beta').length,
    approval_required_tools: toolDefinitions.filter((definition) => definition?.requires_approval === true).length,
    side_effect_tools: toolDefinitions.filter((definition) => {
      const scope = String(definition?.side_effect_scope ?? 'none');
      return scope !== 'none' && scope !== 'read_only';
    }).length,
    by_release_channel: byReleaseChannel,
    by_risk_level: byRiskLevel,
    by_capability: byCapability,
  };
}

function projectCatalogAgainstAccessPolicy({ toolDefinitions = [], accessPolicy = null } = {}) {
  if (!accessPolicy) {
    return null;
  }

  const allowedTools = [];
  const blockedTools = [];
  const blockedByReason = {};

  for (const definition of toolDefinitions) {
    if (definition?.enabled === false) {
      incrementCount(blockedByReason, 'tool_disabled');
      blockedTools.push({
        tool_name: definition.tool_name,
        reason: 'tool_disabled',
      });
      continue;
    }

    const decision = callPythonCore(
      'evaluate_tool_access',
      {
        definition,
        request: {
          tool_name: definition?.tool_name,
          access_policy: accessPolicy,
        },
      },
      { caller: 'apps/platform/src/governance-monitor.mjs' },
    );

    if (decision.allowed) {
      allowedTools.push(definition.tool_name);
      continue;
    }

    incrementCount(blockedByReason, String(decision.reason ?? 'blocked'));
    blockedTools.push({
      tool_name: definition.tool_name,
      reason: decision.reason ?? 'blocked',
      summary: decision.summary ?? null,
      missing_permissions: decision.missing_permissions ?? [],
      missing_capabilities: decision.missing_capabilities ?? [],
    });
  }

  return {
    allowed_tool_count: allowedTools.length,
    blocked_tool_count: blockedTools.length,
    blocked_by_reason: blockedByReason,
    allowed_tools: allowedTools,
    blocked_tools: blockedTools,
  };
}

export function summarizeToolGovernance({
  task = null,
  traceBundle = null,
  alerts = [],
  persona = null,
  toolsets = [],
  toolDefinitions = [],
} = {}) {
  const metrics = traceBundle?.metrics ?? {};
  const taskContext = normalizeToolAccessProjection({ persona, toolsets });
  const accessPolicyEgress = summarizeAccessPolicyEgress(taskContext.access_policy);
  const toolResultCount = Number(metrics.tool_result_count ?? 0);
  const blockedCount = Number(metrics.blocked_tool_result_count ?? 0);
  const notes = [];

  if (taskContext.mode === 'catalog_only') {
    notes.push('Persona has a catalog toolset binding, but this trace did not attach a runtime access policy.');
  } else if (taskContext.mode === 'unbound') {
    notes.push('This trace has no active toolset binding or runtime access policy.');
  }

  return {
    task_context: {
      task_id: task?.task_id ?? traceBundle?.task_id ?? null,
      trace_id: task?.trace_id ?? traceBundle?.trace_id ?? null,
      persona_id: task?.persona_id ?? persona?.persona_id ?? null,
      persona_name: persona?.name ?? null,
      enforcement_mode: taskContext.mode,
      default_toolset_id: persona?.metadata?.default_toolset_id ?? null,
      active_toolset_id: taskContext.active_toolset?.toolset_id ?? null,
      active_toolset_label: taskContext.active_toolset?.label ?? null,
    },
    runtime: {
      tool_call_count: Number(metrics.tool_call_count ?? 0),
      tool_result_count: toolResultCount,
      blocked_tool_result_count: blockedCount,
      blocked_rate: toolResultCount > 0 ? roundNumber(blockedCount / toolResultCount) : 0,
      blocked_tool_error_codes: clone(metrics.blocked_tool_error_codes ?? {}),
      blocked_tool_names: clone(metrics.blocked_tool_names ?? []),
      sandbox_blocked_tool_result_count: Number(metrics.sandbox_blocked_tool_result_count ?? 0),
      sandbox_blocked_error_codes: clone(metrics.sandbox_blocked_error_codes ?? {}),
      sandbox_blocked_tool_names: clone(metrics.sandbox_blocked_tool_names ?? []),
    },
    alerts: summarizeAlertDistribution(alerts),
    active_toolset: taskContext.active_toolset ? clone(taskContext.active_toolset) : null,
    enforcement: {
      mode: taskContext.mode,
      access_policy_present: taskContext.access_policy_present,
      access_policy: taskContext.access_policy ? clone(taskContext.access_policy) : null,
      projected: projectCatalogAgainstAccessPolicy({
        toolDefinitions,
        accessPolicy: taskContext.access_policy,
      }),
      notes,
    },
    sandbox: {
      ...summarizeSandboxPolicy(metrics.sandbox_environment_policy ?? {}),
      dynamic_allowed_hosts: accessPolicyEgress.hosts,
      dynamic_allowed_providers: accessPolicyEgress.providers,
      dynamic_provider_host_bindings: accessPolicyEgress.provider_host_bindings,
      network_observation: clone(metrics.sandbox_network_observability ?? {}),
      blocked_count: Number(metrics.sandbox_blocked_tool_result_count ?? 0),
      blocked_by_reason: clone(metrics.sandbox_blocked_error_codes ?? {}),
      blocked_tool_names: clone(metrics.sandbox_blocked_tool_names ?? []),
    },
    catalog: summarizeToolCatalog(toolDefinitions),
  };
}

export const DEFAULT_GOVERNANCE_POLICY = callPythonCore('normalize_governance_policy', {});

export function createGovernanceMonitor({
  policy = DEFAULT_GOVERNANCE_POLICY,
  alertStore = null,
} = {}) {
  const resolvedPolicy = callPythonCore('normalize_governance_policy', { policy });

  function recordAlert(alert) {
    return alertStore?.record(alert) ?? clone(alert);
  }

  function evaluateWorker({ workerSnapshot = {} } = {}) {
    const result = callPythonCore('evaluate_worker_governance', {
      policy: resolvedPolicy,
      worker_snapshot: workerSnapshot,
    });
    return {
      ...result,
      alerts: (result.alerts ?? []).map((alert) => recordAlert(alert)),
    };
  }

  function evaluateTask({ task, traceBundle, workerSnapshot = {} } = {}) {
    const result = callPythonCore('evaluate_task_governance', {
      policy: resolvedPolicy,
      task,
      trace_bundle: traceBundle,
      worker_snapshot: workerSnapshot,
    });
    return {
      ...result,
      alerts: (result.alerts ?? []).map((alert) => recordAlert(alert)),
    };
  }

  return {
    getPolicy() {
      return clone(resolvedPolicy);
    },
    evaluateWorker,
    evaluateTask,
  };
}
