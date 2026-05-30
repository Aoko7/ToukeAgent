import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeepSeekClient } from '../apps/platform/src/deepseek-client.mjs';

test('deepseek client builds OpenAI-compatible request', async () => {
  let captured = null;
  const client = createDeepSeekClient({
    apiKey: 'test-key',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({
        model: 'deepseek-v4-flash',
        choices: [{ message: { content: 'hello world' } }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await client.chat({
    messages: [{ role: 'user', content: 'hi' }],
    reasoningEffort: 'high',
  });

  assert.equal(client.isConfigured, true);
  assert.equal(captured.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(JSON.parse(captured.options.body).model, 'deepseek-v4-flash');
  assert.equal(JSON.parse(captured.options.body).reasoning_effort, 'high');
  assert.equal(result.content, 'hello world');
});

test('deepseek client prefers dedicated config file over env fallback', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'toukeagent-model-config-'));
  const configPath = join(tempDir, 'model-config.local.json');
  writeFileSync(configPath, JSON.stringify({
    deepseek: {
      apiKey: 'file-key',
      baseUrl: 'https://file.example',
      model: 'file-model',
      reasoningEffort: 'low',
    },
    routing: {
      providers: {
        deepseek: {
          label: 'DeepSeek file',
          mode: 'remote',
          enabled: true,
        },
      },
      fallbackChain: [
        {
          provider: 'local',
          strategy: 'local-compose',
        },
      ],
      profiles: {
        deep: {
          model: 'file-model-pro',
          reasoningEffort: 'high',
          budgetTier: 'premium',
        },
      },
    },
  }, null, 2));

  try {
    let captured = null;
    const client = createDeepSeekClient({
      configPath,
      env: {
        DEEPSEEK_API_KEY: 'env-key',
        DEEPSEEK_BASE_URL: 'https://env.example',
        DEEPSEEK_MODEL: 'env-model',
        DEEPSEEK_REASONING_EFFORT: 'high',
      },
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return new Response(JSON.stringify({
          model: 'file-model',
          choices: [{ message: { content: 'from file config' } }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const result = await client.chat({
      messages: [{ role: 'user', content: 'hi' }],
    });

    assert.equal(client.isConfigured, true);
    assert.equal(client.configSource, 'file');
    assert.equal(client.configPath, configPath);
    assert.equal(client.providerId, 'deepseek');
    assert.equal(client.baseUrl, 'https://file.example');
    assert.equal(client.model, 'file-model');
    assert.equal(client.reasoningEffort, 'low');
    assert.equal(client.routingConfig.fallbackChain[0].provider, 'local');
    assert.equal(client.routingConfig.profiles.deep.model, 'file-model-pro');
    assert.equal(captured.url, 'https://file.example/chat/completions');
    assert.equal(JSON.parse(captured.options.body).model, 'file-model');
    assert.equal(JSON.parse(captured.options.body).reasoning_effort, 'low');
    assert.equal(captured.options.headers.authorization, 'Bearer file-key');
    assert.equal(result.content, 'from file config');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('deepseek client falls back to env when local config file is missing', async () => {
  let captured = null;
  const client = createDeepSeekClient({
    configPath: join(tmpdir(), 'toukeagent-missing-model-config.json'),
    env: {
      DEEPSEEK_API_KEY: 'env-key',
      DEEPSEEK_BASE_URL: 'https://env.example',
      DEEPSEEK_MODEL: 'env-model',
      DEEPSEEK_REASONING_EFFORT: 'high',
    },
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({
        model: 'env-model',
        choices: [{ message: { content: 'from env config' } }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await client.chat({
    messages: [{ role: 'user', content: 'hi' }],
  });

  assert.equal(client.isConfigured, true);
  assert.equal(client.configSource, 'env');
  assert.equal(client.baseUrl, 'https://env.example');
  assert.equal(client.model, 'env-model');
  assert.equal(client.reasoningEffort, 'high');
  assert.equal(captured.url, 'https://env.example/chat/completions');
  assert.equal(JSON.parse(captured.options.body).model, 'env-model');
  assert.equal(JSON.parse(captured.options.body).reasoning_effort, 'high');
  assert.equal(captured.options.headers.authorization, 'Bearer env-key');
  assert.equal(result.content, 'from env config');
});

test('deepseek client supports per-call model overrides for routing decisions', async () => {
  let captured = null;
  const client = createDeepSeekClient({
    apiKey: 'test-key',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({
        model: 'deepseek-v4-pro',
        choices: [{ message: { content: 'routed result' } }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await client.chat({
    model: 'deepseek-v4-pro',
    messages: [{ role: 'user', content: 'hi' }],
    reasoningEffort: 'high',
  });

  assert.equal(JSON.parse(captured.options.body).model, 'deepseek-v4-pro');
  assert.equal(result.model, 'deepseek-v4-pro');
  assert.equal(result.content, 'routed result');
});
