import { asArray, asObject, asNumber, asOptionalString, asString, clone } from './_shared.mjs';

const COMPRESSION_SCOPES = new Set(['task', 'agent', 'step']);
const COMPRESSION_STRATEGIES = new Set(['extractive', 'summary', 'hybrid']);

export function createContextCompressionSnapshot(input) {
  const snapshot = asObject(input, 'context compression snapshot');
  const scope = asString(snapshot.scope, 'scope');
  const strategy = asString(snapshot.compression_strategy, 'compression_strategy');
  if (!COMPRESSION_SCOPES.has(scope)) {
    throw new TypeError(`scope must be one of ${Array.from(COMPRESSION_SCOPES).join(', ')}`);
  }
  if (!COMPRESSION_STRATEGIES.has(strategy)) {
    throw new TypeError(`compression_strategy must be one of ${Array.from(COMPRESSION_STRATEGIES).join(', ')}`);
  }

  return {
    snapshot_id: asString(snapshot.snapshot_id, 'snapshot_id'),
    task_id: asString(snapshot.task_id, 'task_id'),
    trace_id: asString(snapshot.trace_id, 'trace_id'),
    scope,
    model_name: asString(snapshot.model_name, 'model_name'),
    compression_strategy: strategy,
    source_ranges: clone(asArray(snapshot.source_ranges, 'source_ranges', [])),
    token_budget: asNumber(snapshot.token_budget, 'token_budget', 0),
    token_estimate: asNumber(snapshot.token_estimate, 'token_estimate', 0),
    must_keep: clone(asArray(snapshot.must_keep, 'must_keep', [])),
    summary: asString(snapshot.summary, 'summary'),
    unresolved_items: clone(asArray(snapshot.unresolved_items, 'unresolved_items', [])),
    evidence_refs: clone(asArray(snapshot.evidence_refs, 'evidence_refs', [])),
    memory_refs: clone(asArray(snapshot.memory_refs, 'memory_refs', [])),
    metadata: clone(asObject(snapshot.metadata, 'metadata', {})),
    created_at: asOptionalString(snapshot.created_at, 'created_at') ?? new Date().toISOString(),
  };
}
