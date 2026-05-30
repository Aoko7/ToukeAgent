---
entry_id: wiki_trigma_mainline_map
title: TriGMA mainline map
owner: trigma_ops
tags: [trigma, status, mainline, current, boundary]
required_context:
  - project_scope
  - bundle_scope
retrieval_hints:
  - current mainline status
  - 主线目录
  - current bundle map
ttl_seconds: 1209600
source_of_truth: TriGMA/README.md | TriGMA/docs/experiment_registry.md
---

# TriGMA mainline map

## Summary
Current public-facing mainline map and bundle boundary snapshot for TriGMA.

## Facts
- 当前主线代码层优先关注 `src/`、`scripts/`、`configs/`、`docs/` 与 `reports/`。
- 当前 clean paper mainline bundle 指向 `data/downstream_dataset/perfectTotrain_V6lab/transmacro_full/`。
- 当前 robustness paper mainline bundle 指向 `data/downstream_dataset/perfectTotrain_R1lab/`。
- `ADAPT_Net/` 仍保留在仓库中，但现在只应视为历史 lineage，而不是当前 public mainline。
