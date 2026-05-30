---
entry_id: wiki_project_binmae_status
title: Project BinMAE status
owner: project_ops
tags: [project, status, binmae, pretraining, 微观, 当前]
required_context:
  - project_scope
  - pretraining_scope
  - training_scope
retrieval_hints:
  - current binmae status
  - 当前 BinMAE 状态
  - BinMAE 预训练进度
ttl_seconds: 1209600
source_of_truth: curated_private_project_note
---

# Project BinMAE status

## Summary
Current micro-level BinMAE implementation and pretraining snapshot for the project.

## Facts
- 当前微观分支采用 `BinMAE` 作为二进制掩码自编码器。
- `BinMAE` 采用非对称编码器-解码器架构，而不是直接照搬 `BERT` 式对称结构。
- 当前核心训练策略是动态比例随机掩码，用来逼迫模型学习更深层的代码语义而不是局部纹理。
- 当前 `BinMAE` 预训练已经完成，在约 `300 万` 个函数上 `loss` 收敛到 `0.61`。
