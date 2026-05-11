import { asBoolean, asObject, asString } from './_shared.mjs';

const BINDING_STATUS = new Set(['active', 'paused']);

export function createRouteBinding(input) {
  const binding = asObject(input, 'route binding');
  const status = asString(binding.status ?? 'active', 'status');
  if (!BINDING_STATUS.has(status)) {
    throw new TypeError(`status must be one of ${Array.from(BINDING_STATUS).join(', ')}`);
  }

  return {
    binding_id: asString(binding.binding_id, 'binding_id'),
    workspace_id: asString(binding.workspace_id, 'workspace_id'),
    channel_pattern: asString(binding.channel_pattern, 'channel_pattern'),
    agent_id: asString(binding.agent_id, 'agent_id'),
    persona_id: asString(binding.persona_id, 'persona_id'),
    model_policy_id: asString(binding.model_policy_id, 'model_policy_id'),
    toolset_id: asString(binding.toolset_id, 'toolset_id'),
    streaming_enabled: asBoolean(binding.streaming_enabled, 'streaming_enabled', true),
    status,
  };
}
