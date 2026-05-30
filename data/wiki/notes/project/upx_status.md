---
entry_id: wiki_project_upx_status
title: Project UPX status
owner: project_ops
tags: [project, status, robustness, attack, upx, 当前]
required_context:
  - project_scope
  - robustness_scope
retrieval_hints:
  - current upx status
  - 当前 UPX 状态
  - upx 做法
ttl_seconds: 1209600
source_of_truth: curated_private_project_note
---

# Project UPX status

## Summary
Current UPX packing workflow snapshot for the robustness evaluation pipeline.

## Facts
- 当前 `UPX` 攻击线直接对 `PE` 二进制做打包压缩，核心命令是 `upx -q -o output.bin source.bin`。
- 当前只有返回码为 `0` 的样本会被标记为 `ok` 并保留到 `mutated_bin`。
- 当前 `CantPackException`、`AlreadyPackedException` 和 `NotCompressibleException` 都会被明确记录为 `skipped`。
- 当前评测只继续使用 `ok` 样本做后续特征重提取和模型评估，不会强行把压缩失败样本塞回实验集。
