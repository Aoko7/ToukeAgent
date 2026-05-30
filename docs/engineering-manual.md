# ToukeAgent Engineering Manual

## 这份手册的用途
这是给开发、改造和交接使用的工程手册，不是需求文档。

- OpenSpec 说明做什么、为什么做、怎么验收
- Superpowers 说明怎么拆任务、怎么执行
- 这份手册说明代码该放哪、怎么跑、怎么扩、怎么守住边界

## 推荐阅读顺序
1. `openspec/changes/add-plantoact-hybrid-memory-agent/proposal.md`
2. `openspec/changes/add-plantoact-hybrid-memory-agent/design.md`
3. `openspec/changes/add-plantoact-hybrid-memory-agent/contracts.md`
4. `openspec/changes/add-plantoact-hybrid-memory-agent/tasks.md`
5. `docs/development-playbook.md`
6. `docs/framework-next-steps.md`
7. `AGENTS.md`
8. `docs/rag-evaluation-playbook.md`
9. `docs/memory-evaluation-playbook.md`
10. `docs/wiki-evaluation-playbook.md`
11. `docs/iteration-tracking.md`
12. `docs/iteration-journal.md`
13. `openspec/changes/add-langgraph-orchestrator-mvp/README.md`

## 仓库分层

### Python Core
目录：`toukeagent_core/`

包装与启动：
- 项目元数据在仓库根目录 `pyproject.toml`
- 直接入口保留 `python3 -m toukeagent_core`
- 安装后脚本入口保留 `toukeagent-core`

职责：
- `Plan-to-Act` 规划
- `micro-ReAct` 步骤准备
- 模型路由
- hybrid retrieval 路由
- retrieval result 的 response grounding / evidence packing
- embedding 策略选择与 query / chunk 同空间约束
- persona 解析与角色包选择
- persona pack catalog 与 specialist profile 建议
- multi-agent specialist 建议
- multi-agent join strategy 与 next-action 协调判断
- approval preview / approval review / quality review payload 生成
- context budget / compression 决策
- memory provider 选择、回退和能力归一化
- 长期记忆召回排序与 durable write 判定
- persona 级 tool access policy 归一化与工具访问判定
- toolset catalog 与 release-channel / capability gate 规则
- handoff aggregate / fallback 策略判断
- 响应草稿生成
- 输出质量评估
- quality gate 决策
- governance / budget / alert 策略判断
- tool policy
- runtime policy

规则：
- 影响“agent 如何思考、如何路由、如何评估”的改动优先放这里
- Python 只返回结构化 JSON，不直接处理前端渲染或浏览器逻辑
- 新能力要先接入 `toukeagent_core/cli.py`，保证 CLI 和 Node bridge 都能调用
- MVP 阶段的 embedding 基线为单一多语种模型：默认 `multilingual-e5-base`，资源紧张时回退到 `multilingual-e5-small`
- 如无单独 spec 和评测支撑，不在 MVP 中引入按语言拆分的多 embedding 空间
- 审批、复核、handoff 汇合这类治理决策 payload，也归 Python core，不再散落在 Node 业务逻辑里
- 人格列表、pack 元数据和 specialist 建议也视为核心目录数据，不在前端或 Node 中手写第二份
- 多 Agent 的 join strategy、协作模式和 next action 也归 Python core 统一判断
- response draft 不只负责“写一句回复”，还负责把 retrieval result 压成 budget-aware evidence pack，避免 Node / provider 层再各自实现一套 prompt 拼接逻辑
- memory provider runtime 由 Python core 决定 `requested_provider / effective_provider / fallback_reason`，Node 只负责根据该决策挂接 durable backend、暴露 API，并把结果写入 audit / trace
- memory recall ranking 与 durable write decision 也应优先放在 Python core；Node memory store 只保留作用域过滤、持久化和 API 包装，避免 heuristic 多处分叉
- tool access policy 也应由 Python core 统一输出与判定；Node tool registry 只负责执行前阻断、错误封装和审计回写，避免在多处复制人格权限逻辑
- toolset catalog 视为 persona catalog 的一部分，由 Python core 统一输出；Node 侧不得手写第二份 `analysis/review/operations` 默认目录
- persona 默认 toolset 投影（例如 `analysis_toolset`）也由 Python core 统一解析，Node 侧只消费投影结果，不自行补默认值
- retrieval parent ordering 需要尊重 route family（`rag-first` / `wiki-first`），clarification heuristics 也要按 token 级别匹配，避免 substring 撞词造成假阳性
- restricted execution environment 负责运行时沙箱边界：approval、network、filesystem 和 shell 约束在这里真正生效，而不是只停留在 tool access policy 的目录判断
- restricted execution 的 blocked egress 观测要保留 requested_hosts / requested_providers / requested_urls，方便 governance 解释具体是哪个目标被挡住

### Node Shell
目录：`apps/platform/`

职责：
- HTTP API
- SSE / 流式事件
- 前端控制台
- 平台消息适配与投递
- 持久化 job queue、worker lease 和恢复控制
- provider gateway
- 工具执行外壳
- 事件总线、存储、审计回写
- review / task / audit 的落库、checkpoint 和恢复动作
- persona catalog API 暴露与控制台人格切换渲染
- tool directory API 暴露与工具治理面板渲染
- multi-agent inspector API 暴露与协调视图渲染

规则：
- 影响“系统如何接入、展示、投递、持久化”的改动优先放这里
- Node 负责边界和编排，不复制 Python core 的推理逻辑
- Node 的 tool registry 可以执行 Python 返回的 tool access decision，但不应自己再维护第二套 persona 权限矩阵
- Node 的 tool registry 还负责在执行前强制检查 `definition.enabled`、`release_channel` 和 `capabilities`；这类 gate 属于目录/声明层，不属于新的推理逻辑

### Contracts
目录：`packages/contracts/src/`

职责：
- `canonical-message`
- `stream-event`
- `persona-profile`
- `route-binding`
- `tool-invocation`
- `agent-plan`
- `agent-run-state`
- `agent-handoff-packet`
- `context-compression-snapshot`
- `platform-delivery`

规则：
- 跨层对象先改契约，再改实现，再补测试
- 契约变更必须同步回写 OpenSpec 的 `contracts.md`

### Documents
目录：`docs/` 与 `openspec/`

职责：
- `openspec/`：范围、架构、验收
- `docs/development-playbook.md`：开发入口
- `docs/rag-evaluation-playbook.md`：RAG 分层评测与优化手册
- `docs/memory-evaluation-playbook.md`：memory provider 与记忆质量评测手册
- `docs/wiki-evaluation-playbook.md`：LLM wiki 的 freshness / fallback / route consistency 评测手册
- `docs/iteration-tracking.md`：技术迭代记录规范
- `docs/iteration-journal.md`：面试 / 复盘友好的迭代台账
- `docs/framework-next-steps.md`：平台化 backlog
- `docs/superpowers/plans/`：逐步实施计划

当前 harness 约定：
- task / trace 型评测走 `evaluation-harness.mjs`
- memory 质量评测走 `memory-harness.mjs`
- wiki freshness / fallback / route consistency 评测走 `wiki-harness.mjs`
- generation + wiki + memory 的联合 baseline 走 `toukeagent_core/knowledge_eval.py` + `scripts/evaluate_knowledge_quality.py` + `knowledge-harness.mjs`
- 四者统一落到 `harnessStore`，并通过 `/api/harness/runs` 查询
- `harness_type` 当前至少区分 `task`、`memory`、`wiki` 与 `knowledge`
- 前端控制台提供统一 `Harness` tab，可按 `harness_type` 过滤 run，并查看 summary、cases 与 artifact 明细
- 控制台当前也支持一键触发默认 knowledge suite，并优先显示 `artifacts.review_markdown`
- 控制台当前支持一键触发默认 memory suite，并优先显示 `artifacts.review_markdown`
- 控制台当前也支持一键触发默认 wiki suite，并优先显示 `artifacts.review_markdown`
- 当 harness run 自带结构化 case 结果时，Harness 控制台现在优先展示 reviewer-friendly case 视图：run summary chips、case list、selected case reviewer card，以及 `query_frontend` 的 `query_mode / boundary / clarification / decomposition / rewrite / preferred_sources`
- generation / wiki / knowledge harness 的 `review.json` 现已附带 `query_frontend` 与 `reviewer_summary`，用于前端直接渲染 reviewer 视图，而不是再次从深层 retrieval JSON 里现推
- `review.md` 现在也从“指标流水账”升级为 reviewer 叙事结构，至少包含 `Reviewer Summary`，并在 generation / wiki / knowledge 中额外暴露 `Query Frontend Signals` 或 `Joint Reviewer Summary`
- 控制台当前还提供 `Memory` inspector 的专属解释层：优先展示 provider runtime、scope/stale health、handoff/compression 概况，以及最近一次 handoff / compression 的结构化详情，而不是只回退到原始 memory JSON
- 控制台当前还提供 `Tools` inspector，直接读取 `/api/tools` 并同时展示 `toolsets + registered tools`，用于核对 persona 目录、发布通道和能力标签
- 控制台现在还提供 `Gov` inspector，直接读取 `/api/governance` 并展示当前 task 的 tool governance 摘要：active toolset、runtime blocked-tool、access-policy projection、restricted sandbox 摘要（含 path / egress allowlist / dynamic egress slice / provider-host bindings），以及 registry 风险面统计
- 平台还支持按 `task_id` 导出 trace-derived memory harness draft，供后续把真实任务沉淀成 memory benchmark case；该导出默认视为 `review_required`
- draft authoring 当前在控制台内支持 case list 预览、结构化 selected case detail、整份 draft 下载，以及把选中 case 保存到 `data/evals/memory/drafts/...` 的本地 artifact 流程，便于把 trace-derived case 草稿转入人工复核流程
- 当 trace-derived case 完成初步复核后，控制台还支持把选中 case promote 到 `data/evals/memory/candidate_suites/...`，作为候选 benchmark suite 的增量，而不是直接改写正式 gold
- Harness 控制台现在还能列出 memory candidate suites、查看 suite 明细，并直接基于选中的 suite 触发 memory harness，用于 candidate authoring 与回归联动
- candidate suite 当前还支持 case 级 review 与 promote-to-gold 门禁：控制台可对选中 case 写入 `approved / rejected / needs_revision` 状态，且只有 `approved` case 才能并入正式 memory gold
- reviewer workflow 第一版建议在控制台显式填写 `decision / reviewer / notes`，这样后续回看 candidate case 时，不会只看到一个状态值，却不知道为什么被挡在 gold 外面
- 当前控制台还补了三类 authoring 治理工具：selected case compare、selected suite compare、gold rollback；它们分别服务单 case tightening、批量回看与 promote 后回退
- gold promotion 当前会把历史写到独立 history 文件，便于后续按 case 回看 promote / rollback 轨迹，而不是只看 gold 当前快照
- compare 现在已经升级为 field-level 视角，至少会把 `reference / observed / metadata` 拆成 diff rows，减少 reviewer 直接读整块 JSON 的负担
- candidate suite 当前还支持多选 case 做 batch review / batch compare，适合处理一组需要相同 tightening 口径的样本
- compare 视图现已进一步升级为 reviewer-friendly visual compare：会优先显示 checklist fail、field diff summary 与 mismatch card，而不只是通用 diff table
- memory compare 与 wiki compare 现在都继续细化成三层 reviewer 视图：`reviewer summary`、`reviewer gaps`、`selected compare case`，让 reviewer 先判断“这轮 compare 有哪些核心 drift”，再决定是否下钻 raw diff
- gold rollback 现已支持 batch mode，可对一组 selected case 做逐条恢复，并返回成功/失败摘要
- candidate suite detail 现已补 suite governance summary，可直接查看 approved / needs_revision / rejected / pending / promoted 分布
- 控制台现已支持 `Load Gold History`，并以 audit 视图展示 promote / rollback 事件，方便回看近期治理动作
- LLM wiki 现在支持 markdown notes 导入链路：服务端可从 inline markdown 或 `file_path` 构建 wiki payload，并按 `proposal` 或 `upsert` 进入既有 wiki 治理链
- 服务端现已额外支持 markdown 目录级 batch import，可用 `directory_path` 或 `file_paths[]` 批量导入 `.md` 笔记，适合后续接你自己的 markdown 笔记目录
- markdown ingest 解析逻辑位于 `apps/platform/src/wiki-markdown-ingest.mjs`，当前优先读取 frontmatter，并从 `Summary / Facts / Tags / Required Context / Retrieval Hints` section 做保守补齐
- 控制台 `Wiki` 面板已补 `Import Markdown` 按钮与 textarea，默认以 `proposal` 模式导入，适合先把本地 markdown 笔记转成待审 wiki 草稿
- 每次 markdown 导入都会写 `wiki.markdown_imported` 审计事件，并记录 `imported_from / file_path / source_trace_id`，便于后续 freshness 排障、回滚和面试复盘
- `scripts/wiki_first_smoke.py` 现在推荐作为动态知识链路 smoke：它会先写入临时 markdown note，再通过 wiki 导入接口进料，最后验证请求确实命中 `wiki-first`
- `scripts/wiki_first_smoke.py` 现在也支持 `--notes-dir`，可直接导入一个真实 markdown 笔记目录后再做 live 验证
- 真实目录审计后，我们已经在 `data/wiki/notes/project/` 落了一组 card 化的项目状态样本；它们来自本地私有研究笔记，但被改写成了更适合动态治理的状态页，而不是把研究长文直接塞进 wiki
- 这组 `project/` 样本现在已经进一步从 candidate draft authoring 收紧成了 `8/8 wiki-ready` 的正式状态样本集，说明 `audit -> candidate drafts -> formal cards` 这条治理链在仓库内已经闭环
- 我们也已经在 `data/wiki/notes/trigma/` 落了一组来自外部 `TriGMA` 项目文档的状态卡；这证明 LLM wiki 可以消费外部项目的“当前主线/当前排行/当前配置”类动态事实，但仍应保持薄层，不直接吞并完整实验文档目录
- wiki 评测当前已经有独立脚本 `scripts/evaluate_wiki_quality.py`，用于离线检查 freshness / fallback / route consistency，并把产物落到 `data/evals/wiki/*`
- wiki 评测现在也已经接入平台主链：`wiki-harness.mjs -> harnessStore -> /api/harness/runs -> Harness 控制台`
- 平台还支持按 `task_id` 导出 trace-derived wiki harness draft，供后续把真实 `wiki-first / freshness / fallback` 任务沉淀成 wiki benchmark 草稿；这类导出默认也视为 `review_required`
- 第一版 wiki draft authoring 当前支持控制台内 case 预览、整份 draft 下载，以及把选中 case 保存到 `data/evals/wiki/drafts/...` 的本地 artifact 流程，便于把真实任务中的动态检索轨迹沉淀成后续评测样本
- wiki draft authoring 现在还支持把选中 case promote 到 `data/evals/wiki/candidate_suites/...`，作为待复核的 wiki candidate suite，而不是直接修改正式 wiki gold
- Harness 控制台现在还能列出 wiki candidate suites、查看 suite 明细，并直接基于选中的 suite 触发 wiki harness，用于 `draft -> candidate suite -> rerun` 的轻量 authoring 闭环
- wiki candidate suite 当前还支持轻量 reviewer workflow：新 promote 的 case 默认标记为 `pending_review`；控制台可对单条或多条 case 写入 `approved / needs_revision / rejected`，并在 suite list / detail / review 返回中直接查看 `governance_summary`
- wiki candidate compare 当前也已补 reviewer-first 视图：除了 checklist 与 field diff 外，会优先展示 reviewer summary、reviewer gaps，以及单 case 的 expected-vs-observed route / action / citation 对照，避免 reviewer 在两套 compare 体验之间切换语义
- wiki 上线前的操作检查统一收敛到 `docs/wiki-evaluation-playbook.md`：先走 `Governance Checklist`，再走 `Smoke Checklist`，不要只凭单条 query 成功就放行
- 真实 markdown 笔记目录在正式导入前，建议先跑 `scripts/wiki_notes_audit.mjs` 做预览审计；它会输出 `recommended_target`、`recommended_workflow`、`risk_flags` 和 `readiness_score`，避免把长篇研究笔记或草稿直接混进动态 wiki
- `wiki_notes_audit` 现在还支持为 `rag / review` 长文输出 `candidate_card_drafts/`，用于把大笔记里更像动态状态页的 section 先半自动抽出来；这些草稿默认 `review_required=true`，不能直接当正式 wiki 使用
- 当前我们已经对本地私有研究笔记目录做过一次真实目录审计，结果显示大多数笔记更适合进入 RAG 或先做 card 化清洗，而不是直接作为 LLM wiki 实体页。私有原始目录默认不属于公开仓库，只公开收紧后的 `data/wiki/notes/` 样例卡片。
- Python core 的 wiki retrieval quality 现在已经把 `stale_refresh_pair` 和 `source_of_truth_conflict` 纳入治理口径：有更新快照时允许接受，但若同一实体存在动态主事实冲突，会直接降级成 `supplement_rag`

## 技术迭代证据

所有“会影响我们如何回答效果好不好”的改动，都必须留下两层记录：

1. 结构化层：`data/iteration_logs/*.json`
2. 可复述层：`docs/iteration-journal.md`

至少在下面几类情况下更新：

- chunking / retrieval / rerank / query rewrite / filter 变更
- LLM wiki / memory / compression / model routing 变更
- quality gate / judge / approval policy 变更
- 新 benchmark、新 quality report、新 smoke、新线上 KPI 结果

更新要求：

- 写清楚 `problem`、`changes`、`metrics_before`、`metrics_after`、`delta`、`evidence`
- 没有证据时只能标记为 `attempted`
- 面试和对外复盘优先使用 `validated` 条目

## 当前这一轮优先补齐的五块

1. 查询前置层
   - Python core 负责 `query_mode / intent_tags / decomposition / rewrite / clarification / boundary`
   - 目标是把“先搜还是先问、拆几条再搜、该不该拒答”变成显式系统能力
   - 如果 query 明确表达“只看某范围”，这层还必须显式产出 `explicit_scope_required`，让 retrieval filter 从软偏置升级到硬限制
   - 当前 decomposition 已覆盖 comparison / procedure 两类高价值场景；rewrite 也会把 intent focus 和 scope hints 折叠进 query variants，而不只是重复原 query

2. 知识契约
   - RAG candidate、wiki entry、citation 统一补 `required_context / retrieval_hints / owner / ttl / source_of_truth / version`
   - 目标是让 freshness 治理、人工维护、trace 回放和面试复盘都有抓手

3. 评测结构扩容
   - retrieval 继续往 harder negative 和 trace-aware review 扩
   - generation 继续往 `answer / clarify / abstain` 三类行为评估扩

4. 生成层 judge 做厚
   - baseline judge 先覆盖 behavior alignment，再逐步升级到更可信的 judge
   - 不把 behavior 闭环补齐，query frontend 的 clarify / abstain 就无法回归

5. 可观测性
   - trace bundle 至少要能看到 `query_mode / boundary_action / clarification_required / subquery_count / rewrite_count / filter_policy_mode / contract_coverage_score`
   - 这些指标既服务线上排障，也服务技术迭代台账

## 运行链路
一次典型请求的主路径是：

1. 外部平台消息进入 Node
2. Node 归一化成 canonical message
3. Node 通过 `apps/platform/src/python-core-bridge.mjs` 调用 Python core
4. Python 生成 plan、路由检索、准备 step、persona pack / specialist catalog、审批/复核 payload、handoff 聚合与 coordination strategy、响应草稿和输出评估
   - 其中响应草稿阶段需要消费 retrieval result 的 route / quality / citations / supporting evidence，并按 response policy 压成 compact evidence pack
   - tool step 准备阶段还会把 persona 的 `tool_access_policy` 编入结构化 tool request，供 Node registry 在执行前做统一阻断
   - persona catalog 里的 `toolsets` 也由 Python core 一并输出，供 `/api/personas` 和 `/api/tools` 共享
5. Node 执行工具、发 SSE、写审计、更新 review/task/wiki store，并做消息投递
   - tool registry 会先做 `enabled / release_channel / capabilities` gate，再决定是否触发具体 handler
   - 若工具被阻断，`tool_result` 事件会保留 `tool_name / error_code`，trace bundle 也会汇总 blocked-tool 指标，便于平台调试
   - `/api/governance` 还会进一步把这些运行时阻断，与当前 persona/toolset、runtime access policy、sandbox allowlist / scope 和 registry 风险面整合成一份结构化治理摘要，便于判断“这是当前 trace 的真实阻断”还是“目录本身就有 rollout 风险”
6. 前端控制台读取任务、流式事件、评测和复核信息

## 编排迁移约束

如果我们继续把主链路收敛成显式状态图，需要遵守下面几条：

- 图编排优先落 Python core，不向 Node 壳渗透推理逻辑
- 第一次迁移先覆盖知识主链路，不直接重写完整 `runAgentTask`
- `legacy | langgraph_mvp` 双路径必须长期并存到回归稳定为止
- 即便环境中暂时没有安装真实 `langgraph`，图状态、节点契约和兼容执行器也要先落地

## Retrieval Filter Policy

当前 RAG 默认管线是 `semantic + BM25 + metadata filter`，但 metadata filter 不能再只作为隐式实现细节。

图编排与 retrieval runtime 应统一采用双模式：

- `soft_prefer`
  - 默认模式
  - metadata 只作为排序/重排偏好，不先剔除不匹配候选
- `hard_enforce`
  - 用户显式限定范围、治理规则要求、或高噪声 fallback 场景下启用
  - 先按 metadata 收窄候选，再继续 hybrid retrieval

若 `hard_enforce` 后没有候选：
- 必须保留 `hard_filter_empty` 语义
- `hard_enforce_reason` 要区分 `explicit_filters` 与 `user_explicit`
- `hard_filter_empty_reason` 要区分 `scope_candidate_empty` 与 `retrieval_hit_empty`
- `retrieval_plan.filter_plan.mode` 继续表示规划态 `hard_enforce`
- 若在同一路由内恢复成功，结果中的 `filter_policy.mode` 要降为 `soft_prefer`
- 同时显式标记 `recovered_soft_prefer=true`
- 这种 metadata filter 恢复不等于 source fallback，不要把 `route.fallback_applied` 一起打成 `true`
- 然后回退到 `soft_prefer`、clarification、review 或 abstain
- 不能静默吞掉这一层行为差异

## 目录速查

### 核心入口
- `apps/platform/server.mjs`：平台服务总入口
- `apps/platform/public/index.html`：控制台页面
- `apps/platform/public/app.mjs`：控制台前端逻辑
- `apps/platform/src/python-core-bridge.mjs`：Node -> Python bridge
- `toukeagent_core/cli.py`：Python core CLI 分发入口

### 常改目录
- `apps/platform/src/`：Node 外壳、store、service、runtime
- `apps/platform/src/job-queue-store.mjs`：持久化 worker queue、lease 管理与失败 job requeue
- `apps/platform/src/dead-letter-store.mjs`：dead-letter 生命周期、replay/resolve 元数据
- `toukeagent_core/`：Python core 能力
- `packages/contracts/src/`：共享契约
- `tests/`：Node 测试与回归

## 启动与验证

### 本地开发
```bash
npm run dev
```

### 跑全量测试
```bash
npm test
```

## 检索基线

当前开发默认值：

- vector backend：`Qdrant`
- primary embedding：`intfloat/multilingual-e5-base`
- fallback embedding：`intfloat/multilingual-e5-small`
- upgrade path：`BAAI/bge-m3`

本地模型目录约定：

- Python core 会优先尝试加载仓库内的 `data/models/embeddings/`
- 当前默认本地目录：
  - `data/models/embeddings/multilingual-e5-base`
  - `data/models/embeddings/multilingual-e5-small`
  - `data/models/embeddings/bge-m3`
- 若目录不存在，再回退到 Hugging Face 模型名解析
- 这些模型文件不进入 git

约束：

- 同一 collection 内默认保持单一 embedding 空间
- query embedding 与 chunk embedding 必须来自同一模型空间
- 如果未来拆成多 collection / 多模型，必须同步补 query routing、结果融合和回归评测

### 跑契约测试
```bash
npm run test:contracts
```

### 跑服务测试
```bash
npm run test:server
```

### 直接调 Python core
```bash
python3 -m toukeagent_core --action create_plan --payload '{}'
```

### 批量构建论文索引
```bash
python3 scripts/build_paper_index.py \
  --chunk-path /tmp/toukeagent-full-chunks/acl-2024-offset0-limit20/chunks/acl-2024-offset0-limit20.rag_chunks.jsonl \
  --chunk-path /tmp/toukeagent-full-chunks/ndss-2024/chunks/ndss-2024.rag_chunks.jsonl \
  --qdrant-path data/qdrant/papers \
  --collection-name toukeagent-papers
```

说明：
- 默认优先使用仓库内本地 embedding 模型目录
- 默认写入本地 `Qdrant` collection
- 输出会给出 `files / records / points / documents` 摘要，便于确认索引规模

### Node bridge 对 Python 的默认约定
- 默认使用 `python3`
- 可通过 `TOUKEAGENT_PYTHON` 覆盖
- bridge 会自动把仓库根目录加入 `PYTHONPATH`

## 配置

### 模型配置
```bash
cp config/model-config.example.json config/model-config.local.json
```

优先填这些字段：
- `deepseek.apiKey`
- `routing.provider`
- `routing.primaryModel`
- `routing.fallbackChain`

规则：
- 密钥不进仓库
- 本地配置优先
- 环境变量只做兼容回退

### Memory 配置与观测

优先关注这些字段：
- `memory.provider`
- `memory.fallbackChain`
- `memory.filePath`
- `memory.providers.<provider>.enabled / available`

运行时排查时优先看：
- `/api/health` 中的 `memory_provider`
- `/api/memory` 中的 `provider_strategy`
- `/api/memory` 中的 `memory.runtime_summary`
- `/api/memory` 中的 `memory.linked_artifacts`
- trace bundle metrics 中的 `memory_requested_provider / memory_effective_provider / memory_fallback_applied / memory_fallback_reason`

当前 memory policy 落点：
- Python core `rank_memory_recall`：统一输出长期记忆召回排序，至少包含 lexical / semantic / importance / freshness / stale penalty 信号
- Python core `judge_durable_memory_write`：统一输出 durable write 判定，至少区分稳定偏好与一次性提醒
- Node `memory-store.mjs`：负责作用域过滤、expired/stale 过滤、调用 Python policy、持久化长期记忆和暴露 `/api/memory`

约定：
- `provider` 在运行时视图里表示实际生效的 provider
- 如果请求的是 `mem0_compatible`，但 durable backend 未初始化、被禁用或被标记 unavailable，系统必须显式回退到 `local_builtin`
- 这种回退不能是静默行为，必须能在 API、task metadata 与 trace 中看到

## 开发落点

### 新增 Python core action
通常要改：
- `toukeagent_core/<module>.py`
- `toukeagent_core/cli.py`
- `apps/platform/src/<wrapper>.mjs`
- `tests/python-core-bridge.test.mjs`

### 新增 Node 平台能力
通常要改：
- `apps/platform/server.mjs`
- `apps/platform/src/*.mjs`
- `apps/platform/public/*`
- 对应 `tests/*.test.mjs`

### 新增契约对象
通常要改：
- `packages/contracts/src/*.mjs`
- `openspec/changes/add-plantoact-hybrid-memory-agent/contracts.md`
- `tests/contracts.test.mjs`

### 新增平台适配
通常要改：
- `apps/platform/src/platform-adapter-registry.mjs`
- `apps/platform/src/delivery-service.mjs`
- `apps/platform/src/outbound-message-templates.mjs`
- `tests/platform-delivery.test.mjs`

### 新增队列持久化或 worker 控制
通常要改：
- `apps/platform/src/job-queue-store.mjs`
- `apps/platform/src/async-worker.mjs`
- `apps/platform/server.mjs`
- `tests/job-queue-store.test.mjs`
- `tests/async-worker.test.mjs`
- `tests/server.test.mjs`

当前 queue/worker 主链额外约定：
- `job-queue-store` 负责保留 attempts、last_error、requeue_reason
- `async-worker` 负责 `retry_limit` 与最终失败回调
- `server` 负责把最终失败补记成 task-scoped dead-letter、保留 `worker_input`，通过 `/api/dead-letters/replay` 将 worker replay 接回主链，并通过 `/api/tasks/recover` 将 task dead-letter 接回最近检查点

### 新增评测或门禁
通常要改：
- `toukeagent_core/evaluator.py`
- `apps/platform/src/output-evaluator.mjs`
- `apps/platform/src/quality-gate.mjs`
- `tests/output-evaluator.test.mjs`
- `tests/quality-gate.test.mjs`

## 语言边界

### 默认边界
- Python：推理、路由、评估、策略
- JavaScript / Node：SSE、前端、接入、适配、投递、持久化壳层

### 什么时候可以加第三种语言
只在下面场景考虑：
- 有明确的性能热点
- 有明确的协议或运行时约束
- 有明确的独立部署收益

### 加第三种语言前必须满足
- 通过稳定边界集成，优先是 subprocess、HTTP、队列或文件协议
- 不共享进程内可变状态
- 先更新 OpenSpec
- 先更新这份工程手册
- 先写 `docs/superpowers/plans/*.md`
- 必须写清楚为什么不是 Python 或 Node

## 当前推荐顺序
如果目标是把系统做厚、做稳、做成平台，继续按这个顺序推进：

1. Python core packaging 与 bootstrap
2. 事件队列持久化与 worker 横向扩展
3. 审批差异预览与一键接管
4. 多 Agent specialist 细化与 persona pack
5. RL gate 与插件市场

## 完成定义
任何切片在宣布完成前至少确认：

- 契约没有被打破
- 主要测试已经执行
- OpenSpec 和代码仍一致
- 语言边界没有被偷偷打穿
- 改动能落到某个 OpenSpec change 或 superpowers plan 上
