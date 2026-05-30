# Tasks

## Phase 0: Spec & Compatibility
1. 定义 GraphState 字段、默认值与校验规则。
2. 定义节点事件契约并接入 trace store。
3. 增加 `runtime_orchestrator` 配置与读取路径。
4. 将 retrieval `metadata filter` 的软/硬双模式策略补入 contracts、spec 与工程文档。

## Phase 1: Graph Execution Foundation
5. 新增 Python graph orchestrator 模块与兼容执行器骨架。
6. 定义 executor backend 抽象：`langgraph | compat_graph_runner`。
7. 实现 GraphState 归一化与节点事件记录。

## Phase 2: Knowledge Main Path Migration
8. 实现主链路节点：prepare/query_frontend/retrieval/compose/quality/finalize/fallback。
9. 将现有 retrieval/composer/evaluator/runtime policy 能力接入节点调用，而不是重写它们。
10. 为 retrieval 节点补 `retrieval_plan.filter_plan`、`filter_policy`、`requested_filters`、`effective_filters` 与 `hard_filter_empty` / `recovered_soft_prefer` 审计语义。

## Phase 3: Runtime and Bridge Integration
11. 在 Python CLI dispatch 增加 `run_orchestrator_graph`。
12. 在 Node runtime / config 中增加 `runtime_orchestrator` 读取与 flag 分流。
13. 保持现有 SSE、response output、audit 语义兼容。

## Phase 4: Verification
14. 增加 graph state 合同测试、节点分支测试与 filter policy 测试。
15. 增加 `legacy` vs `langgraph_mvp` 对照测试（关键 knowledge case）。
16. 跑现有 retrieval / memory / wiki / knowledge 套件回归。
17. 跑 live / stream / approval / restart / wiki-first smoke。

## Phase 5: Rollout
18. 默认保持 `legacy`，灰度开启 `langgraph_mvp`。
19. 在结构化台账中记录性能、质量与 filter policy 行为对比。
20. 真实 LangGraph 依赖稳定后，再将 `executor_backend` 默认从兼容执行器切换到 `langgraph`。
