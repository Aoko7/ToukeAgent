import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

test('wiki notes audit summarizes real directory readiness', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'toukeagent-wiki-audit-'));
  const notesDir = join(tempRoot, 'notes');
  await mkdir(notesDir, { recursive: true });

  await writeFile(join(notesDir, 'status.md'), `---
title: Runtime status
owner: wiki_ops
required_context:
  - runtime_scope
retrieval_hints:
  - current status
---

# Runtime status

## Summary
Current runtime status note.

## Facts
- queue healthy
- stream healthy
`);

  await writeFile(join(notesDir, 'research.md'), `# 项目状态研究笔记

![[Pasted image 20260101010101.png]]

这是一个长篇研究型文档，但其中也记录了当前状态。

## 当前预训练状态
- BinMAE loss 收敛到 0.61
- GNN loss 收敛到 4.57
`);

  const auditName = 'temp-wiki-audit';
  const result = spawnSync(
    'node',
    [
      'scripts/wiki_notes_audit.mjs',
      '--notes-dir',
      notesDir,
      '--output-root',
      tempRoot,
      '--audit-name',
      auditName,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.summary.file_count, 2);
  assert.equal(summary.summary.recommended_target_counts.wiki, 1);
  assert.equal(summary.summary.recommended_target_counts.rag, 1);
  assert.ok(summary.summary.candidate_card_draft_count >= 1);

  const review = JSON.parse(readFileSync(join(tempRoot, auditName, 'review.json'), 'utf8'));
  assert.equal(review.items.length, 2);
  assert.ok(review.items.some((item) => item.recommended_target === 'wiki'));
  assert.ok(review.items.some((item) => item.recommended_target === 'rag'));
  assert.ok(Array.isArray(review.candidate_card_drafts));
  assert.ok(review.candidate_card_drafts.length >= 1);
  const draftMarkdown = readFileSync(join(tempRoot, auditName, 'candidate_card_drafts', `${review.candidate_card_drafts[0].entry_id}.md`), 'utf8');
  assert.match(draftMarkdown, /review_required: true/);

  rmSync(tempRoot, { recursive: true, force: true });
});
