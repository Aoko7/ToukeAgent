import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('paper collector prints a bounded plan from the source catalog', () => {
  const result = spawnSync(
    'python3',
    [
      'scripts/collect_papers.py',
      '--print-plan',
      '--conference',
      'usenix_security',
      '--conference',
      'neurips',
      '--from-year',
      '2024',
      '--to-year',
      '2025',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.from_year, 2024);
  assert.equal(payload.to_year, 2025);
  assert.deepEqual(payload.years, [2024, 2025]);
  assert.equal(payload.conferences.length, 2);
  assert.equal(payload.conferences[0].id, 'usenix_security');
  assert.equal(payload.conferences[1].id, 'neurips');
  assert.equal(payload.conferences[0].provider, 'usenix');
  assert.equal(payload.conferences[1].provider, 'openalex');
});

test('paper collector exposes provider-specific catalog entries', () => {
  const result = spawnSync(
    'python3',
    [
      'scripts/collect_papers.py',
      '--print-plan',
      '--conference',
      'acl',
      '--conference',
      'ndss',
      '--from-year',
      '2024',
      '--to-year',
      '2024',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.conferences.length, 2);
  assert.equal(payload.conferences[0].provider, 'acl_anthology');
  assert.equal(payload.conferences[1].provider, 'ndss');
});

test('paper collector supports manifest batch download mode in planning summary', () => {
  const result = spawnSync(
    'python3',
    [
      'scripts/collect_papers.py',
      '--manifest-path',
      'data/papers/manifests/iclr-2024.jsonl',
      '--download-pdfs',
      '--offset',
      '0',
      '--limit',
      '1',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.runs[0].provider, 'manifest_batch');
  assert.equal(payload.runs[0].limit, 1);
});

test('paper collector strips anthology correction boilerplate from abstract metadata', () => {
  const script = `
from scripts.collect_papers import parse_html_snapshot, guess_abstract

html = """
<html>
  <head>
    <meta name="description" content="Use this form to create a GitHub issue with structured data describing the correction. Correct abstract if needed. Verification against PDF Authors concatenated from the text boxes above: Create GitHub issue for staff review Although pre-trained language models remain expensive to adapt, this paper shows a lightweight route." />
    <meta name="citation_title" content="Demo Paper" />
  </head>
  <body>
    <h1>Demo Paper</h1>
  </body>
</html>
"""

snapshot = parse_html_snapshot(html)
print(guess_abstract(snapshot, "Demo Paper") or "")
`.trim();

  const result = spawnSync('python3', ['-c', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    'Although pre-trained language models remain expensive to adapt, this paper shows a lightweight route.',
  );
});
