# Framework Next Steps

## 使用方式
- 这份文档是平台化 backlog，不替代 OpenSpec。
- 每个条目在真正开发前，都应先映射到现有 `openspec` 变更包，必要时再拆成新的 change 或 superpowers plan。
- 如果要开始下一段开发，优先参考 `docs/development-playbook.md` 里的推荐顺序，再回到这里挑选具体切片。

## 当前推荐顺序
1. 查询前置层：intent taxonomy、decomposition、clarification、boundary。
2. 知识契约：RAG / wiki / citation 的 required context、owner、TTL、source-of-truth。
3. 评测结构扩容：harder negative / near-neighbor retrieval case、top-distractor taxonomy 扩容、confusable negative mining、行为感知 generation judge。
4. 可观测性：trace bundle、线上抽样、freshness / fallback / behavior 指标。
5. 然后再继续 Python packaging、队列扩展和 RL 联动。

## 已挂出的实施计划
- `docs/superpowers/plans/2026-05-12-python-core-packaging-bootstrap.md`
- `docs/superpowers/plans/2026-05-12-event-queue-persistence-worker-scaling.md`

## P0
- 已完成：更完整的模型路由策略，按任务、预算、上下文和风险做更细分的模型选择。
- 已完成：可配置的 provider/fallback 列表，已支持 provider 目录、fallbackChain 和 local fallback。
- 已完成：浏览器控制台的模型/投递可视化增强，支持筛选、排序、回执明细。

## P1
- hybrid RAG 的召回质量评估与引用评分：已补基础 `Hit@K / MRR / low-signal evidence`、section-level gold、`snippet-level gold v1/v2`、snippet-grounded support compaction、summary-preferred support collapse、query frontend review、hard-negative collision scaffold、top-distractor taxonomy 与 confusable negative mining。`2026-05-14` 那轮 high-fidelity taxonomy/minging 已经把词面噪声压回 `review_surface_noise`，没有误把 RoNLI 这类跨主题近邻直接并进回归集，这给后续 harder suite 的 authoring 提供了比较干净的入口。
- `2026-05-18` 的 harder near-neighbor 工作已经从单一 `EM Eye <-> Eye of Sauron` pair 扩成一套 `8-case` multi-domain suite：高保真结果是 `top1_accuracy = 0.875 / hard_negative_top1_collision_rate = 0.125 / hard_negative_top5_collision_rate = 1.0 / hard_negative_outranked_expected_rate = 0.125`。新增的 quantization、deepfake text detection、hardware-security GNN 和 creator safety 四组 pair 都已经形成稳定 rank-2 pressure，整套 suite 也已经包含 1 条真实 top1 collision。所以下一步更值得做的是二选一：继续从剩余 `17` 条 `adopt_rank_pressure` suggestion 里再挑 `2-4` 个主题族补 harder suite，或者直接围绕这套 8-case 集合做 rerank / taxonomy / query frontend 定向调优。
- 已完成：LLM wiki 的编辑审核、冲突合并和历史回滚，后端 proposal/review/history/rollback 与专门管理界面已补。
- 已完成：LLM wiki 的 markdown notes 导入链路，支持 frontmatter/heading fallback、`proposal/upsert` 双模式、控制台导入和审计落盘。
- 已完成：LLM wiki 的 markdown 目录批量导入、可复用 notes 目录约定，以及 freshness/fallback/route consistency 的基础评测 harness；当前 stale wiki 已会触发 `supplement_rag`，不会再因为 route 命中就误判为 `accept`。
- 已完成：多平台消息模板与富媒体适配，支持 web / slack / telegram 的差异化渲染和富媒体降级。
- 已完成：基于真实 markdown 目录审计结果，整理出 `data/wiki/notes/project/` card 化样本集，并已接上 wiki live smoke、project eval case、stale-refresh pair 与 source-of-truth conflict 治理回归。
- 已完成：基于外部 `TriGMA` 项目文档抽取 `data/wiki/notes/trigma/` 动态状态卡，并通过 notes audit、wiki eval 与 live smoke 验证“外部项目动态事实 -> 薄 wiki 层 -> wiki-first 路由”这条链路。
- 已完成：RAG + LLM wiki + memory 联合评测 baseline 已补，默认 `knowledge` suite 现已覆盖 generation 11 case、wiki 14 case 和 memory 4 case，总计 29 case，并通过统一 summary / review 输出 `joint_route_match_rate`、`joint_expected_outcome_rate`、`expected_pass_success_rate` 与 `expected_non_pass_guardrail_rate`；其中 generation 侧已补 `source-of-truth conflict -> abstain/supplement` guardrail case，当前更需要继续补更强的线上注入样本与 harder near-neighbor retrieval case。
- 已完成：task-scoped `Knowledge` 总览已补，后端 `/api/knowledge` 会把 query frontend、hybrid retrieval、wiki lookup、memory recall、response grounding 和 trace metrics 聚成同一份快照，控制台 Inspector 也能按阶段回看这条知识链。

## P2
- 已完成：事件队列持久化基础、共享队列状态、worker 重启恢复、队列 inspection / requeue hooks、`retry -> dead-letter` 的失败链保真、dead-letter replay 回到 worker queue 主链，以及 task 级 dead-letter 从最近检查点恢复。
- 已完成：控制台 `Queue` inspector 已补，支持按 task / trace / worker / status 查看 worker queue 快照、回看单个 job 详情、直接执行 stale requeue，并联动查看该 job 关联的 dead-letter / recovery / governance 风险上下文。
- 已完成：轨迹导出、bundle 回放、审计快照下载。
- 已完成：人工审批的差异预览和一键接管流程。

## P3
- 插件/工具市场与版本灰度。
- 更强的受限执行沙箱和权限边界：当前已补 `execution_constraints(network/filesystem/shell/path_allowlist/egress_allowlist)`、workspace path allowlist、provider-specific egress policy、suffix/pattern 级 host 规则、provider-host 联合绑定、persona/toolset 动态 egress slice 与 task-level sandbox report；后续可继续补跨任务 egress analytics 与更显式的 network intent contract。
- RL 离线评测集、奖励模型、在线门禁联动。

## P4
- 多 Agent 进一步分工：planner / retriever / writer / reviewer / operator。
- persona pack 化：支持角色模板、边界模板、默认工具集模板。
- 跨 workspace 的知识迁移与隔离策略。
