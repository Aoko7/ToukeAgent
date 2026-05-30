import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export function buildSinglePaperChunkFixture(prefix = 'toukeagent-chunk-fixture-') {
  const outputDir = mkdtempSync(join(tmpdir(), prefix));
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

  if (ingest.status !== 0) {
    throw new Error(ingest.stderr || `ingest_papers failed with code ${ingest.status}`);
  }

  const summary = JSON.parse(ingest.stdout);
  const chunkPath = summary?.outputs?.rag_chunks_path;
  if (!chunkPath) {
    throw new Error('ingest_papers did not return outputs.rag_chunks_path');
  }

  return {
    outputDir,
    chunkPath,
    summary,
  };
}
