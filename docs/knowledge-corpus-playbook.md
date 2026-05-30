# Knowledge Corpus Playbook

## 目标
- 为 ToukeAgent 建立可持续扩展的论文知识底座。
- 使用公开可获取的顶会论文作为稳定知识来源。
- 把论文原文检索与结构化事实抽取拆成两层，分别服务 RAG 与 LLM wiki。

## 当前收录会议白名单

### 网安
- `USENIX Security`
- `NDSS`
- `ACM CCS`
- `IEEE S&P`

### 人工智能
- `ICLR`
- `ICML`
- `NeurIPS`
- `ACL`
- `EMNLP`

### 系统与平台补强
- `MLSys`
- `OSDI`
- `NSDI`

## 语料切分原则

### 进入 RAG 的内容
- 论文标题、摘要、引言、方法、实验、讨论、附录正文
- 适合 chunk 化的稳定解释材料
- 面向“原理是什么”“方法怎么做”“为什么有效”的问题

### 进入 LLM wiki 的内容
- 论文卡片：标题、作者、机构、年份、会议、URL
- 方法卡片：方法名、核心机制、依赖、限制、代码地址
- 指标卡片：任务、数据集、分数、对比基线、SOTA 状态
- 安全卡片：攻击面、威胁模型、防御前提、适用边界

### 不直接进入长期知识库的内容
- 当前任务过程中的临时判断
- 低置信度抽取结果
- 未校验的外部转载材料

## 收集流程
1. 通过 `config/paper-source-catalog.json` 选定会议源。
2. 通过 `scripts/collect_papers.py` 按 provider 拉取元数据和开放获取链接。
3. 先写入 manifest，再按需下载 PDF。
4. 原始 PDF 存入 `data/papers/raw/`，不进入 git。
5. 后续再进入 chunk、抽取、wiki 实体化流程。
6. 当 generation、LLM wiki 与 memory 都已经有稳定 case 后，再用 `scripts/evaluate_knowledge_quality.py` 把三条链路放进同一轮联合评测，避免把“检索分数”“动态事实判断”和“记忆保真”拆成彼此无感的三份报表。
7. 当前官方 knowledge guardrail calibration 已落到 `data/evals/knowledge/2026-05-18-knowledge-guardrail-calibration/`，默认口径现阶段覆盖 generation、freshness、project、TriGMA 与 memory 四块，整体是 `suite_count=3`、`case_count=29`，并统一输出 `joint_route_match_rate`、`joint_expected_outcome_rate`、`expected_pass_success_rate` 与 `expected_non_pass_guardrail_rate`。

## 当前采集器分层

### `openalex`
- 适用于 `ICLR`、`ICML`、`NeurIPS` 等 OpenAlex 命中稳定的会议。
- 优点是字段统一、速度快、适合先批量产出 manifest。

### `usenix`
- 适用于 `USENIX Security`、`OSDI`、`NSDI`。
- 从官方 technical sessions 页面发现论文页，再解析 PDF 链接。

### `ndss`
- 适用于 `NDSS`。
- 从 accepted papers 页面发现论文页，再解析 `Paper` 下载链接。

### `acl_anthology`
- 适用于 `ACL`、`EMNLP`。
- 通过 ACL Anthology volume 页面发现论文页，再抽取标题、作者和 PDF 链接。
- 采集器会清理 Anthology 页面中的纠错表单样板文案，避免污染摘要字段。
- 采集器会排除 proceedings / volume 级别文档，优先保留单篇论文。

### 待补强
- `ACM CCS`
- `IEEE S&P`
- `MLSys`

这些会议当前仍可先走 `openalex` 探测，但如果要大规模稳定采集，建议后续补专用 provider。

## 默认策略
- 默认先抓近两年，验证数据链路和字段质量。
- 默认只收开放获取条目。
- 默认先写 manifest，避免一次性下载过大体量文件。
- 对大会议默认按 manifest 分批下载 PDF，而不是一次性全量拉取。
- 需要大规模补抓时再扩年份或关闭条目上限。

## 目录约定
- `config/paper-source-catalog.json`：会议白名单与主题过滤配置
- `data/papers/manifests/`：采集结果 manifest
- `data/papers/raw/`：PDF 原件
- `data/wiki/notes/`：准备进入 LLM wiki 的 markdown notes 目录
- `scripts/collect_papers.py`：采集脚本

## 推荐批量方式
1. 先跑 `metadata-only` 生成完整 manifest。
2. 再使用 `--manifest-path` 配合 `--offset` 和 `--limit` 分批下载 PDF。
3. 对 `USENIX Security`、`ACL`、`EMNLP` 这类页面型会议，优先使用分批下载，避免长任务中断后整轮重来。
4. 当使用 `--offset` 或 `--limit` 进行会议批次采集时，脚本会写入批次 manifest，不覆盖基础 manifest。

## 当前已验证语料快照

截至 2026-05-13，本地已验证的初始论文池包括：

- `USENIX Security 2024`：3 个批次 manifest，共 150 条，PDF 已落盘。
- `NDSS 2024`：基础 manifest 已生成，PDF 已落盘。
- `ACL 2024`：2 个批次 manifest，共 40 条，PDF 已落盘。
- `EMNLP 2024`：2 个批次 manifest，共 40 条，PDF 已落盘。
- `ICLR / ICML / NeurIPS`：已有少量 OpenAlex 探测样本，后续可按同一批次策略扩展。

当前验证命令：

```bash
node --test tests/paper-collection.test.mjs
git diff --check -- scripts/collect_papers.py tests/paper-collection.test.mjs docs/knowledge-corpus-playbook.md config/paper-source-catalog.json
```

当前质量检查：

- `ACL / EMNLP` 批次 manifest 中不得出现 Anthology 纠错表单文案。
- 批次 manifest 行数应与对应 `records` 统计一致。
- PDF 原件只放在 `data/papers/raw/`，不进入 git。

## 下一步接入 RAG / LLM Wiki

1. 将 manifest 归一化为论文卡片，进入 LLM wiki 的结构化实体层。
2. 将 PDF 解析为正文段落，进入 hybrid RAG 的 chunk 层。
3. 为每个 chunk 记录 `conference_id`、`year`、`paper_title`、`section`、`source_manifest`、`local_pdf_path`、`language`、`embedding_model` 和 `embedding_dim`。
4. RAG 检索默认使用 `semantic + BM25 + metadata filter`，wiki 查询默认使用结构化字段过滤。
5. 对摘要、作者、机构、方法名和指标抽取结果设置置信度，低置信度条目进入人工复核队列。
6. 论文切块优先保留章节层级，并尽量合并或抑制图表坐标、数字刻度、邮箱行和其他低信号短碎片，避免污染检索结果。
7. 评测层同时维护 `rag-first`、`wiki-first` 和 `wiki-first -> rag fallback` 的 generation case，确保结构化检索与论文检索走的是同一条可回归闭环。

## 批量索引当前语料

当 chunk 文件已经生成后，可直接批量写入本地向量索引：

```bash
python3 scripts/build_paper_index.py \
  --chunk-path /tmp/toukeagent-full-chunks/acl-2024-offset0-limit20/chunks/acl-2024-offset0-limit20.rag_chunks.jsonl \
  --chunk-path /tmp/toukeagent-full-chunks/ndss-2024/chunks/ndss-2024.rag_chunks.jsonl \
  --qdrant-path data/qdrant/papers \
  --collection-name toukeagent-papers
```

如果后续所有 chunk 正式回收到仓库内 `data/papers/chunks/`，则可以直接对 chunks 根目录跑 pattern 扫描。

当前本地 Python core 已经补到：

- chunk 级 `semantic + BM25` 双通道召回
- `conference_id / publication_year / doc_id` 等 metadata filter
- 父子聚合输出，便于返回 paper-level 结果与 supporting chunks

## 检查 chunk 与向量质量

在重建索引前后，可以先对 chunk 文件做一次质量体检：

```bash
python3 scripts/inspect_chunk_quality.py \
  --chunk-path /tmp/toukeagent-full-chunks/acl-2024-offset0-limit20/chunks/acl-2024-offset0-limit20.rag_chunks.jsonl
```

当前检查会输出：

- `embedding_models / embedding_dims / vector_backends` 分布
- 顶层字段与 metadata 字段缺失统计
- chunk 文本长度、每篇论文 chunk 数量分布
- 过短 chunk 与重复 chunk 示例
- 向量归一化统计，以及标题到 chunk 的近邻命中情况

如果要评估“检索质量是否真的提升”，不要只用标题或摘要前缀做查询。当前仓库已经提供了一个可追踪的人工查询集入口：

```bash
python3 scripts/benchmark_retrieval_quality.py \
  --manifest-path data/papers/manifests/acl-2024-offset0-limit20.jsonl \
  --manifest-path data/papers/manifests/emnlp-2024-offset0-limit20.jsonl \
  --manifest-path data/papers/manifests/ndss-2024.jsonl \
  --manifest-path data/papers/manifests/usenix_security-2024-offset0-limit50.jsonl \
  --query-case-path config/retrieval-benchmark-cases.json \
  --benchmark-name curated-retrieval \
  --top-k 3 \
  --index-batch-size 128
```

这条基准现在会：

- 读取人工整理的 user-like query case，而不是机械拼接标题摘要
- 将解析后的查询写入 `resolved-queries.json`，方便复现实验
- 对 baseline / cleaned 两套 chunk 索引同时输出 `Hit@1 / Hit@K / MRR / citation proxy`
- 额外输出 `mean_support_low_signal_ratio`，用于观察返回的 supporting chunks 里是否仍混入图表坐标、编码脏块、坐标轴标签等低信号片段
- 额外写出 `review.json` 和 `review.md`，把每条 query 的 top result、supporting chunks、section 标记和低信号判断单独落盘，方便人工复核

如果要进一步衡量“supporting chunks 到底有没有覆盖 gold 证据”，可以在同一条 benchmark 入口上追加 gold 标注：

```bash
python3 scripts/benchmark_retrieval_quality.py \
  --manifest-path data/papers/manifests/acl-2024-offset0-limit20.jsonl \
  --manifest-path data/papers/manifests/emnlp-2024-offset0-limit20.jsonl \
  --query-case-path config/retrieval-benchmark-cases.json \
  --gold-case-path config/retrieval-benchmark-gold-cases.json \
  --benchmark-name curated-gold \
  --top-k 3 \
  --index-batch-size 128
```

这时 summary 和 review artifact 会额外带出：

- `annotated_case_count`
- `mean_context_recall`
- `mean_context_precision`

它们适合用来回答“paper 命中了，但 supporting evidence 到底够不够完整”。
当前还额外导出了：

- `group_breakdowns.conference_id`
- `group_breakdowns.tags`

这样我们不仅能看整体均值，还能直接看某次 rebuild 是否只在 `ACL`、`EMNLP` 或某类 topic/tag 上退化。

当前已经补了一套与 ACL/EMNLP starter 语料对齐的 scaleout 查询集：

- [retrieval-benchmark-scaleout-cases.json](../config/retrieval-benchmark-scaleout-cases.json)

以及一套当前可复现的 starter gold：

- [retrieval-benchmark-gold-cases.json](../config/retrieval-benchmark-gold-cases.json)

需要说明的是，这套扩容 gold 目前偏 `section-aligned`。这是一个工程上有意识的折中：因为 starter 语料里部分 supporting chunk 的文本片段还不够稳定，先用章节对齐把 context coverage 的回归链路跑通，再继续升级到 snippet-level gold，会比一开始追求很细但不可复现的规则更稳。
另外，benchmark 后端也要分层理解：

- `--force-backend deterministic_hash`：只适合 smoke 或 fixture regression
- 本地 `sentence_transformers` 实际 embedding：才适合拿来做质量结论

当前对应的两套 scaleout artifact 分别是：

- `data/papers/benchmarks/2026-05-13-curated-gold-scaleout-v2/`：`hash_smoke_only`
- `data/papers/benchmarks/2026-05-13-curated-gold-scaleout-e5/`：`local_semantic_eval`

后续做面试材料或正式迭代台账时，应优先引用 `local_semantic_eval` 这套 artifact。

如果你已经有现成索引，不想在本地重复做两轮大规模 embedding / upsert，也可以直接复用已有索引路径与 manifest：

```bash
python3 scripts/benchmark_retrieval_quality.py \
  --manifest-path data/papers/manifests/acl-2024-offset0-limit20.jsonl \
  --manifest-path data/papers/manifests/emnlp-2024-offset0-limit20.jsonl \
  --query-case-path config/retrieval-benchmark-cases.json \
  --benchmark-name reuse-existing-indexes \
  --baseline-index-path data/papers/builds/2026-05-13-full-rebuild-v1/qdrant \
  --baseline-collection-name toukeagent-papers-clean-v1 \
  --baseline-index-manifest-path data/papers/builds/2026-05-13-full-rebuild-v1/index-manifest.json \
  --candidate-index-path data/papers/builds/2026-05-13-full-rebuild-v1/qdrant-batched-v2 \
  --candidate-collection-name toukeagent-papers-clean-v2 \
  --candidate-index-manifest-path data/papers/builds/2026-05-13-full-rebuild-v1/index-manifest-batched-v2.json
```

建议后续继续扩 query case，优先覆盖：

- 方法简称、缩写、同义表达
- “问题描述 -> 论文”类问法
- `NDSS / USENIX Security` 中容易被碎片 chunk 干扰的主题
- 带指标、图表、坐标轴、case-study 名称的 adversarial 问法，用来刻意打中 chart/table/glyph 噪声
- 对已经有 scaleout gold 的 ACL / EMNLP 主题，继续把 `section-aligned gold` 升级成 `snippet-level gold`

## RAG 评测建议口径

当前仓库建议把 RAG 评测拆成三层，不要只看单一分数：

### 1. 检索层
- `Hit@K`：该召回的 paper / chunk 有没有出现在前 K 个结果里
- `MRR`：正确结果排得够不够靠前
- `mean_support_low_signal_ratio`：supporting chunks 里混入图表块、轴标签块、乱码块的比例
- `Context Recall / Context Precision`：在有 gold 标注时，supporting chunks 对关键证据的覆盖度与纯度

其中：
- `Hit@K` 低，优先查 embedding、chunking、filter 和 query rewrite
- `MRR` 低但 `Hit@K` 还行，优先查 rerank 和融合策略
- `low_signal_ratio` 高，优先查 chunk 清洗和噪声抑制

### 2. 生成层
当前仓库已经接入一套 starter 级 generation harness，入口是：

```bash
python3 scripts/evaluate_generation_quality.py \
  --case-path config/generation-judge-cases.json \
  --output-root data/evals/generation \
  --benchmark-name starter-suite
```

当前 baseline 会输出：

- `Faithfulness`：答案是否真的来自引用内容
- `Answer Relevancy`：答案是否真的回答了用户问题
- `Context Recall`：检索上下文是否覆盖了解题所需信息
- `Context Precision`：提供给模型的上下文里噪音是否过多
- `Route Consistency`：实际走的 `rag-first / wiki-first / fallback` 是否符合预期
- `Citation Match Rate`：答案引用是否覆盖到预期证据

这套 harness 目前已经扩到 `8` 条 scaleout case，并把 `wiki-first` 和 `wiki-first -> rag fallback` 样例纳入同一回归集，但它仍是可回归的 baseline judge，不是最终的 `LLM-as-a-judge` 终态。

这层建议只对核心回归集或抽样集跑，不建议在大样本上无脑全量跑 judge 模型。

### 3. 线上层
离线指标只负责帮助定位问题，最终仍要看线上业务表现。推荐观测：

- `thumbs_down_rate`
- `followup_rate`
- `escalation_rate`
- `answer_empty_rate`
- `session_resolution_rate`

这几项要和离线 benchmark 定期交叉对照。离线变好、线上没变好，通常说明测试集分布不够贴近真实用户。

## 召回优化建议顺序

参考当前论文语料和我们这套实现，召回优化建议按下面顺序推进：

1. 先修 chunk 质量
   - 保证章节边界、去重、去低信号碎片
2. 再补混合检索
   - `semantic + BM25 + metadata filter`
3. 然后补 query rewrite / 多路召回
   - 扩写术语、同义表达、缩写
4. 最后补 rerank
   - 先看轻量 reranker，再评估 LLM judge / LLM rerank 的成本收益

顺序不要反过来。chunk 地基不稳时，后面再强的 rerank 也只是在脏候选里挑相对不那么脏的结果。

如果只想针对安全论文里的残余噪声做定向回归，可以使用：

```bash
python3 scripts/benchmark_retrieval_quality.py \
  --manifest-path data/papers/manifests/ndss-2024.jsonl \
  --manifest-path data/papers/manifests/usenix_security-2024-offset0-limit50.jsonl \
  --query-case-path config/retrieval-benchmark-cases-security-noise.json \
  --benchmark-name security-noise
```

这组 `security-noise` case 已经额外加入 chart-heavy / table-heavy / glyph-noise 定向 query，可用于观察 chunk 清洗是否真的改善 supporting evidence，而不只是 paper-level 命中率。

如果要对当前已下载 PDF 的 manifest 批量重切、批量体检，并顺手重建索引，可以直接运行：

```bash
python3 scripts/rebuild_paper_corpus.py \
  --build-name full-rebuild \
  --build-index \
  --collection-name toukeagent-papers
```

脚本会：

- 自动挑出当前真正具备本地 PDF 覆盖的 manifest
- 为每个 manifest 产出新的 `paper_cards / rag_documents / rag_chunks`
- 为每个 chunk 文件写一份质量报告
- 在 `data/papers/builds/<build-name>/rebuild-manifest.json` 中汇总整个构建批次
- 可选调用 `scripts/build_paper_index.py` 写入新的本地索引，并输出 `index-manifest.json`

还未补齐的重点是：

- 真实 embedding 依赖安装后的语义质量回归
- 稀疏召回调参与离线评测

## 当前 embedding 与向量索引基线

当前 MVP 默认选择：

- 向量库：`Qdrant`
- 默认 embedding：`intfloat/multilingual-e5-base`
- 低资源 fallback：`intfloat/multilingual-e5-small`
- 后续升级路线：`BAAI/bge-m3`
- 本地模型优先目录：`data/models/embeddings/`

这样定的原因：

- 当前本地开发环境以 CPU 为主，先用更轻的统一多语种模型更稳。
- 我们的语料同时包含中文工程文档和英文论文，需要尽量保持单一向量空间。
- 如果把中文和英文拆成不同 embedding 模型，query 也必须路由到同一模型空间，MVP 阶段会明显增加复杂度。
- 维度不同本身不是核心问题，真正的问题是把不同 embedding 空间的结果混成一套相似度排序。

因此第一版原则是：

1. chunk 和 query 默认使用同一 embedding 模型编码。
2. 同一索引内不混用不同 embedding 空间。
3. 若未来引入 `bge-m3` 或语言分库，需要单独做索引重建、query routing 和回归评测。

## 版权与使用边界
- 当前阶段按“本地索引、检索增强、摘要和引用”使用语料。
- 不默认把所有会议全文视为可自由再分发训练集。
- 在需要二次发布、打包共享或训练用途时，必须按具体会议或平台许可再次核查。
