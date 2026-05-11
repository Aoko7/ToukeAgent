import { loadModelConfig } from './model-config.mjs';

export function createDeepSeekClient({
  apiKey,
  baseUrl,
  model,
  reasoningEffort,
  configPath,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const hasExplicitOverrides = apiKey !== undefined || baseUrl !== undefined || model !== undefined || reasoningEffort !== undefined;
  const modelConfig = hasExplicitOverrides ? null : loadModelConfig({ configPath, env });
  const deepseekConfig = modelConfig?.deepseek ?? {};
  const resolvedApiKey = apiKey ?? deepseekConfig.apiKey ?? env.DEEPSEEK_API_KEY ?? null;
  const resolvedBaseUrl = baseUrl ?? deepseekConfig.baseUrl ?? env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
  const resolvedModel = model ?? deepseekConfig.model ?? env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';
  const resolvedReasoningEffort = reasoningEffort ?? deepseekConfig.reasoningEffort ?? env.DEEPSEEK_REASONING_EFFORT ?? 'medium';

  async function chat({
    messages,
    stream = false,
    thinking = { type: 'enabled' },
    reasoningEffort = resolvedReasoningEffort,
    maxTokens = 1024,
    temperature = 0.2,
    responseFormat = undefined,
  }) {
    if (!resolvedApiKey) {
      throw new Error('DeepSeek API key is not configured');
    }

    const response = await fetchImpl(`${resolvedBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${resolvedApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: resolvedModel,
        messages,
        stream,
        thinking,
        reasoning_effort: reasoningEffort,
        max_tokens: maxTokens,
        temperature,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek chat request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0] ?? {};
    const message = choice.message ?? {};

    return {
      model: data.model ?? resolvedModel,
      content: message.content ?? '',
      reasoning_content: message.reasoning_content ?? null,
      usage: data.usage ?? null,
      raw: data,
    };
  }

  return {
    baseUrl: resolvedBaseUrl,
    model: resolvedModel,
    reasoningEffort: resolvedReasoningEffort,
    configPath: modelConfig?.configPath ?? configPath ?? null,
    configSource: hasExplicitOverrides ? 'explicit' : modelConfig?.source ?? 'env',
    isConfigured: Boolean(resolvedApiKey),
    chat,
  };
}
