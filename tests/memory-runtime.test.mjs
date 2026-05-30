import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemorySubsystem } from '../apps/platform/src/memory-runtime.mjs';

test('memory runtime keeps mem0-compatible provider when durable backend is available', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toukeagent-memory-runtime-'));
  const filePath = join(dir, 'memory.json');

  const subsystem = createMemorySubsystem({
    config: {
      provider: 'mem0_compatible',
      filePath,
      fallbackChain: [{ provider: 'local_builtin', reason: 'local_recovery' }],
    },
  });

  assert.equal(subsystem.memoryProviderStrategy.requested_provider, 'mem0_compatible');
  assert.equal(subsystem.memoryProviderStrategy.effective_provider, 'mem0_compatible');
  assert.equal(subsystem.memoryProviderStrategy.fallback_applied, false);
  assert.ok(subsystem.durableMemoryProvider);
  assert.equal(subsystem.memoryStore.describeStrategy().runtime_persistence, 'file_json');
  assert.equal(subsystem.memoryStore.describeStrategy().short_term_persistence, 'markdown_archive');
});

test('memory runtime falls back to local builtin when requested provider is disabled', () => {
  const subsystem = createMemorySubsystem({
    config: {
      provider: 'mem0_compatible',
      fallbackChain: [{ provider: 'local_builtin', reason: 'local_recovery' }],
      providers: {
        mem0_compatible: {
          enabled: false,
          available: true,
        },
      },
    },
  });

  assert.equal(subsystem.memoryProviderStrategy.requested_provider, 'mem0_compatible');
  assert.equal(subsystem.memoryProviderStrategy.effective_provider, 'local_builtin');
  assert.equal(subsystem.memoryProviderStrategy.fallback_applied, true);
  assert.equal(subsystem.memoryProviderStrategy.fallback_reason, 'provider_disabled');
  assert.equal(subsystem.durableMemoryProvider, null);
  assert.equal(subsystem.memoryStore.describeStrategy().runtime_persistence, 'process_memory');
});

test('memory runtime archives short-term memory into markdown files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toukeagent-memory-runtime-archive-'));
  const subsystem = createMemorySubsystem({
    config: {
      provider: 'local_builtin',
      sessionArchivePath: dir,
    },
  });

  subsystem.memoryStore.appendShortTerm('task_archive_1', {
    trace_id: 'trace_archive_1',
    title: 'Archive short-term',
    summary: 'persist this short-term state',
    workspace_id: 'ws_archive',
    persona_id: 'researcher',
  });

  const snapshot = subsystem.memoryStore.shortTermArchiveSnapshot('task_archive_1');
  assert.ok(existsSync(snapshot.file_path));
  assert.equal(snapshot.entry_count, 1);
  assert.match(readFileSync(snapshot.file_path, 'utf8'), /persist this short-term state/);
});
