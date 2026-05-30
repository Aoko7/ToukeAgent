import { basename, extname } from 'node:path';

function normalizeText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function uniqueStrings(values = []) {
  return Array.from(new Set(
    values
      .map((value) => normalizeText(value))
      .filter(Boolean),
  ));
}

function slugify(value) {
  const normalized = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'untitled';
}

function splitListValue(value) {
  if (Array.isArray(value)) {
    return uniqueStrings(value);
  }
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return [];
  }
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    return uniqueStrings(
      normalized
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^["']|["']$/g, '')),
    );
  }
  return uniqueStrings(normalized.split(/[,\n]/g));
}

function parseScalarValue(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }
  if (/^(true|false)$/i.test(normalized)) {
    return normalized.toLowerCase() === 'true';
  }
  if (/^-?\d+$/.test(normalized)) {
    return Number(normalized);
  }
  return normalized.replace(/^["']|["']$/g, '');
}

function parseFrontmatter(markdownText) {
  const text = String(markdownText ?? '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) {
    return {
      frontmatter: {},
      body: text,
    };
  }

  const endIndex = text.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    return {
      frontmatter: {},
      body: text,
    };
  }

  const rawFrontmatter = text.slice(4, endIndex);
  const body = text.slice(endIndex + 5);
  const lines = rawFrontmatter.split('\n');
  const frontmatter = {};

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }

    const listMatch = line.match(/^([A-Za-z0-9_]+):\s*$/);
    if (listMatch) {
      const key = listMatch[1];
      const values = [];
      while (index + 1 < lines.length && /^\s*-\s+/.test(lines[index + 1])) {
        index += 1;
        values.push(lines[index].replace(/^\s*-\s+/, ''));
      }
      frontmatter[key] = uniqueStrings(values);
      continue;
    }

    const scalarMatch = line.match(/^([A-Za-z0-9_]+):\s*(.+)\s*$/);
    if (scalarMatch) {
      const [, key, rawValue] = scalarMatch;
      if (key === 'tags' || key === 'facts' || key === 'required_context' || key === 'retrieval_hints') {
        frontmatter[key] = splitListValue(rawValue);
      } else {
        frontmatter[key] = parseScalarValue(rawValue);
      }
    }
  }

  return {
    frontmatter,
    body,
  };
}

function parseMarkdownSections(markdownBody) {
  const sections = [];
  let current = { heading: null, lines: [] };

  for (const line of String(markdownBody ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const headingMatch = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (headingMatch) {
      sections.push(current);
      current = {
        heading: normalizeText(headingMatch[1]),
        lines: [],
      };
      continue;
    }
    current.lines.push(line);
  }
  sections.push(current);
  return sections;
}

function findSection(sections, aliases = []) {
  const aliasSet = new Set(aliases.map((item) => item.toLowerCase()));
  return sections.find((section) => aliasSet.has(String(section?.heading ?? '').toLowerCase())) ?? null;
}

function extractBulletLines(lines = []) {
  return uniqueStrings(
    lines
      .map((line) => line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+?)\s*$/)?.[1] ?? null)
      .filter(Boolean),
  );
}

function extractParagraphText(lines = []) {
  const paragraphs = [];
  let current = [];

  for (const line of lines) {
    if (!line.trim()) {
      if (current.length > 0) {
        paragraphs.push(current.join(' '));
        current = [];
      }
      continue;
    }
    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line) || /^```/.test(line)) {
      continue;
    }
    current.push(line.trim());
  }
  if (current.length > 0) {
    paragraphs.push(current.join(' '));
  }

  return paragraphs.map((item) => normalizeText(item)).filter(Boolean);
}

function chooseTitle({ frontmatter, sections, filePath }) {
  return normalizeText(
    frontmatter.title
    ?? sections.find((section) => section?.heading)?.heading
    ?? basename(filePath ?? '', '.md')
    ?? 'Untitled wiki entry',
  );
}

function chooseSummary({ frontmatter, sections }) {
  if (normalizeText(frontmatter.summary)) {
    return normalizeText(frontmatter.summary);
  }

  const summarySection = findSection(sections, ['summary', '简介', '概述']);
  if (summarySection) {
    const sectionParagraph = extractParagraphText(summarySection.lines)[0];
    if (sectionParagraph) {
      return sectionParagraph;
    }
  }

  for (const section of sections) {
    const paragraph = extractParagraphText(section.lines)[0];
    if (paragraph) {
      return paragraph;
    }
  }

  return '';
}

function chooseFacts({ frontmatter, sections }) {
  if (Array.isArray(frontmatter.facts) && frontmatter.facts.length > 0) {
    return uniqueStrings(frontmatter.facts);
  }

  const factsSection = findSection(sections, ['facts', 'fact', '要点', '事实']);
  if (factsSection) {
    const values = extractBulletLines(factsSection.lines);
    if (values.length > 0) {
      return values;
    }
  }

  const allBullets = uniqueStrings(sections.flatMap((section) => extractBulletLines(section.lines)));
  return allBullets.slice(0, 12);
}

function chooseListField({ frontmatter, sections, key, aliases }) {
  if (Array.isArray(frontmatter[key]) && frontmatter[key].length > 0) {
    return uniqueStrings(frontmatter[key]);
  }

  const targetSection = findSection(sections, aliases);
  if (!targetSection) {
    return [];
  }

  const bullets = extractBulletLines(targetSection.lines);
  if (bullets.length > 0) {
    return bullets;
  }

  const paragraphs = extractParagraphText(targetSection.lines);
  if (paragraphs.length === 0) {
    return [];
  }

  return splitListValue(paragraphs.join(', '));
}

function countParagraphs(sections = []) {
  return sections.reduce((total, section) => total + extractParagraphText(section.lines).length, 0);
}

function countBullets(sections = []) {
  return sections.reduce((total, section) => total + extractBulletLines(section.lines).length, 0);
}

function detectLanguage(text) {
  return /[\u4e00-\u9fff]/.test(String(text ?? '')) ? 'zh' : 'en';
}

function estimateReadinessScore(flags = []) {
  let score = 1.0;
  for (const flag of flags) {
    if (flag === 'missing_frontmatter') {
      score -= 0.14;
    } else if (flag === 'missing_summary' || flag === 'missing_facts') {
      score -= 0.12;
    } else if (flag === 'missing_required_context' || flag === 'missing_retrieval_hints') {
      score -= 0.08;
    } else if (flag === 'obsidian_embed' || flag === 'markdown_image' || flag === 'code_block') {
      score -= 0.05;
    } else if (flag === 'long_summary' || flag === 'dense_fact_list') {
      score -= 0.04;
    } else if (flag === 'longform_note' || flag === 'many_sections') {
      score -= 0.1;
    } else if (flag === 'research_note' || flag === 'presentation_note') {
      score -= 0.12;
    } else if (flag === 'draft_note') {
      score -= 0.18;
    }
  }
  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

const DYNAMIC_CUE_PATTERN = /(当前|目前|最新|状态|进度|版本|里程碑|主线|配置|配方|结果|排行|排名|负责人|鲁棒|对抗|预训练|语料|leaderboard|status|current|latest|progress|result|results|version|owner|milestone|mainline|recipe|config|pricing|price|gate|pretrain|pretraining|robust|robustness|attack|corpus|dataset)/i;
const METRIC_CUE_PATTERN = /(\d|loss|acc|accuracy|f1|auc|rate|share|epoch|batch|lr|seed|samples?|checkpoint|收敛|准确率|损失|样本|数量|比例)/i;
const SECTION_SKIP_PATTERN = /(封面|背景|意义|现状|目标|参考文献|致谢|abstract|introduction|conclusion|related work|研究背景|研究现状|国内外研究现状|参考资料|汇报题目)/i;
const SECTION_GENERIC_PATTERN = /(什么是|定义|概述|概要|综述|作者贡献|论文贡献|核心思想与动机|整体框架设计|研究对象|写在前面|备选题目|备选一|备选二|开题报告部分|学位研究方案与研究计划|学位论文研究内容)/i;
const NOTE_DYNAMIC_PATTERN = /(状态|进度|结果|说明|开题|汇报|答辩|里程碑|主线|模型选择|语料|预训练|训练|配方|配置|鲁棒|对抗|tri?gma|leaderboard|gate|status|progress|result|results|mainline|pretrain|pretraining|recipe|config|robust|attack|milestone)/i;

function splitIntoSentences(text) {
  return uniqueStrings(
    String(text ?? '')
      .replace(/\r\n/g, '\n')
      .split(/(?<=[。！？!?;；.])\s+|\n+/g)
      .map((item) => item.trim())
      .filter((item) => item.length >= 8),
  );
}

function sanitizeTitleFragment(text) {
  let normalized = normalizeText(text)
    .replace(/[*_`~]/g, '')
    .replace(/^#+\s*/, '')
    .trim();
  normalized = normalized
    .replace(/^【?\s*[Pp]\d+\s*/u, '')
    .replace(/[】\]]+$/u, '')
    .replace(/^\d+[.、)\]]\s*/u, '')
    .replace(/^[:：-]+\s*/u, '')
    .trim();
  return normalized || normalizeText(text);
}

function chooseDraftBaseTitle(noteTitle, filePath) {
  const sanitizedNoteTitle = sanitizeTitleFragment(noteTitle);
  if (
    !sanitizedNoteTitle ||
    SECTION_SKIP_PATTERN.test(sanitizedNoteTitle) ||
    /^p\d+$/i.test(sanitizedNoteTitle)
  ) {
    return sanitizeTitleFragment(basename(filePath ?? '', '.md'));
  }
  return sanitizedNoteTitle;
}

function inferScopeHints(text) {
  const normalized = String(text ?? '');
  const scopes = [];
  if (/(预训练|pretrain)/i.test(normalized)) {
    scopes.push('pretraining_scope');
  }
  if (/(主线|模型选择|leaderboard|排行|排名|model selection)/i.test(normalized)) {
    scopes.push('model_selection_scope');
  }
  if (/(gate|门控|融合)/i.test(normalized)) {
    scopes.push('gate_scope');
  }
  if (/(鲁棒|对抗|robust|attack)/i.test(normalized)) {
    scopes.push('robustness_scope');
  }
  if (/(语料|dataset|corpus)/i.test(normalized)) {
    scopes.push('corpus_scope');
  }
  if (/(配置|配方|recipe|config|训练)/i.test(normalized)) {
    scopes.push('training_scope');
  }
  if (/(版本|价格|pricing|release|provider)/i.test(normalized)) {
    scopes.push('provider_scope');
  }
  if (scopes.length === 0) {
    scopes.push('project_scope');
  }
  return uniqueStrings(scopes);
}

function inferTagHints(text) {
  const normalized = String(text ?? '');
  const tags = ['candidate-card', 'status'];
  if (/(预训练|pretrain)/i.test(normalized)) {
    tags.push('pretraining');
  }
  if (/(主线|模型选择|model selection)/i.test(normalized)) {
    tags.push('model-selection');
  }
  if (/(leaderboard|排行|排名)/i.test(normalized)) {
    tags.push('leaderboard');
  }
  if (/(gate|门控|融合)/i.test(normalized)) {
    tags.push('gate');
  }
  if (/(鲁棒|对抗|robust|attack)/i.test(normalized)) {
    tags.push('robustness');
  }
  if (/(语料|dataset|corpus)/i.test(normalized)) {
    tags.push('corpus');
  }
  if (/(配置|配方|recipe|config|训练)/i.test(normalized)) {
    tags.push('training');
  }
  return uniqueStrings(tags);
}

function buildDraftFacts({ sectionBullets = [], sectionParagraphs = [], noteSummary = '' }) {
  if (sectionBullets.length > 0) {
    return uniqueStrings(sectionBullets).slice(0, 6);
  }

  const sentenceFacts = splitIntoSentences([
    ...sectionParagraphs,
    noteSummary,
  ].filter(Boolean).join('\n'));
  return sentenceFacts.slice(0, 4);
}

function buildCandidateCardDraft({
  noteTitle,
  noteSummary,
  noteTags = [],
  noteOwner,
  noteRequiredContext = [],
  noteRetrievalHints = [],
  noteTtlSeconds,
  filePath,
  sourceOfTruth,
  recommendedTarget,
  section,
  sectionIndex,
}) {
  const heading = normalizeText(section?.heading);
  if (!heading || SECTION_SKIP_PATTERN.test(heading)) {
    return null;
  }
  const headingLabel = sanitizeTitleFragment(heading);
  if (!headingLabel || SECTION_SKIP_PATTERN.test(headingLabel)) {
    return null;
  }

  const sectionParagraphs = extractParagraphText(section?.lines ?? []);
  const sectionBullets = extractBulletLines(section?.lines ?? []);
  const sectionText = normalizeText([
    headingLabel,
    ...sectionParagraphs,
    ...sectionBullets,
  ].join('\n'));

  const noteDynamicBoost = NOTE_DYNAMIC_PATTERN.test(`${noteTitle}\n${filePath ?? ''}\n${noteSummary}`) ? 2 : 0;
  let signalScore = 0;
  if (DYNAMIC_CUE_PATTERN.test(headingLabel)) {
    signalScore += 2;
  }
  if (DYNAMIC_CUE_PATTERN.test(sectionText)) {
    signalScore += 1;
  }
  if (sectionBullets.length >= 2) {
    signalScore += 1;
  }
  if (METRIC_CUE_PATTERN.test(sectionText)) {
    signalScore += 1;
  }
  if (recommendedTarget === 'review') {
    signalScore += 1;
  }
  signalScore += noteDynamicBoost;
  if (SECTION_GENERIC_PATTERN.test(headingLabel)) {
    signalScore -= 2;
  }

  if (signalScore < 3) {
    return null;
  }

  const facts = buildDraftFacts({
    sectionBullets,
    sectionParagraphs,
    noteSummary,
  });
  const summary = normalizeText(sectionParagraphs[0] ?? facts[0] ?? noteSummary);
  if (!summary && facts.length === 0) {
    return null;
  }

  const noteBaseTitle = chooseDraftBaseTitle(noteTitle, filePath);
  const idBase = `${noteBaseTitle}_${headingLabel}`;
  const title = normalizeText(
    headingLabel.includes(noteBaseTitle) || noteBaseTitle.length > 42
      ? headingLabel
      : `${noteBaseTitle} ${headingLabel}`,
  );
  const hintText = [noteTitle, heading, sectionText].join('\n');
  const requiredContext = uniqueStrings([
    ...noteRequiredContext,
    ...inferScopeHints(hintText),
  ]);
  const retrievalHints = uniqueStrings([
    ...noteRetrievalHints,
    heading,
    `${noteTitle} ${heading}`,
    `当前${heading}`,
    `current ${heading}`,
  ]).slice(0, 6);
  const tags = uniqueStrings([
    ...noteTags,
    ...inferTagHints(hintText),
  ]).slice(0, 8);

  return {
    draft_id: `${slugify(idBase)}_${sectionIndex + 1}`,
    entry_id: `wiki_${slugify(idBase)}`,
    title,
    summary,
    facts,
    tags,
    owner: noteOwner,
    required_context: requiredContext,
    retrieval_hints: retrievalHints,
    ttl_seconds: Number.isFinite(noteTtlSeconds) ? noteTtlSeconds : 14 * 24 * 60 * 60,
    source_of_truth: normalizeText(sourceOfTruth ? `${sourceOfTruth}#${heading}` : `${basename(filePath ?? '', '.md')}#${heading}`),
    source_file_path: filePath,
    source_note_title: noteTitle,
    source_note_recommended_target: recommendedTarget,
    section_heading: heading,
    review_required: true,
    draft_reason: recommendedTarget === 'rag'
      ? 'split_longform_note_into_dynamic_card'
      : 'manual_cleanup_note_into_dynamic_card',
  };
}

function buildWholeNoteFallbackDraft({
  noteTitle,
  noteSummary,
  noteFacts = [],
  noteTags = [],
  noteOwner,
  noteRequiredContext = [],
  noteRetrievalHints = [],
  noteTtlSeconds,
  filePath,
  sourceOfTruth,
  recommendedTarget,
}) {
  if (!noteSummary && noteFacts.length === 0) {
    return null;
  }

  return {
    draft_id: `${slugify(noteTitle)}_whole_note`,
    entry_id: `wiki_${slugify(noteTitle)}`,
    title: noteTitle,
    summary: noteSummary,
    facts: noteFacts.slice(0, 6),
    tags: uniqueStrings([
      ...noteTags,
      ...inferTagHints(noteTitle),
    ]).slice(0, 8),
    owner: noteOwner,
    required_context: uniqueStrings([
      ...noteRequiredContext,
      ...inferScopeHints(noteTitle),
    ]),
    retrieval_hints: uniqueStrings([
      ...noteRetrievalHints,
      noteTitle,
      `当前${noteTitle}`,
      `current ${noteTitle}`,
    ]).slice(0, 6),
    ttl_seconds: Number.isFinite(noteTtlSeconds) ? noteTtlSeconds : 14 * 24 * 60 * 60,
    source_of_truth: normalizeText(sourceOfTruth || basename(filePath ?? '', '.md')),
    source_file_path: filePath,
    source_note_title: noteTitle,
    source_note_recommended_target: recommendedTarget,
    section_heading: null,
    review_required: true,
    draft_reason: recommendedTarget === 'rag'
      ? 'split_longform_note_into_dynamic_card'
      : 'manual_cleanup_note_into_dynamic_card',
  };
}

function classifyMarkdownImport({
  filePath,
  title,
  summary,
  facts,
  requiredContext,
  retrievalHints,
  frontmatter,
  body,
  sections,
}) {
  const fileHint = `${filePath ?? ''}\n${title}\n${summary}`;
  const normalizedBody = normalizeText(body);
  const frontmatterKeys = Object.keys(frontmatter);
  const headingCount = sections.filter((section) => section?.heading).length;
  const paragraphCount = countParagraphs(sections);
  const bulletCount = countBullets(sections);
  const bodyLength = normalizedBody.length;
  const factsCount = facts.length;
  const hasObsidianEmbed = /!\[\[[^\]]+\]\]/.test(body);
  const hasMarkdownImage = /!\[[^\]]*]\([^)]+\)/.test(body);
  const hasCodeBlock = /```/.test(body);

  const riskFlags = [];
  if (frontmatterKeys.length === 0) {
    riskFlags.push('missing_frontmatter');
  }
  if (!summary) {
    riskFlags.push('missing_summary');
  }
  if (factsCount === 0) {
    riskFlags.push('missing_facts');
  }
  if (requiredContext.length === 0) {
    riskFlags.push('missing_required_context');
  }
  if (retrievalHints.length === 0) {
    riskFlags.push('missing_retrieval_hints');
  }
  if (summary.length > 480) {
    riskFlags.push('long_summary');
  }
  if (factsCount > 12) {
    riskFlags.push('dense_fact_list');
  }
  if (bodyLength > 5000) {
    riskFlags.push('longform_note');
  }
  if (headingCount >= 8 || paragraphCount >= 18) {
    riskFlags.push('many_sections');
  }
  if (hasObsidianEmbed) {
    riskFlags.push('obsidian_embed');
  }
  if (hasMarkdownImage) {
    riskFlags.push('markdown_image');
  }
  if (hasCodeBlock) {
    riskFlags.push('code_block');
  }
  if (/(草稿|draft)/i.test(fileHint)) {
    riskFlags.push('draft_note');
  }
  if (/(开题报告|讲解稿|答辩|汇报)/.test(fileHint)) {
    riskFlags.push('presentation_note');
  }
  if (/(论文|paper|研究|实验|框架|算法|恶意代码|malware|detection|classification|识别|检测)/i.test(fileHint)) {
    riskFlags.push('research_note');
  }

  let recommendedTarget = 'wiki';
  let recommendedWorkflow = 'proposal_import';
  let rationale = 'The note already resembles a structured wiki entry and can enter the proposal workflow.';

  if (riskFlags.includes('draft_note') || riskFlags.includes('presentation_note')) {
    recommendedTarget = 'review';
    recommendedWorkflow = 'manual_cleanup_then_proposal';
    rationale = 'The note looks like a draft or presentation script and should be cleaned before entering wiki governance.';
  } else if (
    riskFlags.includes('research_note') ||
    riskFlags.includes('longform_note') ||
    riskFlags.includes('many_sections')
  ) {
    recommendedTarget = 'rag';
    recommendedWorkflow = 'rag_curation';
    rationale = 'The note is closer to a long-form research document and is a better fit for RAG or card-style splitting before wiki import.';
  } else if (
    riskFlags.includes('missing_summary') ||
    riskFlags.includes('missing_facts') ||
    riskFlags.includes('missing_required_context') ||
    riskFlags.includes('missing_retrieval_hints')
  ) {
    recommendedTarget = 'review';
    recommendedWorkflow = 'manual_cleanup_then_proposal';
    rationale = 'The note is importable, but it is missing knowledge-contract fields and should be normalized before formal wiki onboarding.';
  }

  return {
    recommended_target: recommendedTarget,
    recommended_workflow: recommendedWorkflow,
    import_mode: recommendedTarget === 'wiki' ? 'proposal' : null,
    readiness_score: estimateReadinessScore(riskFlags),
    rationale,
    risk_flags: riskFlags,
    stats: {
      language: detectLanguage(`${title}\n${summary}\n${body}`),
      frontmatter_key_count: frontmatterKeys.length,
      heading_count: headingCount,
      paragraph_count: paragraphCount,
      bullet_count: bulletCount,
      body_length: bodyLength,
      summary_length: summary.length,
      facts_count: factsCount,
      has_obsidian_embed: hasObsidianEmbed,
      has_markdown_image: hasMarkdownImage,
      has_code_block: hasCodeBlock,
    },
  };
}

export function buildWikiImportPayloadFromMarkdown(markdownText, {
  filePath = null,
  entryId = null,
  sourceTraceId = null,
  baseVersion = null,
  metadata = {},
  source = 'markdown_import',
} = {}) {
  const { frontmatter, body } = parseFrontmatter(markdownText);
  const sections = parseMarkdownSections(body);
  const title = chooseTitle({ frontmatter, sections, filePath });
  const summary = chooseSummary({ frontmatter, sections });
  const facts = chooseFacts({ frontmatter, sections });
  const tags = chooseListField({
    frontmatter,
    sections,
    key: 'tags',
    aliases: ['tags', 'tag', '标签'],
  });
  const requiredContext = chooseListField({
    frontmatter,
    sections,
    key: 'required_context',
    aliases: ['required context', 'required_context', '所需上下文'],
  });
  const retrievalHints = chooseListField({
    frontmatter,
    sections,
    key: 'retrieval_hints',
    aliases: ['retrieval hints', 'retrieval_hints', '检索提示'],
  });

  return {
    entry_id: normalizeText(entryId ?? frontmatter.entry_id) || (filePath ? deriveWikiEntryIdFromPath(filePath) : `wiki_${slugify(title || 'untitled')}`),
    base_version: Number.isFinite(baseVersion) ? baseVersion : (Number.isFinite(frontmatter.base_version) ? frontmatter.base_version : null),
    title,
    summary,
    facts,
    tags,
    owner: normalizeText(frontmatter.owner) || 'wiki_curator',
    required_context: requiredContext,
    retrieval_hints: retrievalHints,
    ttl_seconds: Number.isFinite(frontmatter.ttl_seconds)
      ? frontmatter.ttl_seconds
      : (Number.isFinite(frontmatter.ttl) ? frontmatter.ttl : 7 * 24 * 60 * 60),
    source_of_truth: normalizeText(frontmatter.source_of_truth) || normalizeText(filePath ? basename(filePath) : title),
    source,
    source_trace_id: sourceTraceId ?? null,
    metadata: {
      ...metadata,
      wiki_import_format: 'markdown',
      wiki_import_path: filePath,
      wiki_import_frontmatter: frontmatter,
    },
  };
}

export function deriveWikiEntryIdFromPath(filePath, fallback = 'wiki_markdown_entry') {
  const baseName = basename(String(filePath ?? '').trim(), extname(String(filePath ?? '').trim() || '.md'));
  return `wiki_${slugify(baseName || fallback)}`;
}

export function buildCandidateCardDraftsFromMarkdown(markdownText, {
  filePath = null,
  entryId = null,
  sourceTraceId = null,
  baseVersion = null,
  metadata = {},
  source = 'markdown_import_preview',
} = {}) {
  const { frontmatter, body } = parseFrontmatter(markdownText);
  const sections = parseMarkdownSections(body);
  const payload = buildWikiImportPayloadFromMarkdown(markdownText, {
    filePath,
    entryId,
    sourceTraceId,
    baseVersion,
    metadata,
    source,
  });
  const classification = classifyMarkdownImport({
    filePath,
    title: payload.title,
    summary: payload.summary,
    facts: payload.facts,
    requiredContext: payload.required_context,
    retrievalHints: payload.retrieval_hints,
    frontmatter,
    body,
    sections,
  });

  if (classification.recommended_target === 'wiki') {
    return [];
  }

  const noteDynamicEligible = NOTE_DYNAMIC_PATTERN.test([
    payload.title,
    filePath ?? '',
    payload.summary,
    ...(payload.tags ?? []),
  ].join('\n'));
  if (!noteDynamicEligible) {
    return [];
  }

  const drafts = sections
    .map((section, sectionIndex) => buildCandidateCardDraft({
      noteTitle: payload.title,
      noteSummary: payload.summary,
      noteTags: payload.tags,
      noteOwner: payload.owner,
      noteRequiredContext: payload.required_context,
      noteRetrievalHints: payload.retrieval_hints,
      noteTtlSeconds: payload.ttl_seconds,
      filePath,
      sourceOfTruth: payload.source_of_truth,
      recommendedTarget: classification.recommended_target,
      section,
      sectionIndex,
    }))
    .filter(Boolean);

  const dedupedDrafts = [];
  const seenEntryIds = new Set();
  for (const draft of drafts) {
    if (seenEntryIds.has(draft.entry_id)) {
      continue;
    }
    seenEntryIds.add(draft.entry_id);
    dedupedDrafts.push(draft);
    if (dedupedDrafts.length >= 3) {
      break;
    }
  }

  if (dedupedDrafts.length > 0) {
    return dedupedDrafts;
  }

  const wholeNoteDraft = buildWholeNoteFallbackDraft({
    noteTitle: payload.title,
    noteSummary: payload.summary,
    noteFacts: payload.facts,
    noteTags: payload.tags,
    noteOwner: payload.owner,
    noteRequiredContext: payload.required_context,
    noteRetrievalHints: payload.retrieval_hints,
    noteTtlSeconds: payload.ttl_seconds,
    filePath,
    sourceOfTruth: payload.source_of_truth,
    recommendedTarget: classification.recommended_target,
  });

  return wholeNoteDraft ? [wholeNoteDraft] : [];
}

export function renderCandidateCardDraftMarkdown(draft = {}) {
  const tags = Array.isArray(draft.tags) ? draft.tags : [];
  const requiredContext = Array.isArray(draft.required_context) ? draft.required_context : [];
  const retrievalHints = Array.isArray(draft.retrieval_hints) ? draft.retrieval_hints : [];
  const facts = Array.isArray(draft.facts) ? draft.facts : [];

  const lines = [
    '---',
    `entry_id: ${draft.entry_id ?? 'wiki_candidate_card'}`,
    `title: ${draft.title ?? 'Candidate card draft'}`,
    `owner: ${draft.owner ?? 'wiki_curator'}`,
    `tags: [${tags.join(', ')}]`,
    'required_context:',
    ...requiredContext.map((item) => `  - ${item}`),
    'retrieval_hints:',
    ...retrievalHints.map((item) => `  - ${item}`),
    `ttl_seconds: ${Number.isFinite(draft.ttl_seconds) ? draft.ttl_seconds : 1209600}`,
    `source_of_truth: ${draft.source_of_truth ?? 'candidate_card_draft'}`,
    'review_required: true',
    `source_file_path: ${draft.source_file_path ?? ''}`,
    `draft_reason: ${draft.draft_reason ?? 'manual_cleanup_note_into_dynamic_card'}`,
    '---',
    '',
    `# ${draft.title ?? 'Candidate card draft'}`,
    '',
    '## Summary',
    draft.summary ?? '',
    '',
    '## Facts',
    ...facts.map((item) => `- ${item}`),
    '',
  ];

  return `${lines.join('\n').trim()}\n`;
}

export function previewWikiImportFromMarkdown(markdownText, {
  filePath = null,
  entryId = null,
  sourceTraceId = null,
  baseVersion = null,
  metadata = {},
  source = 'markdown_import_preview',
} = {}) {
  const { frontmatter, body } = parseFrontmatter(markdownText);
  const sections = parseMarkdownSections(body);
  const payload = buildWikiImportPayloadFromMarkdown(markdownText, {
    filePath,
    entryId,
    sourceTraceId,
    baseVersion,
    metadata,
    source,
  });
  const classification = classifyMarkdownImport({
    filePath,
    title: payload.title,
    summary: payload.summary,
    facts: payload.facts,
    requiredContext: payload.required_context,
    retrievalHints: payload.retrieval_hints,
    frontmatter,
    body,
    sections,
  });
  const candidateCardDrafts = buildCandidateCardDraftsFromMarkdown(markdownText, {
    filePath,
    entryId,
    sourceTraceId,
    baseVersion,
    metadata,
    source,
  });

  return {
    file_path: filePath,
    entry_id: payload.entry_id,
    title: payload.title,
    owner: payload.owner,
    source_of_truth: payload.source_of_truth,
    tags: payload.tags,
    required_context: payload.required_context,
    retrieval_hints: payload.retrieval_hints,
    summary_excerpt: payload.summary.slice(0, 220),
    facts_preview: payload.facts.slice(0, 5),
    metadata_preview: {
      wiki_import_format: payload.metadata.wiki_import_format,
      wiki_import_path: payload.metadata.wiki_import_path,
      wiki_import_frontmatter_keys: Object.keys(frontmatter),
    },
    candidate_card_drafts: candidateCardDrafts,
    ...classification,
  };
}
