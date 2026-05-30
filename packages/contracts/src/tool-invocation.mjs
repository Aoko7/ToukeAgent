import { asArray, asBoolean, asNumber, asObject, asOptionalString, asString, assert } from './_shared.mjs';

const RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical']);
const FILESYSTEM_SCOPES = new Set(['none', 'read_only', 'workspace_write', 'full']);

function normalizeExecutionConstraints(input) {
  const constraints = asObject(input, 'execution_constraints', {});
  const egress = asObject(
    constraints.egress_allowlist ?? constraints.network_targets,
    'execution_constraints.egress_allowlist',
    {},
  );
  const bindings = asArray(
    egress.provider_host_bindings ?? egress.providerHostBindings ?? egress.bindings ?? egress.routes,
    'execution_constraints.egress_allowlist.provider_host_bindings',
    [],
  );
  const filesystem_scope = asString(constraints.filesystem_scope ?? 'none', 'execution_constraints.filesystem_scope');
  assert(
    FILESYSTEM_SCOPES.has(filesystem_scope),
    `execution_constraints.filesystem_scope must be one of ${Array.from(FILESYSTEM_SCOPES).join(', ')}`,
  );

  return {
    network_access: asBoolean(constraints.network_access, 'execution_constraints.network_access', false),
    filesystem_scope,
    shell_access: asBoolean(constraints.shell_access, 'execution_constraints.shell_access', false),
    path_allowlist: asArray(
      constraints.path_allowlist ?? constraints.filesystem_paths,
      'execution_constraints.path_allowlist',
      [],
    ).map((item) => asString(item, 'execution_constraints.path_allowlist item')),
    egress_allowlist: {
      hosts: asArray(
        egress.hosts ?? egress.domains,
        'execution_constraints.egress_allowlist.hosts',
        [],
      ).map((item) => asString(item, 'execution_constraints.egress_allowlist.hosts item')),
      providers: asArray(
        egress.providers ?? egress.services,
        'execution_constraints.egress_allowlist.providers',
        [],
      ).map((item) => asString(item, 'execution_constraints.egress_allowlist.providers item')),
      provider_host_bindings: bindings.map((binding, index) => {
        const item = asObject(binding, `execution_constraints.egress_allowlist.provider_host_bindings[${index}]`);
        return {
          provider: asString(item.provider ?? item.service ?? '*', `execution_constraints.egress_allowlist.provider_host_bindings[${index}].provider`),
          hosts: asArray(
            item.hosts ?? item.domains ?? (item.host ? [item.host] : []),
            `execution_constraints.egress_allowlist.provider_host_bindings[${index}].hosts`,
            [],
          ).map((entry) => asString(entry, `execution_constraints.egress_allowlist.provider_host_bindings[${index}].hosts item`)),
        };
      }),
    },
  };
}

function normalizeNetworkIntent(input) {
  const intent = asObject(input, 'network_intent', {});
  const targets = asArray(
    intent.targets ?? intent.endpoints ?? intent.requests ?? [],
    'network_intent.targets',
    [],
  ).map((target, index) => {
    const item = asObject(target, `network_intent.targets[${index}]`, {});
    return {
      host: asOptionalString(item.host ?? item.hostname ?? item.domain, `network_intent.targets[${index}].host`),
      provider: asOptionalString(item.provider ?? item.service ?? item.provider_id ?? item.providerId, `network_intent.targets[${index}].provider`),
      url: asOptionalString(item.url ?? item.endpoint ?? item.base_url ?? item.baseUrl, `network_intent.targets[${index}].url`),
      purpose: asOptionalString(item.purpose ?? item.intent ?? item.label, `network_intent.targets[${index}].purpose`),
    };
  }).filter((item) => item.host || item.provider || item.url);

  return {
    targets,
  };
}

export function createToolDefinition(input) {
  const tool = asObject(input, 'tool definition');
  const tool_name = asString(tool.tool_name, 'tool_name');
  const risk_level = asString(tool.risk_level ?? 'low', 'risk_level');
  assert(RISK_LEVELS.has(risk_level), `risk_level must be one of ${Array.from(RISK_LEVELS).join(', ')}`);

  return {
    tool_name,
    version: asString(tool.version ?? '1.0.0', 'version'),
    description: asOptionalString(tool.description, 'description') ?? tool_name,
    input_schema: asObject(tool.input_schema, 'input_schema', {}),
    output_schema: asObject(tool.output_schema, 'output_schema', {}),
    permissions: asArray(tool.permissions, 'permissions').map((item) => asString(item, 'permissions item')),
    risk_level,
    timeout_ms: asNumber(tool.timeout_ms, 'timeout_ms', 30_000),
    retry_policy: asObject(tool.retry_policy, 'retry_policy', {}),
    idempotent: asBoolean(tool.idempotent, 'idempotent', false),
    side_effect_scope: asString(tool.side_effect_scope ?? 'none', 'side_effect_scope'),
    requires_approval: asBoolean(tool.requires_approval, 'requires_approval', false),
    enabled: asBoolean(tool.enabled, 'enabled', true),
    release_channel: asString(tool.release_channel ?? 'stable', 'release_channel'),
    capabilities: asArray(tool.capabilities, 'capabilities', []).map((item) => asString(item, 'capabilities item')),
    execution_constraints: normalizeExecutionConstraints(tool.execution_constraints),
  };
}

export function createToolCallRequest(input) {
  const call = asObject(input, 'tool call request');
  return {
    call_id: asString(call.call_id, 'call_id'),
    tool_name: asString(call.tool_name, 'tool_name'),
    version: asString(call.version ?? '1.0.0', 'version'),
    trace_id: asString(call.trace_id, 'trace_id'),
    approval: call.approval === undefined || call.approval === null ? null : asObject(call.approval, 'approval'),
    access_policy: call.access_policy === undefined || call.access_policy === null ? null : asObject(call.access_policy, 'access_policy'),
    network_intent: call.network_intent === undefined || call.network_intent === null
      ? null
      : normalizeNetworkIntent(call.network_intent),
    caller: {
      task_id: asString(asObject(call.caller, 'caller').task_id, 'caller.task_id'),
      step_id: asOptionalString(asObject(call.caller, 'caller').step_id, 'caller.step_id'),
      persona_id: asOptionalString(asObject(call.caller, 'caller').persona_id, 'caller.persona_id'),
    },
    arguments: asObject(call.arguments, 'arguments', {}),
  };
}

export function createToolCallResult(input) {
  const result = asObject(input, 'tool call result');
  const status = asString(result.status ?? 'success', 'status');
  assert(['success', 'error', 'timeout', 'cancelled'].includes(status), 'status must be success, error, timeout, or cancelled');
  return {
    call_id: asString(result.call_id, 'call_id'),
    status,
    error_code: asOptionalString(result.error_code, 'error_code'),
    summary: asOptionalString(result.summary, 'summary'),
    result: result.result === undefined ? {} : result.result,
    evidence: asArray(result.evidence, 'evidence', []),
    metrics: asObject(result.metrics, 'metrics', {}),
  };
}
