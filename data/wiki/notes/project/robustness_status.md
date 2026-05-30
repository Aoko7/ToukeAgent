---
entry_id: wiki_project_robustness_status
title: Project robustness status
owner: project_ops
tags: [project, status, robustness, 对抗, 当前, 进度]
required_context:
  - project_scope
  - robustness_scope
retrieval_hints:
  - robustness status
  - 对抗进度
  - attack coverage
ttl_seconds: 1209600
source_of_truth: curated_private_project_note
---

# Project robustness status

## Summary
Current robustness evaluation coverage and progress snapshot for the project.

## Facts
- 当前已经完成三类鲁棒性扰动流程：导入表增强、UPX 打包、导入表增强后再做 UPX 的组合扰动。
- 所有攻击样本都重新走了 Ghidra、GNN、BinMAE 和 metadata 特征提取流程后再评估。
- UPX 不适配或压缩失败的样本会被明确记录为 skipped，并排除在实验评估集之外。
- 结果口径已经重新对齐到与主实验一致的 workspace_raw metadata。
