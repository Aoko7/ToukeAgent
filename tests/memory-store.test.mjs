import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../apps/platform/src/memory-store.mjs';
import { createPersistentMemoryProvider } from '../apps/platform/src/persistent-memory-provider.mjs';

test('memory store keeps task session context and promotes durable facts', () => {
  const store = createMemoryStore({
    providerStrategy: {
      provider: 'mem0_compatible',
      requested_provider: 'mem0_compatible',
      effective_provider: 'mem0_compatible',
      provider_label: 'Mem0 bridge',
      requested_provider_label: 'Mem0 bridge',
      effective_provider_label: 'Mem0 bridge',
      retrieval_policy: {
        default_top_k: 4,
        stale_after_hours: 24,
      },
    },
  });

  store.appendShortTerm('task_1', {
    trace_id: 'trace_1',
    role: 'user',
    phase: 'received',
    title: 'Inbound message',
    summary: '请以后始终用中文回答',
    content: '请以后始终用中文回答',
    tags: ['message'],
    workspace_id: 'ws_a',
    persona_id: 'researcher',
  });

  const promoted = store.promoteDurableMemory({
    taskId: 'task_1',
    traceId: 'trace_1',
    personaId: 'researcher',
    workspaceId: 'ws_a',
    messageText: '请以后始终用中文回答，并记住我喜欢简洁输出。',
    responseText: '好的，我会保持中文并尽量简洁。',
    plan: { plan_id: 'plan_1' },
  });

  const context = store.buildContext({ taskId: 'task_1', query: '中文 简洁' });
  const search = store.searchLongTerm('简洁输出');

  assert.equal(context.short_term.length, 1);
  assert.ok(context.long_term.length >= 1);
  assert.equal(context.provider, 'mem0_compatible');
  assert.equal(context.provider_label, 'Mem0 bridge');
  assert.equal(context.requested_provider, 'mem0_compatible');
  assert.equal(context.effective_provider, 'mem0_compatible');
  assert.equal(context.fallback_applied, false);
  assert.equal(context.workspace_id, 'ws_a');
  assert.equal(context.persona_id, 'researcher');
  assert.equal(promoted.title, '请以后始终用中文回答，并记住我喜欢简洁输出。');
  assert.ok(search.some((entry) => entry.title.includes('中文回答')));
  assert.ok(search.every((entry) => entry.workspace_id === 'ws_a'));
  assert.ok(search.every((entry) => entry.persona_id === 'researcher'));
});

test('memory store filters by workspace/persona scope and excludes stale durable entries', () => {
  const now = Date.parse('2026-05-14T12:00:00.000Z');
  const store = createMemoryStore({
    providerStrategy: {
      provider: 'local_builtin',
      requested_provider: 'local_builtin',
      effective_provider: 'local_builtin',
      retrieval_policy: {
        default_top_k: 6,
        stale_after_hours: 24,
      },
    },
  });

  store.appendShortTerm('task_scope', {
    trace_id: 'trace_scope',
    role: 'user',
    phase: 'received',
    title: 'Scoped message',
    summary: '记住 AlphaMemoryScope 偏好',
    content: '记住 AlphaMemoryScope 偏好',
    workspace_id: 'ws_scope_a',
    persona_id: 'researcher',
  });

  store.appendLongTerm({
    memory_id: 'mem_scope_fresh',
    title: 'AlphaMemoryScope durable preference',
    summary: 'fresh',
    content: 'AlphaMemoryScope prefers concise Chinese answers',
    workspace_id: 'ws_scope_a',
    persona_id: 'researcher',
    updated_at: '2026-05-14T10:00:00.000Z',
  });
  store.appendLongTerm({
    memory_id: 'mem_scope_other_workspace',
    title: 'AlphaMemoryScope wrong workspace',
    summary: 'other workspace',
    content: 'AlphaMemoryScope should stay hidden from ws_scope_a',
    workspace_id: 'ws_scope_b',
    persona_id: 'researcher',
    updated_at: '2026-05-14T10:00:00.000Z',
  });
  store.appendLongTerm({
    memory_id: 'mem_scope_other_persona',
    title: 'AlphaMemoryScope wrong persona',
    summary: 'other persona',
    content: 'AlphaMemoryScope should stay hidden from researcher scope',
    workspace_id: 'ws_scope_a',
    persona_id: 'retriever',
    updated_at: '2026-05-14T10:00:00.000Z',
  });
  store.appendLongTerm({
    memory_id: 'mem_scope_stale',
    title: 'AlphaMemoryScope stale preference',
    summary: 'stale',
    content: 'AlphaMemoryScope stale preference record',
    workspace_id: 'ws_scope_a',
    persona_id: 'researcher',
    updated_at: '2026-05-10T09:00:00.000Z',
  });

  const scopedSearch = store.searchLongTerm('AlphaMemoryScope', {
    limit: 10,
    workspaceId: 'ws_scope_a',
    personaId: 'researcher',
    now,
  });
  const filteredSearch = store.searchLongTerm('AlphaMemoryScope', {
    limit: 10,
    workspaceId: 'ws_scope_a',
    personaId: 'researcher',
    excludeStale: true,
    now,
  });
  const context = store.buildContext({
    taskId: 'task_scope',
    query: 'AlphaMemoryScope',
    excludeStale: true,
    limit: 10,
    now,
  });

  assert.deepEqual(scopedSearch.map((entry) => entry.memory_id), ['mem_scope_fresh', 'mem_scope_stale']);
  assert.equal(scopedSearch[0].stale, false);
  assert.equal(scopedSearch[1].stale, true);
  assert.deepEqual(filteredSearch.map((entry) => entry.memory_id), ['mem_scope_fresh']);
  assert.equal(context.workspace_id, 'ws_scope_a');
  assert.equal(context.persona_id, 'researcher');
  assert.deepEqual(context.long_term.map((entry) => entry.memory_id), ['mem_scope_fresh']);
});

test('memory store marks expired durable entries stale and filters them from recall', () => {
  const now = Date.parse('2026-05-14T12:00:00.000Z');
  const store = createMemoryStore({
    providerStrategy: {
      provider: 'local_builtin',
      requested_provider: 'local_builtin',
      effective_provider: 'local_builtin',
      retrieval_policy: {
        default_top_k: 6,
        stale_after_hours: 168,
      },
    },
  });

  store.appendShortTerm('task_expiry', {
    trace_id: 'trace_expiry',
    role: 'user',
    phase: 'received',
    title: 'Expiry signal',
    summary: '记住 ExpiryMemorySignal 偏好',
    content: '记住 ExpiryMemorySignal 偏好',
    workspace_id: 'ws_expiry',
    persona_id: 'researcher',
  });

  store.appendLongTerm({
    memory_id: 'mem_expiry_live',
    title: 'ExpiryMemorySignal live preference',
    summary: 'fresh',
    content: 'ExpiryMemorySignal should remain available',
    workspace_id: 'ws_expiry',
    persona_id: 'researcher',
    updated_at: '2026-05-14T11:30:00.000Z',
    expires_at: '2026-05-15T00:00:00.000Z',
  });
  store.appendLongTerm({
    memory_id: 'mem_expiry_dead',
    title: 'ExpiryMemorySignal expired preference',
    summary: 'expired',
    content: 'ExpiryMemorySignal should be treated as expired',
    workspace_id: 'ws_expiry',
    persona_id: 'researcher',
    updated_at: '2026-05-14T11:45:00.000Z',
    expires_at: '2026-05-14T10:00:00.000Z',
  });

  const scopedSearch = store.searchLongTerm('ExpiryMemorySignal', {
    limit: 10,
    workspaceId: 'ws_expiry',
    personaId: 'researcher',
    now,
  });
  const filteredSearch = store.searchLongTerm('ExpiryMemorySignal', {
    limit: 10,
    workspaceId: 'ws_expiry',
    personaId: 'researcher',
    excludeStale: true,
    now,
  });
  const context = store.buildContext({
    taskId: 'task_expiry',
    query: 'ExpiryMemorySignal',
    excludeStale: true,
    limit: 10,
    now,
  });

  assert.deepEqual(scopedSearch.map((entry) => entry.memory_id), ['mem_expiry_live', 'mem_expiry_dead']);
  assert.equal(scopedSearch[0].stale, false);
  assert.equal(scopedSearch[1].stale, true);
  assert.deepEqual(filteredSearch.map((entry) => entry.memory_id), ['mem_expiry_live']);
  assert.deepEqual(context.long_term.map((entry) => entry.memory_id), ['mem_expiry_live']);
});

test('memory store exposes requested/effective provider split after runtime fallback', () => {
  const store = createMemoryStore({
    providerStrategy: {
      provider: 'local_builtin',
      provider_label: 'Local builtin memory',
      requested_provider: 'mem0_compatible',
      requested_provider_label: 'Mem0 bridge',
      effective_provider: 'local_builtin',
      effective_provider_label: 'Local builtin memory',
      fallback_applied: true,
      fallback_reason: 'durable_backend_init_failed:test_unavailable',
      capabilities: {
        short_term: true,
        long_term: true,
        durable_persistence: false,
      },
      requested_capabilities: {
        short_term: true,
        long_term: true,
        durable_persistence: true,
      },
      effective_capabilities: {
        short_term: true,
        long_term: true,
        durable_persistence: false,
      },
      retrieval_policy: {
        default_top_k: 4,
        stale_after_hours: 24,
      },
    },
  });

  const context = store.buildContext({ taskId: 'task_fallback', query: 'anything' });
  const strategy = store.describeStrategy();

  assert.equal(context.provider, 'local_builtin');
  assert.equal(context.requested_provider, 'mem0_compatible');
  assert.equal(context.effective_provider, 'local_builtin');
  assert.equal(context.fallback_applied, true);
  assert.equal(context.fallback_reason, 'durable_backend_init_failed:test_unavailable');
  assert.equal(strategy.provider, 'local_builtin');
  assert.equal(strategy.requested_provider, 'mem0_compatible');
  assert.equal(strategy.effective_provider, 'local_builtin');
  assert.equal(strategy.fallback_applied, true);
});

test('memory store persists durable entries through the file-backed provider for mem0-compatible mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toukeagent-memory-provider-'));
  const filePath = join(dir, 'memory.json');
  const providerStrategy = {
    provider: 'mem0_compatible',
    provider_label: 'Mem0 bridge',
    requested_provider: 'mem0_compatible',
    effective_provider: 'mem0_compatible',
    requested_provider_label: 'Mem0 bridge',
    effective_provider_label: 'Mem0 bridge',
    retrieval_policy: {
      default_top_k: 4,
      stale_after_hours: 24,
    },
  };

  const providerA = createPersistentMemoryProvider({ filePath });
  const storeA = createMemoryStore({
    providerStrategy,
    durableProvider: providerA,
  });

  const promotedA = storeA.promoteDurableMemory({
    taskId: 'task_persist_1',
    traceId: 'trace_persist_1',
    personaId: 'researcher',
    workspaceId: 'ws_persist',
    messageText: '请记住 PersistAlpha 偏好，并始终用中文简洁输出。',
    responseText: '好的，我会记住 PersistAlpha 偏好。',
    plan: { plan_id: 'plan_persist_1' },
  });

  assert.ok(promotedA);
  assert.equal(storeA.describeStrategy().runtime_persistence, 'file_json');

  const providerB = createPersistentMemoryProvider({ filePath });
  const storeB = createMemoryStore({
    providerStrategy,
    durableProvider: providerB,
  });

  const search = storeB.searchLongTerm('PersistAlpha', {
    workspaceId: 'ws_persist',
    personaId: 'researcher',
    excludeStale: true,
  });

  assert.equal(providerB.snapshot().entry_count, 1);
  assert.equal(search.length, 1);
  assert.equal(search[0].workspace_id, 'ws_persist');
  assert.equal(search[0].persona_id, 'researcher');
  assert.match(search[0].title, /PersistAlpha/);
});

test('memory store refreshes durable recall from a shared persistent provider across store instances', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toukeagent-memory-provider-shared-'));
  const filePath = join(dir, 'memory.json');
  const providerStrategy = {
    provider: 'mem0_compatible',
    provider_label: 'Mem0 bridge',
    requested_provider: 'mem0_compatible',
    effective_provider: 'mem0_compatible',
    requested_provider_label: 'Mem0 bridge',
    effective_provider_label: 'Mem0 bridge',
    retrieval_policy: {
      default_top_k: 4,
      stale_after_hours: 24,
    },
  };

  const providerA = createPersistentMemoryProvider({ filePath });
  const providerB = createPersistentMemoryProvider({ filePath });
  const storeA = createMemoryStore({
    providerStrategy,
    durableProvider: providerA,
  });
  const storeB = createMemoryStore({
    providerStrategy,
    durableProvider: providerB,
  });

  const promoted = storeA.promoteDurableMemory({
    taskId: 'task_shared_persist_1',
    traceId: 'trace_shared_persist_1',
    personaId: 'researcher',
    workspaceId: 'ws_shared_persist',
    messageText: '请记住 SharedPersistAlpha 偏好，并始终用中文简洁输出。',
    responseText: '好的，我会记住 SharedPersistAlpha 偏好。',
    plan: { plan_id: 'plan_shared_persist_1' },
  });

  const search = storeB.searchLongTerm('SharedPersistAlpha', {
    workspaceId: 'ws_shared_persist',
    personaId: 'researcher',
    excludeStale: true,
  });
  const context = storeB.buildContext({
    taskId: 'task_shared_persist_1',
    query: 'SharedPersistAlpha',
    workspaceId: 'ws_shared_persist',
    personaId: 'researcher',
    excludeStale: true,
  });

  assert.ok(promoted);
  assert.equal(search.length, 1);
  assert.equal(search[0].workspace_id, 'ws_shared_persist');
  assert.equal(search[0].persona_id, 'researcher');
  assert.equal(context.long_term.length, 1);
  assert.match(context.long_term[0].title, /SharedPersistAlpha/);
});

test('memory store does not promote one-off reminder text into durable memory', () => {
  const store = createMemoryStore({
    providerStrategy: {
      provider: 'local_builtin',
      requested_provider: 'local_builtin',
      effective_provider: 'local_builtin',
      write_policy: {
        allow_auto_promote: true,
        durable_write_threshold: 0.85,
      },
    },
  });

  const promoted = store.promoteDurableMemory({
    taskId: 'task_temp_1',
    traceId: 'trace_temp_1',
    personaId: 'researcher',
    workspaceId: 'ws_temp',
    messageText: '明天早上十点提醒我提交日报。',
    responseText: '好的，我会提醒你。',
    plan: { plan_id: 'plan_temp_1' },
  });

  assert.equal(promoted, null);
  assert.equal(store.listLongTerm({ workspaceId: 'ws_temp', personaId: 'researcher' }).length, 0);
});
