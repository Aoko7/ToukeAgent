# LangGraph Orchestrator MVP

## 这份变更包里有什么
- `proposal.md`：为什么要引入图编排、迁移边界与验收标准
- `design.md`：如何在现有 `Node shell + Python core` 架构上渐进接入 LangGraph
- `contracts.md`：图状态、节点事件、bridge 输入输出与 filter policy 契约
- `tasks.md`：按 superpowers 执行的一次性实施清单
- `specs/agent-platform/spec.md`：面向验收与回归的行为场景

## 目标一句话
在不替换现有运行时、不过度打散既有分层的前提下，把 Python core 的主知识编排链路抽成可观察、可回退、可灰度的状态图执行器，并为后续真正启用 LangGraph 保留稳定接口。

## 这次变更的真实定位
这不是一次“重写 orchestrator”的大迁移，而是一次渐进式编排适配：
- 先把当前主链路显式建模成图执行语义
- 先复用现有 retrieval / composer / quality gate / runtime policy 能力
- 先用 feature flag 与兼容执行器跑通
- 再在后续阶段将执行器从兼容层切到真实 LangGraph 运行时

## 迁移范围（MVP）
- 覆盖主知识主链路：`request normalization -> query frontend -> retrieval -> draft compose -> quality gate -> finalize/fallback`
- 保持现有 Node API、SSE 语义、Python bridge 外观稳定
- 保持已有 memory / wiki / retrieval / governance / audit 逻辑模块不被重写
- 暂不迁移审批恢复、多 agent 并行子图、worker queue 主链与全量控制台联动
- 图层必须保留当前 RAG 主链的工程语义：`query frontend -> Qdrant/BM25 hybrid retrieval -> metadata filter policy -> parent-child 聚合 -> evidence pack -> quality gate`
