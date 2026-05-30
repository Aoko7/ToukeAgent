---
entry_id: wiki_trigma_workspace_raw_leaderboard_status
title: TriGMA workspace_raw leaderboard status
owner: trigma_ops
tags: [trigma, status, leaderboard, workspace_raw, current]
required_context:
  - project_scope
  - leaderboard_scope
retrieval_hints:
  - current workspace_raw leaderboard
  - 当前排行状态
  - current leaderboard status
ttl_seconds: 1209600
source_of_truth: TriGMA/data/downstream_dataset/perfectTotrain_V6lab/transmacro_full/docs/2026-03-29-v5lab-completed-experiments-leaderboard.md
---

# TriGMA workspace_raw leaderboard status

## Summary
Current canonical workspace_raw leaderboard snapshot for TriGMA.

## Facts
- 当前 canonical workspace_raw 按 `test F1` 排名时，`trigma_tri_modal_nomhsa_seed42` 位列第一，`test F1 = 0.9352`。
- 当前 `test Acc` 最高的 workspace_raw 结果是 `trigma_tri_modal_nogate_seed42`，`test Acc = 0.9354`，`test F1 = 0.9351`。
- `trigma_dual_micro_macro_seed42` 仍是非常接近主线的双模态强基线，`test Acc = 0.9342`，`test F1 = 0.9333`。
- 该 snapshot 当前收录 `54` 个已完成实验，其中 `30` 个属于 `workspace_raw`。
