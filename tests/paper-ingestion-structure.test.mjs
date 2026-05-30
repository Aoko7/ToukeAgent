import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('paper ingestion parser preserves heading hierarchy and suppresses tiny low-signal chunks', () => {
  const source = `
Abstract
This paper studies retrieval quality for long technical documents.

1 Introduction
We introduce the problem setting and motivation in detail.

1.1 Background
The background subsection should remain attached to the parent heading.

1.2 Method
0.2 0.4 0.6

The actual method description continues with enough text to remain useful for retrieval.
`.trim();

  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import importlib.util
import json
from pathlib import Path

module_path = Path("scripts/ingest_papers.py").resolve()
spec = importlib.util.spec_from_file_location("ingest_papers", module_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

sections = module.extract_sections(${JSON.stringify(source)})
chunks = []
for section in sections:
    chunks.extend(module.chunk_section_text(section, max_chars=120, overlap_chars=20))

print(json.dumps({"sections": sections, "chunks": chunks}, ensure_ascii=False))
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  const background = payload.sections.find((item) => item.heading === '1.1 Background');
  assert.ok(background);
  assert.deepEqual(background.section_path, ['1 Introduction', '1.1 Background']);

  const method = payload.sections.find((item) => item.heading === '1.2 Method');
  assert.ok(method);
  assert.deepEqual(method.section_path, ['1 Introduction', '1.2 Method']);

  const tinyNoise = payload.chunks.find((item) => item.text.trim() === '0.2 0.4 0.6');
  assert.equal(tinyNoise, undefined);

  assert.ok(payload.chunks.every((item) => item.text.trim().length === 0 || item.text.trim().length >= 20));
});

test('paper ingestion suppresses pseudo-headings, glyph noise, and duplicate low-signal chunks', () => {
  const source = `
III. METHOD
000004b/uni0000004c/uni00000051/uni0000005c /uni0000000f /uni00000044/uni0000004f/uni0000004f /uni00000010

4.3.2 Experimental Results
All Easy Medium Hard (a) List 00.20.40.60.8100.20.40.60.81FPP(A) (b) PCFG 00.20.40.60.81

4.3.2 Experimental Results
All Easy Medium Hard (a) List 00.20.40.60.8100.20.40.60.81FPP(A) (b) PCFG 00.20.40.60.81

4.3.3 Discussion

The real paragraph explains why retrieval quality changes after denoising chunk boundaries and should remain available.
`.trim();

  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import importlib.util
import json
from pathlib import Path

module_path = Path("scripts/ingest_papers.py").resolve()
spec = importlib.util.spec_from_file_location("ingest_papers", module_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

sections = module.extract_sections(${JSON.stringify(source)})
chunks = module.build_chunk_records(
    {
        "conference_id": "testconf",
        "publication_year": 2026,
        "title": "Synthetic Test Paper",
        "source_id": "synthetic",
    },
    {
        "paper_id": "synthetic-paper",
        "language": "en",
        "needs_ocr": False,
    },
    {
        "doc_id": "paper::testconf::2026::synthetic-test-paper",
    },
    sections,
    embedding_model="deterministic_hash",
    embedding_dim=8,
    vector_backend="qdrant_local",
    max_chars=160,
    overlap_chars=20,
)

print(json.dumps({"sections": sections, "chunks": chunks}, ensure_ascii=False))
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.sections.some((item) => String(item.heading).includes('/uni')), false);
  assert.equal(payload.chunks.some((item) => String(item.text).includes('/uni')), false);
  assert.equal(
    payload.chunks.filter((item) => item.text.includes('All Easy Medium Hard')).length,
    0,
  );
  assert.ok(
    payload.chunks.some((item) =>
      item.text.includes('retrieval quality changes after denoising chunk boundaries'),
    ),
  );
});
