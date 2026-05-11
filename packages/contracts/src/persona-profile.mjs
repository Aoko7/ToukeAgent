import { asArray, asBoolean, asObject, asOptionalString, asString, assert } from './_shared.mjs';

export function createPersonaProfile(input) {
  const persona = asObject(input, 'persona profile');
  const style = asObject(persona.style, 'style', {});
  return {
    persona_id: asString(persona.persona_id, 'persona_id'),
    name: asString(persona.name, 'name'),
    purpose: asOptionalString(persona.purpose, 'purpose') ?? 'general persona',
    style: {
      tone: asOptionalString(style.tone, 'style.tone') ?? 'neutral',
      verbosity: asOptionalString(style.verbosity, 'style.verbosity') ?? 'medium',
    },
    boundaries: asArray(persona.boundaries, 'boundaries').map((item) => asString(item, 'boundaries item')),
    preferred_tools: asArray(persona.preferred_tools, 'preferred_tools').map((item) => asString(item, 'preferred_tools item')),
    disallowed_tools: asArray(persona.disallowed_tools, 'disallowed_tools').map((item) => asString(item, 'disallowed_tools item')),
    retrieval_policy: asObject(persona.retrieval_policy, 'retrieval_policy', {}),
    memory_policy: asObject(persona.memory_policy, 'memory_policy', {}),
    model_policy: asObject(persona.model_policy, 'model_policy', {}),
    approval_policy: asObject(persona.approval_policy, 'approval_policy', {}),
    channel_policy: asObject(persona.channel_policy, 'channel_policy', { prefer_streaming: true }),
    active: asBoolean(persona.active, 'active', true),
    metadata: asObject(persona.metadata, 'metadata', {}),
  };
}
