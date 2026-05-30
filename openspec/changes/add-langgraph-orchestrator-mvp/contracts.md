# Contracts: LangGraph Orchestrator MVP

## 1) GraphState Contract
必填字段：
- `trace_id: string`
- `task_id: string`
- `query: string`
- `persona_id: string`
- `orchestrator_mode: legacy | langgraph_mvp`
- `executor_backend: langgraph | compat_graph_runner`

阶段字段：
- `query_frontend: { terms, query_mode, intent_tags, filter_hints, decomposition, rewrites, clarification, boundary }`
- `retrieval: { requested_route_mode, effective_route_mode, route_reason, requested_filters, effective_filters, filter_policy, items, supporting_chunks, diagnostics, channel_hits }`
- `draft: { content, citations, evidence_refs, model_route, fallback }`
- `quality_gate: { decision, score, reasons }`
- `result: { status, answer, review_required, fallback_reason }`

### Retrieval Filter Policy Contract
- `filter_policy.default_mode: soft_prefer`
- `retrieval_plan.filter_plan.mode: soft_prefer | hard_enforce`
- `filter_policy.mode: soft_prefer | hard_enforce`
- `filter_policy.hard_enforce_reason?: user_explicit | explicit_filters | policy_guardrail | retry_noisy_results | null`
- `filter_policy.hard_filter_empty?: boolean`
- `filter_policy.recovered_soft_prefer?: boolean`
- `requested_filters: object`
- `effective_filters: object`
- `soft_match_score?: number`
- `filtered_candidate_count?: number`
- `fallback_reason?: string | null`

## 2) Node Execution Event Contract
- `event_type: node_started | node_completed | node_failed`
- `node_name: string`
- `trace_id: string`
- `task_id: string`
- `timestamp: iso8601`
- `duration_ms?: number`
- `error_code?: string`
- `summary?: object`

## 3) Bridge Contract
沿用当前 Python CLI action：
- 新增/扩展 action：`run_orchestrator_graph`
- 输入：与当前 runtime step / knowledge-chain 输入兼容，并允许传入：
  - `orchestrator_mode`
  - `executor_backend_preference?`
  - `filters?`
  - `filter_policy?`
- 输出：与当前 response composer + quality gate 输出兼容，并补充：
  - `graph_state`
  - `node_events`
  - `executor_backend`

## 4) Recovery Contract
- 节点失败后记录：`failed_node`, `state_snapshot_ref`, `recoverable`
- 恢复请求可指定：`resume_from_node`（默认最近安全节点）
