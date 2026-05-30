# ToukeAgent Development Playbook

## 目标
这份文档解决三个问题：
1. 新开发从哪里开始读
2. 不同改动应该落到 Python 还是 Node
3. 当前平台化工作接下来应该按什么顺序推进

## 文档栈
开发时按下面顺序阅读，避免把“需求”“实现方式”“待办清单”混在一起：

1. `openspec/changes/add-plantoact-hybrid-memory-agent/proposal.md`
   - 说明为什么做、成功标准是什么
2. `openspec/changes/add-plantoact-hybrid-memory-agent/README.md`
   - 说明整个变更包怎么读
3. `openspec/changes/add-plantoact-hybrid-memory-agent/design.md`
   - 说明系统分层、模块边界、关键取舍
4. `openspec/changes/add-plantoact-hybrid-memory-agent/contracts.md`
   - 说明字段、对象和接口契约
5. `openspec/changes/add-plantoact-hybrid-memory-agent/tasks.md`
   - 说明当前已经做完哪些阶段
6. `openspec/changes/add-plantoact-hybrid-memory-agent/specs/agent-platform/spec.md`
   - 说明验收口径
7. `docs/engineering-manual.md`
   - 说明工程手册：目录职责、运行方式、扩展规则、语言边界
8. `docs/rag-evaluation-playbook.md`
   - 说明 RAG 该怎么做离线检索评测、生成层 judge 评测和线上 KPI 闭环
9. `docs/open-source-release-checklist.md`
   - 说明公开作品集版本应该如何选择文件、验证和避免泄漏本地材料
10. `AGENTS.md`
   - 说明仓库工作流：OpenSpec -> superpowers -> git-managed delivery
11. `docs/framework-next-steps.md`
   - 说明当前未完成的平台化 backlog
12. `openspec/changes/add-langgraph-orchestrator-mvp/README.md`
   - 当我们开始把主知识链路收敛成显式图编排时，先读这份 change，而不是直接改 runtime

## 当前架构边界
系统已经明确分成两层，不建议再把职责重新搅在一起。

如果你需要更细的目录说明、启动方式和“第三种语言何时允许引入”的规则，直接看 `docs/engineering-manual.md`。

### Python Core
以下能力优先放在 `toukeagent_core/`：
- `Plan-to-Act` 规划
- `micro-ReAct` 步骤准备
- 模型路由
- hybrid retrieval 路由
- embedding 策略与 query / chunk 同空间校验
- persona 解析与角色包选择
- persona pack catalog 与 specialist profile 建议
- multi-agent specialist 建议
- multi-agent join strategy 与 next-action 协调判断
- approval preview / approval review / quality review payload 生成
- context budget / compression 决策
- persona 级 tool access policy、工具权限与 side-effect 边界判断
- toolset catalog 与 release-channel / capability 匹配规则
- handoff aggregate / fallback 策略判断
- 响应草稿生成
- 输出质量评估
- quality gate 决策
- governance / budget / alert 策略判断
- 与上述决策直接相关的规则、策略和评分逻辑

如果改动会影响“agent 如何思考、如何路由、如何评估”，优先改 Python。

尤其是下面这类改动，默认先落 Python core：
- 人格默认工具边界
- 工具权限 allow / deny 规则
- side-effect 是否允许
- toolset 与 persona 的匹配规则
- toolset 默认目录、release channel 灰度边界、required capability 规则

当前检索栈默认基线：
- vector backend：`Qdrant`
- primary embedding：`intfloat/multilingual-e5-base`
- fallback embedding：`intfloat/multilingual-e5-small`
- `bge-m3` 暂不作为本地开发默认值，只保留为后续升级路线

这意味着 MVP 阶段默认使用单一多语种 embedding 空间，不做按语言拆分的多模型 query routing。

### Node Shell
以下能力保留在 `apps/platform/`：
- HTTP API
- SSE 与流式事件分发
- 前端控制台
- 平台消息适配和出站投递
- provider gateway
- 工具 handler 执行
- `/api/tools` 与 persona/tool 目录接口暴露
- 存储、事件总线、审计回写
- review/task store 的持久化、checkpoint 和人工接管动作
- persona catalog API 和控制台人格切换渲染
- multi-agent API / inspector 的协作策略渲染

如果改动会影响“系统如何接入、如何展示、如何投递、如何持久化”，优先改 Node。

### 契约层
以下对象是跨层边界，不应随意漂移：
- `packages/contracts/src/*.mjs`
- `openspec/.../contracts.md`
- Python bridge 的 JSON 输入输出对象

如果对象结构要改，先更新 OpenSpec，再改代码，再补测试。

## 开发入口
开始一个功能切片时，按这个顺序走：

1. 先确认工作是否已经被 OpenSpec 覆盖
   - 已覆盖：直接从 `tasks.md` 和 `spec.md` 找对应阶段
   - 未覆盖：先补 `proposal.md` / `design.md` / `tasks.md`
2. 再确认这次改动属于哪条主线
   - 在线链路：入口、编排、执行、SSE、控制台
   - 知识链路：memory、RAG、wiki、引用
   - 治理链路：audit、evaluation、approval、budget
   - 平台链路：adapter、delivery、callback、worker
   - 扩展链路：multi-agent、persona、context compression、RL
3. 从 backlog 中只拿一个可验证切片，不要同时拉太宽
4. 如需详细实施步骤，把该切片写成 `docs/superpowers/plans/*.md`
5. 实现后最少做三类确认
   - 契约没破
   - 主要测试通过
   - OpenSpec 与代码仍一致
6. 如果这次改动带来了 benchmark、quality report、smoke 或线上指标变化
   - 同步回写 `data/iteration_logs/*.json`
   - 同步补录 `docs/iteration-journal.md`
   - 没有证据时只记为 `attempted`，不要包装成“已优化完成”

当前已经落地的第一份平台化实施计划是：
- `docs/superpowers/plans/2026-05-12-python-core-packaging-bootstrap.md`
- `docs/superpowers/plans/2026-05-12-python-core-approval-aggregation-migration.md`
- `docs/superpowers/plans/2026-05-12-persona-pack-specialist-catalog.md`
- `docs/superpowers/plans/2026-05-12-multi-agent-coordination-strategy.md`
- `docs/superpowers/plans/2026-05-18-langgraph-orchestrator-mvp.md`

## 当前推荐切片方式
为了让系统越做越稳，建议后续继续按下面粒度开发：

### 1. Packaging and Bootstrap
目标：让 Python core 的安装、运行、依赖和本地启动方式正式化。

优先补：
- `pyproject.toml`
- Python 依赖声明
- Python CLI 启动说明
- Node shell 到 Python core 的本地开发约定

### 2. Queue and Worker Hardening
目标：让异步任务从“能跑”变成“可恢复、可扩展”。

优先补：
- 事件队列持久化
- worker 重启恢复
- 死信队列治理
- worker 横向扩展约束

### 3. Trace and Audit Replay
状态：已完成，作为后续审计与回放的基础能力。

已落地：
- trace bundle 导出
- bundle 回放
- 审计快照下载
- 前端轨迹查看一致性

### 4. Human Control Surface
状态：已完成，作为运维接管与恢复执行的基础能力。

已落地：
- 审批差异预览
- 一键接管
- 恢复执行入口
- 接管后的轨迹回写

### 5. Scale-Out Intelligence
目标：把平台从单 coordinator 扩到更细的角色分工。

优先补：
- planner / retriever / writer / reviewer / operator 的 specialist 细化
- persona pack 化
- context budget 在多 Agent 间的传递和恢复

### 6. RL and Marketplace
目标：把学习和插件能力纳入平台治理，而不是临时接线。

优先补：
- RL 离线评测集
- reward / gate 联动
- 插件与工具市场
- 版本灰度和权限隔离

### 7. Graph-Oriented Orchestration
目标：把当前主知识链路从隐式函数编排提升为显式状态图，但不破坏既有 Node shell / Python core 分层。

优先补：
- 图状态契约
- 图节点事件与可观测性
- `legacy | langgraph_mvp` 双路径灰度
- retrieval `metadata filter` 的软/硬双模式策略

## 常见改动落点
下面这张表用于快速判断从哪里动手：

| 需求类型 | 主要目录 | 先看什么 |
| --- | --- | --- |
| 规划逻辑、评估逻辑、路由策略 | `toukeagent_core/` | `design.md`、`spec.md` |
| 人格工具边界、toolset catalog、release channel/capability gate、side-effect 判定 | `toukeagent_core/` + `apps/platform/src/tool-registry.mjs` + `apps/platform/server.mjs` | `contracts.md`、`python-core-bridge.test.mjs`、`tool-registry.test.mjs`、`server.test.mjs` |
| memory provider runtime、`/api/memory` observability、`Memory` inspector、handoff/compression 关联快照 | `apps/platform/src/memory-store.mjs` + `apps/platform/server.mjs` + `apps/platform/public/` | `contracts.md`、`memory-runtime.test.mjs`、`memory-store.test.mjs`、`server.test.mjs` |
| 工具治理可观测性、`Tools`/`Gov` inspector、blocked-tool trace 指标、toolset projection | `apps/platform/public/` + `apps/platform/src/runtime.mjs` + `apps/platform/src/trace-collector.mjs` + `apps/platform/src/governance-monitor.mjs` | `runtime.test.mjs`、`trace-collector.test.mjs`、`governance-monitor.test.mjs`、`server.test.mjs` |
| 主链回归排查、persona/toolset 投影、approval override scope、route-family 排序、egress 观测 | `toukeagent_core/personas.py` + `toukeagent_core/runtime_policy.py` + `toukeagent_core/retrieval.py` + `apps/platform/src/restricted-exec.mjs` | 先看 `python-core-bridge.test.mjs`、`retrieval-router.test.mjs`、`restricted-exec.test.mjs`、`runtime.test.mjs`，再决定是否继续动模型 |
| 流式输出、任务接口、控制台 | `apps/platform/server.mjs`、`apps/platform/public/` | `contracts.md`、`server.test.mjs` |
| 平台消息适配、投递回执 | `apps/platform/src/platform-adapter-registry.mjs`、`delivery-service.mjs` | `platform-delivery` 契约与相关测试 |
| 审计、轨迹、回放 | `apps/platform/src/trace-collector.mjs` 及相关 store | `design.md` 的 Audit / Replay 部分 |
| 多 Agent、handoff、压缩快照 | `apps/platform/src/multi-agent-coordinator.mjs`、`context-budget-manager.mjs` | `contracts.md` 与 `spec.md` |
| 契约对象 | `packages/contracts/src/` | `contracts.md` |

## Definition of Done
任何一个开发切片完成前，至少满足下面几点：

1. OpenSpec 没有被代码悄悄绕过
2. 修改边界清楚，知道为什么放在 Python 或 Node
3. 相关测试已经跑过，或明确说明没跑什么
4. 关键接口、事件、契约有证据支撑
5. 如果范围变化，先更新 OpenSpec 再继续实现
6. 如果切片影响了质量、召回、稳定性或成本，要把 before / after 指标和证据写进技术迭代台账

## 当前建议的工作顺序
如果我们继续推进“做厚、做稳、做成平台”，建议按这个顺序：

1. Python packaging 和启动规范
2. 事件队列持久化与 worker 横向扩展
3. 多 Agent specialist 细化与 persona pack
4. RL gate 与插件市场

这个顺序的核心原因很简单：先补工程底座，再补可扩展编排，最后再上更复杂的智能编排。
