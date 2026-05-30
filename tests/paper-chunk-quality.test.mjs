import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildSinglePaperChunkFixture } from './helpers/chunk-fixture.mjs';

test('chunk quality inspector reports complete metadata and vector normalization', () => {
  const fixture = buildSinglePaperChunkFixture('toukeagent-chunk-quality-');
  const result = spawnSync(
    'python3',
    [
      'scripts/inspect_chunk_quality.py',
      '--chunk-path',
      fixture.chunkPath,
      '--sample-docs',
      '6',
      '--sample-chunks-per-doc',
      '2',
      '--query-docs',
      '6',
      '--min-text-length',
      '40',
      '--force-backend',
      'deterministic_hash',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.files, 1);
  assert.ok(report.chunks > 0);
  assert.equal(report.completeness.missing_top_level.chunk_id, undefined);
  assert.equal(report.completeness.missing_metadata.paper_title, undefined);
  assert.equal(report.embedding_strategy.backend, 'deterministic_hash');
  assert.equal(report.vector_sample.norm_min, 1);
  assert.equal(report.vector_sample.norm_max, 1);
  assert.ok(report.vector_sample.title_to_chunk_top1_hits >= 1);
  assert.ok(report.quality_flags.tiny_chunk_count >= 0);
});
