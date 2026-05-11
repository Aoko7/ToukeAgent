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
  "arguments": {
    "query": "OpenSpec proposal format"
  }
}
```

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
| `channel_policy` | object | 在不同平台上的输出偏好 |
| `metadata` | object | 扩展字段 |

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
    "write_long_term": false
  },
  "model_policy": {
    "tier": "high_reasoning"
  },
  "approval_policy": {
    "required_for_side_effects": true
  },
  "channel_policy": {
    "prefer_streaming": true
  },
  "metadata": {}
}
```

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

## 10. 开发约定

### 前端
- 只依赖 `CanonicalMessage` 和 `StreamEvent`
- 不直接依赖某个平台的原始字段

### 后端编排
- 只依赖 `ToolInvocationContract` 和 `PersonaProfile`
- 不把 UI 展示逻辑塞进编排状态机
- 多 Agent 协作优先通过 `AgentHandoffPacket` 和 `ContextCompressionSnapshot` 传递状态，而不是直接拼接整段历史

### 适配层
- 负责平台字段映射、流式能力降级和回执回写
- 不负责业务规划逻辑
