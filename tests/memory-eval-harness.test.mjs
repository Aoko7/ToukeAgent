import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('memory harness evaluates durable write, recall, compression, and handoff cases', () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'toukeagent-memory-eval-'));
  const result = spawnSync(
    'python3',
    [
      'scripts/benchmark_memory_quality.py',
      '--case-path',
      'config/memory-benchmark-cases.json',
      '--output-root',
      outputRoot,
      '--benchmark-name',
      'test-memory-suite',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.summary.case_count, 4);
  assert.equal(summary.summary.pass_rate, 1);
  assert.equal(summary.summary.mean_overall_score, 0.9167);
  assert.equal(summary.summary.mean_durable_write_precision, 0.6667);
  assert.equal(summary.summary.mean_durable_write_recall, 1);
  assert.equal(summary.summary.mean_memory_recall_at_k, 1);
  assert.equal(summary.summary.mean_stale_memory_rate, 0.3333);
  assert.equal(summary.summary.mean_compression_must_keep_retention, 1);
  assert.equal(summary.summary.mean_handoff_sufficiency_rate, 1);
  assert.equal(existsSync(join(outputRoot, 'test-memory-suite', 'summary.json')), true);
  assert.equal(existsSync(join(outputRoot, 'test-memory-suite', 'review.json')), true);
  assert.equal(existsSync(join(outputRoot, 'test-memory-suite', 'review.md')), true);
  const reviewMarkdown = readFileSync(join(outputRoot, 'test-memory-suite', 'review.md'), 'utf8');
  assert.match(reviewMarkdown, /Reviewer Summary/);
  assert.match(reviewMarkdown, /Cases needing attention/);

  const review = JSON.parse(readFileSync(join(outputRoot, 'test-memory-suite', 'review.json'), 'utf8'));
  assert.equal(review.summary.metadata_breakdowns.provider.local_builtin.case_count, 2);
  assert.equal(review.summary.metadata_breakdowns.provider.mem0_compatible.case_count, 2);
  const durableCase = review.cases.find((entry) => entry.case_id === 'durable_preference_capture_zh');
  const recallCase = review.cases.find((entry) => entry.case_id === 'memory_recall_with_one_stale_hit');
  assert.ok(durableCase);
  assert.ok(recallCase);
  assert.equal(durableCase.judge.dimensions.durable_write_precision, 0.6667);
  assert.equal(recallCase.judge.dimensions.stale_memory_rate, 0.3333);
});
