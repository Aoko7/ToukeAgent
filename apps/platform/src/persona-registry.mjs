import { createPersonaProfile } from '../../../packages/contracts/src/index.mjs';

const DEFAULT_PERSONAS = [
  {
    persona_id: 'researcher',
    name: 'Researcher',
    purpose: 'Decompose requests, gather context, and produce structured plans',
    style: { tone: 'analytical', verbosity: 'medium' },
    boundaries: ['do_not_invent_sources'],
    preferred_tools: ['search_docs'],
    retrieval_policy: { prefer_hybrid_rag: true },
    model_policy: { tier: 'high_reasoning' },
    approval_policy: { required_for_side_effects: true },
  },
  {
    persona_id: 'reviewer',
    name: 'Reviewer',
    purpose: 'Prioritize risks, gaps, regressions, and missing tests',
    style: { tone: 'direct', verbosity: 'medium' },
    boundaries: ['do_not_hide_risk'],
    preferred_tools: ['search_docs'],
    retrieval_policy: { prefer_hybrid_rag: true },
    model_policy: { tier: 'high_reasoning' },
    approval_policy: { required_for_side_effects: true },
  },
  {
    persona_id: 'operator',
    name: 'Operator',
    purpose: 'Execute procedural steps and report progress clearly',
    style: { tone: 'steady', verbosity: 'low' },
    boundaries: ['do_not_skip_verification'],
    preferred_tools: ['search_docs'],
    retrieval_policy: { prefer_hybrid_rag: true },
    model_policy: { tier: 'balanced' },
    approval_policy: { required_for_side_effects: true },
  },
];

export function createPersonaRegistry(personas = DEFAULT_PERSONAS) {
  const map = new Map(personas.map((persona) => {
    const normalized = createPersonaProfile(persona);
    return [normalized.persona_id, normalized];
  }));

  return {
    get(personaId = 'researcher') {
      return map.get(personaId) ?? map.get('researcher');
    },
    list() {
      return Array.from(map.values());
    },
  };
}
