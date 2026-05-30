import { callPythonCore } from './python-core-bridge.mjs';
import { createProviderGateway } from './provider-gateway.mjs';

export function createResponseComposer({ client, providerGateway = null, modelRouter = null } = {}) {
  const gateway = providerGateway ?? createProviderGateway({
    providers: client?.providerId ? { [client.providerId]: client } : {},
  });

  function normalizeComposeResult(result, fallback = {}) {
    if (typeof result === 'string') {
      return {
        content: result,
        model_route: null,
        fallback: {
          applied: false,
          reason: null,
          strategy: null,
          ...fallback,
        },
      };
    }

    return {
      content: String(result?.content ?? ''),
      model_route: result?.model_route ?? null,
      fallback: {
        applied: false,
        reason: null,
        strategy: null,
        ...(result?.fallback ?? {}),
      },
    };
  }

  return {
    async compose({ persona, message, plan, retrievalResult, memorySnapshot }) {
      const modelRoute = modelRouter?.route({
        message,
        plan,
        memorySnapshot,
        retrievalResult: retrievalResult?.result ?? retrievalResult ?? null,
      }) ?? null;
      const draft = callPythonCore(
        'compose_draft',
        {
          persona,
          message,
          plan,
          retrievalResult: retrievalResult?.result ?? retrievalResult ?? null,
          memorySnapshot,
          model_route: modelRoute,
        },
        { caller: 'apps/platform/src/response-composer.mjs' },
      );

      const result = await gateway.compose({
        modelRoute,
        draft,
        maxTokens: 1024,
      });
      return normalizeComposeResult(result);
    },
  };
}
