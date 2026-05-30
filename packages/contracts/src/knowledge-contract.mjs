import { asArray, asNumber, asObject, asOptionalString, asString, clone } from './_shared.mjs';

export function createKnowledgeContract(input) {
  const contract = asObject(input, 'knowledge contract');
  return {
    required_context: asArray(contract.required_context, 'required_context').map((item) => asString(item, 'required_context item')),
    retrieval_hints: asArray(contract.retrieval_hints, 'retrieval_hints').map((item) => asString(item, 'retrieval_hints item')),
    owner: asString(contract.owner, 'owner'),
    ttl_seconds: asNumber(contract.ttl_seconds, 'ttl_seconds'),
    version: asString(contract.version, 'version'),
    source_of_truth: asString(contract.source_of_truth, 'source_of_truth'),
    contract_source: asString(contract.contract_source ?? 'default_injected', 'contract_source'),
    metadata: asObject(contract.metadata, 'metadata', {}),
  };
}

export function createQueryAnalysis(input) {
  const analysis = asObject(input, 'query analysis');
  const decomposition = asObject(analysis.decomposition, 'decomposition', {});
  const rewrites = asObject(analysis.rewrites, 'rewrites', {});
  const clarification = asObject(analysis.clarification, 'clarification', {});
  const boundary = asObject(analysis.boundary, 'boundary', {});

  return {
    query_text: asString(analysis.query_text ?? '', 'query_text'),
    terms: asArray(analysis.terms, 'terms', []).map((item) => asString(item, 'term')),
    term_count: asNumber(analysis.term_count, 'term_count', 0),
    query_mode: asString(analysis.query_mode ?? 'lookup', 'query_mode'),
    intent_tags: asArray(analysis.intent_tags, 'intent_tags', []).map((item) => asString(item, 'intent_tags item')),
    intent: asObject(analysis.intent, 'intent', {}),
    filter_hints: asObject(analysis.filter_hints, 'filter_hints', {}),
    decomposition: {
      enabled: Boolean(decomposition.enabled),
      strategy: asString(decomposition.strategy ?? 'single_pass', 'decomposition.strategy'),
      subqueries: asArray(decomposition.subqueries, 'decomposition.subqueries', []).map((item) => clone(item)),
    },
    rewrites: {
      enabled: Boolean(rewrites.enabled),
      strategy: asString(rewrites.strategy ?? 'identity', 'rewrites.strategy'),
      variants: asArray(rewrites.variants, 'rewrites.variants', []).map((item) => clone(item)),
    },
    clarification: {
      required: Boolean(clarification.required),
      missing_context: asArray(clarification.missing_context, 'clarification.missing_context', []).map((item) => asString(item, 'clarification missing_context item')),
      questions: asArray(clarification.questions, 'clarification.questions', []).map((item) => asString(item, 'clarification question')),
      reason: asOptionalString(clarification.reason, 'clarification.reason'),
    },
    boundary: {
      action: asString(boundary.action ?? 'answer', 'boundary.action'),
      reason: asOptionalString(boundary.reason, 'boundary.reason'),
      explicit_scope_required: Boolean(boundary.explicit_scope_required),
    },
    metadata: asObject(analysis.metadata, 'metadata', {}),
  };
}
