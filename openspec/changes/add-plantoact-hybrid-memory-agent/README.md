# Plan-to-Act Agent Platform

## 这份变更包里有什么
- `proposal.md`：为什么要做、做什么、不做什么、如何判断成功
- `design.md`：平台分层、核心模块、关键设计取舍
- `contracts.md`：开发时直接对照的字段级契约
- `specs/agent-platform/spec.md`：OpenSpec 需求与验收场景
- `tasks.md`：建议实施顺序

## 建议阅读顺序
1. 先读 `proposal.md`
2. 再读 `README.md` 当前页
3. 然后读 `design.md`
4. 开发前重点读 `contracts.md`
5. 验收或 review 时读 `specs/agent-platform/spec.md`
6. 排期和拆工时读 `tasks.md`

## 一句话目标
构建一个可扩展的 agent 平台：顶层使用 `Plan-to-Act`，步骤内使用 `micro-ReAct`，并同时具备长短期记忆、混合检索、人格切换、多 Agent 协作、上下文压缩、跨平台消息适配、流式输出、审计追溯和质量门禁。

## 最小可落地闭环
建议第一阶段只打通一条最短路径：
1. 单一前端控制台
2. 单一消息入口
3. `Plan-to-Act + micro-ReAct`
4. SSE 流式输出
5. 一个稳定资料库的 hybrid RAG
6. 一个人格配置
7. 一套工具注册与审计链

其中 hybrid RAG 的当前工程基线是：
- 单一多语种 embedding 空间，避免多模型空间混用
- 默认向量库 `Qdrant`
- 默认 embedding 模型 `multilingual-e5-base`
- 资源更紧时可回退到 `multilingual-e5-small`
- `bge-m3` 保留为后续索引重建和质量升级路线
- 主链按 `query frontend -> hybrid retrieval -> metadata filter policy -> parent-child 聚合 -> evidence pack -> generation -> evaluation` 理解
- `RAG` 负责稳定知识，`LLM wiki` 负责动态结构化事实，`memory` 负责任务过程与用户偏好

这条路径跑通后，再逐步扩展到：
- 多人格切换
- 多 Agent 协作
- 多平台消息适配
- LLM wiki
- 长上下文压缩与恢复
- 人工审批
- 质量评测
- RL 接口

## 核心对象
开发时最常碰到的五个对象是：
1. `CanonicalMessage`：平台统一消息结构
2. `StreamEvent`：SSE 和内部流式事件结构
3. `ToolInvocationContract`：工具注册与执行契约
4. `PersonaProfile`：人格和角色配置
5. `RouteBinding`：渠道、人格和 agent 绑定关系
6. `AgentPlan`：任务规划对象
7. `AgentRunState`：运行时状态对象
8. `AgentHandoffPacket`：多 Agent 委派与结果回传对象
9. `ContextCompressionSnapshot`：上下文压缩和恢复对象

字段定义见 `contracts.md`。

## 推荐实现顺序
1. 先定契约：消息、流、工具、人格
2. 再做运行时：编排、执行、SSE、前端
3. 然后补数据层：记忆、检索、wiki、审计
4. 最后做治理层：质量门禁、审批、预算、恢复、RL

## 文档使用原则
- `design.md` 解释为什么这样设计
- `contracts.md` 负责告诉开发“字段到底长什么样”
- `spec.md` 负责告诉测试“什么才算做完”
- `tasks.md` 负责告诉排期“先做哪一段最划算”

## 开发落地入口
如果要继续在这个变更包上开发，建议按下面顺序进入：

1. 先读仓库根目录 `docs/development-playbook.md`
2. 再读仓库根目录 `docs/engineering-manual.md`
3. 再读根目录 `AGENTS.md`
4. 然后回到当前变更包里的 `design.md`、`contracts.md`、`tasks.md`
5. 如果要开始下一阶段实现，把切片写入 `docs/superpowers/plans/*.md`
6. 如果发现范围已经超出当前变更包，先补 OpenSpec，再继续编码

## 当前开发含义
这份 OpenSpec 变更包已经覆盖：
- 总体架构
- Python core / Node shell 边界
- 主要对象契约
- 当前已完成阶段

这份变更包还没有自动替你决定：
- 当前 backlog 应先拿哪一个平台化切片
- 哪些工作要先做工程底座，哪些可以后置
- 每个切片的开发执行顺序

这些内容由仓库根目录 `docs/development-playbook.md` 和 `docs/framework-next-steps.md` 补充说明。

其中：
- `docs/development-playbook.md` 负责告诉你“现在该先做哪类事”
- `docs/engineering-manual.md` 负责告诉你“代码具体该放哪里、怎么跑、怎么守边界”
