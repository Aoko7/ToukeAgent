import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelRouter } from '../apps/platform/src/model-router.mjs';

test('model router chooses fast profile for low-budget latency-sensitive work', () => {
  const router = createModelRouter({
    provider: 'deepseek',
    primaryModel: 'deepseek-v4-flash',
    defaultReasoningEffort: 'medium',
    isPrimaryConfigured: true,
  });

  const route = router.route({
    message: {
      content: [{ type: 'text', text: 'Quick summary please' }],
      metadata: {
        budget_tier: 'low',
      },
      risk_flags: [],
    },
    plan: {
      goal: 'Summarize quickly',
      steps: [{}, {}],
    },
    memorySnapshot: {
      short_term: [],
      long_term: [],
    },
    retrievalResult: {
      items: [],
    },
  });

  assert.equal(route.provider, 'deepseek');
  assert.equal(route.profile, 'fast');
  assert.equal(route.reasoning_effort, 'low');
  assert.equal(route.fallback.applied, false);
});

test('model router chooses deep profile for complex high-quality work', () => {
  const router = createModelRouter({
    provider: 'deepseek',
    primaryModel: 'deepseek-v4-flash',
    defaultReasoningEffort: 'medium',
    isPrimaryConfigured: true,
  });

  const route = router.route({
    message: {
      content: [{ type: 'text', text: 'Please provide a detailed and rigorous analysis of the system design.' }],
      metadata: {
        quality_tier: 'high',
        context_token_estimate: 7200,
      },
      risk_flags: [],
    },
    plan: {
      goal: 'Analyze the system',
      steps: [{}, {}, {}, {}],
    },
    memorySnapshot: {
      short_term: [{}, {}, {}],
      long_term: [{}, {}],
    },
    retrievalResult: {
      items: [{}, {}, {}],
    },
  });

  assert.equal(route.provider, 'deepseek');
  assert.equal(route.profile, 'deep');
  assert.equal(route.reasoning_effort, 'high');
  assert.ok(route.selection_reason.includes('profile=deep'));
});

test('model router falls back to local compose when primary provider is unavailable', () => {
  const router = createModelRouter({
    provider: 'deepseek',
    primaryModel: 'deepseek-v4-flash',
    defaultReasoningEffort: 'medium',
    isPrimaryConfigured: false,
    providers: {
      deepseek: {
        label: 'DeepSeek primary',
        mode: 'remote',
        enabled: true,
      },
      local: {
        label: 'Local compose',
        mode: 'local-compose',
        enabled: true,
      },
    },
  });

  const route = router.route({
    message: {
      content: [{ type: 'text', text: 'hello world' }],
      metadata: {},
      risk_flags: [],
    },
    plan: {
      goal: 'Say hello',
      steps: [{}, {}],
    },
  });

  assert.equal(route.provider, 'local');
  assert.equal(route.mode, 'local-compose');
  assert.equal(route.fallback.applied, true);
  assert.equal(route.fallback.reason, 'primary_not_configured');
});

test('model router uses configured profile models and fallback policy', () => {
  const router = createModelRouter({
    provider: 'deepseek',
    primaryModel: 'deepseek-v4-flash',
    defaultReasoningEffort: 'medium',
    isPrimaryConfigured: true,
    profiles: {
      fast: {
        model: 'deepseek-v4-flash',
        reasoningEffort: 'low',
        budgetTier: 'economy',
      },
      balanced: {
        model: 'deepseek-v4-flash',
        reasoningEffort: 'medium',
        budgetTier: 'balanced',
      },
      deep: {
        model: 'deepseek-v4-pro',
        reasoningEffort: 'high',
        budgetTier: 'premium',
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
  });

  const route = router.route({
    message: {
      content: [{ type: 'text', text: 'Please provide a detailed and rigorous analysis.' }],
      metadata: {
        quality_tier: 'high',
      },
      risk_flags: [],
    },
    plan: {
      goal: 'Analyze the system',
      steps: [{}, {}, {}],
    },
    memorySnapshot: {
      short_term: [],
      long_term: [],
    },
  });

  const policy = router.getPolicy();

  assert.equal(route.profile, 'deep');
  assert.equal(route.model, 'deepseek-v4-pro');
  assert.equal(route.reasoning_effort, 'high');
  assert.equal(policy.fallback.strategy, 'structured-local-compose');
  assert.equal(policy.fallback_chain[0].provider, 'local');
  assert.equal(policy.providers.local.mode, 'local-compose');
  assert.equal(policy.profiles.deep.model, 'deepseek-v4-pro');
});

test('model router falls back through the provider chain when the preferred provider is unavailable', () => {
  const router = createModelRouter({
    provider: 'alpha',
    primaryModel: 'alpha-model',
    defaultReasoningEffort: 'medium',
    isPrimaryConfigured: false,
    profiles: {
      balanced: {
        provider: 'alpha',
        model: 'alpha-model',
        reasoningEffort: 'medium',
        budgetTier: 'balanced',
      },
    },
    providers: {
      alpha: {
        label: 'Alpha remote',
        mode: 'remote',
        enabled: true,
        available: false,
      },
      local: {
        label: 'Local compose',
        mode: 'local-compose',
        enabled: true,
        available: true,
      },
    },
    fallbackChain: [
      { provider: 'local', strategy: 'local-compose' },
    ],
  });

  const route = router.route({
    message: {
      content: [{ type: 'text', text: 'route via fallback chain' }],
      metadata: {
        model_provider: 'alpha',
      },
      risk_flags: [],
    },
    plan: {
      goal: 'Route via chain',
      steps: [{}, {}],
    },
  });

  assert.equal(route.provider, 'local');
  assert.equal(route.mode, 'local-compose');
  assert.equal(route.fallback.applied, true);
  assert.equal(route.fallback.preferred_provider, 'alpha');
  assert.equal(route.fallback.candidates[0].provider, 'local');
});
