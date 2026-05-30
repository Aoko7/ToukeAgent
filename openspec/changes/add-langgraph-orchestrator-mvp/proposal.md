# Change: Add LangGraph Orchestrator MVP

## 背景
当前平台已经具备 Plan-to-Act、micro-ReAct、memory/wiki/retrieval、quality gate、审批与恢复能力，但主知识链路的编排语义仍然分散在 runtime、response compose、retrieval routing 和若干条件分支之间。随着 fallback、review、恢复、多角色协作与知识治理复杂度提高，我们需要把“调用顺序、状态迁移和分支条件”从隐式函数链提升为显式图模型。

当前系统也已经明确了工程边界：
- Python core 负责策略、路由、评估和决策
- Node shell 负责 HTTP/SSE、工具执行、持久化、审计和控制台

因此本次变更必须遵守“在现有分层基础上增量接入”这一前提，而不是把图编排扩散到 Node 壳层或重写既有能力模块。

## 目标
1. 在 Python core 内为主知识链路建立显式图编排接口与状态模型。
2. 先迁移一条最小但关键的执行主链路到图语义，而不是一次性覆盖所有运行时流程。
3. 保持 Node shell、HTTP/SSE、工具执行与 bridge 对外契约不变。
4. 通过 feature flag 支持 `legacy | langgraph_mvp` 双路径并存。
5. 为后续接入真实 LangGraph 保留兼容接口；若依赖不可用，MVP 仍可通过兼容执行器运行。
6. 在 retrieval 中正式引入 `metadata filter` 的双模式策略：默认软限制、必要时升级硬限制。
7. 保持评测、审计、恢复与现有 harness 契约兼容。

## 非目标
1. 不在本次变更中重写所有 orchestrator、runtime 或 worker queue 逻辑。
2. 不在本次变更中迁移全部多-agent 并行子图、审批恢复子图或 full task replay 主链。
3. 不改变外部 API 协议、SSE 事件契约或控制台主交互模型。
4. 不要求首次落地时强依赖真实 LangGraph 包已安装。
5. 不在本次变更中引入新的 provider、数据库或云绑定。

## 成功标准
1. 主知识链路可由 `langgraph_mvp` 执行模式完整运行，并产出与现有 runtime 兼容的最终结果结构。
2. 图中的关键节点、分支和失败点都有结构化事件与状态快照语义。
3. quality gate 阻断、review 和 fallback 分支在图模型中显式存在。
4. retrieval 中 `metadata filter` 支持软/硬两种执行语义，并具备结构化审计字段。
5. 同一组关键 case 在 `legacy` 与 `langgraph_mvp` 路径下核心行为指标不回退。
6. 现有 retrieval / memory / wiki / knowledge 回归与主 smoke 不被破坏。
7. 文档、contracts 与执行任务拆解足够精确，可以直接指导一次 superpowers 风格的一次性实施。
