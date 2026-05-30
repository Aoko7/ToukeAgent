---
entry_id: wiki_project_model_selection_status
title: Project model selection status
owner: project_ops
tags: [project, status, model, 主线, 当前, 状态]
required_context:
  - project_scope
  - model_scope
retrieval_hints:
  - current main model status
  - 主线模型选择
  - current model status
ttl_seconds: 1209600
source_of_truth: curated_private_project_note
---

# Project model selection status

## Summary
Current decision board for the main model line under the project.

## Facts
- `transmacro_full` 相比 `baseline_full` 在全部 7 个攻击桶上都有提升。
- `nomhsa` 仅在更轻量的 import-only 扰动下出现局部最好表现。
- 如果主鲁棒性结果线只保留一条，当前最稳妥的主线模型选择仍然是 `transmacro_full`。
- 这些判断来自本地私有鲁棒性结果笔记，经收紧后整理为公开样例状态卡。
