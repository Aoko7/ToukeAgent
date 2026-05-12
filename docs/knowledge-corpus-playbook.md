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
3. 为每个 chunk 记录 `conference_id`、`year`、`paper_title`、`section`、`source_manifest` 和 `local_pdf_path`。
4. RAG 检索默认使用 `semantic + BM25 + metadata filter`，wiki 查询默认使用结构化字段过滤。
5. 对摘要、作者、机构、方法名和指标抽取结果设置置信度，低置信度条目进入人工复核队列。

## 版权与使用边界
- 当前阶段按“本地索引、检索增强、摘要和引用”使用语料。
- 不默认把所有会议全文视为可自由再分发训练集。
- 在需要二次发布、打包共享或训练用途时，必须按具体会议或平台许可再次核查。
