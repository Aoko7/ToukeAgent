import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWikiImportPayloadFromMarkdown,
  buildCandidateCardDraftsFromMarkdown,
  deriveWikiEntryIdFromPath,
  previewWikiImportFromMarkdown,
  renderCandidateCardDraftMarkdown,
} from '../apps/platform/src/wiki-markdown-ingest.mjs';

test('wiki markdown ingest builds structured payload from frontmatter and sections', () => {
  const markdown = `---
entry_id: wiki_markdown_case
title: Markdown Wiki Case
owner: research_ops
tags: [markdown, wiki, status]
required_context:
  - project_scope
retrieval_hints:
  - latest milestone
ttl_seconds: 7200
source_of_truth: local_markdown_note
---

# Markdown Wiki Case

## Summary
This is the freshest structured status note for the project.

## Facts
- Milestone A completed
- Milestone B delayed
`;

  const payload = buildWikiImportPayloadFromMarkdown(markdown, {
    filePath: 'notes/wiki_case.md',
    sourceTraceId: 'trace_markdown_import',
  });

  assert.equal(payload.entry_id, 'wiki_markdown_case');
  assert.equal(payload.title, 'Markdown Wiki Case');
  assert.equal(payload.owner, 'research_ops');
  assert.equal(payload.ttl_seconds, 7200);
  assert.equal(payload.source_of_truth, 'local_markdown_note');
  assert.deepEqual(payload.tags, ['markdown', 'wiki', 'status']);
  assert.deepEqual(payload.required_context, ['project_scope']);
  assert.deepEqual(payload.retrieval_hints, ['latest milestone']);
  assert.deepEqual(payload.facts, ['Milestone A completed', 'Milestone B delayed']);
  assert.match(payload.summary, /freshest structured status note/);
});

test('wiki markdown ingest falls back to headings and bullets without frontmatter', () => {
  const markdown = `# Runtime Notes

This note tracks the current runtime switches.

## Facts
- switch alpha enabled
- switch beta disabled
`;

  const payload = buildWikiImportPayloadFromMarkdown(markdown, {
    filePath: 'notes/runtime_notes.md',
  });

  assert.equal(payload.title, 'Runtime Notes');
  assert.equal(payload.entry_id, 'wiki_runtime_notes');
  assert.deepEqual(payload.facts, ['switch alpha enabled', 'switch beta disabled']);
  assert.deepEqual(payload.tags, []);
  assert.equal(payload.source_of_truth, 'runtime_notes.md');
});

test('wiki markdown ingest can derive stable entry id from file path', () => {
  assert.equal(
    deriveWikiEntryIdFromPath('notes/provider status/DeepSeek Pricing.md'),
    'wiki_deepseek_pricing',
  );
});

test('wiki markdown ingest prefers file-path-stable entry ids when frontmatter id is absent', () => {
  const markdown = `# Runtime Status Card

Current runtime status summary.

## Facts
- queue healthy
`;

  const payload = buildWikiImportPayloadFromMarkdown(markdown, {
    filePath: 'notes/ops/runtime_snapshot.md',
  });

  assert.equal(payload.entry_id, 'wiki_runtime_snapshot');
});

test('wiki markdown ingest preview marks structured notes as wiki-ready', () => {
  const markdown = `---
entry_id: wiki_provider_status
title: Provider status card
owner: wiki_ops
tags: [status, version]
required_context:
  - provider_name
retrieval_hints:
  - latest version
ttl_seconds: 3600
source_of_truth: local_status_note
---

# Provider status card

## Summary
Current provider status and release note.

## Facts
- latest version is v4
- current price is updated weekly
`;

  const preview = previewWikiImportFromMarkdown(markdown, {
    filePath: 'notes/provider_status.md',
  });

  assert.equal(preview.recommended_target, 'wiki');
  assert.equal(preview.recommended_workflow, 'proposal_import');
  assert.equal(preview.import_mode, 'proposal');
  assert.ok(preview.readiness_score >= 0.8);
  assert.deepEqual(preview.required_context, ['provider_name']);
  assert.deepEqual(preview.retrieval_hints, ['latest version']);
});

test('wiki markdown ingest preview marks long research notes as rag-oriented', () => {
  const markdown = `# 恶意代码研究笔记

这是一个很长的研究型说明，用于记录论文思路和实验综述。

## 研究背景
![[Pasted image 20260101010101.png]]

恶意代码检测面临很多问题，需要从序列、图结构和多模态多个角度讨论。

## 实验方法
- 比较多个模型
- 分析实验误差
- 记录未来优化方向

## 论文综述
这里继续展开非常长的研究笔记内容，用来模拟更像 RAG 的长文资料。
`;

  const preview = previewWikiImportFromMarkdown(markdown, {
    filePath: 'private-notes/malware-research-note.md',
  });

  assert.equal(preview.recommended_target, 'rag');
  assert.equal(preview.recommended_workflow, 'rag_curation');
  assert.ok(preview.risk_flags.includes('missing_frontmatter'));
  assert.ok(preview.risk_flags.includes('research_note'));
});

test('wiki markdown ingest can emit candidate card drafts from long-form notes', () => {
  const markdown = `# TriGMA 研究记录

这是一个很长的研究型说明，用于记录外部项目当前状态和实验结果。

## 当前主线状态
- 当前主线目录优先关注 src、scripts、configs 与 docs
- 当前 clean bundle 指向 perfectTotrain_V6lab

## gate 量化结果
- macro dominant share 为 0.7266
- high-confidence 20 percent error rate 为 0.0127
`;

  const drafts = buildCandidateCardDraftsFromMarkdown(markdown, {
    filePath: 'private-notes/trigma-research-log.md',
  });

  assert.ok(drafts.length >= 2);
  assert.ok(drafts.every((draft) => draft.review_required === true));
  assert.ok(drafts.some((draft) => /主线状态/.test(draft.title)));
  assert.ok(drafts.some((draft) => /gate 量化结果/.test(draft.title)));
});

test('wiki markdown ingest preview includes candidate card drafts for rag-oriented notes', () => {
  const markdown = `# 外部项目状态汇总

## 当前预训练状态
- 当前 BinMAE loss 收敛到 0.61
- 当前 GNN loss 收敛到 4.57
`;

  const preview = previewWikiImportFromMarkdown(markdown, {
    filePath: 'private-notes/external-project-status.md',
  });

  assert.ok(['rag', 'review'].includes(preview.recommended_target));
  assert.ok(preview.candidate_card_drafts.length >= 1);
  assert.ok(preview.candidate_card_drafts[0].entry_id.startsWith('wiki_'));
});

test('wiki markdown ingest keeps compact structured status cards wiki-ready even in a research domain', () => {
  const markdown = `---
entry_id: wiki_project_architecture_status
title: Project architecture status
owner: project_ops
tags: [project, status, architecture, 当前]
required_context:
  - project_scope
  - architecture_scope
retrieval_hints:
  - current architecture status
  - 当前方案状态
ttl_seconds: 1209600
source_of_truth: private-notes/project-briefing.md
---

# Project architecture status

## Summary
Current tri-modal architecture snapshot for the project.

## Facts
- 当前总体设计遵循分而治之和动态融合方案
- 微观分支当前使用 BinMAE
- 中观分支当前使用 GraphCL
`;

  const preview = previewWikiImportFromMarkdown(markdown, {
    filePath: 'data/wiki/notes/project/architecture_status.md',
  });

  assert.equal(preview.recommended_target, 'wiki');
  assert.equal(preview.recommended_workflow, 'proposal_import');
  assert.equal(preview.import_mode, 'proposal');
  assert.deepEqual(preview.candidate_card_drafts, []);
});

test('wiki markdown ingest can render candidate card draft markdown', () => {
  const markdown = renderCandidateCardDraftMarkdown({
    entry_id: 'wiki_runtime_status',
    title: 'Runtime status',
    owner: 'wiki_ops',
    tags: ['status', 'runtime'],
    required_context: ['runtime_scope'],
    retrieval_hints: ['current runtime status'],
    ttl_seconds: 3600,
    source_of_truth: 'runtime.md#当前状态',
    source_file_path: 'notes/runtime.md',
    draft_reason: 'split_longform_note_into_dynamic_card',
    summary: 'Current runtime state summary.',
    facts: ['queue healthy', 'stream healthy'],
  });

  assert.match(markdown, /entry_id: wiki_runtime_status/);
  assert.match(markdown, /review_required: true/);
  assert.match(markdown, /## Facts/);
  assert.match(markdown, /- queue healthy/);
});
