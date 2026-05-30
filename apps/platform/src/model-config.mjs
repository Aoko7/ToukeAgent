import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MODEL_CONFIG_PATH = fileURLToPath(new URL('../../../config/model-config.local.json', import.meta.url));

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJsonFile(configPath) {
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse model config at ${configPath}: ${error.message}`);
    }

    throw error;
  }
}

function resolveDeepSeekConfig(source = {}, env = process.env) {
  return {
    apiKey: source.apiKey ?? env.DEEPSEEK_API_KEY ?? null,
    baseUrl: source.baseUrl ?? env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    model: source.model ?? env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
    reasoningEffort: source.reasoningEffort ?? env.DEEPSEEK_REASONING_EFFORT ?? 'medium',
  };
}

function resolveRoutingProfile(source = {}, fallback = {}) {
  return {
    provider: source.provider ?? fallback.provider ?? null,
    model: source.model ?? fallback.model ?? null,
    reasoning_effort: source.reasoningEffort ?? source.reasoning_effort ?? fallback.reasoning_effort ?? 'medium',
    budget_tier: source.budgetTier ?? source.budget_tier ?? fallback.budget_tier ?? 'balanced',
  };
}

function resolveRoutingProvider(source = {}, fallback = {}, providerId = fallback.provider ?? 'unknown') {
  return {
    provider: providerId,
    label: source.label ?? fallback.label ?? providerId,
    mode: source.mode ?? fallback.mode ?? (providerId === 'local' ? 'local-compose' : 'remote'),
    enabled: source.enabled ?? fallback.enabled ?? true,
    available: source.available ?? fallback.available ?? null,
    model: source.model ?? fallback.model ?? null,
    reasoning_effort: source.reasoningEffort ?? source.reasoning_effort ?? fallback.reasoning_effort ?? null,
  };
}

function resolveFallbackEntry(source = {}, fallback = {}) {
  const providerId = source.provider ?? fallback.provider ?? 'local';
  return {
    provider: providerId,
    label: source.label ?? fallback.label ?? providerId,
    strategy: source.strategy ?? source.mode ?? fallback.strategy ?? fallback.mode ?? (providerId === 'local' ? 'local-compose' : 'remote'),
    mode: source.mode ?? fallback.mode ?? (providerId === 'local' ? 'local-compose' : 'remote'),
    enabled: source.enabled ?? fallback.enabled ?? true,
  };
}

function resolveRoutingConfig(source = {}, deepseekConfig = {}) {
  const provider = source.provider ?? 'deepseek';
  const primaryModel = source.primaryModel ?? deepseekConfig.model ?? null;
  const defaultReasoningEffort = source.defaultReasoningEffort ?? deepseekConfig.reasoningEffort ?? 'medium';
  const fallbackSource = isPlainObject(source.fallback) ? source.fallback : {};
  const profileSource = isPlainObject(source.profiles) ? source.profiles : {};
  const providerSource = isPlainObject(source.providers) ? source.providers : {};
  const defaultProfiles = {
    fast: {
      provider,
      model: primaryModel,
      reasoning_effort: 'low',
      budget_tier: 'economy',
    },
    balanced: {
      provider,
      model: primaryModel,
      reasoning_effort: defaultReasoningEffort,
      budget_tier: 'balanced',
    },
    deep: {
      provider,
      model: primaryModel,
      reasoning_effort: 'high',
      budget_tier: 'premium',
    },
  };

  const profiles = Object.fromEntries(
    Object.entries({
      ...defaultProfiles,
      ...profileSource,
    }).map(([name, profile]) => [
      name,
      resolveRoutingProfile(profile, defaultProfiles[name] ?? {
        model: primaryModel,
        reasoning_effort: defaultReasoningEffort,
        budget_tier: 'balanced',
      }),
    ]),
  );

  const defaultProviders = {
    [provider]: {
      label: `${provider} primary`,
      mode: 'remote',
      enabled: true,
      available: null,
      model: primaryModel,
      reasoning_effort: defaultReasoningEffort,
    },
    local: {
      label: 'local compose',
      mode: 'local-compose',
      enabled: true,
      available: true,
      model: null,
      reasoning_effort: 'none',
    },
  };

  const providers = Object.fromEntries(
    Object.entries({
      ...defaultProviders,
      ...providerSource,
    }).map(([name, providerConfig]) => [
      name,
      resolveRoutingProvider(providerConfig, defaultProviders[name] ?? {}, name),
    ]),
  );

  const fallbackChainSource = Array.isArray(source.fallbackChain) && source.fallbackChain.length > 0
    ? source.fallbackChain
    : [fallbackSource];
  const fallbackChain = fallbackChainSource
    .filter((entry) => entry !== null && entry !== undefined)
    .map((entry, index) => resolveFallbackEntry(
      isPlainObject(entry) ? entry : { provider: String(entry) },
      index === 0 ? fallbackSource : {},
    ));
  const normalizedFallbackChain = fallbackChain.length > 0
    ? fallbackChain
    : [resolveFallbackEntry({ provider: 'local', strategy: 'local-compose', mode: 'local-compose' })];

  return {
    provider,
    primaryModel,
    defaultReasoningEffort,
    fallback: normalizedFallbackChain[0],
    fallbackChain: normalizedFallbackChain,
    providers,
    profiles,
    orchestrator: source.orchestrator ?? 'legacy',
  };
}

export function loadModelConfig({
  configPath = DEFAULT_MODEL_CONFIG_PATH,
  env = process.env,
} = {}) {
  const fileConfig = readJsonFile(configPath);

  if (fileConfig !== null && !isPlainObject(fileConfig)) {
    throw new Error(`Model config at ${configPath} must be a JSON object`);
  }

  const deepseekConfig = fileConfig?.deepseek ?? {};
  const routingConfig = fileConfig?.routing ?? {};
  const memoryConfig = fileConfig?.memory ?? {};
  const wikiConfig = fileConfig?.wiki ?? {};

  if (fileConfig !== null && !isPlainObject(deepseekConfig)) {
    throw new Error(`Model config at ${configPath} must contain a "deepseek" object`);
  }

  if (fileConfig !== null && !isPlainObject(routingConfig)) {
    throw new Error(`Model config at ${configPath} must contain a "routing" object`);
  }

  if (fileConfig !== null && !isPlainObject(memoryConfig)) {
    throw new Error(`Model config at ${configPath} must contain a "memory" object`);
  }

  if (fileConfig !== null && !isPlainObject(wikiConfig)) {
    throw new Error(`Model config at ${configPath} must contain a "wiki" object`);
  }

  const resolvedDeepseekConfig = resolveDeepSeekConfig(deepseekConfig, env);

  return {
    configPath,
    source: fileConfig === null ? 'env' : 'file',
    deepseek: resolvedDeepseekConfig,
    routing: resolveRoutingConfig(routingConfig, resolvedDeepseekConfig),
    memory: structuredClone(memoryConfig),
    wiki: structuredClone(wikiConfig),
  };
}
