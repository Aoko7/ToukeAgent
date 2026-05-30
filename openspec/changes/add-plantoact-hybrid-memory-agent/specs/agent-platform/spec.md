# agent-platform Specification

## Purpose
定义一个可扩展的 agent 平台：顶层以 Plan-to-Act 编排，步骤内以 micro-ReAct 执行，并统一接入记忆、混合检索、LLM wiki 与评测门禁。

## Reading Guide
- 与接入层相关：`Streaming Output`、`SSE Transport`、`Canonical Message Model`、`Platform Adapters`
- 与运行时相关：`Persona and Role Profiles`、`Plan-to-Act Orchestration`、`Micro-ReAct Step Execution`、`Multi-Agent Coordination`
- 与数据层相关：`Short-Term and Long-Term Memory`、`Context Window Management and Compression`、`Hybrid Retrieval Routing`、`Hybrid RAG Quality`、`LLM Wiki Freshness`
- 与治理层相关：`Audit Logging and Provenance`、`Model Output Quality Evaluation`、`Tool and Plugin Registry`、`Secrets and Execution Safety`
- 与平台化相关：`Human-in-the-Loop Control`、`Knowledge Lifecycle Management`、`SLO and Cost Governance`、`Deployment and Recovery`

## ADDED Requirements

### Requirement: Python Core Boundary
系统 SHALL 将 agent 核心能力实现为 Python 核心，并通过稳定 JSON bridge 被 Node 外壳调用。

#### Scenario: Planner via Python bridge
- GIVEN 一个输入消息需要生成计划
- WHEN Node 外壳调用核心规划能力
- THEN 系统 SHALL 通过 Python bridge 生成 plan
- AND 系统 SHALL 保留可回放的输入输出载荷

#### Scenario: Core error propagation
- GIVEN Python 核心在生成、检索或评估时返回错误
- WHEN Node 外壳接收到该错误
- THEN 系统 SHALL 将错误记录到审计链和流式事件中
- AND 系统 SHALL 不在 Node 中重新实现同一段核心逻辑

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

#### Scenario: Rich media adaptation
- GIVEN 出站响应包含图片、文件或引用来源
- WHEN 系统为 web、Slack 或 Telegram 渲染消息
- THEN 系统 SHALL 保留平台支持的富媒体结构
- AND 系统 SHALL 在不支持的渠道中降级为链接或纯文本

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

#### Scenario: Inspect harness runs
- GIVEN 平台中已经存在 task、memory 或 wiki harness run
- WHEN 用户切换到 harness 面板
- THEN 系统 SHALL 支持按 harness type 过滤 run 列表
- AND 系统 SHALL 展示所选 run 的 summary、cases 或 artifact 明细

#### Scenario: Trigger default memory harness
- GIVEN memory harness 已注册默认评测集
- WHEN 用户在控制台触发默认 memory harness suite
- THEN 系统 SHALL 运行该 suite 并将新 run 写入统一 harness registry
- AND 系统 SHALL 让控制台可直接查看新 run 的 review artifact

#### Scenario: Trigger default wiki harness
- GIVEN wiki harness 已注册默认评测集
- WHEN 用户在控制台触发默认 wiki harness suite
- THEN 系统 SHALL 运行该 suite 并将新 run 写入统一 harness registry
- AND 系统 SHALL 让控制台可直接查看新 run 的 review artifact

### Requirement: Unified Knowledge Harness
系统 SHALL 支持把 generation、wiki 与 memory 三套评测合并为单一 knowledge harness run。

#### Scenario: Trigger default knowledge harness
- GIVEN generation、wiki 与 memory 都已存在默认评测集
- WHEN 用户在控制台触发默认 knowledge harness suite
- THEN 系统 SHALL 在同一条 run 中执行三套评测
- AND 系统 SHALL 同时产出联合 summary 与各自 suite artifact

#### Scenario: Inspect knowledge harness runs
- GIVEN 平台中已经存在 `knowledge` harness run
- WHEN 用户在 Harness 面板按 `knowledge` 过滤
- THEN 系统 SHALL 展示该 run 的联合指标、suite case 数量和 review artifact
- AND 系统 SHALL 保留 generation、wiki、memory 三套子结果的可回看性

#### Scenario: Knowledge harness exposes governance-oriented joint metrics
- GIVEN 平台完成一次联合 knowledge harness 运行
- WHEN 用户查看该 run 的 summary 或 review artifact
- THEN 系统 SHALL 暴露联合 contract coverage、guardrail capture 与 source-of-truth conflict 计数
- AND SHALL 让 reviewer 能区分“知识治理风险”与“普通召回质量波动”

#### Scenario: Export trace-derived memory harness draft
- GIVEN 系统已经存在一个包含 memory / compression / handoff 产物的任务轨迹
- WHEN 用户请求导出 memory harness draft
- THEN 系统 SHALL 从该轨迹生成 memory harness case 草稿
- AND 系统 SHALL 显式标记这些 case 仍需人工复核

#### Scenario: Save selected trace-derived memory draft case
- GIVEN 控制台已经生成 trace-derived memory harness draft
- WHEN 用户选择其中一条 case 并请求保存
- THEN 系统 SHALL 将该 case 保存为独立的本地 draft artifact
- AND 系统 SHALL 保留 `review_required` 与 trace-derived draft 标记

#### Scenario: Export trace-derived wiki harness draft
- GIVEN 系统已经存在一个包含 retrieval result 的真实任务轨迹
- WHEN 用户请求导出 wiki harness draft
- THEN 系统 SHALL 从该轨迹生成至少一条 wiki harness case 草稿
- AND 系统 SHALL 保留 `expected_route_mode`、`expected_effective_mode`、`expected_recommended_action` 与 `required_citation_titles`

#### Scenario: Save selected trace-derived wiki draft case
- GIVEN 控制台已经生成 trace-derived wiki harness draft
- WHEN 用户选择其中一条 case 并请求保存
- THEN 系统 SHALL 将该 case 保存为独立的本地 draft artifact
- AND 系统 SHALL 保留 `review_required` 与 `draft_origin=trace_bundle`

#### Scenario: Promote trace-derived wiki draft case into candidate suite
- GIVEN 控制台已经生成 trace-derived wiki harness draft
- AND 用户已经选中一条待复核 wiki case
- WHEN 用户请求 promote 到候选 wiki 评测集
- THEN 系统 SHALL 将该 case 合并进独立的 wiki candidate suite
- AND 系统 SHALL 不直接写入正式 wiki gold

#### Scenario: Inspect and run wiki candidate suite
- GIVEN 平台中已经存在 wiki candidate suite
- WHEN 用户在 Harness 控制台查看该 suite
- THEN 系统 SHALL 展示 suite 元数据与 case 明细
- AND 系统 SHALL 支持直接基于该 suite 触发 wiki harness 运行

#### Scenario: Review wiki candidate case before broader governance
- GIVEN 平台中已经存在 wiki candidate suite
- AND 用户已经在 Harness 控制台选中某一条 wiki candidate case
- WHEN 用户提交 review decision
- THEN 系统 SHALL 持久化该 case 的 `review_status`、`reviewer_id`、`reviewed_at` 与 `review_notes`
- AND 系统 SHALL 允许 reviewer 先完成 candidate 治理，而不是要求立即进入 gold

#### Scenario: Batch review wiki candidate cases from one suite
- GIVEN reviewer 已经在同一个 wiki candidate suite 中选中了多条 case
- WHEN reviewer 提交一次 batch review
- THEN 系统 SHALL 将相同的 review decision、reviewer 与 notes 应用于这些 case
- AND 系统 SHALL 回写 batch review summary 供后续回看

#### Scenario: Wiki compare surfaces reviewer-oriented summary before raw diff
- GIVEN reviewer 在控制台查看 wiki candidate compare 结果
- WHEN 系统渲染单 case 或 suite compare 详情
- THEN 系统 SHALL 优先呈现 reviewer summary、reviewer gaps 与 selected compare case / suite mismatch card
- AND 系统 SHALL 避免让 reviewer 只能先阅读原始 diff JSON 才能判断是否存在 route、action、citation 或 observed drift

#### Scenario: Promote reviewed memory draft case into candidate suite
- GIVEN 控制台已经生成 trace-derived memory harness draft
- AND 用户已经选中一条待复核 case
- WHEN 用户请求 promote 到候选评测集
- THEN 系统 SHALL 将该 case 合并进独立的 candidate benchmark suite
- AND 系统 SHALL 不直接写入正式 memory benchmark gold

#### Scenario: Inspect and run candidate memory benchmark suite
- GIVEN 平台中已经存在 memory candidate suite
- WHEN 用户在 Harness 控制台查看 candidate suite
- THEN 系统 SHALL 展示 suite 元数据与 case 明细
- AND 系统 SHALL 支持直接基于该 suite 触发 memory harness 运行

#### Scenario: Review candidate memory benchmark case before gold promotion
- GIVEN 平台中已经存在 memory candidate suite
- AND 用户已经在 Harness 控制台选中某一条 candidate case
- WHEN 用户提交 review decision
- THEN 系统 SHALL 持久化该 case 的 `review_status`、`reviewer_id`、`reviewed_at` 与 `review_notes`
- AND 系统 SHALL 仅允许 `approved` 状态的 candidate case 进入正式 gold

#### Scenario: Candidate case marked needs revision stays outside gold
- GIVEN 某条 memory candidate case 被 reviewer 标记为 `needs_revision` 或 `rejected`
- WHEN 用户尝试直接 promote 该 case 到正式 gold
- THEN 系统 SHALL 拒绝该请求
- AND 系统 SHALL 保持该 case 仍停留在 candidate suite 中等待进一步收紧或重审

#### Scenario: Promote approved candidate case into memory gold
- GIVEN 某条 memory candidate case 已经被标记为 `approved`
- WHEN 用户请求将该 case promote 到正式 gold
- THEN 系统 SHALL 将该 case 合并进正式 memory benchmark gold 文档
- AND 系统 SHALL 保留 `source_candidate_suite` 与 `promoted_to_gold_at` 等 provenance 字段

#### Scenario: Compare candidate case against gold before merge
- GIVEN 某条 memory candidate case 已经存在于 candidate suite 中
- WHEN reviewer 在控制台请求 compare
- THEN 系统 SHALL 返回 candidate-vs-gold 的结构化 diff 与 checklist
- AND 系统 SHALL 显式标记 reference、observed 与 metadata 是否已经对齐

#### Scenario: Batch review candidate cases from one suite
- GIVEN reviewer 已经在同一个 memory candidate suite 中选中了多条 case
- WHEN reviewer 提交一次 batch review
- THEN 系统 SHALL 将相同的 review decision、reviewer 与 notes 应用于这些 case
- AND 系统 SHALL 回写 batch review summary 供后续回看

#### Scenario: Roll back a previous gold promotion
- GIVEN 某条 memory gold case 曾由 candidate suite promote 而来
- WHEN reviewer 请求 rollback
- THEN 系统 SHALL 根据 promotion history 恢复该 case promote 前的 gold 状态
- AND 系统 SHALL 将 rollback 事件写入独立的 gold history

#### Scenario: Batch roll back multiple gold promotions
- GIVEN reviewer 已经选中同一个治理批次中的多条 memory gold case
- WHEN reviewer 请求 batch rollback
- THEN 系统 SHALL 逐条尝试恢复这些 case promote 前的 gold 状态
- AND 系统 SHALL 返回逐 case 的成功或失败摘要，而不是只给出单一布尔结果

#### Scenario: Visual compare prioritizes actionable review signals
- GIVEN reviewer 在控制台查看 candidate-vs-gold compare 结果
- WHEN 系统渲染 compare 详情
- THEN 系统 SHALL 优先呈现 checklist fail、field diff summary 与 mismatch-focused compare card
- AND 系统 SHALL 避免仅以通用 JSON 表格作为唯一 compare 视图

#### Scenario: Memory compare surfaces reviewer-oriented summary before raw diff
- GIVEN reviewer 在控制台查看 memory candidate-vs-gold compare 结果
- WHEN 系统渲染单 case 或 suite compare 详情
- THEN 系统 SHALL 优先呈现 reviewer summary、reviewer gaps 与 selected compare case / suite mismatch card
- AND 系统 SHALL 让 reviewer 在打开 raw diff JSON 前先看到 gold coverage、equality drift 与 checklist failure 聚合

#### Scenario: Suite governance summary is visible in candidate authoring
- GIVEN reviewer 在控制台查看一个 memory candidate suite
- WHEN 系统渲染 suite detail
- THEN 系统 SHALL 展示该 suite 的 review 状态分布与 promoted 数量摘要
- AND 系统 SHALL 让 reviewer 能快速判断候选集当前的治理状态

#### Scenario: Gold history audit is visible from the console
- GIVEN 平台中已经存在 memory gold promotion history
- WHEN reviewer 在控制台请求查看 gold history
- THEN 系统 SHALL 以 audit 视图展示 promote / rollback 事件
- AND 系统 SHALL 不只返回原始 JSON 而缺少结构化回看入口

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

### Requirement: Trace Bundle and Evaluation Harness
系统 SHALL 提供可回放的轨迹 bundle 导出能力，并复用其进行离线评测 harness。

#### Scenario: Trace bundle export
- GIVEN 一个已完成的任务轨迹
- WHEN 用户或评测系统请求轨迹导出
- THEN 系统 SHALL 汇总任务状态、审计日志、流式事件、记忆、评测和复核结果
- AND 系统 SHALL 提供稳定的 bundle 结构供回放或离线分析使用

#### Scenario: Batch harness execution
- GIVEN 一批标准任务案例
- WHEN 系统运行离线评测 harness
- THEN 系统 SHALL 执行每个案例并采集对应轨迹 bundle
- AND 系统 SHALL 输出批量成功率与基础质量指标

### Requirement: Iteration Evidence Logging
系统 SHALL 将经过验证的关键技术迭代沉淀为结构化证据与可复述记录。

#### Scenario: Validated retrieval iteration
- GIVEN 一次关于 chunking、retrieval、rerank、query rewrite 或评测器的关键改动
- WHEN 系统通过 benchmark、quality report、smoke 或线上 KPI 确认该改动产生了可解释信号
- THEN 系统 SHALL 记录 problem、changes、metrics before/after、delta 和 evidence refs
- AND 系统 SHALL 补充可直接用于复盘或面试复述的文字摘要

#### Scenario: Unvalidated attempt
- GIVEN 一次改动尚未拿到稳定指标或证据
- WHEN 项目记录该次尝试
- THEN 系统 SHALL 将其标记为 attempted 或同等状态
- AND 系统 SHALL 不把该次尝试记为已验证优化

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

#### Scenario: Persona and tool directories expose one shared toolset catalog
- GIVEN 控制台或治理面板需要查看当前人格目录与工具目录
- WHEN 请求 `/api/personas` 或 `/api/tools`
- THEN 系统 SHALL 从同一份 Python core persona catalog 暴露 `toolsets`
- AND `/api/tools` SHALL 同时返回已注册工具定义列表

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

### Requirement: Tool Execution Policy
系统 SHALL 按工具契约执行超时、重试、幂等和风险等级策略。

#### Scenario: Retry low-risk idempotent tool
- GIVEN 一个低风险且幂等的读取型工具出现瞬时失败
- WHEN registry 执行该工具
- THEN 系统 SHALL 在声明的重试策略内自动重试
- AND 系统 SHALL 记录尝试次数与最终结果

#### Scenario: Do not auto-retry high-risk tool
- GIVEN 一个高风险或非幂等工具执行失败
- WHEN registry 评估该工具的执行策略
- THEN 系统 SHALL 默认避免自动重试
- AND 系统 SHALL 保留失败结果供后续人工审批或补偿处理

#### Scenario: Block disabled tool before execution
- GIVEN 某个工具在 registry 中被标记为 `enabled=false`
- WHEN 系统尝试执行该工具
- THEN 系统 SHALL 在触发 handler 前阻断该调用
- AND 系统 SHALL 返回结构化 blocked result 与 `tool_disabled` 错误码

#### Scenario: Block tool outside allowed release channel
- GIVEN 当前 persona toolset 仅允许 `stable` 发布通道
- WHEN 一个 `beta` 工具被选中执行
- THEN 系统 SHALL 在触发 handler 前阻断该调用
- AND 系统 SHALL 返回结构化 blocked result 与 `tool_release_channel_blocked` 错误码

#### Scenario: Block tool that misses required capabilities
- GIVEN 当前 persona toolset 要求工具具备 `retrieval` 能力
- WHEN 一个不具备该能力标签的工具被选中执行
- THEN 系统 SHALL 在触发 handler 前阻断该调用
- AND 系统 SHALL 返回结构化 blocked result 与 `tool_capability_mismatch` 错误码

#### Scenario: Trace bundle summarizes blocked tool governance events
- GIVEN 某次任务执行中存在被 tool governance 阻断的工具调用
- WHEN 用户查看 trace bundle 或控制台 trace inspector
- THEN 系统 SHALL 提供 blocked-tool 数量、错误码分布和被阻断工具名列表
- AND `tool_result` 事件 SHALL 保留 `tool_name` 与 `error_code` 等最小治理字段

#### Scenario: Governance inspector explains runtime tool enforcement
- GIVEN 用户查看某个任务的 `/api/governance` 快照或控制台 `Gov` inspector
- WHEN 该任务具有人格 toolset 边界与运行时 access policy
- THEN 系统 SHALL 返回当前 persona/toolset 上下文、运行时 blocked-tool 统计、alert 分布和 registry 风险面摘要
- AND 系统 SHALL 提供基于 active access policy 的 projected allow/block 结果，便于区分“目录上有风险”与“这次 trace 里真实发生了阻断”

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

#### Scenario: Restricted environment blocks undeclared or disallowed execution capabilities
- GIVEN 某个工具声明需要 network、filesystem 或 shell 能力
- WHEN 当前 restricted execution environment 不允许该能力
- THEN 系统 SHALL 在触发 handler 前阻断该调用
- AND 系统 SHALL 返回结构化错误码与执行环境约束摘要，而不是静默失败或继续重试

#### Scenario: Restricted environment blocks filesystem paths outside the active allowlist
- GIVEN 某个工具声明需要文件系统访问，并在请求中携带 `path`、`file_path` 或 `directory_path`
- WHEN 当前 restricted execution environment 的 workspace path allowlist 不包含目标路径
- THEN 系统 SHALL 在触发 handler 前阻断该调用
- AND 系统 SHALL 返回 `filesystem_path_blocked`
- AND 系统 SHALL 在结果 metrics 中暴露 `requested_paths`、`blocked_paths` 与有效 `allowed_paths`

#### Scenario: Restricted environment blocks network egress targets outside the active allowlist
- GIVEN 某个工具声明需要网络访问，并在请求中携带 `host/domain/provider/service`
- WHEN 当前 restricted execution environment 的 egress allowlist 不包含该 host 或 provider
- THEN 系统 SHALL 在触发 handler 前阻断该调用
- AND 系统 SHALL 返回 `network_egress_blocked`
- AND 系统 SHALL 在结果 metrics 中暴露 `requested_hosts`、`requested_providers`、`blocked_hosts`、`blocked_providers` 以及有效 `allowed_hosts / allowed_providers`

#### Scenario: Restricted environment supports suffix-based host egress rules
- GIVEN restricted execution environment 或工具契约中的 `egress_allowlist.hosts` 包含 `*.domain` 形式的后缀规则
- WHEN 工具请求访问该后缀范围内的具体 host，或通过 `url/base_url/endpoint` 提供可解析 URL
- THEN 系统 SHALL 将该请求视为命中允许规则
- AND 系统 SHALL 在 environment/tool 双方都声明 host 规则时按交集收紧，而不是按并集放宽

#### Scenario: Restricted environment enforces provider-host joint bindings
- GIVEN restricted execution environment 或工具契约中的 `egress_allowlist.provider_host_bindings` 为某个 provider 指定了允许的 host 规则
- WHEN 某次网络调用虽然命中了独立的 provider allowlist 与 host allowlist，但其 provider-host 组合不满足联合绑定
- THEN 系统 SHALL 仍然阻断该调用
- AND 系统 SHALL 在结果 metrics 中暴露 `blocked_provider_host_pairs` 与有效 `allowed_provider_host_bindings`

#### Scenario: Restricted environment applies persona or toolset egress slices as a dynamic narrowing layer
- GIVEN 当前任务绑定的人格或 toolset 在 `tool_access_policy.egress_allowlist` 中声明了动态 egress slice
- WHEN 某个联网工具准备执行
- THEN 系统 SHALL 按“环境策略 -> persona/toolset slice -> tool constraints”三级交集收紧有效 egress allowlist
- AND 系统 SHALL 在 governance snapshot 与控制台中暴露该 dynamic slice 摘要，便于区分环境上界与人格运行时收紧

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

#### Scenario: Wiki proposal review and conflict merge
- GIVEN 一条 wiki 更新来自模型生成或异步补录
- WHEN 该更新与当前版本冲突或需要人工确认
- THEN 系统 SHALL 支持以 proposal 形式暂存、审核、合并并保留审计记录

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

#### Scenario: Retry before dead-letter
- GIVEN 一个异步 worker job 发生了暂时性失败
- WHEN 当前 job 的 retry budget 尚未耗尽
- THEN 系统 SHALL 先将该 job 重新排回队列
- AND 系统 SHALL 记录重试次数、最近一次错误与重排原因

#### Scenario: Replay dead-letter into worker queue main path
- GIVEN 一个 worker job 已经进入 dead-letter
- WHEN operator 触发 dead-letter replay
- THEN 系统 SHALL 使用该 dead-letter 记录中的原始 worker 输入重新进入 worker queue 主链
- AND 系统 SHALL 记录 `replay_id`、`replay_job_id` 与 replay 状态元数据

#### Scenario: Recover task dead-letter from latest checkpoint
- GIVEN 一个 task 已进入 dead-letter，且保留了最近可恢复检查点
- WHEN operator 通过恢复接口请求继续执行
- THEN 系统 SHALL 基于 `message_snapshot`、`plan` 与 `run_state` 从最近检查点恢复
- AND 系统 SHALL 记录 task 级 dead-letter recovery 的状态元数据与审计事件

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

### Requirement: Multi-Agent Coordination
系统 SHALL 支持由 coordinator 管理的多 Agent 协作模式。

#### Scenario: Delegated specialist execution
- GIVEN 一个任务同时包含检索、生成和审校等可拆分子问题
- WHEN coordinator 判断单 agent 执行成本过高、需要隔离风险或适合并行处理
- THEN 系统 SHALL 将子任务委派给 specialist agent
- AND 每个 specialist agent SHALL 使用独立上下文、工具集和预算

#### Scenario: Structured handoff and join
- GIVEN 一个 specialist agent 完成子任务
- WHEN 其结果返回 coordinator
- THEN 系统 SHALL 通过结构化 handoff 包合并结果
- AND 系统 SHALL 记录委派输入摘要、输出摘要、证据引用和采纳决策

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

### Requirement: Memory Provider Abstraction
系统 SHALL 支持可回退的 memory provider abstraction，并显式区分内建记忆与外部持久记忆后端。

#### Scenario: Local fallback for memory provider
- GIVEN 外部 memory provider 未配置、不可用或执行失败
- WHEN 系统需要执行记忆写入或查询
- THEN 系统 SHALL 回退到 `local_builtin` provider
- AND 系统 SHALL 记录 provider 回退原因

#### Scenario: Profile-aware durable provider
- GIVEN 系统启用了外部 durable memory provider
- WHEN 系统写入或读取长期记忆
- THEN 系统 SHALL 保留 workspace / persona / trace 级隔离信息
- AND 系统 SHALL 通过统一 provider contract 返回结构化结果

#### Scenario: Memory runtime snapshot explains live provider and linked artifacts
- GIVEN 用户查看 `/api/memory` 或控制台 `Memory` inspector
- WHEN 当前任务已经发生记忆读写、handoff 或上下文压缩
- THEN 系统 SHALL 返回 memory runtime summary，显式展示 provider mode、fallback、scope health 和 handoff/compression 概况
- AND 系统 SHALL 提供最近一次 handoff 与 compression 的结构化关联产物，避免调试视图退化成原始 JSON dump

#### Scenario: Short-term memory archive remains recoverable without becoming durable long-term memory
- GIVEN 一个任务已经产生多条短期工作记忆
- WHEN 系统写入 short-term memory
- THEN 系统 SHALL 保持进程内热记忆可直接参与当前上下文构建
- AND 系统 SHALL 将该 short-term memory 同步写入本地 markdown archive 以便恢复与排障
- AND 系统 SHALL 不因写入 markdown archive 而自动将该条目视为长期 durable memory

### Requirement: Memory Evaluation Harness
系统 SHALL 为记忆链路提供独立评测 harness，而不是仅依赖 RAG 或端到端 smoke。

#### Scenario: Durable write evaluation
- GIVEN 一组稳定偏好与临时指令样例
- WHEN 系统运行 memory harness
- THEN 系统 SHALL 输出 durable write precision / recall

#### Scenario: Compression fidelity evaluation
- GIVEN 一组压缩恢复样例
- WHEN 系统运行 memory harness
- THEN 系统 SHALL 输出 must-keep retention 与 unresolved-item retention

#### Scenario: Handoff sufficiency evaluation
- GIVEN 一组跨 Agent handoff 样例
- WHEN 系统运行 memory harness
- THEN 系统 SHALL 输出 handoff packet 的字段完整性和上下文充分性指标

### Requirement: Context Window Management and Compression
系统 SHALL 在上下文接近模型窗口上限时执行预算管理、压缩和恢复。

#### Scenario: Budget-aware compaction
- GIVEN 当前任务上下文超过模型预算阈值
- WHEN 系统准备发起下一次模型调用
- THEN 系统 SHALL 优先保留系统约束、当前步骤、关键证据和未决事项
- AND 系统 SHALL 将较早历史压缩为可审计摘要

#### Scenario: Compression-assisted resume or handoff
- GIVEN 任务需要恢复执行或转交给另一个 agent
- WHEN 原始上下文过大或不适合直接传递
- THEN 系统 SHALL 使用最近压缩快照和引用指针重建所需上下文
- AND 系统 SHALL 保留原始事件日志用于审计与回放

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

#### Scenario: Mixed query routing
- GIVEN 一个查询同时包含稳定背景与当前状态字段
- WHEN 系统处理该查询
- THEN 系统 SHALL 保留主路径决策
- AND 系统 SHALL 允许次路径补充引用
- AND 系统 SHALL 显式记录是否发生 fallback

#### Scenario: Query decomposition before retrieval
- GIVEN 一个查询同时包含多个检索意图
- WHEN 系统进入 retrieval routing 前置层
- THEN 系统 SHALL 输出子查询分解结果
- AND 系统 SHALL 为每个子查询标注 preferred source
- AND 系统 SHALL 将 decomposition 结果写入 retrieval result 与 trace

#### Scenario: Clarification before retrieval
- GIVEN 查询中出现“这个/它/that/it”等不明确指代，导致目标实体不清
- WHEN 系统执行 query analysis
- THEN 系统 SHALL 标记 clarification required
- AND 系统 SHALL 输出缺失上下文与推荐追问
- AND 系统 SHALL 将建议动作显式标记为 `clarify`

### Requirement: Hybrid RAG Pipeline
hybrid RAG SHALL 采用语义检索、BM25 稀疏检索与 metadata filter 的组合管线。

#### Scenario: Filter-first recall planning
- GIVEN 一个包含项目范围、文档类型或语言约束的查询
- WHEN 系统准备执行 RAG
- THEN 系统 SHALL 先提取 filter hints
- AND 系统 SHALL 先缩小候选范围后再发起 semantic 与 BM25 双路召回

#### Scenario: Inferred hints stay in soft-prefer mode
- GIVEN query frontend 只从上下文推断出 conference、year 或 doc scope 提示
- WHEN 系统执行 RAG
- THEN 系统 SHALL 默认采用 `soft_prefer`
- AND 系统 SHALL 把 metadata 作为排序与聚合偏好，而不是直接硬排除所有不匹配候选

#### Scenario: Explicit filters upgrade metadata policy
- GIVEN 请求本身已经携带显式 metadata filters，或用户明确要求“只看某范围”
- WHEN 系统执行 RAG
- THEN 系统 SHALL 将 filter policy 升级为 `hard_enforce`
- AND 系统 SHALL 先以该约束收窄候选集合，再执行后续排序

#### Scenario: Hard filter empty keeps bounded fallback semantics
- GIVEN `hard_enforce` 过滤后候选为空
- WHEN 系统继续处理该请求
- THEN 系统 SHALL 记录 `hard_filter_empty`
- AND 系统 SHALL 保留 `requested_filters` 与 `effective_filters`
- AND 若系统在同一路由内恢复候选，SHALL 将结果中的 `filter_policy.mode` 标记为 `soft_prefer`
- AND SHALL 显式标记 `recovered_soft_prefer`
- AND SHALL 保留 `retrieval_plan.filter_plan.mode = hard_enforce` 作为规划态审计字段
- AND SHALL 仅在真实来源回退时把 `route.fallback_applied` 标记为 `true`
- AND 系统 SHALL 显式记录回退到 `soft_prefer`、clarify、review 或 abstain 的原因

#### Scenario: Dual-channel recall merge
- GIVEN 一个可检索查询
- WHEN 系统执行 hybrid RAG
- THEN 系统 SHALL 同时执行 semantic 与 BM25 召回
- AND 系统 SHALL 对结果去重、合并并进入统一重排阶段

### Requirement: Hybrid RAG Quality
hybrid RAG SHALL 结合稀疏检索、稠密检索与重排结果。

#### Scenario: Multi-signal ranking
- GIVEN 一个可检索查询
- WHEN 系统执行 RAG
- THEN 系统 SHALL 合并多路召回结果
- AND 系统 SHALL 经过重排后输出
- AND 系统 SHALL 保留引用链

#### Scenario: Retrieval result explainability
- GIVEN 一次检索已经完成
- WHEN 系统返回 retrieval result
- THEN 系统 SHALL 同时返回 query analysis、retrieval plan、citations 与 quality 指标
- AND 系统 SHALL 保留 filter 命中与 route/fallback 信息以供审计和调试

#### Scenario: Parent-child evidence view is preserved
- GIVEN 一次检索先命中了一批 chunk 级候选
- WHEN 系统完成融合、聚合与支撑证据选择
- THEN 系统 SHALL 同时保留 `raw_items`、`doc_aggregates` 与 `supporting_chunks`
- AND 系统 SHALL 让后续 response draft 基于聚合后的证据视图，而不是直接倾倒原始 top chunks

#### Scenario: Retrieval benchmark metrics
- GIVEN 一批带 expected document 的检索评测 query
- WHEN 系统运行离线 retrieval benchmark
- THEN 系统 SHALL 输出至少 `Hit@1`、`Hit@K` 与 `MRR`
- AND 系统 SHALL 输出可供人工复核的 review artifact

#### Scenario: Smoke retrieval backend is labeled as low fidelity
- GIVEN 某次 retrieval benchmark 运行使用了非语义高保真 backend（如 `deterministic_hash`）
- WHEN 系统输出 benchmark summary
- THEN 系统 SHALL 显式标记该运行只适合 smoke / regression
- AND 系统 SHALL 不把该结果冒充为最终的语义检索质量结论

#### Scenario: Snippet-grounded retrieval gold
- GIVEN 一批带 expected document 且包含 snippet-level gold selector 的检索评测 query
- WHEN 系统运行离线 retrieval benchmark
- THEN 系统 SHALL 输出 `snippet_context_recall`、`snippet_context_precision` 与 `citation_span_match_rate`
- AND 系统 SHALL 在 review artifact 中保留 requirement 级匹配结果与对应 chunk 证据

#### Scenario: Noisy supporting chunk inspection
- GIVEN 一次检索命中了目标文档但 supporting evidence 仍可能混入图表块、坐标轴块或乱码块
- WHEN 系统生成 retrieval review
- THEN 系统 SHALL 标记 supporting chunks 中的低信号片段
- AND 系统 SHALL 输出可供人工排查 chunking 与 rerank 问题的证据视图

### Requirement: Retrieval-to-Response Grounding
系统 SHALL 将 retrieval result 中的关键证据以受控方式注入最终 response draft，而不是只传标题级上下文。

#### Scenario: Compact evidence packing
- GIVEN 一次检索已经完成，且 retrieval result 包含 route、quality、citations 和 supporting chunks
- WHEN 系统构建 response draft
- THEN 系统 SHALL 注入 compact evidence pack
- AND 系统 SHALL 优先使用 supporting snippet，而不是只使用标题列表
- AND 系统 SHALL 保留 route 与 citation 线索

#### Scenario: Compact evidence pack reuses selected supports
- GIVEN 一次检索已经完成 parent-child 聚合与 supporting chunk 选择
- WHEN 系统构建 response draft
- THEN 系统 SHALL 优先复用 `items[*].supporting_chunks` 与 `supporting_chunks`
- AND 系统 SHALL 不绕过前置 compaction 结果去重新盲选原始 fused chunk 列表

#### Scenario: Clarification-first grounding
- GIVEN query frontend 标记了 clarification required
- WHEN 系统构建 response draft
- THEN 系统 SHALL 保留推荐追问
- AND 系统 SHALL 优先引导最终响应先澄清，再决定是否回答

#### Scenario: Evidence budget enforcement
- GIVEN supporting evidence 超过单次模型输入预算
- WHEN 系统打包 retrieval context
- THEN 系统 SHALL 限制 parent item 数、supporting chunk 数和 snippet 长度
- AND 系统 SHALL 保留 must-keep 的 route、top citations、关键 supporting snippet 和 clarification 信号

### Requirement: Knowledge Segmentation
系统 SHALL 按知识稳定性、结构化程度和时效要求划分 RAG、LLM wiki 与 memory 的边界。

#### Scenario: Stable documentation goes to RAG
- GIVEN 一份架构说明、运行手册或流程文档
- WHEN 系统进行知识入库规划
- THEN 系统 SHALL 将其视为稳定文档材料
- AND 系统 SHALL 进入 RAG 文档与 chunk 流程

#### Scenario: Dynamic fact goes to wiki
- GIVEN 一个版本号、价格、负责人或状态类事实
- WHEN 系统进行知识入库规划
- THEN 系统 SHALL 将其视为动态结构化事实
- AND 系统 SHALL 优先进入 LLM wiki 实体页

#### Scenario: Knowledge contract attached to retrieval sources
- GIVEN 一条进入 RAG 或 wiki 的知识条目
- WHEN 系统构建 retrieval candidate 或最终 citation
- THEN 系统 SHALL 保留 `required_context`、`retrieval_hints`、`owner`、`ttl`、`source_of_truth` 和 `version`
- AND 系统 SHALL 能够区分该 contract 是显式标注还是默认注入

#### Scenario: Query explicit scope upgrades metadata filter policy
- GIVEN 用户查询中明确表达“只看某个 conference / year / scope”
- WHEN 系统完成 query frontend 分析并进入 retrieval
- THEN 系统 SHALL 在 `query_analysis.filter_hints` 中标注该显式范围
- AND SHALL 在 `query_analysis.boundary` 中标注 `explicit_scope_required=true`
- AND SHALL 将 retrieval `filter_policy.mode` 升级为 `hard_enforce`

### Requirement: LLM Wiki Freshness
LLM wiki SHALL 支持结构化更新、版本追踪和过期标记。

#### Scenario: Frequent update
- GIVEN 一个高变更实体
- WHEN 该实体信息发生变化
- THEN 系统 SHALL 更新对应 wiki 条目
- AND 系统 SHALL 标记旧版本为过期或历史记录

### Requirement: LLM Wiki Durable Store
LLM wiki SHALL 拥有可审计的本地 durable store，并允许可选热缓存加速读取。

#### Scenario: SQLite remains the source of truth for wiki lifecycle
- GIVEN 系统写入、审核、回滚或查询 wiki 条目
- WHEN 这些动作进入正式 wiki 治理链
- THEN 系统 SHALL 将 `entries / history / proposals` 持久化到本地 durable store
- AND 系统 SHALL 保证该 durable store 可在进程重启后恢复 wiki 状态

#### Scenario: Redis cache is optional and never replaces the durable source of truth
- GIVEN 系统启用了 wiki 热缓存
- WHEN wiki 查询命中缓存或触发缓存失效
- THEN 系统 MAY 使用 Redis 作为读优化层
- AND 系统 SHALL 继续以 durable store 作为 wiki 的 source of truth

#### Scenario: Wiki runtime API exposes provider and cache observability
- GIVEN 用户或控制台正在调试 wiki 生命周期
- WHEN 系统返回 `/api/wiki` catalog、query 或 entry 视图
- THEN 系统 SHALL 同时暴露 `provider_strategy`
- AND 系统 SHALL 提供 `runtime_summary`，至少覆盖 provider、durable store 计数/更新时间，以及 cache backend / ttl 摘要

### Requirement: LLM Wiki Markdown Import
系统 SHALL 支持从 markdown 笔记构建 wiki proposal 或直接 upsert 的受控导入链路。

#### Scenario: Frontmatter-backed markdown proposal import
- GIVEN 一段包含 frontmatter、summary 和 facts 的 markdown 笔记
- WHEN 系统执行 wiki markdown 导入，且 `mode=proposal`
- THEN 系统 SHALL 从 markdown 构建结构化 wiki proposal
- AND 系统 SHALL 保留 `required_context`、`retrieval_hints`、`owner`、`ttl`、`source_of_truth` 和 `base_version`
- AND 系统 SHALL 将导入事件写入审计链

#### Scenario: Heading fallback markdown upsert
- GIVEN 一段不带 frontmatter 的 markdown 笔记，但存在标题、首段摘要和 bullet facts
- WHEN 系统执行 wiki markdown 导入，且 `mode=upsert`
- THEN 系统 SHALL 使用 heading / paragraph / bullet fallback 生成 wiki entry
- AND 系统 SHALL 为缺失字段注入保守默认值

#### Scenario: Markdown import stays inside governance boundary
- GIVEN 系统已支持 wiki proposal、review、history 和 rollback
- WHEN 用户通过 markdown notes 导入动态知识
- THEN 系统 SHALL 复用现有 wiki 治理链
- AND 系统 SHALL 不把 markdown import 视为绕过 proposal / history / audit 的特殊后门

#### Scenario: Directory-backed markdown batch import
- GIVEN 一组以 markdown 目录组织的动态知识 notes
- WHEN 系统执行目录级 wiki markdown batch import
- THEN 系统 SHALL 枚举 `.md` 文件并逐条进入既有 wiki 导入治理链
- AND 系统 SHALL 保留每条 note 的 `file_path` 与 `source_trace_id`

#### Scenario: Audit can emit candidate card drafts for long-form notes
- GIVEN 一篇更适合进入 `rag` 或 `review` 的长篇 markdown note
- WHEN 系统执行 notes audit，且启用了 card draft 导出
- THEN 系统 SHALL 输出一个或多个 candidate card drafts
- AND 每个 draft SHALL 保留 `source_file_path`、`summary`、`facts`、`required_context`、`retrieval_hints`、`source_of_truth` 与 `review_required`
- AND 系统 SHALL 不将这些 drafts 直接写入正式 wiki

#### Scenario: Stale wiki entry requires supplement
- GIVEN 一个 `wiki-first` 查询命中了 `historical` 的 wiki 主源
- WHEN 系统计算 retrieval quality
- THEN 系统 SHALL 不将该结果直接判定为 `accept`
- AND 系统 SHALL 将 `recommended_action` 标记为 `supplement_rag`

### Requirement: Evaluation and RL Gating
系统 SHALL 在启用 RL 前提供可回放的评测 harness 与安全门禁。

#### Scenario: Offline evaluation
- GIVEN 一批标准任务轨迹
- WHEN 系统运行评测
- THEN 系统 SHALL 输出任务成功率、引用准确率和工具合规率

#### Scenario: Behavior-aware generation evaluation
- GIVEN 一批 RAG / wiki generation case，且 case 显式声明期望行为为 `answer`、`clarify` 或 `abstain`
- WHEN 系统运行生成层评测
- THEN 系统 SHALL 输出 behavior alignment 指标
- AND 系统 SHALL 将其与 faithfulness、answer relevancy 和 route consistency 一起纳入 judge 结果

#### Scenario: Retrieval trace observability
- GIVEN 一次混合检索已经完成
- WHEN trace collector 生成 trace bundle
- THEN 系统 SHALL 至少暴露 `query_mode`、`intent_tags`、`boundary_action`、`clarification_required`、`subquery_count`、`rewrite_count`、`filter_policy_mode`、`contract_coverage_score`、`hard_filter_empty`、`requested_filters`、`effective_filters`、`recommended_action` 和 `source_of_truth_conflict_count`
- AND 这些指标 SHALL 可供线上监控、离线复盘和面试复述使用

#### Scenario: RL gate
- GIVEN 评测结果未达到门槛
- WHEN 系统尝试启用学习更新
- THEN 系统 SHALL 阻止直接在线更新策略
