---
entry_id: wiki_project_architecture_status
title: Project architecture status
owner: project_ops
tags: [project, status, architecture, 方案, 当前, 状态]
required_context:
  - project_scope
  - architecture_scope
retrieval_hints:
  - current architecture status
  - 当前方案状态
  - 当前总体设计
ttl_seconds: 1209600
source_of_truth: curated_private_project_note
---

# Project architecture status

## Summary
Current tri-modal architecture snapshot for the project.

## Facts
- 当前总体设计遵循“分而治之，动态融合”的方案。
- 微观分支使用 `BinMAE` 处理二进制字节流，负责提取抗混淆的指令语义。
- 中观分支使用 `GraphCL` 训练图注意力网络，负责建模程序拓扑结构。
- 宏观分支使用分层哈希注意力网络处理导入表，融合层再通过自适应门控机制动态调整三种模态权重。
