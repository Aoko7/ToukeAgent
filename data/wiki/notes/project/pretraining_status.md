---
entry_id: wiki_project_pretraining_status
title: Project pretraining status
owner: project_ops
tags: [project, status, pretraining, 当前, 状态, 预训练]
required_context:
  - project_scope
  - milestone_scope
retrieval_hints:
  - current pretraining status
  - 预训练状态
  - BinMAE
  - GraphCL
ttl_seconds: 1209600
source_of_truth: curated_private_project_note
---

# Project pretraining status

## Summary
Current pretraining milestones and progress snapshot for the project.

## Facts
- BinMAE 预训练已经完成，当前 loss 收敛到 0.61。
- GNN/GraphCL 预训练已经完成，在 A100 80GB、Batch Size 320 的设置下 loss 收敛到 4.57。
- 当前预训练语料规模约为 1.6 万张函数调用图和 300 万个采样函数字节流。
- 上述状态均整理自本地私有项目进展笔记，经收紧后作为公开样例状态卡保留。
