# Wiki Notes Corpus

这个目录用于放置会进入 `LLM wiki` 的 markdown 笔记。

## 推荐结构

- `demo/`：最小示例或 smoke 用样本
- `project/`：项目状态、负责人、版本、策略开关
- `research/`：论文卡片、方法卡片、指标卡片
- `trigma/`：从外部 `TriGMA` 项目文档抽取出来的状态卡与配方卡

## 推荐 frontmatter

```md
---
entry_id: wiki_example
title: Example Entry
owner: wiki_ops
tags: [status, pricing]
required_context:
  - provider_name
retrieval_hints:
  - latest version
ttl_seconds: 3600
source_of_truth: local_markdown_note
---
```

## 导入方式

单文件：

```bash
curl -s http://127.0.0.1:3000/api/wiki/import-markdown \
  -H 'content-type: application/json' \
  -d '{"mode":"proposal","file_path":"data/wiki/notes/demo/deepseek_provider.md"}'
```

目录批量导入：

```bash
curl -s http://127.0.0.1:3000/api/wiki/import-markdown-batch \
  -H 'content-type: application/json' \
  -d '{"mode":"upsert","directory_path":"data/wiki/notes/demo"}'
```

项目状态样本集 live smoke：

```bash
python3 scripts/wiki_first_smoke.py \
  --notes-dir data/wiki/notes/project \
  --query '当前预训练状态是什么' \
  --expect-title 'Project pretraining status'
```

TriGMA 外部状态样本 live smoke：

```bash
python3 scripts/wiki_first_smoke.py \
  --notes-dir data/wiki/notes/trigma \
  --query '当前 TriGMA 主线目录状态是什么' \
  --expect-title 'TriGMA mainline map'
```

## 真实目录预审

如果你有一整批真实 markdown 笔记，建议先审计，再决定哪些走 wiki、哪些走 RAG：

```bash
node scripts/wiki_notes_audit.mjs --notes-dir path/to/private-notes --audit-name private-notes-preview
```

当前这类审计会输出：

- `recommended_target`
- `recommended_workflow`
- `risk_flags`
- `readiness_score`
- `candidate_card_drafts/`

这样可以先识别：

- 适合直接进入 `proposal` 的动态状态页
- 需要先清洗 frontmatter / knowledge contract 的 note
- 更适合进入 RAG 的长篇研究笔记、论文综述和草稿
- 以及从 `rag / review` 长文里先半自动抽出来、等待人工收紧的 wiki 卡片草稿

## 当前 project 样本集

`project/` 目录是一组从本地私有研究笔记中抽出来的 card 化状态页：

- `architecture_status.md`
- `binmae_status.md`
- `pretraining_status.md`
- `corpus_status.md`
- `model_selection_status.md`
- `robustness_status.md`
- `import_augmentation_status.md`
- `upx_status.md`

它们的用途是：

- 把“当前状态/当前进度/当前主线决策”从长篇研究材料里单独分层
- 作为 LLM wiki 的动态结构化知识页
- 与原始研究笔记并存，而不是覆盖原始资料
- 作为仓库内已经完成 `candidate_card_drafts -> 人工收紧 -> 正式 wiki card` 的样本闭环

## 当前 TriGMA 外部样本集

`trigma/` 目录是一组从外部 `TriGMA` 项目文档中抽出来的 card 化状态页：

- `trigma_mainline_map.md`
- `trigma_workspace_raw_leaderboard_status.md`
- `trigma_gate_distribution_status.md`
- `trigma_gnn_pretraining_recipe.md`

它们的用途是：

- 证明外部项目资料也可以抽成薄的动态 wiki 状态层
- 只保留“当前主线 / 当前排行 / 当前 gate 证据 / 当前预训练配方”这类频繁被问到的结构化事实
- 把更长的实验说明、训练记录和背景分析继续留在 RAG 层，而不是混进 wiki
