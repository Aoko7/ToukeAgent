# agent-platform Specification

## Purpose
定义一个可扩展的 agent 平台：顶层以 Plan-to-Act 编排，步骤内以 micro-ReAct 执行，并统一接入记忆、混合检索、LLM wiki 与评测门禁。

## Reading Guide
- 与接入层相关：`Streaming Output`、`SSE Transport`、`Canonical Message Model`、`Platform Adapters`
- 与运行时相关：`Persona and Role Profiles`、`Plan-to-Act Orchestration`、`Micro-ReAct Step Execution`
- 与数据层相关：`Short-Term and Long-Term Memory`、`Hybrid Retrieval Routing`、`Hybrid RAG Quality`、`LLM Wiki Freshness`
- 与治理层相关：`Audit Logging and Provenance`、`Model Output Quality Evaluation`、`Tool and Plugin Registry`、`Secrets and Execution Safety`
- 与平台化相关：`Human-in-the-Loop Control`、`Knowledge Lifecycle Management`、`SLO and Cost Governance`、`Deployment and Recovery`

## ADDED Requirements

### Requirement: Streaming Output
系统 SHALL 支持生成过程的流式输出，并将增量结果及时暴露给前端和兼容平台。

#### Scenario: Token streaming
- GIVEN 一个正在生成的模型响应
- WHEN 系统开始输出内容
- THEN 系统 SHALL 以增量形式推送中间结果
- AND 系统 SHALL 在最终完成时发送完成事件

#### Scenario: Step progress streaming
- GIVEN 一个较长的计划步骤正在执行
- WHEN 工具调用或检索产生进度
- THEN 系统 SHALL 推送步骤级进度更新

#### Scenario: Stream cancellation
- GIVEN 用户取消了正在进行的输出
- WHEN 系统收到取消请求
- THEN 系统 SHALL 停止继续流式输出
- AND 系统 SHALL 记录取消状态与最终轨迹

### Requirement: SSE Transport
系统 SHALL 为浏览器控制台提供 SSE 作为默认流式传输通道。

#### Scenario: Browser live view
- GIVEN 前端控制台正在查看一个任务
- WHEN 后端持续产生流式事件
- THEN 前端 SHALL 通过 SSE 实时接收更新

#### Scenario: Stream reconnect
- GIVEN 前端连接中断后重新连接
- WHEN 前端重新订阅同一任务流
- THEN 系统 SHALL 支持从最近可恢复点继续推送

### Requirement: Persona and Role Profiles
系统 SHALL 支持可切换的人格和角色配置，并将其作为运行时行为上下文的一部分。

#### Scenario: Switch persona for a task
- GIVEN 一个任务适合以研究型人格处理
- WHEN 用户或调度器切换到该人格
- THEN 系统 SHALL 更新表达风格、默认工具偏好和工作边界
- AND 系统 SHALL 保持审计与权限规则不变

#### Scenario: Multi-role operating mode
- GIVEN 系统需要同时扮演助手、审核和运维三种角色
- WHEN 不同任务进入平台
- THEN 系统 SHALL 按任务上下文选择对应角色配置

### Requirement: Canonical Message Model
系统 SHALL 将所有外部平台消息归一化为统一消息模型。

#### Scenario: Inbound normalization
- GIVEN 一条来自任意支持平台的消息
- WHEN 系统接收到该消息
- THEN 系统 SHALL 转换为统一消息结构
- AND 系统 SHALL 保留平台原始标识与来源信息

#### Scenario: Outbound rendering
- GIVEN 一条需要发送到外部平台的系统响应
- WHEN 系统准备投递
- THEN 系统 SHALL 根据目标平台能力渲染消息
- AND 系统 SHALL 在必要时进行降级

### Requirement: Platform Adapters
系统 SHALL 通过适配器层支持不同平台的消息发送、接收与回执。

#### Scenario: Platform capability differences
- GIVEN 两个平台具备不同的消息能力
- WHEN 系统向它们发送同一类响应
- THEN 系统 SHALL 通过适配器处理格式差异
- AND 系统 SHALL 不把平台差异泄漏到上层 agent 逻辑

### Requirement: Event-Driven Processing
系统 SHALL 将长耗时操作和跨模块回写通过事件总线异步处理。

#### Scenario: Long-running document ingestion
- GIVEN 一批文档需要入库和索引
- WHEN 系统开始处理
- THEN 系统 SHALL 通过事件发布异步任务
- AND 系统 SHALL 支持重试与幂等处理

#### Scenario: Message delivery callback
- GIVEN 一条出站消息已经提交
- WHEN 平台返回投递结果
- THEN 系统 SHALL 通过事件回写发送状态

### Requirement: Frontend Control Console
系统 SHALL 提供面向任务运维和调试的前端控制台。

#### Scenario: Inspect task execution
- GIVEN 一个正在执行的任务
- WHEN 用户打开控制台
- THEN 系统 SHALL 显示计划树、步骤轨迹与当前状态

#### Scenario: Debug retrieval
- GIVEN 用户需要检查某次检索结果
- WHEN 用户切换到检索面板
- THEN 系统 SHALL 显示召回、重排与引用来源

### Requirement: Storage Separation
系统 SHALL 将任务状态、事件日志、文档、向量索引、wiki 状态与审计数据分域存储。

#### Scenario: Independent storage domains
- GIVEN 一条新的任务轨迹
- WHEN 系统持久化该轨迹
- THEN 系统 SHALL 写入对应的状态域与审计域
- AND 系统 SHALL 不把所有数据混写到单一存储中

### Requirement: Observability and Replay
系统 SHALL 提供可观测性与轨迹回放能力。

#### Scenario: Trace inspection
- GIVEN 一次失败的任务执行
- WHEN 用户查看回放
- THEN 系统 SHALL 展示关键事件、工具调用和消息链路

### Requirement: Audit Logging and Provenance
系统 SHALL 提供端到端日志追溯与证据链追踪能力。

#### Scenario: End-to-end request trace
- GIVEN 一次来自外部平台的请求
- WHEN 系统完成处理并返回响应
- THEN 系统 SHALL 能够通过统一 trace 标识串联入口消息、规划步骤、检索证据、工具调用和出站回执

#### Scenario: Response provenance inspection
- GIVEN 一条已发送给用户的响应
- WHEN 运维或审核人员检查该响应来源
- THEN 系统 SHALL 展示模型版本、提示词版本、上下文片段和引用依据

### Requirement: Model Output Quality Evaluation
系统 SHALL 对模型生成内容提供质量评估、抽样复核与门禁控制。

#### Scenario: Offline quality scoring
- GIVEN 一批标准任务和参考答案
- WHEN 系统执行质量评估
- THEN 系统 SHALL 输出事实性、引用一致性、完成度、格式合规性和安全性评分

#### Scenario: Online low-quality output handling
- GIVEN 一条生成结果未满足质量阈值
- WHEN 系统在发送前或发送后检测到该问题
- THEN 系统 SHALL 触发重试、降级、补充检索或人工审核中的至少一种处理

### Requirement: Tool and Plugin Registry
系统 SHALL 通过统一注册表管理工具与插件的能力、权限和运行策略。

#### Scenario: Registered tool execution
- GIVEN 一个工具已登记能力声明、权限要求和超时策略
- WHEN 编排层选择该工具执行
- THEN 系统 SHALL 依据注册表校验工具契约与权限约束

#### Scenario: Unregistered tool rejection
- GIVEN 一个未登记的工具或插件实现
- WHEN 系统尝试调用该能力
- THEN 系统 SHALL 阻止执行并记录审计事件

### Requirement: Tool Invocation Contract
系统 SHALL 为工具调用定义统一输入输出契约与副作用语义。

#### Scenario: Structured tool output
- GIVEN 一个工具被系统调用
- WHEN 工具返回结果
- THEN 系统 SHALL 接收结构化状态、错误码和可审计摘要

#### Scenario: Side-effect declaration
- GIVEN 一个会修改外部状态的工具
- WHEN 系统准备调用
- THEN 系统 SHALL 根据副作用声明决定是否需要人工审批或降级处理

### Requirement: Secrets and Execution Safety
系统 SHALL 对密钥、敏感数据和高风险执行提供隔离与保护。

#### Scenario: Secret redaction
- GIVEN 一条包含敏感信息的上下文或工具输出
- WHEN 系统写入日志或发送给模型
- THEN 系统 SHALL 对敏感内容执行脱敏或阻断

#### Scenario: Restricted tool execution
- GIVEN 一个高风险工具需要访问外部资源或执行副作用操作
- WHEN 系统准备调用该工具
- THEN 系统 SHALL 在受限执行环境和策略检查通过后再执行

### Requirement: Model Routing and Fallback
系统 SHALL 根据任务特征、质量需求和预算约束进行模型选择与降级。

#### Scenario: Route by task profile
- GIVEN 一个具有明确成本和质量要求的任务
- WHEN 系统为该任务选择模型
- THEN 系统 SHALL 综合任务类型、上下文规模、时效要求和预算进行路由

#### Scenario: Primary model fallback
- GIVEN 主模型不可用或超出预算
- WHEN 系统仍需完成任务
- THEN 系统 SHALL 切换到备用模型或预定义降级路径

### Requirement: Human-in-the-Loop Control
系统 SHALL 对高风险或低置信度流程提供人工审批、接管和恢复执行能力。

#### Scenario: Approval before risky action
- GIVEN 一个步骤会触发外部副作用或高风险变更
- WHEN 系统准备执行该步骤
- THEN 系统 SHALL 请求人工审批后再继续

#### Scenario: Resume after human intervention
- GIVEN 人工已修改计划或补充了关键输入
- WHEN 系统恢复该任务
- THEN 系统 SHALL 从最近的可恢复状态继续执行

### Requirement: Knowledge Lifecycle Management
系统 SHALL 对文档、记忆和 wiki 条目提供生命周期治理。

#### Scenario: Stale knowledge expiration
- GIVEN 一条知识条目已超过其有效期或被新证据覆盖
- WHEN 系统刷新知识状态
- THEN 系统 SHALL 将该条目标记为过期、历史版本或待复核

#### Scenario: Soft delete and rollback
- GIVEN 管理员删除或回滚一条知识条目
- WHEN 系统处理该请求
- THEN 系统 SHALL 保留版本历史并更新检索可见性

### Requirement: SLO and Cost Governance
系统 SHALL 对延迟、吞吐、失败率和成本预算提供约束与告警。

#### Scenario: Budget threshold reached
- GIVEN 某个租户或流程接近预算上限
- WHEN 系统继续处理任务
- THEN 系统 SHALL 触发告警并支持降级非关键能力

#### Scenario: Queue backlog breach
- GIVEN 异步任务积压超过目标阈值
- WHEN 系统检测到该状态
- THEN 系统 SHALL 记录告警并允许调度层采取限流、扩容或降级措施

### Requirement: Deployment and Recovery
系统 SHALL 支持部署隔离、故障恢复和任务重放。

#### Scenario: Resume after worker restart
- GIVEN 一个长任务在执行中遇到 worker 重启
- WHEN worker 恢复并重新拉取任务状态
- THEN 系统 SHALL 从已持久化的最近状态继续执行或安全重试

#### Scenario: Dead-letter recovery
- GIVEN 一个异步任务多次重试后仍失败
- WHEN 系统将其转入死信队列
- THEN 系统 SHALL 保留失败上下文并支持后续人工重放或补偿处理

### Requirement: OpenClaw-Inspired Isolation and Routing
系统 SHALL 支持隔离工作区、独立状态、路由绑定和可编辑启动文件。

#### Scenario: Isolated workspace
- GIVEN 两个不同角色或业务线的 agent 配置
- WHEN 系统运行它们
- THEN 系统 SHALL 将它们隔离到不同工作区和状态目录

#### Scenario: Routing binding
- GIVEN 一个来自特定渠道的消息
- WHEN 系统选择处理该消息的 agent
- THEN 系统 SHALL 根据路由绑定选择对应 agent 与 persona

#### Scenario: Bootstrap personalization
- GIVEN 一个新 agent 首次启动
- WHEN 系统完成初始化
- THEN 系统 SHALL 加载可编辑的 persona、identity、tool notes 和启动配置

### Requirement: Multi-Tenant Boundaries
系统 SHALL 维护 workspace、user、org 级别的访问边界。

#### Scenario: Workspace isolation
- GIVEN 两个不同 workspace
- WHEN 系统查询记忆或文档
- THEN 系统 SHALL 只返回当前边界内的数据

### Requirement: Plan-to-Act Orchestration
系统 SHALL 先生成可执行计划，再按步骤推进任务。

#### Scenario: Normal task execution
- GIVEN 用户提交一个复杂任务
- WHEN 系统开始处理任务
- THEN 系统 SHALL 先输出计划
- AND 系统 SHALL 按计划逐步执行
- AND 系统 SHALL 记录每个步骤的状态

#### Scenario: Step failure triggers replanning
- GIVEN 某个步骤执行失败或证据不足
- WHEN 系统检测到失败
- THEN 系统 SHALL 允许局部重规划
- AND 系统 SHALL 不丢失已完成步骤的结果

### Requirement: Micro-ReAct Step Execution
每个计划步骤 SHALL 在局部范围内运行 ReAct 循环。

#### Scenario: Step-level reasoning
- GIVEN 一个已生成的计划步骤
- WHEN 系统开始执行该步骤
- THEN 系统 SHALL 支持观察、推理、行动和结果回写
- AND 系统 SHALL 在步骤结束后产出可审计轨迹

### Requirement: Short-Term and Long-Term Memory
系统 SHALL 同时支持短期记忆与长期记忆。

#### Scenario: Session memory
- GIVEN 一个正在进行的任务
- WHEN 系统需要跨多个步骤保留上下文
- THEN 系统 SHALL 使用短期记忆保存当前状态

#### Scenario: Durable memory
- GIVEN 一条经过校验的稳定信息
- WHEN 系统判断其具备复用价值
- THEN 系统 SHALL 写入长期记忆
- AND 系统 SHALL 记录来源与时间戳

### Requirement: Hybrid Retrieval Routing
系统 SHALL 根据资料稳定性与结构化程度在 hybrid RAG 与 LLM wiki 之间路由检索。

#### Scenario: Stable document retrieval
- GIVEN 查询目标属于长期稳定资料
- WHEN 系统处理该查询
- THEN 系统 SHALL 优先使用 hybrid RAG

#### Scenario: Dynamic structured retrieval
- GIVEN 查询目标属于频繁变化且结构化的资料
- WHEN 系统处理该查询
- THEN 系统 SHALL 优先使用 LLM wiki

### Requirement: Hybrid RAG Quality
hybrid RAG SHALL 结合稀疏检索、稠密检索与重排结果。

#### Scenario: Multi-signal ranking
- GIVEN 一个可检索查询
- WHEN 系统执行 RAG
- THEN 系统 SHALL 合并多路召回结果
- AND 系统 SHALL 经过重排后输出
- AND 系统 SHALL 保留引用链

### Requirement: LLM Wiki Freshness
LLM wiki SHALL 支持结构化更新、版本追踪和过期标记。

#### Scenario: Frequent update
- GIVEN 一个高变更实体
- WHEN 该实体信息发生变化
- THEN 系统 SHALL 更新对应 wiki 条目
- AND 系统 SHALL 标记旧版本为过期或历史记录

### Requirement: Evaluation and RL Gating
系统 SHALL 在启用 RL 前提供可回放的评测 harness 与安全门禁。

#### Scenario: Offline evaluation
- GIVEN 一批标准任务轨迹
- WHEN 系统运行评测
- THEN 系统 SHALL 输出任务成功率、引用准确率和工具合规率

#### Scenario: RL gate
- GIVEN 评测结果未达到门槛
- WHEN 系统尝试启用学习更新
- THEN 系统 SHALL 阻止直接在线更新策略
