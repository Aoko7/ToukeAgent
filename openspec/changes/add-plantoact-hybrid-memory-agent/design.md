# Design

## 文档导航
- 业务目标和范围：见 `proposal.md`
- 字段级对象定义：见 `contracts.md`
- 验收口径：见 `specs/agent-platform/spec.md`
- 实施顺序：见 `tasks.md`

## 总体架构
系统分为八层：
1. Presentation：前端控制台、任务面板、轨迹查看、检索调试、角色切换。
2. Ingestion / Adapter：不同外部平台消息的接入、归一化与回传。
3. Orchestrator：负责任务接收、规划、重规划、终止条件、角色上下文选择。
4. Executor：负责每个计划步骤内的 micro-ReAct 推理与工具执行。
5. Memory：负责短期状态、长期记忆、记忆写入策略。
6. Retrieval：负责 hybrid RAG、LLM wiki 路由与统一引用输出。
7. Event Bus / Workers：负责异步任务、重试、回写和长耗时处理。
8. Evaluation / RL：负责轨迹评测、生成质量评估、奖励建模、离线回放与安全门禁。

### Node Shell / Python Core Split
- Node 继续承担 HTTP、SSE、前端静态资源、外部平台适配、存储编排、工具 handler 执行和 provider gateway。
- Python 负责核心 agent 能力：`Plan-to-Act` 规划、`micro-ReAct` 步骤准备、模型路由、tool policy、hybrid retrieval 路由、响应草稿生成与输出评估。
- Node 通过稳定的 JSON bridge 调用 Python 核心，避免把核心推理逻辑散落在多个 `.mjs` 文件里。
- bridge 只传递结构化对象，不传递函数、闭包或环境状态；所有输入输出都应可序列化、可记录、可回放。
- 当 Python 核心返回错误时，Node 负责把错误写入审计和 SSE 事件，但不在本地重写核心逻辑。

## 核心对象
本设计围绕五个核心对象展开：
1. `CanonicalMessage`：统一接入和回放的消息对象
2. `StreamEvent`：前端和审计共享的流式事件对象
3. `ToolInvocationContract`：工具注册与执行对象
4. `PersonaProfile`：人格和角色配置对象
5. `RouteBinding`：渠道、人格、agent 的绑定对象
6. `AgentPlan`：任务规划对象
7. `AgentRunState`：执行状态对象

字段细节见 `contracts.md`。

## 关键设计
### 1) Plan-to-Act
- 顶层只产出计划，不直接做所有细节推理。
- 每个 plan step 再进入一个局部 ReAct 循环。
- 任何 step 都允许因为失败、缺证据或新约束触发局部重规划。
- 计划生成、模型路由、step 准备与评估应由 Python 核心实现，Node 仅负责调用、包装和回放。

### 1.1) Persona and Role Switching
- 人格是可配置的运行时上下文，而不是固定的提示词附录。
- 每个人格定义表达风格、边界、默认工具偏好、风险等级和常见工作模式。
- 角色切换只能改变行为策略层，不得绕过审计、安全、权限和数据边界。
- 对话中可在不同人格之间切换，以适配多面手、助手、审核、运维、研究等不同工作模式。

### 1.2) Multi-Agent Coordination
- 默认以单一 coordinator 为任务入口；只有当任务天然可拆分、风险需要隔离或需要并行提速时，才委派给 specialist agents。
- specialist agent 建议分为 `planner`、`retriever`、`writer`、`reviewer`、`operator` 等角色，但都必须在同一 trace 下运行。
- 多 Agent 之间不直接共享完整原始上下文，而是通过结构化 handoff packet 传递目标、约束、摘要、证据引用和预算。
- coordinator 是唯一能够汇总最终状态、决定结果采纳与发起高风险外部副作用的角色。
- 每个 specialist agent 必须具备独立的人格、工具集、上下文预算、重试策略和工作区边界，避免“多 agent 共用一个大 prompt”。
- fan-out 数量、委派深度和等待超时应可配置，防止无限分裂和互相阻塞。

### 2) Memory
- 短期记忆：保存在当前会话状态中，随任务结束释放。
- 长期记忆：沉淀为可检索条目，支持用户、项目、实体、流程等维度。
- 写入策略：仅写入稳定、可复用、经过校验的信息。
- 短期记忆通过任务级查询接口暴露；长期记忆通过独立搜索接口暴露，并可被回复链路和后续任务复用。
- 长期记忆召回排序与 durable write 判定不应长期停留在 Node 侧 heuristic；推荐由 Python core 统一输出 recall ranking 与 write decision，Node 只负责持久化和观测。
- 短期记忆的运行时热层仍应保留在内存中，但建议同时落一份轻量本地归档，优先使用 markdown session log，便于重启恢复、人工排障和 handoff 回看。
- markdown short-term archive 不是 durable long-term memory；它服务于“短生命周期工作记忆可回放”，而不是替代长期偏好记忆。

### 2.1) Memory Provider Boundary
- 记忆 provider 的选择、能力归一化、写入策略和读取策略应由 Python core 统一表达，Node 只负责注入配置、编排存储实例和暴露调试接口。
- 第一版至少支持 `local_builtin` 和 `mem0_compatible` 两类 provider：前者用于本地内建存储与回退，后者作为外部持久记忆后端的兼容接口。
- provider 抽象必须显式声明能力边界：是否支持 durable persistence、是否支持 profile / workspace 隔离、是否支持语义检索、是否支持压缩快照复用。
- provider 选择必须可回退；当外部 provider 不可用、配置缺失或返回异常时，系统应回退到 `local_builtin`，并把回退原因写入 trace / audit。
- 记忆 provider 不与 RAG / wiki 混用。provider 负责“工作记忆与偏好记忆”的写入和查询，而不是稳定知识库路由。
- 运行时调试接口不应只返回原始 `short_term / long_term` 列表；`/api/memory` 还应提供面向排障的 `runtime_summary`，至少覆盖 provider mode、fallback、short/long/stale 计数、handoff/compression 计数和 durable persistence 概况。
- `Memory` inspector 应优先消费服务端输出的 memory runtime 快照，而不是在前端本地重新推导 provider/fallback/handoff 状态，避免控制台复制第二套记忆治理逻辑。
- memory runtime 快照还应保留 `linked_artifacts`，至少能回看最近一次 handoff packet 和 context compression snapshot，让“为什么这段记忆会这样”可以直接追到关联产物。
- 本地开发默认建议采用“双层持久化”：`short-term = in-memory + markdown archive`，`long-term = provider-managed durable store`。
- 当 provider 为 `local_builtin` 时，长期记忆允许继续仅驻留进程内；但短期记忆归档仍建议落到 markdown，以保留最小恢复与审计抓手。

### 2.2) Memory Harness and Quality Gates
- 记忆链路必须有独立 harness，不能只复用 RAG 或 end-to-end smoke。
- 第一版 memory harness 至少输出：`durable_write_precision`、`durable_write_recall`、`memory_recall_at_k`、`stale_memory_rate`、`compression_must_keep_retention`、`handoff_sufficiency_rate`。
- harness 产物应和 RAG 一样输出结构化 `summary.json / review.json / review.md`，方便回归、人工复核和面试复述。
- memory harness 的 case 应覆盖：稳定偏好提升、长期记忆检索、压缩恢复保真、handoff packet 完整性。
- 当记忆链路发生 provider 切换、写入策略调整、压缩策略调整或 persona 隔离变更时，必须先过 memory harness，再更新迭代台账。
- durable write 至少要能区分“稳定偏好/长期约束”和“一次性提醒/时间绑定指令”；memory recall 至少要能表达 lexical、semantic、importance、freshness 与 stale penalty 的组合排序依据。
- memory harness 不应长期停留在独立脚本层；推荐接入平台统一 harness runtime、store 和 API，使 task harness 与 memory harness 能共享 run registry、artifact 查询和前端调试入口。
- 当前端控制台进入调试态时，应提供统一 harness inspector，至少支持按 `harness_type` 过滤 `task` / `memory` run、查看 summary / cases / artifacts，并复用同一 run registry。
- 当 harness run 自带 `review_markdown` artifact 时，前端应优先展示该 artifact，而不是默认回退到原始 JSON，避免评测结果再次退化成“结构化但难读”的调试材料。
- 对存在默认 suite 的 harness（当前至少是 `memory`） ，前端可提供受控触发入口，用于快速运行默认评测集；高自由度 task harness 仍保留开发者/API 调用优先。
- 当平台已经拥有真实 `trace bundle` 时，应支持导出 trace-derived memory harness draft，用于把真实任务中的 durable memory、recall、compression 和 handoff 产物转成待人工复核的 case 草稿。
- trace-derived draft 只能作为 case authoring 加速器，不能直接冒充 validated gold；系统必须显式保留 `review_required` 和 `draft_origin` 标记。
- 当前端展示 trace-derived draft 时，应优先提供 case list、selected case detail 和下载入口，帮助人工快速完成 authoring / review，而不是只暴露原始 JSON。
- 当 authoring 已经选定某一条 trace-derived case 时，平台应支持把该 case 单独保存为本地 draft artifact，默认落到独立的 memory draft 目录，避免未经复核的草稿直接污染正式 benchmark gold。
- 当人工已经完成最小复核后，平台应支持把选中的 draft case promote 到 candidate benchmark suite；candidate suite 与正式 gold 必须分开落盘，避免 trace-derived case 在没有人工收紧前直接进入正式评测基线。
- candidate benchmark suite 不应只是磁盘里的中间文件；前端 Harness 控制台应能列出 suite、查看 case 明细，并支持直接基于 suite 触发 memory harness 回归，形成 candidate authoring 与评测闭环。
- candidate suite 到正式 gold 之间必须再加一层 review gate：每条 case 需要显式记录 `review_status / reviewer_id / reviewed_at / review_notes`，且只有 `approved` 状态的 case 才允许 promote 到正式 gold。
- promote 到正式 gold 时，系统应把 provenance 一并写入 gold case 元数据，例如 `source_candidate_suite`、`promoted_to_gold_at`、`benchmark_stage=gold`，保证后续 tightening、回滚与审计时能追溯来源。
- Harness 控制台不应只提供单向 approve 按钮；第一版 reviewer workflow 至少要支持 `approved / needs_revision / rejected` 三种显式 decision，并允许 reviewer 填写 notes，避免“为什么没进 gold”只能靠口头约定。
- reviewer 在 promote 前最好能直接看到 candidate-vs-gold 的结构化 compare 结果，至少包括 reference / observed / metadata diff，以及一组最小 checklist，避免 tightening 仍然退化成逐段肉眼对比 JSON。
- gold promote 不应是不可逆写入；系统应维护独立的 promotion history，并允许按 case 执行 rollback，把 gold 恢复到 promote 前状态，同时把 rollback 事件继续写回 history。
- compare 不应长期停留在整块 JSON dump；下一层应至少把 `reference / observed / metadata` 拆成 field-level diff rows，让 reviewer 能更快定位差异点。
- 当 candidate suite 中出现一组需要同口径处理的 case 时，控制台应支持 batch review / batch compare，避免 reviewer 重复点击单 case 操作。
- compare 在进入 field-level 之后，还应继续往 reviewer-friendly visual compare 演进：优先展示 checklist fail、field diff summary 和 mismatch card，而不是把 reviewer 再次推回通用表格视角。
- reviewer-friendly visual compare 当前还应继续细化成三层：`reviewer summary`、`reviewer gaps`、`selected compare case`。前两层用于快速判断这一轮 compare 是否值得继续深挖，最后一层用于把单 case 的 equality / drift / expected-vs-observed 对照拉到 reviewer 第一视线，而不是让 reviewer 先打开整块 diff JSON。
- gold rollback 不应只停在单 case 入口；当一组 promote 后发现同类 provenance 或 tightening 问题时，控制台与服务端应支持 batch rollback，并返回逐 case 成败摘要。
- 当 candidate suite 的样本数开始增多时，控制台不应只展示 case 明细，还应直接给出 suite governance summary，例如 approved / needs_revision / rejected / pending / promoted 分布，帮助 reviewer 快速判断当前候选集状态。
- gold history 不应只作为原始 JSON 附件存在；控制台应提供 audit 视图，把 promote / rollback 事件按时间和 case 组织起来，便于回看近期治理动作。

### 2.3) Unified Knowledge Harness
- `knowledge` harness 负责把 generation / wiki / memory 三条离线评测线放进同一份 run record，而不是只做一层脚本聚合。
- unified knowledge judge 需要同时保留各自 suite summary，以及 `joint_route_match_rate` / `joint_expected_outcome_rate` 这类跨 suite 汇总指标。
- generation 侧重点是 route consistency 与 expected decision，wiki 侧重点是 freshness / fallback / source-of-truth conflict，memory 侧重点是 durable write / recall / compression / handoff。
- 当默认 knowledge suite 运行时，平台应一次性产出三套子评测结果和一个联合 summary，便于在 Harness 控制台、迭代台账和面试材料里统一复述。
- `knowledge` harness 应与 `task / memory / wiki` 共用同一个 run registry、artifact 视图和过滤入口。

### 2.4) Context Window and Compression
- 原始上下文永远保存在事件日志和审计链中，压缩只作用于模型输入视图，不覆盖底层事实。
- 运行时应按分层上下文包组装模型输入：系统约束、人格配置、当前计划、当前步骤、未决事项、最新证据、近期对话、历史摘要。
- 当上下文接近模型窗口阈值时，优先进行抽取式裁剪，再进行摘要式压缩，最后才回退到低优先级历史丢弃。
- 压缩策略必须保留 `must-keep` 信息：安全边界、当前步骤目标、未完成决策、关键工具结果、引用依据和人工指令。
- 压缩产物应以 versioned snapshot 持久化，供任务恢复、跨 Agent handoff、前端回放和人工复核复用。
- 对于长任务，建议将“完整历史”与“工作摘要”分离：完整历史供审计与检索，工作摘要供下一次模型调用。

### 3) Hybrid Retrieval
- 稳定资料：文档、规范、手册、历史说明，进入 hybrid RAG 索引。
- 动态资料：人名、项目状态、版本、频繁变化的结构化事实，进入 LLM wiki。
- 路由器根据“变更频率、结构化程度、时效要求、来源可信度”决定检索路径。
- 检索路由、排序与引用评分应由 Python 核心实现，Node 仅负责数据源接入与调用桥接。

### 3.1) Knowledge Segmentation Rules
- 不按“文件来自哪里”切分，而按“知识属性”切分：稳定性、结构化程度、时效要求、错误代价和是否需要保留原文语义。
- 适合进入 RAG 的是稳定说明性材料：架构文档、README、运行手册、OpenSpec、接口解释、长期流程说明。
- 适合进入 LLM wiki 的是动态结构化事实：版本、价格、负责人、里程碑状态、平台能力、策略开关、实体属性页。
- session memory 只承担任务级短期工作记忆与用户偏好，不与 RAG / wiki 混用。
- 同一知识源允许拆分到两层：稳定解释部分进入 RAG，当前状态字段进入 wiki。

### 3.2) Hybrid RAG Pipeline
- RAG 层采用 `semantic retrieval + BM25 lexical retrieval + metadata filter` 的混合检索。
- 查询先做 query analysis：提取术语、动态/稳定意图、过滤提示、实体标签、语言信息，并生成 `terms / query_mode / intent_tags / filter_hints / decomposition / rewrites / clarification / boundary`。
- 对多意图 query，第一版先做 decomposition scaffold：拆出子查询、声明 preferred source，并把这些子查询同步暴露给 trace、review 和 benchmark，而不是仅在 prompt 中隐式消化。
- 当前的 decomposition 与 rewrite 仍以 scaffold / query variants 为主，而不是完整的 learned query executor；这类限制需要在文档、trace 与 benchmark 中显式保留。
- filter 先筛选 corpus 范围，再分别发起 semantic 与 BM25 双路召回。
- 双路结果合并后按 `doc_id + chunk_id` 去重，再交给 metadata-aware reranker。
- reranker 需综合 semantic score、BM25 score、freshness、authority、filter match、chunk position 等特征。
- 融合后的 chunk 命中不应直接原样送入生成层；系统应继续经过 parent-child 聚合与 supporting chunk 选择，优先输出“来源项 + 精选支撑证据”的结构化视图。
- 最终输出应同时携带 chunk 结果、引用对象、route 决策、质量分和推荐动作。

### 3.2.1) Embedding and Vector Store Baseline
- MVP 阶段默认使用单一多语种 embedding 空间，而不是按语言拆成多模型分库。
- 原因不是多模型不可做，而是不同 embedding 模型意味着不同语义空间；如果 query 和 chunk 不在同一空间内编码，相似度不可直接比较。
- 第一版默认向量库选择 `Qdrant`，用于承载 dense vector、payload metadata 和 filter-first retrieval。
- 第一版默认 embedding 模型选择 `intfloat/multilingual-e5-base`。
- 当本地机器资源更紧或需要更快的离线构建时，可回退到 `intfloat/multilingual-e5-small`。
- `BAAI/bge-m3` 作为后续升级路径保留，用于离线重建索引或更高质量的统一多语种检索；不作为当前本地开发默认值。
- 这样可以保证中文工程文档、英文论文和混合 query 在同一向量空间内检索，先降低系统复杂度，再做质量优化。
- 当本地语义 embedding backend 不可用时，系统可退到 `deterministic_hash` 作为 smoke / regression backend；但该 backend 只用于链路保真与输出形状回归，不应用于得出高保真检索质量结论。
- 后续如果需要按语言或领域拆成多 embedding 空间，必须显式引入 query routing、collection routing、结果融合和评测基线，不能在 MVP 阶段隐式混入。

### 3.3) Filter-First Retrieval Boundary
- filter 是 RAG 层的前置约束，而不是事后展示字段。
- 第一版建议支持：`source_type`、`doc_type`、`project`、`tags`、`language`、`freshness`、`authority`、`visibility`、`entity_refs`。
- filter 命中信息必须进入审计与检索结果，便于解释“为什么这条文档被纳入或排除”。
- 当 query 自带强约束（如项目名、文档类型、语言或 freshness）时，系统应优先缩小召回范围，避免仅靠向量相似度扩散。
- metadata filter 的默认执行语义应为 `soft_prefer`：把匹配范围作为排序与聚合偏好，而不是直接排除所有不匹配候选。
- 当 query frontend 识别到显式范围约束，或请求本身已经携带显式 metadata filters 时，系统应将策略升级为 `hard_enforce`。
- 如果 `hard_enforce` 过滤后候选为空，系统不得静默放宽约束；必须显式记录 `hard_filter_empty`、保留 `requested_filters / effective_filters`，并留下回退原因。
- `retrieval_plan.filter_plan.mode` 表示规划态：query frontend 或显式请求希望以什么策略执行 filter。
- `filter_policy.mode` 表示结果态：若发生 `hard_filter_empty` 且系统成功执行 soft recovery，结果态应显式降为 `soft_prefer`，同时保留 `hard_filter_empty=true` 与 `recovered_soft_prefer=true`。
- metadata filter recovery 不等同于 source fallback；`route.fallback_applied` 只应用于 `wiki-first -> rag-first` 或 `rag-first -> wiki-first` 这类真实来源回退。

### 3.4) Corpus and Chunk Strategy
- 文档先归一化为 `RAGDocument`，再切分为 `RAGChunk`。
- chunk 不宜只保存正文，还应带标题、章节路径、doc_type、更新时间、authority、可见性和实体引用。
- chunk 元数据应显式记录 `language`、`embedding_model`、`embedding_dim` 和 `vector_backend`，便于后续重建索引、迁移模型和做离线评测。
- 对接口文档、手册、设计说明等强结构文档，切块应优先尊重标题层级，而不是纯长度切分。
- 对版本日志、变更说明、FAQ 等高密度文档，可采用更短 chunk，减少无关上下文污染。

### 3.5) Retrieval Output Contract
- retrieval 输出不只是一组 item，还应包含 `query_analysis`、`retrieval_plan`、`route`、`citations` 和 `quality`。
- `query_analysis` 用于表达 query 被系统如何理解，包括术语、intent、filter hints、query mode、subqueries、rewrite variants、clarification 和 boundary action。
- `retrieval_plan` 用于表达当前请求在 RAG 与 wiki 上的执行骨架，哪怕第一版只是 scaffold，也要保持接口稳定。
- 检索结果除了最终 `items`，还应保留 `raw_items`、`doc_aggregates` 与 `supporting_chunks`，便于解释“最初召回了什么”“最终为什么只给模型这些证据”。
- retrieval benchmark 的 gold review 不应只停留在 section-level；对于关键 case，应支持 snippet-level selector，并输出 span-oriented coverage 指标。
- 这样后续接入真实向量库、BM25 索引、reranker、filter compiler 时，不需要推翻 Node/Python 边界。

### 3.5.1) Knowledge Contract
- 每个稳定文档、chunk、wiki entry 和最终 citation 都应能追溯到统一的 knowledge contract。
- contract 最少包含：`required_context`、`retrieval_hints`、`owner`、`ttl_seconds`、`source_of_truth`、`version`。
- contract 的目标不是让知识对象“更漂亮”，而是让 query clarification、review、freshness 治理、线上追责和人工维护都有明确抓手。
- 当 source 本身没有这些字段时，系统允许按 source type 注入 conservative default，但必须把这种默认值暴露在 metadata 中，避免误认为人工精标。
- contract 还应显式保留 `contract_source`，至少区分 `explicit` 与 `default_injected`，便于后续治理与人工 tightening。

### 3.5.2) Retrieval-to-Response Grounding
- retrieval result 不应只停留在调试或 review 产物层；response draft 必须消费 retrieval result，并把 route、quality、citations 和 supporting evidence 一起压成可控的模型输入视图。
- 默认 grounding 方式应为 `compact evidence pack`，优先注入 extractive snippet，而不是只把标题列表或 doc id 传给最终模型。
- evidence pack 应优先复用 parent-child 聚合后的 `items[*].supporting_chunks`，而不是重新从原始 fused chunk 列表里盲选，避免绕过前面的 support compaction 结果。
- prompt packing 需要显式预算：限制 parent item 数、每个 item 的 supporting chunk 数、单条 snippet 长度和总 evidence 字符预算，避免把 retrieval result 原样灌进最终 prompt。
- 当 query frontend 给出 `clarify` 边界动作时，response draft 必须保留澄清问题，并优先要求模型先追问，再决定是否回答。
- 当 retrieval quality 的 `recommended_action` 不是 `accept` 时，response draft 应把该信号显式暴露给最终模型，避免把不充分证据包装成确定答案。
- evidence packing 的压缩顺序应先做 extractive 截断和去重，再做 section / citation 级裁剪；不要在没有保留证据原文的前提下直接摘要化。

### 3.6) RAG and LLM Wiki Join Strategy
- `rag-first` 适合“怎么做/为什么这样设计/原理是什么”类问题。
- `wiki-first` 适合“最新是什么/当前谁负责/价格是多少/版本到哪”类问题。
- 当 `wiki-first` 没有主源命中时，系统应显式记录 fallback，而不是无声切回 RAG。
- 当 query 同时包含稳定背景和当前状态时，系统可采用“wiki 主答 + RAG 补背景”或“RAG 主答 + wiki 补现状”的混合引用策略。
- 当前第一版仍以 `rag-first / wiki-first / fallback` 骨架为主，而不是完整的主路径 + 补路径联合规划器；这属于后续可增强项，而不是本轮文档应隐藏的实现现状。

### 4) LLM Wiki
- 以结构化实体页为主，支持增量编辑、版本追踪、过期标记。
- 对外表现为“可问答的活知识库”，对内保留证据链。
- 对外接口需支持写入、更新、过期、查询与历史回看，便于动态资料快速变更。
- wiki 的 source of truth 默认应为本地结构化 durable store；当前推荐使用 `SQLite` 承载 `entries / history / proposals`，以便兼顾单机可移植性、版本治理和 rollback。
- `Redis` 更适合作为 wiki 的可选热缓存，而不是唯一主存。即使启用 Redis，也应保留 `SQLite` 作为可审计的主事实源。
- `Wiki` inspector 与 `/api/wiki` 调试接口不应只返回 `entries / proposals / history`；还应同时暴露 `provider_strategy` 与面向排障的 `runtime_summary`，至少覆盖 provider、durable store 计数/更新时间，以及 cache backend / ttl 摘要。
- wiki freshness / fallback 评测不应长期停留在独立脚本层；推荐像 memory harness 一样接入平台统一 harness runtime、store、API 与控制台回看入口。
- 当平台存在默认 wiki suite 时，Harness 控制台应支持受控触发，并与 `task / memory` 共用同一个 run registry、artifact viewer 与 type filter。
- 当平台已经拥有真实 `trace bundle` 时，也应支持导出 trace-derived wiki harness draft，用于把真实 `wiki-first / fallback / freshness guard` 轨迹反哺成待人工复核的 wiki case 草稿。
- trace-derived wiki draft 只能作为 case authoring 加速器，不能直接冒充 validated wiki gold；系统必须显式保留 `review_required` 与 `draft_origin` 标记。
- 第一版 wiki draft authoring 可先停留在 `trace -> draft preview / download / local artifact save` 这一层，优先验证真实任务到评测草稿的抽取质量，再决定是否像 memory 一样继续扩 candidate suite reviewer workflow。
- 下一步更轻量的 authoring 落地应优先补 `wiki draft -> wiki candidate suite -> suite rerun` 这条闭环，而不是一开始就复制 memory 的完整 reviewer / gold promotion 治理流。
- wiki candidate suite 第一版可先只承担“候选样本沉淀 + 控制台回看 + 基于 suite 的回归运行”三件事，等真实样本积累起来后，再决定是否补齐更重的 reviewer workflow。
- 在补 reviewer workflow 时，也应继续保持轻量化：先支持 `approved / needs_revision / rejected`、单 case / batch review 和 suite governance summary，让 reviewer 能筛样、标样、分层，而不是立刻引入 wiki gold promotion。
- 即使保持轻量 reviewer workflow，wiki candidate compare 也应尽量和 memory candidate compare 共享 reviewer 视角：至少具备 `reviewer summary`、`reviewer gaps`、`selected compare case` 与 suite-level mismatch cards，避免 reviewer 在两套 authoring 流之间来回切换时重新适应不同的控制台语义。
- wiki 与 memory 的治理节奏可以不同：memory 已经需要 gold 对齐与 rollback，而 wiki 当前更适合先把“真实轨迹 -> candidate suite -> review queue”做厚，再决定是否建立正式 gold。

### 4.1) Markdown Notes Ingest
- LLM wiki 不应只依赖手写 JSON 或表单录入；第一版需要支持把 markdown 笔记作为动态结构化知识的导入入口。
- markdown ingest 是 wiki 的 entry path，而不是绕过治理的后门。导入后仍需进入既有的 `proposal / review / history / rollback` 治理链。
- 第一版采用轻量规则式解析：优先读取 frontmatter，再从 `Summary / Facts / Tags / Required Context / Retrieval Hints` 等 section 中补齐字段，不强依赖完整 markdown AST。
- 当 markdown 缺少 frontmatter 时，系统应退回到 heading、首段摘要和 bullet 提取，尽量生成保守但可用的 wiki payload。
- ingest 产物必须显式带上 knowledge contract 字段：`required_context`、`retrieval_hints`、`owner`、`ttl_seconds`、`source_of_truth`、`version/base_version`，避免导入后又变回无治理的自由文本。
- 服务端应同时支持 `inline markdown` 和 `file_path` 两种输入源，便于后续接用户自己的 markdown 笔记目录。
- 当知识源已经以 markdown 目录形式组织时，服务端还应支持目录级 batch import，批量枚举 `.md` 文件并逐条进入现有 wiki 导入治理链。
- 控制台第一版至少提供 markdown textarea 与 `Import Markdown` 入口，默认导入到 `proposal`，降低误写正式 wiki 的风险。
- 每次导入都应写入审计事件，例如 `wiki.markdown_imported`，并保留 `imported_from / file_path / source_trace_id` 等 provenance，便于 freshness 排障和回滚定位。
- wiki-first smoke 不应只依赖预置内存条目；更好的做法是让 smoke 在运行时先导入一份 markdown note，再验证 `wiki-first` 路由、dynamic hit 和 citation，从而证明“真实 authoring 入口 -> 动态检索”链路已经打通。
- notes audit 不应只停留在 `wiki / rag / review` 三分类结果；对于被判为 `rag` 或 `review` 的长文，系统还应支持导出 `candidate card drafts`，从原文中抽取若干动态事实卡草稿，供人工继续收紧成正式 wiki entry。
- candidate card draft 是 audit authoring 的辅助产物，而不是直接写入正式 wiki 的旁路。它至少应保留 `source_file_path`、`draft_reason`、`summary`、`facts`、`required_context`、`retrieval_hints` 和 `source_of_truth`，并显式标记 `review_required=true`。
- candidate card draft 的目标不是把长文“自动变成正确 wiki”，而是降低从长篇研究笔记中人工提炼动态状态卡的成本，特别适合 project 状态页、外部项目状态页和运行状态页这类半结构化来源。

### 5) RL / Harness
- 先做离线 harness：任务成功率、引用准确率、工具合规率、回退率。
- RL 只允许在门禁通过后启用。
- 奖励信号必须可解释，避免把“看起来像对”当成正确。

### 6) Message Adapter Layer
- 所有外部平台消息先归一化为统一消息模型。
- 适配器负责处理平台差异：文本、按钮、附件、提及、引用、线程、回执。
- 出站消息根据平台能力降级或转换，避免上层逻辑依赖某一平台的特性。

### 6.1) Canonical Message Contract
- 消息模型需包含消息 ID、来源平台、会话键、线程键、发送者、接收者、时间戳、正文、附件、引用、意图标签、风险标记和审计标识。
- 统一消息模型是所有平台适配、检索、审计和回放的唯一入口。
- 平台专有字段只能以扩展元数据形式保留，不能污染核心业务逻辑。

### 6.2) Streaming and SSE
- 前端控制台与部分外部平台通道应支持流式输出。
- SSE 作为默认的浏览器流式传输方式，用于展示 token、段落、步骤状态、工具进度和最终结果。
- 流式事件应区分：开始、增量、工具调用、状态变更、错误、完成、取消。
- 对不支持流式的外部平台，适配器可以聚合后一次性发送，但内部仍保留流式轨迹。
- 流式输出必须支持中断、取消和最终落盘，避免前端和后端状态不一致。

### 6.3) Stream Event Schema
- 每个流式事件至少包含 `event_id`、`event_type`、`seq`、`trace_id`、`task_id`、`timestamp` 和 `payload`。
- `delta` 只负责增量正文，不负责状态切换。
- `status` 负责步骤状态，如 `planning`、`retrieving`、`tool_running`、`waiting_approval`。
- `tool_call` 和 `tool_result` 必须能映射到审计链。
- `done`、`error`、`cancel` 视为终止事件，必须可重放。

### 7) Frontend Console
- 前端以任务为中心，不以聊天流为中心。
- 核心视图包括：任务队列、计划树、步骤轨迹、记忆浏览器、检索调试器、平台适配器状态、评测面板。
- 评测面板应包含统一 Harness 视图，用于查看 `task` / `memory` harness run、过滤类型、选择 run 并回看 artifact。
- 对于具备默认 preset 的评测链路，控制台可提供一键触发入口，优先服务 smoke / baseline 级运维回归，而不是暴露全量自由参数表单。
- 前端只消费平台的 canonical API，不直接绑定内部实现。

### 8) Event and Storage Boundaries
- 长耗时步骤、文档入库、记忆写回、消息发送、评测任务都通过事件驱动解耦。
- 任务状态、事件日志、文档索引、向量索引、wiki 状态、审计日志应分域存储。
- 任务状态存储只保留最新执行快照和 checkpoint 序列，对前端和恢复逻辑暴露稳定查询接口。
- 所有关键对象保留版本与来源，便于回放和追踪。
- 流式输出的增量事件应进入事件日志和审计链，供回放和前端重连。

### 9) Audit and Provenance
- 每次请求都应分配全局 trace id，并贯穿平台入口、规划、执行、检索、工具、消息回传。
- 审计记录至少包含：输入消息、规范化结果、模型版本、提示词版本、上下文片段、检索证据、工具参数摘要、输出结果、回执状态。
- 审计与业务状态分离存储，保证回放与合规检查不依赖热路径数据结构。
- 轨迹采集层应能够把任务状态、审计日志、流式事件、记忆、评测结果和复核结果拼装成可回放的 trace bundle。
- 离线评测 harness 应复用同一套 trace bundle 采集逻辑，确保批量评测与单任务回放看到的证据一致。
- trace bundle 应额外暴露 query frontend 指标：`query_mode`、`intent_tags`、`boundary_action`、`clarification_required`、`subquery_count`。
- 检索质量摘要应额外暴露 knowledge contract 覆盖度，避免只看 citation / recall 而忽略知识治理质量。
- 对经过 benchmark、quality report、smoke 或线上 KPI 验证的关键技术迭代，应同步沉淀双层证据：结构化 iteration log 与可复述 journal。
- 结构化层用于脚本聚合、回归比对和持续维护；可复述层用于复盘、排障和对外表达。

### 10) Model Output Quality Evaluation
- 质量评估覆盖事实性、引用一致性、任务完成度、格式合规性、安全性和可执行性。
- 评估应同时支持离线基准集、线上抽样评估和人工复核闭环。
- 对低置信度或高风险输出可触发降级、重试、补检索或人工审核。
- 质量评估函数应由 Python 核心实现，以便与离线 harness、RL 预留接口共享同一实现。
- 对 RAG / wiki 混合问答，生成评测至少要区分三类行为：`answer`、`clarify`、`abstain`。
- baseline judge 即使还不是最终 LLM-as-a-judge，也要先把行为对齐纳入口径；否则 query frontend 的 clarify / abstain 能力无法形成真正可回归闭环。

### 11) Tool and Plugin Registry
- 所有工具与插件必须登记能力声明、输入输出契约、所需权限、超时、重试、幂等性和风险等级。
- 编排层只依赖统一工具契约，不直接依赖具体实现细节。
- 插件支持版本化发布和灰度启停，便于回滚与兼容性控制。
- toolset catalog 应由 Python core 输出，并至少覆盖 `toolset_id`、权限范围、能力标签、发布通道、副作用边界和启停状态；Node 不维护第二份默认目录。
- persona catalog 与工具目录接口应共享同一份 toolset catalog：`/api/personas` 返回 `packs + personas + toolsets`，`/api/tools` 返回 `registered tools + toolsets`，便于控制台和审计面板对齐运行时口径。

### 11.1) Tool Invocation Contract
- 工具调用必须显式声明入参、出参、幂等性、可重试性、副作用范围、超时和回滚语义。
- 工具执行结果必须返回结构化状态、错误码、可审计摘要和必要证据。
- 编排层应能够根据契约自动判断是否需要人工审批、重试或降级。

### 11.2) Tool Execution Policy
- tool registry 不只负责查找 handler，还负责执行策略：超时、重试、幂等缓存、风险分级默认值。
- 低风险且幂等的读取型工具允许自动重试，用于吸收瞬时错误和短时超时。
- 高风险或非幂等工具默认不自动重试，避免重复副作用；如需重试，必须显式声明策略。
- 相同的幂等调用应支持结果复用或并发合流，减少重复工具开销。
- 工具执行策略产出的尝试次数、重试次数、超时参数和风险等级应进入指标与轨迹，便于评测和回放。
- 在真正触发 handler 之前，registry 还应执行目录级 preflight gate：阻断 `enabled=false` 的工具、阻断不在 `allowed_release_channels` 内的工具、阻断缺失 `required_capabilities` 的工具。
- 权限范围、副作用允许性和 disallow/allow list 判定继续由 Python core 给出结构化结论；Node registry 只执行该结论并补充 tool-definition 级 preflight gate，不在本地复制一套人格推理逻辑。
- `tool_result` 事件应保留最小治理可观测字段，如 `tool_name`、`status`、`summary` 和 `error_code`；trace bundle 还应聚合 blocked-tool 统计，至少包括数量、错误码分布和被阻断工具名列表。
- `/api/governance` 不应只返回原始 alert 列表，还应给出结构化的 tool governance 摘要：当前 persona/toolset 上下文、运行时 blocked-tool 概况、restricted sandbox allowlist/scope 摘要（含 path 与 network egress，host 规则支持 suffix/pattern 解释，provider-host 可做联合绑定）、基于 active access policy 的 catalog projection，以及 registry 风险面分布（disabled/beta/high-risk/capability histogram）。
- restricted execution 的 network egress 应明确按三层收紧：环境级 sandbox policy 先定义上界，persona/toolset 的 `tool_access_policy.egress_allowlist` 再做运行时动态切片，最后与工具 `execution_constraints.egress_allowlist` 求交；治理侧需要能同时解释 effective allowlist 与 dynamic slice。
- 控制台 `Gov` inspector 应优先消费这份结构化治理快照，而不是在前端重新推导“哪些工具理论上可用、哪些是目录风险、哪些是运行时真正被阻断”。

### 12) Security and Secrets
- 密钥按 workspace、service、tool 作用域隔离，不允许在日志和模型上下文中明文泄漏。
- 模型密钥优先放入本地 `config/model-config.local.json`，再按需回退到环境变量；仓库仅提交 example 文件。
- 高风险工具执行应运行在受限环境中，并保留审计记录。
- 输入输出在进入模型和日志前应做脱敏与策略检查。

### 13) Model Routing and Cost Control
- 路由器根据任务类型、时效要求、上下文长度、结构化约束和成本预算选择模型。
- 对关键链路支持主模型、备用模型和规则降级路径。
- 平台按任务、租户和流程阶段记录 token 与费用消耗。

### 14) Human-in-the-Loop
- 对高风险动作、低置信度结果和质量门禁失败结果，系统可请求人工审批、补充信息或直接接管。
- 人工决策应写回轨迹，成为后续评测和策略优化的数据来源。
- 前端需提供审批队列、差异预览和恢复执行入口。

### 15) Knowledge Lifecycle
- 文档、记忆和 wiki 条目都应具备创建时间、更新时间、过期时间、版本号和删除状态。
- 对高变更资料，优先采用短 TTL、增量刷新和来源回验。
- 支持手动回滚、软删除和按策略归档。

### 16) SLO, Capacity, and Budget
- 为在线请求、异步任务、检索链路和消息投递分别定义延迟、成功率和积压目标。
- 为模型调用、存储、检索和第三方平台调用建立预算和告警。
- 当预算或容量接近阈值时，平台应优先降级非关键能力。

### 17) Deployment and Recovery
- 服务需支持多环境部署、配置隔离和可重复发布。
- 长任务和关键状态必须可持久化，以支持 worker 重启后的恢复执行。
- worker 应支持有限次自动重试，并在重试耗尽后把失败上下文连同 job 元数据一起转入 dead-letter，而不是只留下一个丢失上下文的最终异常。
- dead-letter 记录应保留 replay 所需的原始 worker 输入，并支持沿同一条 worker queue 主链重放，避免旁路执行和上下文丢失。
- 对 task 级 dead-letter，平台应优先复用最近可恢复检查点（`message_snapshot + plan + run_state`）继续执行，而不是一律从头重跑。
- 平台应支持任务重放、死信队列处理和灾难恢复演练。

### 18) OpenClaw-inspired Operational Patterns
- 单 agent / 多 agent 运行模式应支持隔离工作区、独立状态目录和独立路由绑定。
- 运行时应支持可编辑的 bootstrapping 入口，例如 persona、identity、tool notes 和 first-run 初始化。
- 前端控制台应能直接查看会话、配置和路由状态，减少“黑盒式”调试成本。
- 角色绑定与渠道绑定应可配置，以便不同外部平台或业务线路映射到不同 persona 和策略。

## 推荐实现
初版建议采用图状态编排式框架作为底座，便于表达计划、分支、回退、持久化状态与异步工作流。

## 推荐落地顺序
1. 先定契约：消息、流、工具、人格、路由
2. 再做在线链路：单入口、SSE、控制台、Plan-to-Act
3. 然后补检索和记忆：hybrid RAG、长期记忆、LLM wiki
4. 再补扩展编排：多 agent、context budget、压缩与恢复
5. 然后做治理链路：审计、质量评测、审批、预算
6. 最后补弹性能力：多平台、多人格、灾备和 RL
