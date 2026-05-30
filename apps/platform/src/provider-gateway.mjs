function buildLocalResult({ draft, modelRoute, fallback }) {
  return {
    content: draft.content,
    model_route: modelRoute,
    fallback,
  };
}

export function createProviderGateway({ providers = {} } = {}) {
  const registry = new Map(Object.entries(providers));

  function register(providerId, provider) {
    registry.set(providerId, provider);
    return provider;
  }

  function get(providerId) {
    return registry.get(providerId) ?? null;
  }

  function list() {
    return Array.from(registry.entries()).map(([providerId, provider]) => ({
      provider: providerId,
      isConfigured: Boolean(provider?.isConfigured),
      model: provider?.model ?? null,
      reasoningEffort: provider?.reasoningEffort ?? null,
    }));
  }

  async function compose({
    modelRoute,
    draft,
    maxTokens = 1024,
  } = {}) {
    if (!modelRoute || modelRoute.provider === 'local' || modelRoute.mode === 'local-compose') {
      return buildLocalResult({
        draft,
        modelRoute,
        fallback: {
          ...(modelRoute?.fallback ?? {}),
          applied: true,
          reason: modelRoute?.fallback?.reason ?? 'local_provider_selected',
          strategy: modelRoute?.fallback?.strategy ?? 'local-compose',
        },
      });
    }

    const provider = get(modelRoute.provider);
    if (!provider?.isConfigured) {
      return buildLocalResult({
        draft,
        modelRoute: {
          ...modelRoute,
          provider: 'local',
          mode: 'local-compose',
        },
        fallback: {
          ...(modelRoute?.fallback ?? {}),
          applied: true,
          reason: provider ? 'provider_not_configured' : `unsupported_provider:${modelRoute.provider}`,
          strategy: 'local-compose',
        },
      });
    }

    try {
      const completion = await provider.chat({
        model: modelRoute?.model ?? provider.model,
        messages: draft.messages,
        thinking: { type: 'enabled' },
        reasoningEffort: modelRoute?.reasoning_effort ?? provider.reasoningEffort,
        maxTokens,
      });

      return {
        content: completion.content?.trim() || draft.content,
        model_route: {
          ...modelRoute,
          provider: modelRoute?.provider ?? provider.providerId,
          model: completion.model ?? modelRoute?.model ?? provider.model,
          usage: completion.usage ?? null,
        },
        fallback: {
          applied: false,
          reason: null,
          strategy: null,
        },
      };
    } catch (error) {
      return buildLocalResult({
        draft,
        modelRoute: {
          ...modelRoute,
          provider: 'local',
          mode: 'local-compose',
        },
        fallback: {
          applied: true,
          reason: error instanceof Error ? error.message : String(error),
          strategy: 'local-compose',
        },
      });
    }
  }

  return {
    register,
    get,
    list,
    compose,
  };
}
