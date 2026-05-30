import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadModelConfig } from '../apps/platform/src/model-config.mjs';

test('model config resolves deepseek and routing settings from the local file', () => {
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
      provider: 'deepseek',
      primaryModel: 'file-model',
      defaultReasoningEffort: 'low',
      providers: {
        deepseek: {
          label: 'DeepSeek file',
          mode: 'remote',
          enabled: true,
        },
        local: {
          label: 'Structured local',
          mode: 'local-compose',
          enabled: true,
        },
      },
      fallback: {
        provider: 'local',
        strategy: 'structured-local-compose',
      },
      fallbackChain: [
        {
          provider: 'local',
          strategy: 'structured-local-compose',
        },
      ],
      profiles: {
        deep: {
          provider: 'deepseek',
          model: 'file-model-pro',
          reasoningEffort: 'high',
          budgetTier: 'premium',
        },
      },
    },
    memory: {
      provider: 'mem0_compatible',
      fallbackChain: [
        {
          provider: 'local_builtin',
          reason: 'local_recovery',
        },
      ],
      providers: {
        mem0_compatible: {
          label: 'Mem0 file',
          mode: 'external',
          workspaceIsolated: true,
          personaIsolated: true,
        },
      },
      retrievalPolicy: {
        defaultTopK: 6,
        staleAfterHours: 72,
      },
    },
    wiki: {
      sqlitePath: './data/runtime/wiki-test.sqlite',
      redis: {
        enabled: false,
        keyPrefix: 'toukeagent:test:wiki',
      },
    },
  }, null, 2));

  try {
    const config = loadModelConfig({ configPath, env: {} });

    assert.equal(config.source, 'file');
    assert.equal(config.deepseek.apiKey, 'file-key');
    assert.equal(config.deepseek.model, 'file-model');
    assert.equal(config.routing.primaryModel, 'file-model');
    assert.equal(config.routing.fallback.strategy, 'structured-local-compose');
    assert.equal(config.routing.fallbackChain[0].provider, 'local');
    assert.equal(config.routing.providers.deepseek.label, 'DeepSeek file');
    assert.equal(config.routing.profiles.deep.model, 'file-model-pro');
    assert.equal(config.routing.profiles.deep.provider, 'deepseek');
    assert.equal(config.routing.profiles.fast.reasoning_effort, 'low');
    assert.equal(config.routing.orchestrator, 'legacy');
    assert.equal(config.memory.provider, 'mem0_compatible');
    assert.equal(config.memory.providers.mem0_compatible.label, 'Mem0 file');
    assert.equal(config.memory.retrievalPolicy.defaultTopK, 6);
    assert.equal(config.wiki.sqlitePath, './data/runtime/wiki-test.sqlite');
    assert.equal(config.wiki.redis.keyPrefix, 'toukeagent:test:wiki');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('model config falls back to env values and default routing when the file is missing', () => {
  const config = loadModelConfig({
    configPath: join(tmpdir(), 'toukeagent-missing-model-config.json'),
    env: {
      DEEPSEEK_API_KEY: 'env-key',
      DEEPSEEK_MODEL: 'env-model',
      DEEPSEEK_REASONING_EFFORT: 'high',
    },
  });

  assert.equal(config.source, 'env');
  assert.equal(config.deepseek.apiKey, 'env-key');
  assert.equal(config.deepseek.model, 'env-model');
  assert.equal(config.deepseek.reasoningEffort, 'high');
  assert.equal(config.routing.primaryModel, 'env-model');
  assert.equal(config.routing.defaultReasoningEffort, 'high');
  assert.equal(config.routing.providers.deepseek.model, 'env-model');
  assert.equal(config.routing.fallbackChain[0].provider, 'local');
  assert.equal(config.routing.profiles.deep.reasoning_effort, 'high');
  assert.equal(config.routing.orchestrator, 'legacy');
  assert.deepEqual(config.memory, {});
  assert.deepEqual(config.wiki, {});
});
