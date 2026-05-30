# Tasks

## Phase 0: Contract First
1. 定义 agent 状态模型、计划模型与 step 结果模型。（已完成）
2. 定义统一消息模型与平台适配器接口。（已完成）
3. 定义人格/角色模型、切换规则和默认行为边界。（已完成）
4. 定义流式输出事件模型与 SSE 传输规范。（已完成）
5. 定义工具与插件注册表、能力声明和权限模型。（已完成）
6. 定义工具调用契约、输入输出 schema 和副作用描述。（已完成）
7. 定义 trace id、审计日志结构与证据链记录规范。（已完成）
8. 定义模型路由策略、备用模型和成本统计接口。（已完成）

## Phase 1: MVP Online Loop
9. 实现前端控制台的基础视图、任务追踪入口、角色切换入口和流式渲染。（已完成）
10. 实现顶层 plan 生成与 step 调度。（已完成）
11. 实现 step 内 micro-ReAct 执行循环。（已完成）
12. 接入事件总线与异步 worker。（已完成）
13. 拆分任务状态、事件日志、文档、向量、wiki 与审计存储。（已完成）
14. 实现跨平台请求到响应的端到端日志追溯。（已完成）

## Phase 2: Knowledge and Retrieval
15. 接入短期记忆与长期记忆接口。（已完成）
16. 实现 hybrid RAG 路由、检索、重排与引用输出。（已完成）
17. 实现 LLM wiki 的写入、更新、过期与查询接口。（已完成）
18. 定义知识条目的 TTL、版本、软删除和归档策略。（已完成）

## Phase 3: Governance and Safety
19. 实现模型输出质量评测管线与评分维度。（已完成）
20. 接入线上抽样评估、人工复核和质量门禁。（已完成）
21. 实现评测 harness 与轨迹采集。（已完成）
22. 为工具执行补齐超时、重试、幂等和风险等级策略。（已完成）
23. 实现密钥管理、脱敏策略与受限执行环境接口，并支持本地 model-config 文件优先、env 兼容回退。（已完成）
24. 实现人工审批、人工接管和恢复执行流。（已完成）
25. 定义在线与异步链路的 SLO、预算与告警阈值。（已完成）

## Phase 4: Resilience and Optimization
26. 实现任务恢复、死信处理、重放与灾备演练接口。（已完成）
26.1. 为 worker queue 补有限次自动重试、失败后 dead-letter 上下文保留，以及避免重复 task dead-letter 的主链处理。（已完成）
26.2. 将 worker dead-letter replay 正式接回 queue 主链，保留 `worker_input`、`replay_id / replay_job_id / replay_error` 元数据，并暴露 replay API。（已完成）
26.3. 将 task 级 dead-letter recovery 接回最近可恢复检查点，支持基于 `message_snapshot + plan + run_state` 的恢复执行，并复用 `/api/tasks/recover` 主链。（已完成）
27. 为 RL 预留 reward、policy log 与安全门禁接口。（已完成）

## Phase 4.5: Scale-Out Orchestration
28. 定义多 Agent 的 coordinator / specialist 角色、handoff packet、隔离和汇合策略。（已完成）
29. 实现多 Agent 委派、结果汇总、失败回退与审计链。（已完成）
30. 定义上下文预算、压缩快照、恢复与跨 Agent 传递契约。（已完成）
31. 实现 context budget manager、分层裁剪、压缩摘要与基于快照的恢复。（已完成）
32. 实现多平台消息模板与富媒体适配。（已完成）

## Phase 5: Python Core Split
33. 实现 `toukeagent_core` Python 核心包与 JSON CLI bridge。（已完成）
34. 将 planner、hybrid retrieval router、response draft 和 output evaluator 改为通过 Python bridge 执行。（已完成）
35. 补齐 Node 外壳的桥接异常处理、审计记录与流式错误回传。（已完成）
36. 增加 Python 核心与 Node bridge 的回归测试。（已完成）
37. 更新 README 与开发说明，明确 Node 外壳 / Python 核心分层。（已完成）

## Phase 5.5: Retrieval Evidence Precision
38. 为 retrieval gold 增加 snippet-level selector 与 span-oriented 指标输出。（已完成）
39. 补齐 snippet-level gold 基线配置与 benchmark 回归测试。（已完成）
40. 运行 snippet-level retrieval benchmark，并将结果同步到迭代台账。（已完成）
41. 将 snippet gold 收紧为 harder-anchor v2，并校准 span match 指标含义。（已完成）
42. 实现 snippet-grounded support compaction / rerank，并降低冗余 background evidence 对 citation precision 的污染。（已完成）
43. 实现 summary-preferred support collapse，针对 summary-heavy case 进一步压缩为单条高质量引用片段。（已完成）

## Phase 5.6: Query Frontend and Production RAG Hardening
44. 在 Python retrieval core 中补齐查询前置层：query mode、intent tags、query decomposition、rewrite scaffold、clarification 和 boundary policy。（已完成）
45. 为 RAG candidate / wiki entry / retrieval citation 补齐知识契约字段：required context、retrieval hints、owner、TTL、source of truth、version。（已完成）
46. 扩 generation judge，新增行为对齐口径，统一评估 answer / clarify / abstain 三类输出。（已完成）
47. 扩 trace bundle 与检索质量摘要，补 query frontend、contract coverage 和 clarification 级指标。（已完成）
48. 将这五块的实现边界、契约和推荐推进顺序同步回写到 OpenSpec 与工程手册。（已完成）
48.1. 为 retrieval result 增加 response grounding policy，明确 route / citations / supporting evidence 如何受控注入 response draft。（已完成）
48.2. 将 response draft 从标题级上下文升级为 compact evidence pack，并补 clarification-first 与 evidence budget 的回归测试。（已完成）

## Phase 5.7: Memory Provider and Harness
49. 定义 memory provider abstraction：provider 目录、fallback chain、能力声明、隔离范围和写入 / 读取策略。（已完成）
50. 将 memory provider 的归一化与决策下沉到 Python core，并预留 `local_builtin` / `mem0_compatible` 两类 provider。（已完成）
51. 实现 memory harness v1，覆盖 durable write、memory recall、compression fidelity 和 handoff sufficiency。（已完成）
52. 补 memory benchmark case、review artifact 和 memory evaluation playbook，形成和 RAG 对齐的评测产物层。（已完成）
53. 将 memory harness 的核心指标和关键迭代同步到结构化台账与工程手册。（已完成）
53.1. 将长期记忆召回排序与 durable write 判定迁到 Python core policy，并补 stale-aware / temporary-reminder 回归测试。（已完成）
53.2. 将 memory harness 接入平台 `harnessStore` 与 `/api/harness/runs` 主链，支持统一查询、过滤和 artifact 回看。（已完成）
53.3. 在前端控制台 Inspector 中新增统一 `Harness` 视图，支持 `task` / `memory` run 的过滤、选择与 artifact 回看。（已完成）
53.4. 在前端控制台支持触发默认 memory harness suite，并优先展示 `review_markdown` artifact，降低评测回看门槛。（已完成）
53.5. 基于真实 `task trace` 导出 memory harness draft case，覆盖 durable write、recall、compression 和 handoff 的草稿生成链路。（已完成）
53.6. 将 trace-derived memory draft 从 raw JSON 提升为前端可点击的 case 预览，并支持直接下载当前 draft。（已完成）
53.7. 为 trace-derived memory draft 增加结构化 case detail 与本地 draft artifact 保存链路，便于把选中 case 沉淀到可复跑的 benchmark-ready 文件。（已完成）
53.8. 为 trace-derived memory draft 增加 promote 到 candidate benchmark suite 的链路，支持将复核后的 case 并入候选评测集而不直接污染正式 gold。（已完成）
53.9. 将 memory candidate suite 接入 Harness 控制台，支持列表查看、suite detail 回看与基于 suite 的 memory harness 运行。（已完成）
53.10. 为 memory candidate suite 增加 review 状态与 promote-to-gold 门禁，要求仅已审批 case 才能并入正式 gold，并将该链路接入控制台与服务端回归。（已完成）
53.11. 补齐 memory candidate reviewer workflow，支持 `approved / needs_revision / rejected`、reviewer / notes 录入，以及非 approved case 的 gold promote 拒绝回归。（已完成）
53.12. 为 memory candidate authoring 增加 candidate-vs-gold diff/checklist、gold promotion history 与 rollback 能力，并接入控制台与服务端回归。（已完成）
53.13. 将 memory candidate compare 升级为 field-level diff，并补 batch review / batch compare 的控制台与服务端回归能力。（已完成）
53.14. 将 memory candidate compare 升级为 reviewer-friendly visual compare，并补 batch gold rollback 的控制台与服务端回归能力。（已完成）
53.15. 为 memory candidate authoring 增加 suite governance summary 与 gold history audit 视图，补齐控制台回看能力与静态回归。（已完成）
53.16. 将 memory candidate compare 继续细化为 reviewer summary / reviewer gaps / selected compare case 三层 reviewer 视图，统一单 case 与 suite compare 的控制台体验。（已完成）
54. 为 LLM wiki 增加 markdown notes 导入链路，支持从 markdown 构建 wiki proposal / upsert，并接入控制台与服务端回归。（已完成）
54.1. 为 LLM wiki 增加 markdown 目录级批量导入与 wiki-first smoke 自进料能力，验证真实 markdown 笔记可驱动动态检索路径。（已完成）
54.2. 对你自己的 markdown 笔记目录做导入前审计，区分 wiki-ready、RAG-ready 与 manual-cleanup 候选，并沉淀可复用的 notes audit 流程。（已完成）
54.3. 基于真实目录审计结果，整理一批 card 化 / frontmatter 化的 wiki-ready 样本集，并接入 wiki live smoke / eval。（已完成）
54.4. 扩真实 stale-refresh pair、source-of-truth 冲突与实体冲突 case，形成更接近生产的 wiki 评测集。（已完成）
54.5. 为 notes audit 增加 candidate card draft 导出能力，让 `rag/review` 长文在审计后能产出待人工收紧的 wiki 卡片草稿。（已完成）
54.6. 从高价值 candidate card drafts 中人工收紧一批正式 wiki cards，并将它们接入 project 样本审计、离线评测与迭代台账。（已完成）
54.7. 将 wiki freshness / fallback 离线评测接入平台 `harnessStore`、`/api/harness/runs` 与 Harness 控制台，形成 `task / memory / wiki` 统一回看入口。（已完成）
54.8. 基于真实 `task trace` 导出 wiki harness draft case，支持在 Harness 控制台查看、下载与保存 trace-derived wiki case 草稿，形成 `trace -> wiki draft artifact` 的 authoring 起点。（已完成）
54.9. 将 trace-derived wiki draft promote 到 candidate suite，并在 Harness 控制台支持 wiki candidate suite 列表查看、suite detail 回看与基于 suite 的 wiki harness 运行。（已完成）
54.10. 为 wiki candidate suite 增加轻量 reviewer workflow，支持 `approved / needs_revision / rejected`、单 case / batch review 与 suite governance summary，先补治理闭环而不直接引入 wiki gold promotion。（已完成）
54.11. 为 wiki candidate compare 增加 reviewer summary / reviewer gaps / selected compare case 三层 reviewer 视图，并补单 case 与 suite compare 的控制台静态回归。（已完成）
54.12. 将 wiki 运行态主存切换为本地 SQLite durable store，并预留 Redis 可选热缓存层；保证 `entries / history / proposals` 重启后可恢复。（已完成）
54.13. 为 short-term memory 增加 markdown session archive，形成 `in-memory heat layer + markdown recovery log` 的本地短期记忆持久化方案。（已完成）

## Phase 5.8: Persona Tool Governance Hardening
55. 将 persona toolset catalog、registry `enabled/release_channel/capabilities` gate 与 `/api/tools` 目录接口接入统一治理链。（已完成）
55.1. 为 `/api/memory` 与控制台 `Memory` inspector 增加 runtime summary / linked artifacts 解释层，统一暴露 provider mode、fallback、stale 概况、handoff/compression 计数与最新关联产物。（已完成）
55.2. 为工具定义补 `execution_constraints` 契约，并让 restricted execution environment 在运行时阻断越界的 network/filesystem/shell 能力，同时避免对这类 policy block 继续自动重试。（已完成）
55.3. 将 restricted execution 从 scope 级边界补到 workspace path allowlist，并把 sandbox block 聚合进 trace bundle、`/api/governance` 与控制台 `Gov` inspector，统一暴露 blocked reason / allowed paths / sandbox runtime 摘要。（已完成）
55.4. 为 restricted execution 增加 provider-specific egress allowlist，支持按 host/provider 阻断越界网络目标，并将 egress block 与 allowlist 摘要接入 trace bundle、`/api/governance` 与控制台 `Gov` inspector。（已完成）
55.5. 将 restricted execution 的 host egress 规则从精确匹配补到 suffix/pattern 级交集判定，支持 `*.domain` / URL host 提取，并保持 sandbox block 的非重试语义与治理可解释性。（已完成）
55.6. 为 restricted execution 增加 `provider_host_bindings` 联合策略，支持按“provider 仅允许命中特定 host 规则”的方式收紧 egress 边界，并将该组合策略摘要接入 governance 与控制台。（已完成）
55.7. 将 persona/toolset 的 `tool_access_policy.egress_allowlist` 接入运行时动态网络切片，使 restricted execution 按“环境策略 -> persona/toolset slice -> tool constraints”三级交集收紧 egress，并在 governance / 控制台中显式暴露 dynamic slice 摘要。（已完成）

## Phase 5.9: Knowledge Chain Overview
56. 实现 task-scoped knowledge snapshot API，聚合 query frontend、hybrid retrieval、wiki lookup、memory recall、response grounding 与 trace metrics。（已完成）
57. 在前端控制台新增 `Knowledge` inspector，支持按阶段回看统一知识链路。（已完成）

## Phase 5.10: Worker Queue Overview
58. 在前端控制台新增 `Queue` inspector，支持按 task / trace / worker / status 过滤 worker queue 快照，并展示 queued / running / completed / failed / stale 与选中 job 详情。（已完成）
59. 为 `Queue` inspector 增加 stale requeue 控制与任务上下文默认过滤，便于直接在控制台执行队列恢复动作。（已完成）
59.1. 为 worker queue job 聚合 dead-letter / recovery drill / alert 关联摘要，让队列快照直接暴露风险与恢复上下文。（已完成）
59.2. 在前端控制台为 `Queue` inspector 增加跳转 `Dead Letters` / `Recovery` / `Governance` 的联动动作，补齐风险闭环回看路径。（已完成）

## Phase 5.11: Unified Knowledge Harness
60. 将 generation / wiki / memory 三套评测统一到 Python core 的 knowledge judge，并输出联合 summary / review。（已完成）
61. 在 Node 外壳接入 `knowledge` harness、`/api/harness/runs` 分支和 Harness 控制台入口。（已完成）
62. 补齐 unified knowledge harness 的回归测试、文档说明和迭代台账记录。（已完成）
