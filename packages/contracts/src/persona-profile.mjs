import { asArray, asBoolean, asObject, asOptionalString, asString, assert } from './_shared.mjs';

function normalizeAccessPolicyEgress(input) {
  const egress = asObject(input, 'tool_access_policy.egress_allowlist', {});
  const bindings = asArray(
    egress.provider_host_bindings ?? egress.providerHostBindings ?? egress.bindings ?? egress.routes,
    'tool_access_policy.egress_allowlist.provider_host_bindings',
    [],
  );
  return {
    hosts: asArray(
      egress.hosts ?? egress.domains,
      'tool_access_policy.egress_allowlist.hosts',
      [],
    ).map((item) => asString(item, 'tool_access_policy.egress_allowlist.hosts item')),
    providers: asArray(
      egress.providers ?? egress.services,
      'tool_access_policy.egress_allowlist.providers',
      [],
    ).map((item) => asString(item, 'tool_access_policy.egress_allowlist.providers item')),
    provider_host_bindings: bindings.map((binding, index) => {
      const item = asObject(binding, `tool_access_policy.egress_allowlist.provider_host_bindings[${index}]`);
      return {
        provider: asString(
          item.provider ?? item.service ?? '*',
          `tool_access_policy.egress_allowlist.provider_host_bindings[${index}].provider`,
        ),
        hosts: asArray(
          item.hosts ?? item.domains ?? (item.host ? [item.host] : []),
          `tool_access_policy.egress_allowlist.provider_host_bindings[${index}].hosts`,
          [],
        ).map((entry) => asString(
          entry,
          `tool_access_policy.egress_allowlist.provider_host_bindings[${index}].hosts item`,
        )),
      };
    }),
  };
}

export function createPersonaProfile(input) {
  const persona = asObject(input, 'persona profile');
  const style = asObject(persona.style, 'style', {});
  const toolAccessPolicy = asObject(persona.tool_access_policy, 'tool_access_policy', {});
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
    tool_access_policy: {
      ...toolAccessPolicy,
      egress_allowlist: normalizeAccessPolicyEgress(toolAccessPolicy.egress_allowlist),
    },
    channel_policy: asObject(persona.channel_policy, 'channel_policy', { prefer_streaming: true }),
    active: asBoolean(persona.active, 'active', true),
    metadata: asObject(persona.metadata, 'metadata', {}),
  };
}
