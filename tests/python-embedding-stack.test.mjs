import test from 'node:test';
import assert from 'node:assert/strict';
import { callPythonCore } from '../apps/platform/src/python-core-bridge.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSinglePaperChunkFixture } from './helpers/chunk-fixture.mjs';

test('python core describes single-space embedding strategy for MVP retrieval', () => {
  const result = callPythonCore('describe_embedding_strategy', {});

  assert.equal(result.space_mode, 'single_multilingual');
  assert.equal(result.same_space_required, true);
  assert.equal(result.primary_model, 'intfloat/multilingual-e5-base');
  assert.equal(result.fallback_model, 'intfloat/multilingual-e5-small');
  assert.ok(typeof result.dimensions === 'number');
  assert.ok(typeof result.backend === 'string');
});

test('python core can embed texts with deterministic fallback when optional deps are absent', () => {
  const result = callPythonCore('embed_texts', {
    texts: ['ToukeAgent retrieval baseline', '混合检索需要统一向量空间'],
    input_type: 'passage',
  });

  assert.equal(result.vector_count, 2);
  assert.ok(Array.isArray(result.vectors));
  assert.equal(result.vectors.length, 2);
  assert.ok(result.vectors[0].length > 100);
  assert.equal(result.strategy.same_space_required, true);
});

test('python core describes qdrant local backend even when dependency is not installed', () => {
  const result = callPythonCore('describe_vector_backend', {});

  assert.equal(result.kind, 'qdrant_local');
  assert.equal(result.collection_name, 'toukeagent-rag');
  assert.ok(typeof result.available === 'boolean');
  assert.ok(['local_mode', 'stub'].includes(result.mode));
});

test('python core can index chunk files and search them with parent-child aggregation', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'toukeagent-vector-store-'));
  const fixture = buildSinglePaperChunkFixture('toukeagent-vector-chunks-');
  const chunkPath = fixture.chunkPath;

  const indexed = callPythonCore('index_chunk_file', {
    chunk_path: chunkPath,
    config: {
      force_backend: 'deterministic_hash',
      path: tempDir,
      collection_name: 'test-chunks',
    },
  });

  assert.ok(indexed.records > 0);
  assert.ok(indexed.points > 0);
  assert.equal(indexed.embedding_strategy.same_space_required, true);

  const searched = callPythonCore('search_indexed_chunks', {
    query: 'Quantized Side Tuning memory efficient tuning of quantized large language models',
    limit: 5,
    chunk_path: chunkPath,
    config: {
      force_backend: 'deterministic_hash',
      path: tempDir,
      collection_name: 'test-chunks',
    },
  });

  assert.ok(Array.isArray(searched.items));
  assert.ok(searched.items.length > 0);
  assert.ok(Array.isArray(searched.doc_aggregates));
  assert.ok(Array.isArray(searched.supporting_chunks));
  assert.ok(searched.supporting_chunks.length > 0);
  assert.ok(searched.items[0].supporting_chunks.length >= 1);
  assert.equal(searched.retrieval_plan.implementation_status, 'active_hybrid_rag');
  assert.ok(Array.isArray(searched.channel_hits.semantic));
  assert.ok(Array.isArray(searched.channel_hits.bm25));
  assert.ok(searched.channel_hits.bm25.length > 0);
  assert.equal(searched.items[0].doc_id, 'paper::acl::2024::quantized-side-tuning-fast-and-memory-efficient-tuning-of-quantized-large-language-models');
  assert.equal(searched.items[0].supporting_chunks[0].metadata.conference_id, 'acl');
});

test('python core search_indexed_chunks applies explicit filters on indexed chunk search', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'toukeagent-vector-store-filter-'));
  const fixture = buildSinglePaperChunkFixture('toukeagent-vector-filter-chunks-');
  const chunkPath = fixture.chunkPath;
  const docId = 'paper::acl::2024::quantized-side-tuning-fast-and-memory-efficient-tuning-of-quantized-large-language-models';

  const searched = callPythonCore('search_indexed_chunks', {
    query: 'large language models tuning',
    limit: 5,
    chunk_path: chunkPath,
    filters: {
      doc_id: docId,
    },
    config: {
      force_backend: 'deterministic_hash',
      path: tempDir,
      collection_name: 'filter-test-chunks',
    },
  });

  assert.equal(searched.filters.doc_id, docId);
  assert.ok(searched.items.length > 0);
  assert.ok(searched.items.every((item) => item.doc_id === docId));
  assert.ok(searched.channel_hits.semantic.every((hit) => hit.payload.doc_id === docId));
});

test('python core search_indexed_chunks marks retrieval_hit_empty when hard-filter scope has candidates but filtered retrieval returns zero hits', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json
from toukeagent_core import retrieval as module

payload_item = {
    "doc_id": "paper::acl::2024::retrieval-hit-empty",
    "chunk_id": "paper::acl::2024::retrieval-hit-empty::chunk-0",
    "paper_title": "Scope Candidate Example",
    "title": "Scope Candidate Example",
    "source_type": "rag",
    "freshness": "stable",
    "text": "completely unrelated stable content without lexical overlap",
    "section_path": ["Introduction"],
    "metadata": {
        "conference_id": "acl",
        "publication_year": 2024,
    },
}

class FakeVectorStore:
    def ensure_collection(self):
        return {"ok": True}

    def iter_payloads(self, *, filters=None, limit=10000):
        return [{"id": "point-1", "payload": payload_item}]

    def search(self, query_vector, *, limit=5, filters=None):
        filters = dict(filters or {})
        if filters:
            return []
        return [{"id": "point-1", "score": 0.73, "payload": payload_item}]

    def describe(self):
        return {
            "kind": "qdrant_local",
            "collection_name": "fake-filter-test",
            "path": "/tmp/fake-filter-test",
            "vector_size": 768,
            "available": False,
            "dependency": "qdrant_client",
            "mode": "stub",
        }

    def close(self):
        return None

module.create_vector_store = lambda config=None: FakeVectorStore()
result = module.search_indexed_chunks({
    "query": "qxzvplm noroute token",
    "limit": 3,
    "filters": {"conference_id": ["acl"]},
    "filter_policy": {"mode": "soft_prefer"},
    "config": {"force_backend": "deterministic_hash"},
})
print(json.dumps(result))
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const searched = JSON.parse(result.stdout);
  assert.equal(searched.filter_policy.hard_enforce_reason, 'explicit_filters');
  assert.equal(searched.filter_policy.hard_filter_scope_candidate_count, 1);
  assert.equal(searched.filter_policy.hard_filter_retrieval_hit_count, 0);
  assert.equal(searched.filter_policy.hard_filter_empty, true);
  assert.equal(searched.filter_policy.hard_filter_empty_reason, 'retrieval_hit_empty');
  assert.equal(searched.filter_policy.recovered_soft_prefer, true);
  assert.equal(searched.filter_policy.mode, 'soft_prefer');
  assert.equal(searched.diagnostics.hard_filter_empty_reason, 'retrieval_hit_empty');
  assert.equal(searched.retrieval_plan.router.fallback_applied, false);
  assert.ok(searched.items.length > 0);
  assert.equal(searched.items[0].doc_id, 'paper::acl::2024::retrieval-hit-empty');
});

test('python core can index chunk files with real qdrant local ids derived from stable UUIDs', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'toukeagent-vector-store-qdrant-'));
  const fixture = buildSinglePaperChunkFixture('toukeagent-vector-qdrant-chunks-');
  const chunkPath = fixture.chunkPath;

  const indexed = callPythonCore('index_chunk_file', {
    chunk_path: chunkPath,
    config: {
      force_backend: 'deterministic_hash',
      path: tempDir,
      collection_name: 'uuid-qdrant-test',
    },
  });

  assert.ok(indexed.records > 0);
  assert.ok(indexed.points > 0);
  assert.equal(indexed.vector_backend.kind, 'qdrant_local');
});

const qdrantBackend = callPythonCore('describe_vector_backend', {});

const realQdrantFilterTest = qdrantBackend.available ? test : test.skip;
realQdrantFilterTest('python core applies explicit filters on the real qdrant search path', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'toukeagent-vector-store-real-filter-'));
  const chunkPath = join(tempDir, 'mini.rag_chunks.jsonl');
  const alphaDocId = 'paper::alpha::2024::retrieval-filter-validation';
  const betaDocId = 'paper::beta::2024::retrieval-filter-validation';

  writeFileSync(
    chunkPath,
    [
      JSON.stringify({
        doc_id: alphaDocId,
        chunk_id: `${alphaDocId}::chunk-0`,
        title: 'Alpha Retrieval Filter',
        text: 'alpha signal about retrieval filters and filtered evaluation',
        section_path: ['Introduction'],
        metadata: {
          conference_id: 'acl',
          publication_year: 2024,
          language: 'en',
        },
      }),
      JSON.stringify({
        doc_id: betaDocId,
        chunk_id: `${betaDocId}::chunk-0`,
        title: 'Beta Retrieval Filter',
        text: 'beta beta beta signal about retrieval filters and filtering behavior',
        section_path: ['Introduction'],
        metadata: {
          conference_id: 'acl',
          publication_year: 2024,
          language: 'en',
        },
      }),
    ].join('\n'),
    'utf8',
  );

  const searched = callPythonCore('search_indexed_chunks', {
    query: 'beta beta retrieval filter behavior',
    limit: 5,
    chunk_path: chunkPath,
    filters: {
      doc_id: alphaDocId,
    },
    config: {
      force_backend: 'deterministic_hash',
      path: tempDir,
      collection_name: 'real-qdrant-filter-test',
    },
  });

  assert.equal(searched.filters.doc_id, alphaDocId);
  assert.ok(searched.channel_hits.semantic.length > 0);
  assert.ok(searched.channel_hits.semantic.every((hit) => hit.payload.doc_id === alphaDocId));
  assert.ok(searched.items.length > 0);
  assert.ok(searched.items.every((item) => item.doc_id === alphaDocId));
});
