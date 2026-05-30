import { createPlatformAdapterProfile } from '../../../packages/contracts/src/index.mjs';
import {
  buildGenericDeliveryPayload,
  buildSlackDeliveryPayload,
  buildTelegramDeliveryPayload,
  buildWebDeliveryPayload,
} from './outbound-message-templates.mjs';

function clone(value) {
  return structuredClone(value);
}

function createAdapter({
  platform_id,
  label,
  render_mode,
  callback_supported,
  fallback_platform,
  capabilities,
  transport,
  render,
  metadata = {},
}) {
  return {
    profile: createPlatformAdapterProfile({
      platform_id,
      label,
      render_mode,
      callback_supported,
      fallback_platform,
      capabilities,
      transport,
      metadata,
    }),
    render,
  };
}

const DEFAULT_ADAPTERS = [
  createAdapter({
    platform_id: 'web',
    label: 'Web Console',
    render_mode: 'rich_card',
    callback_supported: true,
    capabilities: {
      supports_blocks: true,
      supports_threads: true,
      supports_rich_text: true,
      supports_attachments: true,
    },
    transport: {
      mode: 'sse',
    },
    render: buildWebDeliveryPayload,
  }),
  createAdapter({
    platform_id: 'slack',
    label: 'Slack',
    render_mode: 'blocks',
    callback_supported: true,
    capabilities: {
      supports_blocks: true,
      supports_threads: true,
      supports_mentions: true,
    },
    transport: {
      mode: 'webhook',
    },
    render: buildSlackDeliveryPayload,
  }),
  createAdapter({
    platform_id: 'telegram',
    label: 'Telegram',
    render_mode: 'markdown',
    callback_supported: true,
    capabilities: {
      supports_markdown: true,
      supports_attachments: false,
    },
    transport: {
      mode: 'webhook',
    },
    render: buildTelegramDeliveryPayload,
  }),
  createAdapter({
    platform_id: 'generic',
    label: 'Generic',
    render_mode: 'plain_text',
    callback_supported: false,
    capabilities: {
      supports_plain_text: true,
    },
    transport: {
      mode: 'in_memory',
    },
    render: buildGenericDeliveryPayload,
  }),
];

export function createPlatformAdapterRegistry({ adapters = DEFAULT_ADAPTERS } = {}) {
  const adaptersById = new Map();

  function register(adapterInput) {
    const profile = adapterInput.profile ?? createPlatformAdapterProfile(adapterInput);
    const render = adapterInput.render ?? buildGenericDeliveryPayload;
    adaptersById.set(profile.platform_id, {
      profile,
      render,
    });
    return clone(profile);
  }

  function get(platformId = 'generic') {
    const normalized = String(platformId ?? 'generic').toLowerCase();
    return adaptersById.get(normalized) ?? adaptersById.get('generic') ?? null;
  }

  function list() {
    return Array.from(adaptersById.values()).map(({ profile }) => clone(profile));
  }

  function render({
    target_platform,
    responseText = '',
    task = null,
    persona = null,
    plan = null,
    traceId = task?.trace_id ?? task?.task_id ?? null,
    sourcePlatform = task?.message?.source_platform ?? null,
    metadata = {},
    runState = task?.run_state ?? null,
  } = {}) {
    const adapter = get(target_platform);
    if (!adapter) {
      throw new Error(`Unknown platform adapter: ${target_platform}`);
    }

    const renderedPayload = adapter.render({
      responseText,
      task,
      persona,
      plan,
      traceId,
      sourcePlatform,
      metadata,
      runState,
      adapterProfile: adapter.profile,
    });

    return {
      profile: clone(adapter.profile),
      rendered_payload: renderedPayload,
    };
  }

  for (const adapter of adapters) {
    register(adapter);
  }

  return {
    get,
    list,
    register,
    render,
  };
}
