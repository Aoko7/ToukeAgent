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
构建一个可扩展的 agent 平台：顶层使用 `Plan-to-Act`，步骤内使用 `micro-ReAct`，并同时具备长短期记忆、混合检索、人格切换、跨平台消息适配、流式输出、审计追溯和质量门禁。

## 最小可落地闭环
建议第一阶段只打通一条最短路径：
1. 单一前端控制台
2. 单一消息入口
3. `Plan-to-Act + micro-ReAct`
4. SSE 流式输出
5. 一个稳定资料库的 hybrid RAG
6. 一个人格配置
7. 一套工具注册与审计链

这条路径跑通后，再逐步扩展到：
- 多人格切换
- 多平台消息适配
- LLM wiki
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
