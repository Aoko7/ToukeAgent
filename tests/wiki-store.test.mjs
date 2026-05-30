import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWikiStore } from '../apps/platform/src/wiki-store.mjs';
import { createSQLiteWikiProvider } from '../apps/platform/src/sqlite-wiki-provider.mjs';
import { createWikiSubsystem } from '../apps/platform/src/wiki-runtime.mjs';

test('wiki store supports write, update, expire, and query', () => {
  const store = createWikiStore();

  const first = store.upsert({
    entry_id: 'wiki_custom_status',
    title: 'Custom status page',
    summary: 'Latest release and pricing notes',
    facts: ['release 1.2', 'price changed'],
    tags: ['status', 'version', 'pricing'],
    owner: 'custom_owner',
    required_context: ['product_scope'],
    retrieval_hints: ['release', 'pricing'],
    ttl_seconds: 3600,
    source_of_truth: 'custom_status_wiki',
    source: 'manual',
  });

  const second = store.upsert({
    entry_id: 'wiki_custom_status',
    title: 'Custom status page',
    summary: 'Latest release and pricing notes, updated',
    facts: ['release 1.3', 'price changed again'],
    tags: ['status', 'version', 'pricing'],
    source: 'manual',
  });

  const query = store.query({ query: 'latest version pricing status', limit: 3 });
  const expired = store.expire('wiki_custom_status', { reason: 'outdated' });

  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.ok(query.some((entry) => entry.entry_id === 'wiki_custom_status'));
  assert.equal(query.find((entry) => entry.entry_id === 'wiki_custom_status').owner, 'custom_owner');
  assert.deepEqual(query.find((entry) => entry.entry_id === 'wiki_custom_status').required_context, ['product_scope']);
  assert.equal(expired.status, 'expired');
  assert.equal(store.getHistory('wiki_custom_status').length, 2);
  assert.ok(store.list().every((entry) => entry.status !== 'expired'));
  assert.ok(store.list({ includeExpired: true }).some((entry) => entry.entry_id === 'wiki_custom_status'));
});

test('wiki store supports archive and soft delete lifecycle states', () => {
  const store = createWikiStore();

  store.upsert({
    entry_id: 'wiki_archive_case',
    title: 'Archive candidate',
    summary: 'Candidate for archival',
    facts: ['stable but inactive'],
    tags: ['archive'],
    source: 'manual',
  });
  store.upsert({
    entry_id: 'wiki_delete_case',
    title: 'Delete candidate',
    summary: 'Candidate for soft delete',
    facts: ['incorrect fact'],
    tags: ['delete'],
    source: 'manual',
  });

  const archived = store.archive('wiki_archive_case', { reason: 'inactive' });
  const deleted = store.softDelete('wiki_delete_case', { reason: 'retracted' });

  assert.equal(archived.status, 'archived');
  assert.equal(deleted.status, 'deleted');
  assert.equal(deleted.deleted, true);
  assert.ok(!store.list().some((entry) => entry.entry_id === 'wiki_archive_case'));
  assert.ok(!store.list().some((entry) => entry.entry_id === 'wiki_delete_case'));
  assert.ok(store.list({ includeArchived: true }).some((entry) => entry.entry_id === 'wiki_archive_case'));
  assert.ok(store.list({ includeDeleted: true }).some((entry) => entry.entry_id === 'wiki_delete_case'));
  assert.ok(store.getHistory('wiki_archive_case').length >= 1);
  assert.ok(store.getHistory('wiki_delete_case').length >= 1);
});

test('wiki store supports proposal review, conflict merge, and rollback', () => {
  const store = createWikiStore();

  const created = store.upsert({
    entry_id: 'wiki_review_case',
    title: 'Provider status',
    summary: 'Version 1 summary',
    facts: ['stable fact'],
    tags: ['status'],
    source: 'manual',
  });

  const pendingProposal = store.createProposal({
    entry_id: 'wiki_review_case',
    base_version: created.version,
    title: 'Provider status',
    summary: 'Version 2 summary',
    facts: ['stable fact', 'approved fact'],
    tags: ['status', 'approved'],
    source: 'llm',
  });

  const approved = store.reviewProposal(pendingProposal.proposal_id, {
    decision: 'approved',
    reviewer_id: 'reviewer_1',
    notes: 'looks good',
  });

  const updated = store.get('wiki_review_case');
  assert.equal(pendingProposal.status, 'pending_review');
  assert.equal(approved.proposal.status, 'approved');
  assert.equal(approved.entry.version, 2);
  assert.equal(updated.summary, 'Version 2 summary');

  const conflictProposal = store.createProposal({
    entry_id: 'wiki_review_case',
    base_version: 1,
    title: 'Provider status',
    summary: 'Merged summary',
    facts: ['conflicting fact'],
    tags: ['status', 'conflict'],
    source: 'llm',
  });

  assert.equal(conflictProposal.status, 'conflict');
  assert.equal(conflictProposal.conflict.current_version, 2);

  const merged = store.reviewProposal(conflictProposal.proposal_id, {
    decision: 'approved',
    reviewer_id: 'reviewer_2',
    merge_strategy: 'combine',
    notes: 'merge facts and tags',
  });

  const rolledBack = store.rollback('wiki_review_case', {
    target_version: 1,
    reviewer_id: 'reviewer_3',
    reason: 'restore baseline',
  });

  assert.equal(merged.proposal.merge_strategy, 'combine');
  assert.ok(merged.entry.facts.includes('stable fact'));
  assert.ok(merged.entry.facts.includes('conflicting fact'));
  assert.ok(merged.entry.tags.includes('conflict'));
  assert.equal(rolledBack.version, 4);
  assert.equal(rolledBack.summary, 'Version 1 summary');
  assert.equal(store.getHistory('wiki_review_case').length, 3);
  assert.equal(store.listProposals({ entryId: 'wiki_review_case' }).length, 0);
  assert.equal(store.listProposals({ entryId: 'wiki_review_case', includeResolved: true }).length, 2);
});

test('wiki store supports Chinese project-status lookups through tags, facts, and retrieval hints', () => {
  const store = createWikiStore([]);

  store.upsert({
    entry_id: 'wiki_project_pretraining_status',
    title: 'Project pretraining status',
    summary: 'Current pretraining milestones and progress snapshot for the project.',
    facts: ['BinMAE 预训练已经完成，当前 loss 为 0.61。'],
    tags: ['project', 'status', '当前', '状态', '预训练'],
    owner: 'project_ops',
    required_context: ['project_scope'],
    retrieval_hints: ['预训练状态', '当前预训练状态'],
    ttl_seconds: 1209600,
    source_of_truth: 'private-notes/project-briefing.md',
    source: 'manual',
  });

  const query = store.query({ query: '当前预训练状态是什么', limit: 2 });
  assert.equal(query.length, 1);
  assert.equal(query[0].entry_id, 'wiki_project_pretraining_status');
  assert.equal(query[0].owner, 'project_ops');
});

test('wiki store can reload persisted sqlite-backed state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toukeagent-wiki-store-'));
  const filePath = join(dir, 'wiki.sqlite');
  const provider = createSQLiteWikiProvider({ filePath });
  const storeA = createWikiStore({ durableProvider: provider, entries: [] });
  storeA.upsert({
    entry_id: 'wiki_persist_case',
    title: 'Persisted wiki',
    summary: 'persisted summary',
    facts: ['persisted fact'],
    tags: ['persisted'],
    source: 'manual',
  });

  const storeB = createWikiStore({
    durableProvider: createSQLiteWikiProvider({ filePath }),
    entries: [],
  });
  assert.equal(storeB.get('wiki_persist_case').summary, 'persisted summary');
});

test('wiki subsystem strategy snapshot stays live as durable counts change', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toukeagent-wiki-runtime-'));
  const sqlitePath = join(dir, 'wiki.sqlite');
  const subsystem = createWikiSubsystem({
    config: {
      sqlitePath,
      redis: {
        enabled: false,
      },
    },
  });

  const initial = subsystem.describeWikiStrategy();
  subsystem.wikiStore.upsert({
    entry_id: 'wiki_runtime_live_case',
    title: 'Runtime live snapshot',
    summary: 'provider snapshot should update',
    facts: ['live count change'],
    tags: ['runtime'],
    source: 'manual',
  });
  const afterWrite = subsystem.describeWikiStrategy();

  assert.equal(initial.durable_store.entry_count + 1, afterWrite.durable_store.entry_count);
  assert.equal(afterWrite.provider, 'sqlite');
  assert.equal(afterWrite.runtime_persistence, 'sqlite');
  assert.equal(afterWrite.cache.backend, 'disabled');
});
