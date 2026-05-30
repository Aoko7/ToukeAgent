---
entry_id: wiki_trigma_gnn_pretraining_recipe
title: TriGMA GNN pretraining recipe
owner: trigma_ops
tags: [trigma, status, gnn, pretraining, recipe, current]
required_context:
  - project_scope
  - pretraining_scope
retrieval_hints:
  - current gnn pretraining recipe
  - 当前 GNN 预训练配置
  - graphcl recipe
ttl_seconds: 1209600
source_of_truth: TriGMA/src/pretrain/gnn_graph/TRAINING_SUMMARY.md
---

# TriGMA GNN pretraining recipe

## Summary
Current graph pretraining recipe snapshot for TriGMA.

## Facts
- 当前 GraphCL 默认 `batch size = 320`、`epochs = 100`、`learning rate = 3e-4`。
- 当前对比学习温度参数为 `0.5`，图增强里的 `edge drop prob = 0.2`。
- 当前 GAT 编码器配置为 `hidden dim = 256`、`output dim = 128`、`dropout = 0.2`。
- 当前学习率调度采用 `10% warmup + cosine decay`。
