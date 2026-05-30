import { asArray, asObject, asOptionalString, asString, clone } from './_shared.mjs';

const HANDOFF_STATUS = new Set(['created', 'running', 'completed', 'failed', 'cancelled']);

export function createAgentHandoffPacket(input) {
  const packet = asObject(input, 'agent handoff packet');
  const status = asOptionalString(packet.status, 'status') ?? 'created';
  if (!HANDOFF_STATUS.has(status)) {
    throw new TypeError(`status must be one of ${Array.from(HANDOFF_STATUS).join(', ')}`);
  }

  return {
    handoff_id: asString(packet.handoff_id, 'handoff_id'),
    task_id: asString(packet.task_id, 'task_id'),
    trace_id: asString(packet.trace_id, 'trace_id'),
    parent_agent_id: asString(packet.parent_agent_id, 'parent_agent_id'),
    target_agent_id: asString(packet.target_agent_id, 'target_agent_id'),
    role: asString(packet.role, 'role'),
    objective: asString(packet.objective, 'objective'),
    scope: clone(asObject(packet.scope, 'scope', {})),
    input_summary: asString(packet.input_summary, 'input_summary'),
    must_keep: clone(asArray(packet.must_keep, 'must_keep', [])),
    evidence_refs: clone(asArray(packet.evidence_refs, 'evidence_refs', [])),
    context_snapshot_id: asOptionalString(packet.context_snapshot_id, 'context_snapshot_id'),
    output_schema: clone(asObject(packet.output_schema, 'output_schema', {})),
    status,
    metadata: clone(asObject(packet.metadata, 'metadata', {})),
  };
}
