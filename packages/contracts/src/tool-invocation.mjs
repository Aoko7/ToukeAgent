import { asArray, asBoolean, asNumber, asObject, asOptionalString, asString, assert } from './_shared.mjs';

const RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical']);

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
  };
}

export function createToolCallRequest(input) {
  const call = asObject(input, 'tool call request');
  return {
    call_id: asString(call.call_id, 'call_id'),
    tool_name: asString(call.tool_name, 'tool_name'),
    version: asString(call.version ?? '1.0.0', 'version'),
    trace_id: asString(call.trace_id, 'trace_id'),
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
