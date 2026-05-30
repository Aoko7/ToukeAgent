import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('paper corpus rebuild batches selected manifests, emits quality reports, and writes index manifest', () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'toukeagent-corpus-rebuild-'));
  const result = spawnSync(
    'python3',
    [
      'scripts/rebuild_paper_corpus.py',
      '--manifest-path',
      'data/papers/manifests/acl-2024-offset0-limit20.jsonl',
      '--manifest-path',
      'data/papers/manifests/emnlp-2024-offset0-limit20.jsonl',
      '--manifest-record-limit',
      '1',
      '--output-root',
      outputRoot,
      '--build-name',
      'test-build',
      '--build-index',
      '--collection-name',
      'test-build-index',
      '--force-backend',
      'deterministic_hash',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.summary.manifests, 2);
  assert.equal(summary.summary.documents, 2);
  assert.equal(summary.summary.quality_reports, 2);
  assert.equal(summary.chunk_paths.length, 2);
  assert.ok(Array.isArray(summary.selection));
  assert.equal(summary.selection.length, 2);
  assert.ok(summary.qualities.every((item) => item.tiny_chunk_count >= 0));
  assert.ok(summary.index);
  assert.equal(summary.index.files, 2);
  assert.equal(summary.index.documents, 2);
  assert.ok(summary.index.index_manifest_path);
  assert.equal(existsSync(summary.index.index_manifest_path), true);
  assert.equal(existsSync(join(outputRoot, 'test-build', 'rebuild-manifest.json')), true);
  assert.equal(existsSync(join(outputRoot, 'test-build', 'reports', 'acl-2024-offset0-limit20.quality.json')), true);
});
