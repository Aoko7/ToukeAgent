---
entry_id: wiki_project_import_augmentation_status
title: Project import augmentation status
owner: project_ops
tags: [project, status, robustness, attack, import, augmentation, 当前]
required_context:
  - project_scope
  - robustness_scope
retrieval_hints:
  - current import augmentation status
  - 当前导入表增强状态
  - import augmentation 做法
ttl_seconds: 1209600
source_of_truth: curated_private_project_note
---

# Project import augmentation status

## Summary
Current import-table augmentation workflow snapshot for the robustness evaluation pipeline.

## Facts
- 当前 `import augmentation` 攻击线修改的是 `PE import table`，而不是代码逻辑或节注入。
- 当前脚本会从预设 benign import 池中，为每个样本补入默认 `2` 对尚未出现的 `DLL!API` 导入。
- 当前导入对的选择不是完全随机，而是基于 `sha256[:8]` 做确定性偏移，以保证攻击结果可复现。
- 当前修改后的样本会再次用 `pefile` 回读验证，确认新增导入已经真正写入 `mutated_bin`。
