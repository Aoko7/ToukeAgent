import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('paper ingestion normalizes one manifest record into cards, documents, and chunks', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'toukeagent-ingest-'));
  const result = spawnSync(
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

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.records, 1);
  assert.equal(summary.paper_cards, 1);
  assert.equal(summary.rag_documents, 1);
  assert.ok(summary.rag_chunks >= 2);
  assert.equal(summary.embedding_strategy.same_space_required, true);
  assert.equal(summary.vector_backend.kind, 'qdrant_local');

  const cardsPath = summary.outputs.paper_cards_path;
  const docsPath = summary.outputs.rag_documents_path;
  const chunksPath = summary.outputs.rag_chunks_path;
  assert.equal(existsSync(cardsPath), true);
  assert.equal(existsSync(docsPath), true);
  assert.equal(existsSync(chunksPath), true);

  const card = JSON.parse(readFileSync(cardsPath, 'utf8').trim().split('\n')[0]);
  const doc = JSON.parse(readFileSync(docsPath, 'utf8').trim().split('\n')[0]);
  const chunk = JSON.parse(readFileSync(chunksPath, 'utf8').trim().split('\n')[0]);

  assert.equal(card.conference_id, 'acl');
  assert.equal(card.needs_ocr, false);
  assert.equal(doc.doc_type, 'paper');
  assert.ok(Array.isArray(chunk.section_path));
  assert.ok(chunk.text.length > 200);
  assert.ok(['intfloat/multilingual-e5-base', 'intfloat/multilingual-e5-small'].includes(chunk.embedding_model));
});
