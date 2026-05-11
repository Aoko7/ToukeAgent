import test from 'node:test';
import assert from 'node:assert/strict';
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
