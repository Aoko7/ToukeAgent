# Design: LangGraph Orchestrator MVP

## 架构边界
- Node shell 继续负责 HTTP/SSE、工具执行、持久化、平台适配。
- Python core 负责计划、检索、路由、草拟、评估与编排。
- 图编排只进入 Python core 编排层，不穿透 Node 外壳。
- 现有 retrieval / composer / evaluator / runtime policy 模块仍然是能力提供者，图层只负责编排，不复制规则。

## 为什么这次先做适配层
当前环境不保证始终安装 `langgraph` 依赖，而我们又需要让 OpenSpec 与工程实现先稳定下来。因此本次设计采用两层抽象：

1. `graph orchestration contract`
   - 定义图节点、状态迁移、事件与恢复语义
   - 不依赖具体第三方运行时
2. `graph executor backend`
   - `langgraph` 可用时，绑定到真实 LangGraph 运行时
   - 否则使用兼容执行器顺序/条件执行同一张图

这样做的目的不是“假装已经完成 LangGraph 集成”，而是避免让依赖是否安装阻塞主架构迁移。

## 图编排范围（MVP）
MVP 只覆盖知识主链路，不直接替代完整任务 runtime：

主图节点：
1. `prepare_request`
2. `analyze_query_frontend`
3. `plan_retrieval`
4. `retrieve_evidence`
5. `compose_grounded_draft`
6. `evaluate_quality_gate`
7. `finalize_response`
8. `fallback_or_review`

主图边：
- `prepare_request -> analyze_query_frontend -> plan_retrieval -> retrieve_evidence -> compose_grounded_draft -> evaluate_quality_gate`
- `evaluate_quality_gate(pass) -> finalize_response`
- `evaluate_quality_gate(block/review) -> fallback_or_review`

## GraphState 设计
统一 `GraphState` 采用“稳定子块”而不是松散字典，避免后续节点互相踩字段：

- `request`
  - task_id, trace_id, message_text, persona_id, workspace_id
- `runtime`
  - orchestrator_mode, executor_backend, started_at, checkpoints
- `query_frontend`
  - terms, query_mode, intent_tags, filter_hints, decomposition, rewrites, clarification, boundary
- `retrieval`
  - requested_route_mode, effective_route_mode, route_reason
  - requested_filters, effective_filters
  - filter_policy, hard_filter_empty
  - channel_hits, raw_items, items, doc_aggregates, supporting_chunks, citations, quality, diagnostics
- `draft`
  - content, citations, evidence_refs, model_route, fallback
- `quality_gate`
  - decision, score, reasons, sampled_for_review
- `result`
  - status, answer, review_required, fallback_reason, review_item
- `errors`
  - failed_node, recoverable, error_code, error_message

## 保留当前 retrieval 主链能力
图编排层不应重写当前 retrieval 内核，而应把既有链路提升为显式节点语义：

- `analyze_query_frontend` 复用当前 query frontend 结构化输出：`terms / query_mode / intent_tags / filter_hints / decomposition / rewrites / clarification / boundary`
- `plan_retrieval` 保留当前“第一版仍以 scaffold 为主”的实现现状，而不是假装已经有完整 learned query planner
- `retrieve_evidence` 继续复用当前 `Qdrant semantic + BM25 lexical + metadata filter + heuristic rerank` 组合管线
- retrieval 节点输出必须保留 `raw_items -> doc_aggregates -> supporting_chunks -> citations -> quality` 这一结构化演进关系
- `compose_grounded_draft` 节点应消费现有 compact evidence pack 语义，而不是在图层里再发明一套新的证据打包协议

## Metadata Filter 双模式策略
现有 retrieval 已有 `semantic + BM25 + metadata filter` 组合管线。本次变更要求把 filter 行为从隐式实现提升为显式契约。

### 默认模式：`soft_prefer`
- metadata 作为 rerank / parent ordering 的加权偏好
- 不因 conference/year/doc 限制直接丢弃所有不匹配候选
- 适用于：
  - query 中带弱提示但未明确限制范围
  - query frontend 只是从上下文推断出候选域

### 升级模式：`hard_enforce`
- metadata 先作为硬过滤作用于 candidate set
- 若过滤后为空，可按策略回退到软模式，但必须留下显式审计字段
- 适用于：
  - 用户显式限定范围，如“只看 ACL 2024”
  - 请求本身已经携带显式 metadata filters
  - policy / governance 要求必须限制数据域
  - 系统在高噪声 fallback/retry 中主动收紧范围

### 回退策略
- `hard_enforce` 过滤为空时，不直接沉默失败
- 系统应记录 `hard_filter_empty`
- 然后执行：
  - `soft_prefer` 回退，或
  - clarification / review / abstain
  具体由 query frontend boundary 与 quality gate 共同决定
- `retrieval_plan.filter_plan.mode` 保留规划态 `hard_enforce`
- 若恢复成功，`filter_policy.mode` 在结果态降为 `soft_prefer`
- `recovered_soft_prefer=true` 表示发生了 metadata filter recovery
- 这种恢复不应改写 `requested_route_mode / effective_route_mode`，也不应把 `route.fallback_applied` 误记成来源回退

## 与现有 runtime 的关系
本次不直接让 Node `runAgentTask` 整体改成图执行，而是先提供：
- Python `run_orchestrator_graph` action
- Node runtime 在需要时以 feature flag 调用图执行结果
- 保持当前事件与输出结构稳定

这使我们可以先把图编排跑在知识主链路上，再决定是否逐步接管更完整的 step loop。

## 兼容策略
- `runtime_orchestrator` 配置：
  - `legacy`：维持现有执行链
  - `langgraph_mvp`：走图编排链
- Node `python-core-bridge` action 不变，内部根据 flag 切换执行器。
- 图执行器增加 `executor_backend` 字段：
  - `langgraph`
  - `compat_graph_runner`

## 可观测性与恢复
- 每个节点产出 `node_started/node_completed/node_failed` 事件。
- 节点输入输出摘要写入 trace collector（避免敏感原文泄露）。
- 失败节点保存恢复点，可从最近安全节点继续执行。
- retrieval 节点必须补充：
  - `retrieval_plan.filter_plan.mode`
  - `filter_policy.mode`
  - `requested_filters`
  - `effective_filters`
  - `hard_enforce_reason`
  - `hard_filter_empty`
  - `recovered_soft_prefer`
  - `filtered_candidate_count`
  - `fallback_reason`
  - `doc_aggregate_count`
  - `contract_coverage_score`
  - `recommended_action`

## 风险与缓解
1. 状态 schema 不一致 -> 引入强校验与默认值归一化。
2. 双路径行为偏差 -> 关键 case 双跑对比 + 阈值门禁。
3. 真实 LangGraph 依赖在部分环境缺失 -> 先提供兼容执行器并保留 backend 标识。
4. metadata filter 行为不透明 -> 在 retrieval state 与 trace 中显式暴露软/硬模式与回退原因。
5. 性能回退 -> 节点计时与慢节点告警。
