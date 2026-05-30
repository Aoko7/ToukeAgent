import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { callPythonCore } from '../apps/platform/src/python-core-bridge.mjs';

test('paper index builder batch-indexes chunk files into local qdrant store', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'toukeagent-paper-index-input-'));
  const qdrantDir = mkdtempSync(join(tmpdir(), 'toukeagent-paper-index-'));
  const indexManifestPath = join(qdrantDir, 'paper-index-test.manifest.json');
  const ingest = spawnSync(
    'python3',
    [
      'scripts/ingest_papers.py',
      '--manifest-path',
      'data/papers/manifests/acl-2024-offset0-limit20.jsonl',
      '--limit',
      '1',
      '--output-dir',
      outputDir,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(ingest.status, 0, ingest.stderr);
  const ingestSummary = JSON.parse(ingest.stdout);
  const chunkPath = ingestSummary.outputs.rag_chunks_path;

  const result = spawnSync(
    'python3',
    [
      'scripts/build_paper_index.py',
      '--chunk-path',
      chunkPath,
      '--qdrant-path',
      qdrantDir,
      '--collection-name',
      'paper-index-test',
      '--index-manifest-path',
      indexManifestPath,
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
  assert.equal(summary.files, 1);
  assert.ok(summary.records >= 2);
  assert.ok(summary.points >= 2);
  assert.equal(summary.documents, 1);
  assert.equal(summary.embedding_strategy.backend, 'deterministic_hash');
  assert.equal(summary.vector_backend.kind, 'qdrant_local');
  assert.equal(summary.vector_backend.mode, 'local_mode');
  assert.equal(summary.per_file.length, 1);
  assert.equal(existsSync(qdrantDir), true);
  assert.equal(existsSync(indexManifestPath), true);
  assert.equal(summary.index_manifest_path, indexManifestPath);

  const searched = callPythonCore('search_indexed_chunks', {
    query: 'Quantized Side Tuning memory efficient tuning of quantized large language models',
    limit: 3,
    filters: {
      conference_id: ['acl'],
    },
    filter_policy: {
      mode: 'soft_prefer',
    },
    config: {
      force_backend: 'deterministic_hash',
      path: qdrantDir,
      collection_name: 'paper-index-test',
    },
  });

  assert.ok(searched.items.length > 0);
  assert.ok(searched.channel_hits.bm25.length > 0);
  assert.equal(searched.filter_policy.mode, 'hard_enforce');
  assert.equal(searched.filter_policy.hard_enforce_reason, 'explicit_filters');
  assert.deepEqual(searched.requested_filters, { conference_id: ['acl'] });
  assert.deepEqual(searched.effective_filters, { conference_id: ['acl'] });
  assert.equal(
    searched.items[0].doc_id,
    'paper::acl::2024::quantized-side-tuning-fast-and-memory-efficient-tuning-of-quantized-large-language-models',
  );
});

test('paper index search surfaces hard_filter_empty when hard-enforced scope removes all qdrant candidates', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'toukeagent-paper-index-input-empty-'));
  const qdrantDir = mkdtempSync(join(tmpdir(), 'toukeagent-paper-index-empty-'));
  const ingest = spawnSync(
    'python3',
    [
      'scripts/ingest_papers.py',
      '--manifest-path',
      'data/papers/manifests/acl-2024-offset0-limit20.jsonl',
      '--limit',
      '1',
      '--output-dir',
      outputDir,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(ingest.status, 0, ingest.stderr);
  const ingestSummary = JSON.parse(ingest.stdout);
  const chunkPath = ingestSummary.outputs.rag_chunks_path;

  const build = spawnSync(
    'python3',
    [
      'scripts/build_paper_index.py',
      '--chunk-path',
      chunkPath,
      '--qdrant-path',
      qdrantDir,
      '--collection-name',
      'paper-index-empty-test',
      '--force-backend',
      'deterministic_hash',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(build.status, 0, build.stderr);

  const searched = callPythonCore('search_indexed_chunks', {
    query: '只看 EMNLP 2024 的 quantized side tuning',
    limit: 3,
    config: {
      force_backend: 'deterministic_hash',
      path: qdrantDir,
      collection_name: 'paper-index-empty-test',
    },
  });

  assert.equal(searched.retrieval_plan.filter_plan.mode, 'hard_enforce');
  assert.deepEqual(searched.effective_filters, {
    conference_id: ['emnlp'],
    publication_year: [2024],
  });
  assert.equal(searched.filter_policy.filtered_candidate_count, 0);
  assert.equal(searched.filter_policy.hard_filter_scope_candidate_count, 0);
  assert.equal(searched.filter_policy.hard_filter_retrieval_hit_count, 0);
  assert.equal(searched.filter_policy.hard_filter_empty, true);
  assert.equal(searched.filter_policy.hard_filter_empty_reason, 'scope_candidate_empty');
  assert.equal(searched.filter_policy.recovered_soft_prefer, true);
  assert.equal(searched.filter_policy.mode, 'soft_prefer');
  assert.equal(searched.filter_policy.fallback_reason, 'hard_filter_empty_soft_prefer_recovery');
  assert.equal(Array.isArray(searched.items), true);
  assert.equal(searched.items.length, 1);
});
