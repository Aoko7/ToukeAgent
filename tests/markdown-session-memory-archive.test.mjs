import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarkdownSessionMemoryArchive } from '../apps/platform/src/markdown-session-memory-archive.mjs';

test('markdown session memory archive appends and reloads short-term entries', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'toukeagent-session-archive-'));
  const archive = createMarkdownSessionMemoryArchive({ rootDir });

  archive.appendShortTerm({
    memory_id: 'mem_short_1',
    task_id: 'task_markdown_1',
    trace_id: 'trace_markdown_1',
    title: 'Inbound message',
    summary: 'remember short-lived state',
    workspace_id: 'ws_markdown',
    persona_id: 'researcher',
    created_at: '2026-05-20T10:00:00.000Z',
    updated_at: '2026-05-20T10:00:00.000Z',
  });

  const items = archive.listShortTerm('task_markdown_1');
  const snapshot = archive.snapshot('task_markdown_1');
  const text = readFileSync(snapshot.file_path, 'utf8');

  assert.equal(items.length, 1);
  assert.equal(items[0].memory_id, 'mem_short_1');
  assert.equal(snapshot.entry_count, 1);
  assert.match(text, /Session Memory task_markdown_1/);
  assert.match(text, /```json session-memory/);
});
