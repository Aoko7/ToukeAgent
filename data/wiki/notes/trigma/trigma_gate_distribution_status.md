---
entry_id: wiki_trigma_gate_distribution_status
title: TriGMA gate distribution status
owner: trigma_ops
tags: [trigma, status, gate, confidence, current]
required_context:
  - project_scope
  - gate_scope
retrieval_hints:
  - current gate status
  - gate distribution
  - 当前 gate 状态
ttl_seconds: 1209600
source_of_truth: TriGMA/reports/issue04/gate_quantitative_evidence.md
---

# TriGMA gate distribution status

## Summary
Current gate distribution and confidence-alignment snapshot for TriGMA.

## Facts
- `full seed42` 下三路 gate 均值分别为：`micro = 0.4039`、`meso = 0.1429`、`macro = 0.4532`。
- `macro` 的 dominant share 当前最高，为 `0.7266`；`meso` 的 dominant share 仅为 `0.0038`。
- `no-gate` 对照中三路权重都固定为 `0.3333`，dominant tie rate 为 `1.0000`。
- 低置信度 20% 子集的 error rate 当前为 `0.2658`，高置信度 20% 子集仅为 `0.0127`。
