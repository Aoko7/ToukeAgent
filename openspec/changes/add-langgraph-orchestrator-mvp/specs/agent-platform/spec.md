# Spec Delta: Agent Platform - LangGraph Orchestrator MVP

## ADDED Requirements

### Requirement: Graph-Orchestrated Runtime Main Path
系统 SHALL 提供基于状态图的主执行链路，并支持与现有运行时并存。

#### Scenario: Execute request via langgraph_mvp main path
- GIVEN `runtime_orchestrator=langgraph_mvp`
- WHEN 系统收到一个标准任务请求
- THEN 系统 SHALL 按主图节点顺序执行
- AND SHALL 产出与现有 runtime 兼容的最终响应结构
- AND SHALL 在结果中返回执行器 backend 标识

#### Scenario: Quality gate blocked path enters fallback node
- GIVEN quality gate 返回阻断或需复核决策
- WHEN 图执行到质量门禁节点
- THEN 系统 SHALL 跳转到 fallback/review 节点
- AND SHALL 在输出中标注 `review_required` 或 `fallback_reason`

### Requirement: Retrieval Metadata Filter Policy
系统 SHALL 将 retrieval metadata filter 视为显式策略对象，而不是隐式散落在检索实现中的行为。

#### Scenario: Soft-prefer filter biases ranking without hard exclusion
- GIVEN query frontend 只推断出 conference/year 候选域，但用户未显式要求“只看某范围”
- WHEN 系统执行 retrieval
- THEN 系统 SHALL 以 `soft_prefer` 模式应用 metadata filter
- AND SHALL 优先排序 metadata 匹配候选，而不是先剔除所有不匹配候选

#### Scenario: Explicit scope upgrades filter into hard enforce
- GIVEN 用户明确要求只看某个 conference、year 或 doc scope
- WHEN 系统执行 retrieval
- THEN 系统 SHALL 将 filter policy 升级为 `hard_enforce`
- AND SHALL 在检索前先以该 filter 收窄候选集合

#### Scenario: Explicit request filters also upgrade hard enforce
- GIVEN 请求载荷本身已经带有显式 metadata filters
- WHEN 系统执行 retrieval
- THEN 系统 SHALL 将 filter policy 升级为 `hard_enforce`
- AND SHALL 在 graph state 中保留升级原因

#### Scenario: Hard filter empty falls back with explicit reason
- GIVEN `hard_enforce` 过滤后没有候选结果
- WHEN 系统继续处理该请求
- THEN 系统 SHALL 记录 `hard_filter_empty` 类原因
- AND 若系统在同一路由内恢复候选，SHALL 将结果中的 `filter_policy.mode` 降为 `soft_prefer`
- AND SHALL 标记 `recovered_soft_prefer=true`
- AND SHALL 保留 `retrieval_plan.filter_plan.mode = hard_enforce`
- AND SHALL 仅在真实来源回退时设置 `route.fallback_applied=true`
- AND SHALL 回退到 `soft_prefer`、clarification、review 或 abstain 之一
- AND SHALL 在 trace / result 中保留该回退语义

#### Scenario: Retrieval result exposes requested and effective filters
- GIVEN 任一 retrieval 请求包含显式或推断出的 metadata filter
- WHEN retrieval 完成
- THEN 系统 SHALL 同时返回 `requested_filters` 与 `effective_filters`
- AND SHALL 返回 `retrieval_plan.filter_plan.mode`
- AND SHALL 返回结果态 `filter_policy.mode`

#### Scenario: Graph retrieval node preserves evidence structure
- GIVEN `runtime_orchestrator=langgraph_mvp`
- WHEN 图执行到 retrieval 节点并完成取证
- THEN 系统 SHALL 保留 `raw_items`、`doc_aggregates`、`supporting_chunks`、`citations` 与 `quality`
- AND SHALL 把这些结构化结果传给后续 compose 节点，而不是只传一个扁平文本摘要

### Requirement: Node-Level Traceability
系统 SHALL 为每个图节点输出结构化可观测事件。

#### Scenario: Node execution emits start/complete events
- GIVEN 任一图节点被执行
- WHEN 节点开始与完成
- THEN 系统 SHALL 分别记录 `node_started` 与 `node_completed`
- AND SHALL 包含 trace_id、task_id、node_name 与 duration_ms

#### Scenario: Node failure emits recoverable snapshot reference
- GIVEN 某图节点执行失败
- WHEN 系统处理异常
- THEN 系统 SHALL 记录 `node_failed` 事件
- AND SHALL 保留可恢复状态快照引用

### Requirement: Dual-Mode Compatibility
系统 SHALL 支持 legacy 与 langgraph_mvp 双路径，并可配置切换。

#### Scenario: Runtime flag routes to legacy path
- GIVEN `runtime_orchestrator=legacy`
- WHEN 请求进入 runtime
- THEN 系统 SHALL 使用原有执行链路
- AND SHALL 保持既有测试行为不变

#### Scenario: Runtime flag routes to graph path
- GIVEN `runtime_orchestrator=langgraph_mvp`
- WHEN 请求进入 runtime
- THEN 系统 SHALL 使用图执行链路
- AND SHALL 保持 bridge 输出契约兼容
