import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolRegistry } from '../apps/platform/src/tool-registry.mjs';

test('tool registry retries idempotent low-risk tools on transient failure', async () => {
  const registry = createToolRegistry();
  let attempts = 0;

  registry.register({
    tool_name: 'retryable_tool',
    permissions: ['read_docs'],
    input_schema: { type: 'object', required: ['query'] },
    output_schema: { type: 'object' },
    risk_level: 'low',
    timeout_ms: 100,
    retry_policy: {
      max_attempts: 2,
      retry_on: ['error', 'timeout'],
    },
    idempotent: true,
    side_effect_scope: 'none',
    requires_approval: false,
  }, async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error('transient failure');
    }

    return {
      status: 'success',
      summary: 'Recovered after retry',
      result: { ok: true },
      evidence: [],
      metrics: { latency_ms: 5 },
    };
  });

  const result = await registry.invoke({
    call_id: 'call_retry_1',
    tool_name: 'retryable_tool',
    trace_id: 'trace_retry_1',
    caller: { task_id: 'task_retry_1', persona_id: 'researcher' },
    arguments: { query: 'hello' },
  });

  assert.equal(result.status, 'success');
  assert.equal(attempts, 2);
  assert.equal(result.metrics.attempt_count, 2);
  assert.equal(result.metrics.retry_count, 1);
});

test('tool registry caches successful idempotent calls', async () => {
  const registry = createToolRegistry();
  let attempts = 0;

  registry.register({
    tool_name: 'cached_tool',
    permissions: ['read_docs'],
    input_schema: { type: 'object', required: ['query'] },
    output_schema: { type: 'object' },
    risk_level: 'low',
    timeout_ms: 100,
    retry_policy: { max_attempts: 2, retry_on: ['error', 'timeout'] },
    idempotent: true,
    side_effect_scope: 'none',
    requires_approval: false,
  }, async () => {
    attempts += 1;
    return {
      status: 'success',
      summary: 'Fresh result',
      result: { attempts },
      evidence: [],
      metrics: { latency_ms: 1 },
    };
  });

  const first = await registry.invoke({
    call_id: 'call_cache_1',
    tool_name: 'cached_tool',
    trace_id: 'trace_cache_1',
    caller: { task_id: 'task_cache_1', persona_id: 'researcher' },
    arguments: { query: 'hello' },
  });
  const second = await registry.invoke({
    call_id: 'call_cache_1',
    tool_name: 'cached_tool',
    trace_id: 'trace_cache_1',
    caller: { task_id: 'task_cache_1', persona_id: 'researcher' },
    arguments: { query: 'hello' },
  });

  assert.equal(attempts, 1);
  assert.equal(first.result.attempts, 1);
  assert.equal(second.result.attempts, 1);
  assert.equal(second.metrics.cache_hit, true);
});

test('tool registry does not auto-retry high-risk tools by default', async () => {
  const registry = createToolRegistry();
  let attempts = 0;

  registry.register({
    tool_name: 'high_risk_tool',
    permissions: ['write_state'],
    input_schema: { type: 'object', required: ['value'] },
    output_schema: { type: 'object' },
    risk_level: 'high',
    timeout_ms: 100,
    idempotent: true,
    side_effect_scope: 'external_state',
    requires_approval: false,
  }, async () => {
    attempts += 1;
    throw new Error('permanent failure');
  });

  const result = await registry.invoke({
    call_id: 'call_high_1',
    tool_name: 'high_risk_tool',
    trace_id: 'trace_high_1',
    caller: { task_id: 'task_high_1', persona_id: 'operator' },
    arguments: { value: 'x' },
  });

  assert.equal(result.status, 'error');
  assert.equal(attempts, 1);
  assert.equal(result.metrics.attempt_count, 1);
  assert.equal(result.metrics.retry_count, 0);
});
