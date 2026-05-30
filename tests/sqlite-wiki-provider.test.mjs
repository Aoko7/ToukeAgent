import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSQLiteWikiProvider } from '../apps/platform/src/sqlite-wiki-provider.mjs';
import { createWikiStore } from '../apps/platform/src/wiki-store.mjs';

test('sqlite wiki provider persists entries, history, and proposals across store instances', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toukeagent-wiki-sqlite-'));
  const filePath = join(dir, 'wiki.sqlite');
  const providerA = createSQLiteWikiProvider({ filePath });
  const storeA = createWikiStore({ durableProvider: providerA, entries: [] });

  storeA.upsert({
    entry_id: 'wiki_sqlite_1',
    title: 'SQLite wiki status',
    summary: 'v1',
    facts: ['fact v1'],
    tags: ['status'],
    source: 'manual',
  });
  storeA.upsert({
    entry_id: 'wiki_sqlite_1',
    title: 'SQLite wiki status',
    summary: 'v2',
    facts: ['fact v2'],
    tags: ['status', 'updated'],
    source: 'manual',
  });
  const proposal = storeA.createProposal({
    entry_id: 'wiki_sqlite_1',
    base_version: 2,
    title: 'SQLite wiki status',
    summary: 'v3 draft',
    facts: ['fact v3'],
    tags: ['status', 'draft'],
    source: 'llm',
  });

  const providerB = createSQLiteWikiProvider({ filePath });
  const storeB = createWikiStore({ durableProvider: providerB, entries: [] });

  assert.equal(storeB.get('wiki_sqlite_1').summary, 'v2');
  assert.equal(storeB.getHistory('wiki_sqlite_1').length, 1);
  assert.equal(storeB.getProposal(proposal.proposal_id)?.proposed_entry?.summary, 'v3 draft');
  assert.equal(storeB.listProposals({ includeResolved: true }).length, 1);
  assert.equal(providerB.snapshot().entry_count, 1);
});
