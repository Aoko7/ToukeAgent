# Contracts

本文档提供字段级契约，供后端、前端、平台适配层和工具实现直接对齐。

## 1. CanonicalMessage

### 用途
统一承接所有外部平台入站消息，以及平台内部需要回放、审计、路由的消息对象。

### 建议字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `message_id` | string | 平台内唯一消息 ID |
| `source_platform` | string | 消息来源平台，如 `web`、`discord`、`wechat` |
| `source_message_id` | string | 外部平台原始消息 ID |
| `workspace_id` | string | 工作区边界 |
| `channel_id` | string | 外部渠道或群组标识 |
| `conversation_id` | string | 会话标识 |
| `thread_id` | string | 线程标识，可为空 |
| `sender` | object | 发送者摘要 |
| `recipient` | object | 接收者摘要 |
| `created_at` | string | ISO 8601 时间 |
| `content` | array | 结构化内容片段 |
| `attachments` | array | 附件元数据 |
| `quoted_messages` | array | 引用消息摘要 |
| `intent_tags` | array | 路由或业务意图标签 |
| `risk_flags` | array | 风险标记 |
| `persona_hint` | string | 建议人格，可为空 |
| `trace_id` | string | 审计链路标识 |
| `metadata` | object | 平台专有扩展字段 |

### 内容片段建议
`content` 建议拆为多段，避免把所有内容塞进一个字符串。

```json
{
  "type": "text",
  "text": "请帮我分析这个任务"
}
```

常见 `type`：
- `text`
- `mention`
- `image`
- `file`
- `quote`
- `action`

### 示例
```json
{
  "message_id": "msg_01",
  "source_platform": "web",
  "source_message_id": "raw_9981",
  "workspace_id": "ws_research",
  "channel_id": "console",
  "conversation_id": "conv_12",
  "thread_id": "thread_7",
  "sender": {
    "id": "user_1",
    "role": "user",
    "display_name": "Alice"
  },
  "recipient": {
    "id": "agent_main",
    "role": "agent"
  },
  "created_at": "2026-05-11T10:30:00Z",
  "content": [
    {
      "type": "text",
      "text": "请给我一个分阶段方案"
    }
  ],
  "attachments": [],
  "quoted_messages": [],
  "intent_tags": ["planning"],
  "risk_flags": [],
  "persona_hint": "researcher",
  "trace_id": "trace_abc",
  "metadata": {
    "platform_capabilities": ["stream", "thread"]
  }
}
```

## 2. StreamEvent

### 用途
统一描述 SSE 和内部事件总线中的流式输出事件。

### 事件类型
- `start`
- `delta`
- `tool_call`
- `tool_result`
- `status`
- `error`
- `done`
- `cancel`
- `heartbeat`

### 建议字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `event_id` | string | 事件 ID |
| `event_type` | string | 事件类型 |
| `seq` | integer | 同一流内递增序号 |
| `trace_id` | string | 全局追踪 ID |
| `task_id` | string | 任务 ID |
| `run_id` | string | 本次执行 ID |
| `step_id` | string | 所属计划步骤 ID，可为空 |
| `persona_id` | string | 当前人格 ID |
| `timestamp` | string | ISO 8601 时间 |
| `is_terminal` | boolean | 是否终止事件 |
| `visibility` | string | `user` / `internal` / `audit` |
| `payload` | object | 事件主体 |
| `usage` | object | token 或资源统计 |
| `error` | object | 错误结构，可为空 |

### 事件载荷建议

#### `start`
```json
{
  "title": "Generating response",
  "mode": "assistant"
}
```

#### `delta`
```json
{
  "text": "第一阶段我们先打通最小闭环，"
}
```

#### `tool_call`
```json
{
  "tool_name": "search_docs",
  "call_id": "call_01",
  "summary": "Search internal docs for OpenSpec format"
}
```

#### `tool_result`
```json
{
  "call_id": "call_01",
  "tool_name": "search_docs",
  "status": "success",
  "summary": "Found 3 matching documents",
  "error_code": null
}
```

#### `status`
```json
{
  "state": "retrieving",
  "message": "Hybrid RAG recall in progress"
}
```

#### `done`
```json
{
  "final_message_id": "msg_out_01",
  "finish_reason": "completed"
}
```

### SSE 映射建议
- `event:` 使用 `event_type`
- `id:` 使用 `event_id`
- `data:` 放完整 JSON
- 对浏览器长连接增加 `heartbeat` 事件，避免空闲断流
- 重连时优先基于 `Last-Event-ID` 或最近 `seq` 恢复

## 3. ToolInvocationContract

### 用途
统一描述工具注册、工具调用和工具返回结构。

### 注册元数据
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `tool_name` | string | 工具名 |
| `version` | string | 版本 |
| `description` | string | 简要说明 |
| `input_schema` | object | 入参 schema |
| `output_schema` | object | 出参 schema |
| `permissions` | array | 所需权限 |
| `risk_level` | string | `low` / `medium` / `high` / `critical` |
| `timeout_ms` | integer | 超时时间 |
| `retry_policy` | object | 重试策略 |
| `idempotent` | boolean | 是否幂等 |
| `side_effect_scope` | string | 副作用范围 |
| `requires_approval` | boolean | 是否默认要求审批 |
| `enabled` | boolean | 是否允许在当前 registry 中被执行 |
| `release_channel` | string | 发布通道，如 `stable` / `beta` / `experimental` |
| `capabilities` | array | 工具能力标签，如 `retrieval`、`planning`、`operations` |
| `execution_constraints` | object | 受限执行环境约束，如 network/filesystem/shell 需求 |

### `execution_constraints` 建议字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `network_access` | boolean | 工具是否要求网络访问 |
| `filesystem_scope` | string | `none` / `read_only` / `workspace_write` / `full` |
| `shell_access` | boolean | 工具是否要求 shell 执行能力 |
| `path_allowlist` | array | 当工具涉及文件系统路径时声明允许访问的路径根；restricted execution 会与环境 allowlist 求交后阻断越界路径 |
| `egress_allowlist` | object | 当工具涉及网络访问时声明允许访问的 host/provider；host 当前支持精确值与 `*.domain` 后缀规则，也支持 `provider_host_bindings` 约束 provider 与 host 的组合关系；restricted execution 会与环境 egress allowlist 求交后阻断越界网络目标 |

### `retry_policy` 建议字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `max_attempts` | integer | 最大尝试次数 |
| `backoff_ms` | integer | 重试等待时间 |
| `retry_on` | array | 允许自动重试的状态，如 `error`、`timeout` |

### 调用请求
```json
{
  "call_id": "call_01",
  "tool_name": "search_docs",
  "version": "1.0.0",
  "trace_id": "trace_abc",
  "caller": {
    "task_id": "task_01",
    "step_id": "step_03",
    "persona_id": "researcher"
  },
  "access_policy": {
    "toolset_id": "analysis_toolset",
    "allowed_permissions": ["read_docs"],
    "allow_side_effects": false,
    "allow_unlisted_tools": true,
    "disallowed_tools": [],
    "allowed_release_channels": ["stable"],
    "required_capabilities": ["retrieval"]
  },
  "arguments": {
    "query": "OpenSpec proposal format"
  }
}
```

#### Runtime `access_policy` 建议子字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `toolset_id` | string | 当前请求生效的工具集 ID |
| `allowed_permissions` | array | 该请求允许的权限范围 |
| `allowed_tools` | array | 显式允许的工具 allowlist |
| `disallowed_tools` | array | 必须阻断的工具列表 |
| `allow_side_effects` | boolean | 是否允许副作用型工具 |
| `allow_unlisted_tools` | boolean | 当存在 allowlist 时，是否允许未显式列出的工具 |
| `allowed_release_channels` | array | 允许命中的工具发布通道 |
| `required_capabilities` | array | 当前 toolset 要求工具具备的能力标签 |

### 调用响应
```json
{
  "call_id": "call_01",
  "status": "success",
  "error_code": null,
  "summary": "Found 3 matching documents",
  "result": {
    "items": []
  },
  "evidence": [],
  "metrics": {
    "latency_ms": 182,
    "attempt_count": 1,
    "retry_count": 0,
    "timeout_ms": 5000,
    "risk_level": "low",
    "idempotent": true
  }
}
```

## 4. PersonaProfile

### 用途
定义人格、角色和行为边界。

### 建议字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `persona_id` | string | 人格 ID |
| `name` | string | 显示名称 |
| `purpose` | string | 角色用途 |
| `style` | object | 表达风格 |
| `boundaries` | array | 禁止越过的边界 |
| `preferred_tools` | array | 默认偏好工具 |
| `disallowed_tools` | array | 禁止工具 |
| `retrieval_policy` | object | 检索偏好 |
| `memory_policy` | object | 记忆写入和读取策略 |
| `model_policy` | object | 模型路由偏好 |
| `approval_policy` | object | 审批阈值 |
| `tool_access_policy` | object | 人格级工具访问策略 |
| `channel_policy` | object | 在不同平台上的输出偏好 |
| `metadata` | object | 扩展字段 |

#### `tool_access_policy` 建议子字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `toolset_id` | string | 当前人格默认工具集 |
| `allowed_permissions` | array | 允许的工具权限范围 |
| `allowed_tools` | array | 可选的工具 allowlist |
| `disallowed_tools` | array | 必须阻断的工具 |
| `allow_side_effects` | boolean | 是否允许副作用型工具 |
| `allow_unlisted_tools` | boolean | 当存在 allowlist 时，是否允许未显式列出的工具 |
| `allowed_release_channels` | array | 当前人格允许命中的工具发布通道 |
| `required_capabilities` | array | 当前人格要求工具具备的能力标签 |
| `egress_allowlist` | object | 当前人格或 toolset 对外联目标施加的动态 egress slice，结构与工具 `execution_constraints.egress_allowlist` 保持一致，并在 restricted execution 中与环境策略、工具契约按交集收紧 |

#### `memory_policy` 建议子字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `provider` | string | `local_builtin` / `mem0_compatible` |
| `fallback_provider` | string | provider 不可用时的回退目标 |
| `workspace_isolated` | boolean | 是否按 workspace 隔离长期记忆 |
| `persona_isolated` | boolean | 是否按 persona 隔离长期记忆 |
| `durable_write_threshold` | number | 自动提升为长期记忆的阈值 |
| `retrieval_top_k` | integer | 默认长期记忆检索数量 |
| `allow_snapshot_reuse` | boolean | 是否允许压缩快照复用到恢复与 handoff |
| `stale_after_hours` | integer | 记忆过期 / 复核阈值 |

#### Runtime memory context / strategy 建议字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `requested_provider` | string | 配置或策略请求的 provider |
| `effective_provider` | string | 运行时实际生效的 provider |
| `fallback_applied` | boolean | 是否发生 provider 回退 |
| `fallback_reason` | string | 回退原因，如 `provider_disabled`、`provider_unavailable`、`durable_backend_init_failed:*` |
| `requested_capabilities` | object | 请求 provider 的能力声明 |
| `effective_capabilities` | object | 实际 provider 的能力声明 |
| `retrieval_strategy` | object | 长期记忆召回使用的排序策略摘要，如 `python_ranked_recall`、权重和 embedding backend |
| `durable_write_decision` | object | durable write 判定结果摘要，如 `should_promote`、`confidence`、`reasons` |

说明：
- `provider` 在运行时视图中建议等价于 `effective_provider`，避免 API 把“配置请求”误报成“实际生效”。
- `/api/memory`、trace bundle 和调试视图应同时暴露 `requested_provider` 与 `effective_provider`，便于排查外部 durable provider 不可用时的降级行为。
- 长期记忆召回排序和 durable write 判定建议由 Python core 输出结构化结果，Node 只负责持久化、API 暴露和审计回写，避免在多个 `.mjs` 文件里散落不同 heuristic。
- 当长期记忆条目带有 `expires_at` 时，运行时应在到期后将其视作 stale，并在 `exclude_stale` 视图中排除，即使 `updated_at` 仍然较新。

#### Memory runtime observability 建议子字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `runtime_summary.provider_mode` | string | 当前调试视图中生效的 provider 模式，通常等价于 `effective_provider` |
| `runtime_summary.provider_switch` | string | `requested -> effective` 形式的 provider 切换摘要 |
| `runtime_summary.fallback_applied` | boolean | 是否发生 provider 回退 |
| `runtime_summary.fallback_reason` | string | 最近一次 provider 回退原因 |
| `runtime_summary.short_term_count` | integer | 当前短期记忆条目数 |
| `runtime_summary.long_term_count` | integer | 当前长期记忆条目数 |
| `runtime_summary.stale_long_term_count` | integer | 当前长期记忆中 stale 条目数 |
| `runtime_summary.stale_long_term_rate` | number | stale 长期记忆占比 |
| `runtime_summary.handoff_count` | integer | 当前 task 关联的 handoff 数量 |
| `runtime_summary.compression_count` | integer | 当前 task 关联的压缩快照数量 |
| `runtime_summary.latest_handoff_id` | string | 最近一次 handoff ID |
| `runtime_summary.latest_context_snapshot_id` | string | 最近一次 handoff / compression 关联的 context snapshot ID |
| `runtime_summary.runtime_persistence` | string | 当前 durable backend 的持久化模式摘要 |
| `runtime_summary.short_term_persistence` | string | 当前短期记忆归档模式摘要，如 `markdown_archive` 或 `process_memory` |
| `runtime_summary.short_term_archive_entry_count` | integer | 当前任务对应的短期记忆归档条目数 |
| `runtime_summary.short_term_archive_updated_at` | string | 当前任务短期记忆归档最近更新时间 |
| `runtime_summary.durable_store_entry_count` | integer | durable store 已持久化条目数量 |
| `runtime_summary.durable_store_updated_at` | string | durable store 最近更新时间 |
| `linked_artifacts.latest_handoff` | object | 最近一次 handoff packet 详情 |
| `linked_artifacts.latest_compression` | object | 最近一次 context compression snapshot 详情 |
| `linked_artifacts.short_term_archive` | object | 当前任务的短期记忆 markdown 归档摘要 |

说明：
- `runtime_summary` 用于回答“现在这条记忆链路在怎么跑”，而不是替代原始 memory entries。
- `linked_artifacts` 应保留结构化对象，便于控制台、trace 调试和后续 harness authoring 直接复用，而不是只回传 ID。

#### Wiki durable store / cache 建议字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `wiki.provider` | string | wiki 主存 provider，如 `sqlite` |
| `wiki.runtime_persistence` | string | wiki 主存持久化模式，如 `sqlite` |
| `wiki.durable_store.file_path` | string | wiki durable store 文件路径 |
| `wiki.durable_store.entry_count` | integer | 当前 wiki 持久化条目数 |
| `wiki.durable_store.proposal_count` | integer | 当前 wiki proposal 持久化条目数 |
| `wiki.cache.enabled` | boolean | 是否启用可选缓存 |
| `wiki.cache.backend` | string | 缓存后端，如 `redis_optional` |
| `wiki.cache.ttl_seconds` | integer | 缓存 TTL |

### 示例
```json
{
  "persona_id": "reviewer",
  "name": "Code Reviewer",
  "purpose": "Prioritize bugs, regressions, and missing tests",
  "style": {
    "tone": "direct",
    "verbosity": "medium"
  },
  "boundaries": [
    "do_not_hide_risk",
    "do_not_skip_citations"
  ],
  "preferred_tools": ["search_code", "run_tests"],
  "disallowed_tools": ["deploy_prod"],
  "retrieval_policy": {
    "prefer_hybrid_rag": true,
    "use_wiki_for_dynamic_facts": true
  },
  "memory_policy": {
    "provider": "local_builtin",
    "fallback_provider": "local_builtin",
    "workspace_isolated": true,
    "persona_isolated": true,
    "durable_write_threshold": 0.85,
    "retrieval_top_k": 4,
    "allow_snapshot_reuse": true,
    "stale_after_hours": 168,
    "write_long_term": false
  },
  "model_policy": {
    "tier": "high_reasoning"
  },
  "approval_policy": {
    "required_for_side_effects": true
  },
  "tool_access_policy": {
    "toolset_id": "review_toolset",
    "allowed_permissions": ["read_docs", "read_wiki"],
    "allowed_tools": [],
    "disallowed_tools": ["deploy_prod"],
    "allow_side_effects": false,
    "allow_unlisted_tools": true,
    "allowed_release_channels": ["stable"],
    "required_capabilities": ["retrieval"]
  },
  "channel_policy": {
    "prefer_streaming": true
  },
  "metadata": {}
}
```

### ToolsetCatalogEntry

### 用途
定义 persona catalog 中可复用的工具集目录，用于统一描述权限、能力、发布通道和副作用边界。

### 建议字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `toolset_id` | string | 工具集 ID |
| `label` | string | 显示名称 |
| `description` | string | 工具集说明 |
| `allowed_permissions` | array | 默认允许的权限范围 |
| `required_capabilities` | array | 工具集要求工具具备的能力标签 |
| `allowed_release_channels` | array | 工具集允许命中的发布通道 |
| `allow_side_effects` | boolean | 是否允许副作用型工具 |
| `enabled` | boolean | 工具集是否启用 |
| `release_channel` | string | 工具集自身发布通道 |
| `capabilities` | array | 工具集主要覆盖的能力标签 |
| `metadata` | object | 扩展字段 |

说明：
- `toolset` 是 persona 与 tool registry 之间的目录层，不是第二套运行时权限系统。
- Python core 应作为 toolset catalog 的 source of truth；Node 只负责透传、展示和执行前 gate。

## 5. RouteBinding

### 用途
把渠道、工作区、人格和 agent 运行实例绑定起来。

### 建议字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `binding_id` | string | 绑定 ID |
| `workspace_id` | string | 工作区 |
| `channel_pattern` | string | 渠道路由规则 |
| `agent_id` | string | 处理该路由的 agent |
| `persona_id` | string | 默认人格 |
| `model_policy_id` | string | 默认模型策略 |
| `toolset_id` | string | 可用工具集 |
| `streaming_enabled` | boolean | 是否允许流式输出 |
| `status` | string | `active` / `paused` |

## 6. AgentPlan

### 用途
描述一次任务的规划结果、步骤顺序和执行目标。

### 建议字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `plan_id` | string | 计划 ID |
| `task_id` | string | 任务 ID |
| `trace_id` | string | 追踪 ID |
| `persona_id` | string | 当前人格 |
| `goal` | string | 计划目标 |
| `summary` | string | 计划摘要 |
| `steps` | array | 步骤数组 |
| `metadata` | object | 扩展字段 |

### 步骤建议字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `step_id` | string | 步骤 ID |
| `title` | string | 步骤标题 |
| `objective` | string | 步骤目标 |
| `kind` | string | `reason` / `tool` / `respond` |
| `status` | string | `pending` / `running` / `completed` / `failed` / `cancelled` |
| `tool_name` | string | 关联工具，可为空 |
| `acceptance` | array | 步骤完成标准 |
| `metadata` | object | 扩展字段 |

## 7. AgentRunState

### 用途
描述一个任务执行过程中的实时状态、阶段结果和最终输出。

### 建议字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `run_id` | string | 运行 ID |
| `task_id` | string | 任务 ID |
| `trace_id` | string | 追踪 ID |
| `persona_id` | string | 当前人格 |
| `plan_id` | string | 所属计划，可为空 |
| `status` | string | `queued` / `planning` / `running` / `completed` / `failed` / `cancelled` |
| `current_step_id` | string | 当前步骤，可为空 |
| `completed_steps` | number | 已完成步骤数 |
| `total_steps` | number | 总步骤数 |
| `step_results` | array | 步骤结果 |
| `output` | object | 最终输出 |
| `metadata` | object | 扩展字段 |

### 步骤结果建议字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `step_id` | string | 步骤 ID |
| `status` | string | 步骤状态 |
| `summary` | string | 结果摘要 |
| `output` | object | 步骤输出 |
| `error` | object | 错误信息 |

## 8. AgentHandoffPacket

### 用途
描述 coordinator 与 specialist agent 之间的委派、回传和汇合载荷。

### 建议字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `handoff_id` | string | handoff ID |
| `task_id` | string | 任务 ID |
| `trace_id` | string | 追踪 ID |
| `parent_agent_id` | string | 发起委派的 agent |
| `target_agent_id` | string | 目标 agent |
| `role` | string | 子 agent 角色，如 `retriever` / `reviewer` |
| `objective` | string | 子任务目标 |
| `scope` | object | 允许访问的数据、工具和工作区边界 |
| `input_summary` | string | 输入摘要 |
| `must_keep` | array | 必须保留的约束、证据或指令 |
| `evidence_refs` | array | 相关证据引用 |
| `context_snapshot_id` | string | 关联上下文快照，可为空 |
| `output_schema` | object | 预期返回结构 |
| `status` | string | `created` / `running` / `completed` / `failed` / `cancelled` |
| `metadata` | object | 扩展字段 |

### 示例
```json
{
  "handoff_id": "handoff_01",
  "task_id": "task_01",
  "trace_id": "trace_abc",
  "parent_agent_id": "agent_main",
  "target_agent_id": "agent_reviewer_1",
  "role": "reviewer",
  "objective": "Review the draft for factual risk and missing evidence",
  "scope": {
    "toolset_id": "review_toolset",
    "workspace_ids": ["ws_research"],
    "side_effects_allowed": false
  },
  "input_summary": "Draft complete. Need evidence and safety review.",
  "must_keep": [
    "do_not_hide_risk",
    "preserve cited evidence"
  ],
  "evidence_refs": ["trace_abc:step_02", "wiki_release_notes"],
  "context_snapshot_id": "ctx_01",
  "output_schema": {
    "type": "object",
    "required": ["findings", "decision"]
  },
  "status": "created",
  "metadata": {}
}
```

## 9. ContextCompressionSnapshot

### 用途
描述上下文预算管理后产出的压缩快照，可供恢复执行、跨 Agent handoff 和下一次模型调用复用。

### 建议字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `snapshot_id` | string | 快照 ID |
| `task_id` | string | 任务 ID |
| `trace_id` | string | 追踪 ID |
| `scope` | string | `task` / `agent` / `step` |
| `model_name` | string | 目标模型 |
| `compression_strategy` | string | `extractive` / `summary` / `hybrid` |
| `source_ranges` | array | 压缩来源区间或引用 |
| `token_budget` | integer | 目标预算 |
| `token_estimate` | integer | 压缩后估算 token |
| `must_keep` | array | 不允许丢失的关键项 |
| `summary` | string | 压缩摘要 |
| `unresolved_items` | array | 未决事项 |
| `evidence_refs` | array | 证据引用 |
| `memory_refs` | array | 关联记忆引用 |
| `metadata` | object | 扩展字段 |
| `created_at` | string | ISO 8601 时间 |

### 示例
```json
{
  "snapshot_id": "ctx_01",
  "task_id": "task_01",
  "trace_id": "trace_abc",
  "scope": "task",
  "model_name": "deepseek-v4-flash",
  "compression_strategy": "hybrid",
  "source_ranges": ["seq:1-48", "memory:ltm_12", "wiki_release_notes"],
  "token_budget": 12000,
  "token_estimate": 8420,
  "must_keep": [
    "current step objective",
    "latest tool result",
    "safety boundaries"
  ],
  "summary": "Plan drafted. Retrieval complete. Waiting for reviewer findings before final answer.",
  "unresolved_items": [
    "Confirm version status from wiki"
  ],
  "evidence_refs": ["call_step_02", "wiki_release_notes"],
  "memory_refs": ["stm_14", "ltm_3"],
  "metadata": {},
  "created_at": "2026-05-11T12:00:00Z"
}
```

## 10. Hybrid Retrieval Contracts

### 10.1 RetrievalQuery
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `query_text` | string | 原始查询文本 |
| `terms` | array | 归一化术语列表 |
| `query_mode` | string | `lookup` / `status_lookup` / `procedure` / `explanation` / `compare` |
| `intent_tags` | array | 更细粒度的路由或业务意图标签 |
| `intent` | object | 动态/稳定意图判断 |
| `filter_hints` | object | 检索过滤提示 |
| `decomposition` | object | 多意图拆分结果与子查询列表 |
| `rewrites` | object | query rewrite scaffold |
| `clarification` | object | 缺失上下文与追问建议 |
| `boundary` | object | `answer` / `clarify` / `decompose` 等边界动作，且可标注 `explicit_scope_required` |
| `metadata` | object | 可选扩展字段 |

### 10.2 RetrievalFilterHints
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `freshness` | string | `stable` / `dynamic` / `historical` |
| `source_scope` | array | 候选数据源范围，如 `rag`、`wiki` |
| `doc_types` | array | 文档类别，如 `architecture`、`process` |
| `entity_tags` | array | 动态实体标签，如 `pricing`、`version` |
| `projects` | array | 项目或业务域过滤 |
| `language` | string | 语言提示，如 `zh`、`en` |
| `conference_ids` | array | query frontend 推断出的会议范围 |
| `publication_years` | array | query frontend 推断出的年份范围 |
| `explicit_scope` | boolean | 是否识别到“只看某范围”这类硬范围约束 |

### 10.3 RAGDocument
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `doc_id` | string | 文档 ID |
| `title` | string | 文档标题 |
| `source_type` | string | `rag` |
| `doc_type` | string | 文档类型 |
| `project` | string | 所属项目 |
| `tags` | array | 标签集合 |
| `authority` | string | 来源权威等级 |
| `visibility` | string | 可见性边界 |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |
| `owner` | string | 当前知识 owner |
| `version` | string | 文档或知识版本 |
| `required_context` | array | 回答前需要补齐的最小上下文 |
| `retrieval_hints` | array | 推荐命中的关键词或别名 |
| `ttl_seconds` | number | 推荐 TTL |
| `source_of_truth` | string | 权威来源标识 |
| `contract_source` | string | `explicit` / `default_injected` |
| `metadata` | object | 扩展字段 |

### 10.4 RAGChunk
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `chunk_id` | string | chunk ID |
| `doc_id` | string | 归属文档 |
| `title` | string | chunk 标题 |
| `section_path` | array | 标题层级路径 |
| `text` | string | chunk 文本 |
| `semantic_vector_ref` | string | 向量索引引用 |
| `bm25_terms_ref` | string | 倒排索引引用 |
| `embedding_model` | string | 生成该 chunk 向量的 embedding 模型 |
| `embedding_dim` | number | 向量维度 |
| `vector_backend` | string | 向量存储后端，如 `qdrant` |
| `freshness` | string | 稳定性或时效标记 |
| `entity_refs` | array | 关联实体 ID |
| `owner` | string | 当前知识 owner |
| `version` | string | chunk 对应知识版本 |
| `required_context` | array | 回答前需要补齐的最小上下文 |
| `retrieval_hints` | array | 推荐命中的关键词或别名 |
| `ttl_seconds` | number | 推荐 TTL |
| `source_of_truth` | string | 权威来源标识 |
| `contract_source` | string | `explicit` / `default_injected` |
| `metadata` | object | 扩展字段 |

### 10.5 RetrievalCandidate
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `source_type` | string | `rag` / `wiki` |
| `doc_id` | string | 文档 ID，可为空 |
| `chunk_id` | string | chunk ID，可为空 |
| `entry_id` | string | wiki 条目 ID，可为空 |
| `title` | string | 标题 |
| `snippet` | string | 摘要或片段 |
| `semantic_score` | number | 稠密检索分 |
| `bm25_score` | number | 稀疏检索分 |
| `rerank_score` | number | 重排分 |
| `freshness` | string | 时效标记 |
| `matched_filters` | object | 命中过滤条件 |
| `owner` | string | 当前知识 owner |
| `version` | string | 知识版本 |
| `required_context` | array | 回答前需要补齐的最小上下文 |
| `retrieval_hints` | array | 推荐命中的关键词或别名 |
| `source_of_truth` | string | 权威来源标识 |
| `contract_source` | string | `explicit` / `default_injected` |
| `knowledge_contract` | object | 结构化知识契约快照 |
| `metadata` | object | 扩展字段 |

### 10.6 RetrievalPlan
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `implementation_status` | string | `scaffolded` / `active` |
| `active_path` | string | 当前生效路径 |
| `requested_path` | string | 路由器原始请求路径 |
| `query_frontend` | object | query frontend 摘要，如 query mode、subquery 数和 clarify 标志 |
| `filter_plan` | object | 过滤策略 |
| `rag` | object | semantic + BM25 + merge + rerank 骨架 |
| `wiki` | object | wiki lookup 骨架 |
| `embedding_strategy` | object | 当前请求使用的 embedding / vector backend 策略 |
| `response_policy` | object | 引用和 persona 相关策略 |

#### `response_policy` 建议子字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `citation_required` | boolean | 最终响应是否必须保留引用意识 |
| `grounding_mode` | string | 如 `compact_evidence_pack` |
| `clarification_first` | boolean | 当 query frontend 需要澄清时，是否优先追问 |
| `max_parent_items` | integer | 最多注入多少个 parent-level 来源 |
| `max_supporting_chunks_per_item` | integer | 每个来源最多注入多少条 supporting chunk |
| `max_supporting_chunks_total` | integer | 单次 response draft 最多注入多少条 supporting chunk |
| `max_snippet_chars` | integer | 单条 evidence snippet 的最大长度 |
| `max_evidence_chars` | integer | retrieval evidence 总字符预算 |
| `include_quality_summary` | boolean | 是否把 retrieval quality 摘要注入 prompt |
| `include_clarification_questions` | boolean | 是否把推荐澄清问题注入 prompt |

#### `filter_plan` 建议子字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `mode` | string | 规划态 filter mode，`soft_prefer` / `hard_enforce` |
| `hard_enforce_reason` | string | 如 `user_explicit`、`explicit_filters`、`policy_guardrail` |
| `hard_filter_empty` | boolean | 硬过滤后是否无候选 |
| `filtered_candidate_count` | integer | 过滤后候选数 |
| `fallback_reason` | string | 若发生回退，记录原因 |

### 10.7 RetrievalResult
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `route` | object | 检索路径与 fallback 信息 |
| `query_analysis` | object | Query 分析结果 |
| `requested_filters` | object | 用户显式请求的 filter |
| `effective_filters` | object | 系统最终执行的 filter |
| `filter_policy` | object | 结果态 filter policy，包含 `mode / hard_filter_empty / recovered_soft_prefer / fallback_reason` |
| `retrieval_plan` | object | 检索执行骨架 |
| `raw_items` | array | 融合后但未压缩为 parent-level 的原始候选 |
| `items` | array | 最终候选结果 |
| `stable_items` | array | 稳定来源候选 |
| `dynamic_items` | array | 动态来源候选 |
| `doc_aggregates` | array | parent-child 聚合后的来源级结果 |
| `supporting_chunks` | array | 最终选择出的支撑证据 |
| `citations` | array | 最终引用对象 |
| `quality` | object | 检索质量评估 |
| `persona_id` | string | 发起人格 |

### 10.8 RetrievalQuality
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `retrieval_score` | number | 综合检索质量分 |
| `citation_score` | number | 引用质量分 |
| `coverage_score` | number | 候选覆盖度 |
| `route_alignment_score` | number | route 与结果源的一致性 |
| `freshness_score` | number | freshness 对齐程度 |
| `source_balance_score` | number | RAG / wiki 引用平衡度 |
| `contract_coverage_score` | number | knowledge contract 覆盖度 |
| `boundary_action` | string | query frontend 决定的建议动作 |
| `clarification_required` | boolean | 是否要求先追问 |
| `source_of_truth_conflict_count` | number | 主来源内部 source-of-truth 冲突数 |
| `recommended_action` | string | `accept` / `supplement_rag` / `supplement_wiki` |

## 11. 开发约定

### 前端
- 只依赖 `CanonicalMessage` 和 `StreamEvent`
- 不直接依赖某个平台的原始字段

### 后端编排
- 只依赖 `ToolInvocationContract` 和 `PersonaProfile`
- 不把 UI 展示逻辑塞进编排状态机
- 多 Agent 协作优先通过 `AgentHandoffPacket` 和 `ContextCompressionSnapshot` 传递状态，而不是直接拼接整段历史
- response draft 只消费 retrieval result 的结构化字段，不直接自己再做一次检索或跳过 response policy 重组 evidence

### 适配层
- 负责平台字段映射、流式能力降级和回执回写
- 不负责业务规划逻辑

## 12. PythonCoreBridge

### 用途
定义 Node 外壳与 Python 核心之间的 JSON 调用契约。

### 请求字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `request_id` | string | 单次 bridge 调用 ID |
| `action` | string | `create_plan` / `retrieve` / `compose_draft` / `evaluate` |
| `payload` | object | 对应 action 的输入对象 |
| `metadata` | object | 可选元信息，如调用方、版本、调试标记 |

### 响应字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ok` | boolean | 是否成功 |
| `result` | object | action 返回值 |
| `error` | object | 失败时的错误结构 |
| `meta` | object | 可选执行信息，如 Python 版本或耗时 |

### 错误结构建议
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `code` | string | 错误码 |
| `message` | string | 错误描述 |
| `details` | object | 结构化错误上下文 |

### 示例
```json
{
  "request_id": "bridge_01",
  "action": "create_plan",
  "payload": {
    "message": {
      "trace_id": "trace_abc",
      "content": [{ "type": "text", "text": "请写一个开发方案" }]
    },
    "persona": {
      "persona_id": "researcher",
      "name": "Researcher"
    }
  },
  "metadata": {
    "caller": "apps/platform/src/planner.mjs"
  }
}
```

```json
{
  "ok": true,
  "result": {
    "plan_id": "plan_trace_abc",
    "task_id": "trace_abc",
    "trace_id": "trace_abc",
    "persona_id": "researcher",
    "goal": "请写一个开发方案",
    "summary": "Plan the request, route retrieval, then respond as Researcher.",
    "steps": []
  },
  "error": null,
  "meta": {
    "runtime": "python",
    "version": "3.x"
  }
}
```

## 13. Directory APIs

### 13.1 `/api/personas`

### 用途
暴露当前平台的人格目录，供控制台、调试面板和多 Agent 编排查询。

### 响应字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `default_persona_id` | string | 默认人格 ID |
| `packs` | array | persona pack 列表 |
| `personas` | array | 规范化后的人格列表 |
| `toolsets` | array | 与 persona catalog 同源的 toolset 目录 |

说明：
- `toolsets` 必须来自 Python core persona catalog，而不是 Node 侧手写默认值。
- `/api/personas` 是控制台人格切换、调试和 specialist 目录查看的主入口。

### 13.2 `/api/tools`

### 用途
暴露当前平台注册工具目录，供控制台和治理面板查看工具声明与可用边界。

### 响应字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `items` | array | 当前 registry 中已注册的工具定义 |
| `toolsets` | array | 与 `/api/personas` 同源的 toolset 目录 |

说明：
- `/api/tools` 应返回 registry 中的 `enabled`、`release_channel` 和 `capabilities` 元数据，便于核对 rollout 边界。
- `/api/tools` 也应保留 `execution_constraints`，便于控制台和治理链明确回答“某个工具为什么只能在更高权限环境里跑”。
- `/api/tools` 与 `/api/personas` 必须共享同一份 toolset catalog，避免控制台看到的目录和运行时 gate 口径不一致。
- 控制台 `Tools` inspector 应优先消费该接口，而不是从 trace bundle 或前端常量反推工具目录。

### 13.3 `/api/governance`

### 用途
暴露任务级与系统级治理快照，供控制台 `Gov` inspector、调试面板和后续治理报表消费。

### 任务级响应字段
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `task_id` | string | 当前任务 ID |
| `task` | object\|null | 当前任务快照 |
| `policy` | object | 当前治理策略 |
| `alerts` | array | 当前任务相关 alert 列表 |
| `latest_alert` | object\|null | 最近一条 alert |
| `metrics` | object | 任务级治理指标摘要 |
| `tool_governance` | object | 工具治理结构化摘要 |

### `tool_governance`
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `task_context` | object | 当前任务的人格、toolset 与 enforcement 上下文 |
| `runtime` | object | 当前 trace 的 blocked-tool 运行时统计 |
| `alerts` | object | alert 分类/严重度分布 |
| `active_toolset` | object\|null | 当前 persona 对应的 active toolset |
| `enforcement` | object | runtime access policy 与 catalog projection |
| `sandbox` | object | restricted execution sandbox 摘要 |
| `catalog` | object | registry 风险面统计 |

说明：
- `tool_governance.runtime` 至少应包含 `tool_call_count`、`tool_result_count`、`blocked_tool_result_count`、`blocked_rate`、`blocked_tool_error_codes` 和 `blocked_tool_names`。
- `tool_governance.runtime` 还应包含 `sandbox_blocked_tool_result_count`、`sandbox_blocked_error_codes` 与 `sandbox_blocked_tool_names`，用于区分一般治理阻断与 sandbox 级阻断。
- `tool_governance.enforcement` 至少应包含当前 `access_policy`、是否存在 runtime policy、以及在当前 policy 下对 registry 的 projected allow/block 结果。
- `tool_governance.sandbox` 至少应包含 `environment_name`、`network_allowed`、`shell_allowed`、`filesystem_scope`、`allowed_paths`、`blocked_count` 与 `blocked_by_reason`。
- `tool_governance.sandbox` 还应包含 `allowed_hosts`、`allowed_providers` 与 `provider_host_bindings`，便于区分“可联网”“允许访问哪些外部目标”以及“哪些 provider 只能走哪些 host”。
- `tool_governance.catalog` 至少应包含 `total_tools`、`enabled_tools`、`disabled_tools`、`beta_tools`、`approval_required_tools`、`side_effect_tools` 以及按 `release_channel` / `risk_level` / `capability` 的分布。
- 控制台 `Gov` inspector 应直接消费该接口，而不是在前端重复计算 catalog 风险和 projected block 结果。
