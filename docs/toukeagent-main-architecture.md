# ToukeAgent 主干总览图说明

这份说明对应：

- [toukeagent-main-architecture.svg](./toukeagent-main-architecture.svg)

## 图的目标

这张图不是只讲某一个板块，而是把当前仓库里最核心的“主干执行链”画成一张总览：

- 用户如何进入系统
- Node 平台壳负责什么
- Python 编排核心负责什么
- `memory / wiki / rag` 三路知识如何接到主链
- 质量门控、评测和治理如何闭环

## 分栏对应

### 1. 用户与入口

表示用户从前端、控制台或平台接口进入系统，并通过最终回答或 SSE 事件流收到结果。

### 2. Node 平台壳

对应仓库里的平台接线层，重点文件包括：

- [apps/platform/src/retrieval-router.mjs](../apps/platform/src/retrieval-router.mjs)
- [apps/platform/src/response-composer.mjs](../apps/platform/src/response-composer.mjs)
- [apps/platform/src/provider-gateway.mjs](../apps/platform/src/provider-gateway.mjs)
- [apps/platform/src/context-budget-manager.mjs](../apps/platform/src/context-budget-manager.mjs)
- [apps/platform/src/trace-collector.mjs](../apps/platform/src/trace-collector.mjs)
- [apps/platform/src/multi-agent-coordinator.mjs](../apps/platform/src/multi-agent-coordinator.mjs)

主要职责：

- API / SSE 入口
- Python core 调用桥
- provider 接入
- stores / traces / reviews / handoffs / delivery 持久化
- 预算、观测、治理聚合

### 3. Python 编排核心

对应当前真正的执行主链，重点文件包括：

- [toukeagent_core/graph_orchestrator.py](../toukeagent_core/graph_orchestrator.py)
- [toukeagent_core/retrieval.py](../toukeagent_core/retrieval.py)
- [toukeagent_core/composer.py](../toukeagent_core/composer.py)
- [toukeagent_core/quality_gate.py](../toukeagent_core/quality_gate.py)
- [toukeagent_core/planner.py](../toukeagent_core/planner.py)
- [toukeagent_core/model_router.py](../toukeagent_core/model_router.py)

主链顺序与图一致：

1. `prepare_request`
2. `analyze_query_frontend`
3. `plan_retrieval`
4. `retrieve_evidence`
5. `compose_grounded_draft`
6. `evaluate_quality_gate`
7. `finalize_response` 或 `fallback_or_review`

### 4. 知识子系统

这里把我们前面讲完的三大知识板块接入到主链里：

- `RAG`：稳定知识检索
- `Wiki`：动态状态知识
- `Memory`：持久化记忆与 handoff 信息

对应重点文件：

- [toukeagent_core/retrieval.py](../toukeagent_core/retrieval.py)
- [apps/platform/src/wiki-runtime.mjs](../apps/platform/src/wiki-runtime.mjs)
- [apps/platform/src/memory-runtime.mjs](../apps/platform/src/memory-runtime.mjs)

### 5. 外部依赖

这里把真正依赖的外部执行环境或存储单独画出来，避免和主逻辑混在一起：

- LLM provider
- Qdrant / SQLite / Redis
- 工作区文件和 benchmark artifact

## 为什么这样画

这张图刻意保持了你给的参考图那种讲解风格：

- 左到右分栏
- 每栏内部再编号
- 同时画控制流、事件流、数据流
- 底部给出一条典型执行链
- 右下角列出关键产物

这样做的好处是：

- 面试时容易顺着编号讲
- 讲实现机制时能快速落到真实文件
- 后续如果要扩 `approval / handoff / multi-agent / sandbox`，还能继续在这张图上迭代

## 可以继续扩的方向

如果你下一步要继续画更细的图，我建议优先扩三张：

1. `主干执行链细化图`
   - 把 graph orchestrator 的每个 node 单独展开
2. `知识路由图`
   - 专门画 `memory / wiki / rag` 三路怎么分工、怎么 fallback
3. `治理与评测图`
   - 专门画 benchmark、quality gate、trace bundle、review 的闭环
