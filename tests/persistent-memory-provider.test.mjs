import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPersistentMemoryProvider } from '../apps/platform/src/persistent-memory-provider.mjs';

test('persistent memory provider survives reload and upserts by durable key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toukeagent-persistent-memory-'));
  const filePath = join(dir, 'memory.json');

  const providerA = createPersistentMemoryProvider({ filePath });
  providerA.upsertLongTerm({
    memory_id: 'mem_a',
    title: 'Persisted preference',
    facts: ['fact_a'],
    workspace_id: 'ws_a',
    persona_id: 'researcher',
    created_at: '2026-05-14T00:00:00.000Z',
    updated_at: '2026-05-14T00:00:00.000Z',
    metadata: {
      durable_key: 'ws_a::researcher::Persisted preference',
    },
  });

  const providerB = createPersistentMemoryProvider({ filePath });
  assert.equal(providerB.snapshot().entry_count, 1);
  assert.equal(providerB.listLongTerm()[0].title, 'Persisted preference');

  providerB.upsertLongTerm({
    memory_id: 'mem_b',
    title: 'Persisted preference',
    facts: ['fact_b'],
    workspace_id: 'ws_a',
    persona_id: 'researcher',
    created_at: '2026-05-14T00:00:00.000Z',
    updated_at: '2026-05-14T02:00:00.000Z',
    metadata: {
      durable_key: 'ws_a::researcher::Persisted preference',
    },
  });

  const providerC = createPersistentMemoryProvider({ filePath });
  const entries = providerC.listLongTerm();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].memory_id, 'mem_b');
  assert.equal(entries[0].facts[0], 'fact_b');
});

test('persistent memory provider refreshes shared file state across concurrent instances', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toukeagent-persistent-memory-shared-'));
  const filePath = join(dir, 'memory.json');

  const providerA = createPersistentMemoryProvider({ filePath });
  const providerB = createPersistentMemoryProvider({ filePath });

  providerA.upsertLongTerm({
    memory_id: 'mem_shared_a',
    title: 'Shared preference A',
    facts: ['fact_shared_a'],
    workspace_id: 'ws_shared',
    persona_id: 'researcher',
    created_at: '2026-05-14T00:00:00.000Z',
    updated_at: '2026-05-14T00:00:00.000Z',
    metadata: {
      durable_key: 'ws_shared::researcher::Shared preference A',
    },
    stale: true,
    score: 0.99,
  });

  providerB.upsertLongTerm({
    memory_id: 'mem_shared_b',
    title: 'Shared preference B',
    facts: ['fact_shared_b'],
    workspace_id: 'ws_shared',
    persona_id: 'researcher',
    created_at: '2026-05-14T01:00:00.000Z',
    updated_at: '2026-05-14T01:00:00.000Z',
    metadata: {
      durable_key: 'ws_shared::researcher::Shared preference B',
    },
    lexical_score: 0.8,
    score_breakdown: { lexical: 0.4 },
  });

  const sharedEntries = providerA.listLongTerm();
  assert.deepEqual(sharedEntries.map((entry) => entry.memory_id).sort(), ['mem_shared_a', 'mem_shared_b']);
  assert.equal(Object.prototype.hasOwnProperty.call(sharedEntries[0], 'score'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sharedEntries[0], 'stale'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sharedEntries[1], 'score_breakdown'), false);
});
