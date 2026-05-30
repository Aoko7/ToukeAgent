import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderGateway } from '../apps/platform/src/provider-gateway.mjs';

test('provider gateway falls back to local draft when provider is unavailable', async () => {
  const gateway = createProviderGateway({
    providers: {},
  });

  const result = await gateway.compose({
    modelRoute: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoning_effort: 'medium',
      fallback: {
        applied: false,
        reason: null,
        strategy: null,
      },
    },
    draft: {
      content: 'local fallback content',
      messages: [],
    },
  });

  assert.equal(result.content, 'local fallback content');
  assert.equal(result.model_route.provider, 'local');
  assert.equal(result.fallback.applied, true);
  assert.equal(result.fallback.reason, 'unsupported_provider:deepseek');
});

test('provider gateway uses configured provider and returns provider completion', async () => {
  const gateway = createProviderGateway({
    providers: {
      deepseek: {
        providerId: 'deepseek',
        isConfigured: true,
        model: 'deepseek-v4-flash',
        reasoningEffort: 'medium',
        async chat({ model, messages }) {
          return {
            model,
            content: `provider response: ${messages.length}`,
            usage: { total_tokens: 12 },
          };
        },
      },
    },
  });

  const result = await gateway.compose({
    modelRoute: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoning_effort: 'medium',
      profile: 'balanced',
      fallback: {
        applied: false,
        reason: null,
        strategy: null,
      },
    },
    draft: {
      content: 'local fallback content',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'user' },
      ],
    },
  });

  assert.equal(result.content, 'provider response: 2');
  assert.equal(result.model_route.provider, 'deepseek');
  assert.equal(result.model_route.model, 'deepseek-v4-flash');
  assert.equal(result.fallback.applied, false);
});
