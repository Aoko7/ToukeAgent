import test from 'node:test';
import assert from 'node:assert/strict';
import { createWikiStore } from '../apps/platform/src/wiki-store.mjs';

test('wiki store supports write, update, expire, and query', () => {
  const store = createWikiStore();

  const first = store.upsert({
    entry_id: 'wiki_custom_status',
    title: 'Custom status page',
    summary: 'Latest release and pricing notes',
    facts: ['release 1.2', 'price changed'],
    tags: ['status', 'version', 'pricing'],
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
