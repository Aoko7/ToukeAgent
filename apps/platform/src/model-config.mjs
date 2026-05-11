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

export function loadModelConfig({
  configPath = DEFAULT_MODEL_CONFIG_PATH,
  env = process.env,
} = {}) {
  const fileConfig = readJsonFile(configPath);

  if (fileConfig !== null && !isPlainObject(fileConfig)) {
    throw new Error(`Model config at ${configPath} must be a JSON object`);
  }

  const deepseekConfig = fileConfig?.deepseek ?? {};

  if (fileConfig !== null && !isPlainObject(deepseekConfig)) {
    throw new Error(`Model config at ${configPath} must contain a "deepseek" object`);
  }

  return {
    configPath,
    source: fileConfig === null ? 'env' : 'file',
    deepseek: resolveDeepSeekConfig(deepseekConfig, env),
  };
}
