import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../apps/platform/src/memory-store.mjs';

test('memory store keeps task session context and promotes durable facts', () => {
  const store = createMemoryStore();

  store.appendShortTerm('task_1', {
    trace_id: 'trace_1',
    role: 'user',
    phase: 'received',
    title: 'Inbound message',
    summary: '请以后始终用中文回答',
    content: '请以后始终用中文回答',
    tags: ['message'],
  });

  const promoted = store.promoteDurableMemory({
    taskId: 'task_1',
    traceId: 'trace_1',
    personaId: 'researcher',
    messageText: '请以后始终用中文回答，并记住我喜欢简洁输出。',
    responseText: '好的，我会保持中文并尽量简洁。',
    plan: { plan_id: 'plan_1' },
  });

  const context = store.buildContext({ taskId: 'task_1', query: '中文 简洁' });
  const search = store.searchLongTerm('简洁输出');

  assert.equal(context.short_term.length, 1);
  assert.ok(context.long_term.length >= 1);
  assert.equal(promoted.title, '请以后始终用中文回答，并记住我喜欢简洁输出。');
  assert.ok(search.some((entry) => entry.title.includes('中文回答')));
});
