#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  previewWikiImportFromMarkdown,
  deriveWikiEntryIdFromPath,
  renderCandidateCardDraftMarkdown,
} from '../apps/platform/src/wiki-markdown-ingest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT_ROOT = join(ROOT, 'data', 'wiki', 'audits');

function parseArgs(argv = []) {
  const parsed = {
    notesDir: 'LLM wiki',
    outputRoot: DEFAULT_OUTPUT_ROOT,
    auditName: 'llm-wiki-notes-audit',
    recursive: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--notes-dir') {
      parsed.notesDir = argv[index + 1];
      index += 1;
    } else if (arg === '--output-root') {
      parsed.outputRoot = argv[index + 1];
      index += 1;
    } else if (arg === '--audit-name') {
      parsed.auditName = argv[index + 1];
      index += 1;
    } else if (arg === '--recursive') {
      parsed.recursive = true;
    }
  }

  return parsed;
}

async function collectMarkdownFiles(directoryPath, { recursive = false } = {}) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (recursive) {
        files.push(...await collectMarkdownFiles(fullPath, { recursive }));
      }
      continue;
    }
    if (entry.isFile() && /\.md$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  files.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
  return files;
}

function countBy(items = [], key) {
  return items.reduce((accumulator, item) => {
    const value = String(item?.[key] ?? 'unknown');
    accumulator[value] = (accumulator[value] ?? 0) + 1;
    return accumulator;
  }, {});
}

function countRiskFlags(items = []) {
  const flags = {};
  for (const item of items) {
    for (const flag of item.risk_flags ?? []) {
      flags[flag] = (flags[flag] ?? 0) + 1;
    }
  }
  return Object.fromEntries(
    Object.entries(flags).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  );
}

function average(values = []) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function buildSummary(items = [], metadata = {}) {
  const wikiCandidates = items.filter((item) => item.recommended_target === 'wiki');
  const ragCandidates = items.filter((item) => item.recommended_target === 'rag');
  const reviewCandidates = items.filter((item) => item.recommended_target === 'review');
  const candidateCardDrafts = items.flatMap((item) => item.candidate_card_drafts ?? []);
  const frontmatterCount = items.filter((item) => (item.metadata_preview?.wiki_import_frontmatter_keys?.length ?? 0) > 0).length;
  const obsidianEmbedCount = items.filter((item) => item.stats?.has_obsidian_embed).length;
  const markdownImageCount = items.filter((item) => item.stats?.has_markdown_image).length;

  return {
    file_count: items.length,
    notes_dir: metadata.notes_dir,
    recursive: Boolean(metadata.recursive),
    recommended_target_counts: countBy(items, 'recommended_target'),
    recommended_workflow_counts: countBy(items, 'recommended_workflow'),
    risk_flag_counts: countRiskFlags(items),
    avg_readiness_score: Number(average(items.map((item) => item.readiness_score)).toFixed(4)),
    avg_summary_length: Number(average(items.map((item) => item.stats?.summary_length)).toFixed(2)),
    avg_facts_count: Number(average(items.map((item) => item.stats?.facts_count)).toFixed(2)),
    frontmatter_coverage: Number((frontmatterCount / Math.max(items.length, 1)).toFixed(4)),
    obsidian_embed_coverage: Number((obsidianEmbedCount / Math.max(items.length, 1)).toFixed(4)),
    markdown_image_coverage: Number((markdownImageCount / Math.max(items.length, 1)).toFixed(4)),
    candidate_card_draft_count: candidateCardDrafts.length,
    wiki_candidate_files: wikiCandidates.map((item) => item.file_path),
    rag_candidate_files: ragCandidates.map((item) => item.file_path),
    review_candidate_files: reviewCandidates.map((item) => item.file_path),
  };
}

function renderReviewMarkdown({ metadata, summary, items }) {
  const lines = [
    `# Wiki Notes Audit: ${metadata.audit_name}`,
    '',
    '## Summary',
    '',
    `- Notes dir: \`${metadata.notes_dir}\``,
    `- File count: ${summary.file_count}`,
    `- Average readiness score: ${summary.avg_readiness_score.toFixed(4)}`,
    `- Frontmatter coverage: ${summary.frontmatter_coverage.toFixed(4)}`,
    `- Obsidian embed coverage: ${summary.obsidian_embed_coverage.toFixed(4)}`,
    `- Markdown image coverage: ${summary.markdown_image_coverage.toFixed(4)}`,
    `- Candidate card draft count: ${summary.candidate_card_draft_count}`,
    '',
    '### Recommended targets',
    '',
  ];

  for (const [label, count] of Object.entries(summary.recommended_target_counts)) {
    lines.push(`- \`${label}\`: ${count}`);
  }

  lines.push('', '### Top risk flags', '');
  for (const [label, count] of Object.entries(summary.risk_flag_counts)) {
    lines.push(`- \`${label}\`: ${count}`);
  }

  lines.push('', '## Per file', '');
  for (const item of items) {
    lines.push(`### ${item.file_path}`);
    lines.push('');
    lines.push(`- Entry ID: \`${item.entry_id}\``);
    lines.push(`- Title: \`${item.title}\``);
    lines.push(`- Target: \`${item.recommended_target}\``);
    lines.push(`- Workflow: \`${item.recommended_workflow}\``);
    lines.push(`- Readiness: \`${Number(item.readiness_score || 0).toFixed(4)}\``);
    lines.push(`- Risk flags: \`${(item.risk_flags ?? []).join(', ') || 'none'}\``);
    lines.push(`- Summary excerpt: ${item.summary_excerpt || '(empty)'}`);
    lines.push(`- Facts preview: \`${(item.facts_preview ?? []).join(' | ') || 'none'}\``);
    lines.push(`- Rationale: ${item.rationale}`);
    if ((item.candidate_card_drafts?.length ?? 0) > 0) {
      lines.push(`- Candidate card drafts: ${(item.candidate_card_drafts ?? []).length}`);
      for (const draft of item.candidate_card_drafts ?? []) {
        lines.push(`  - \`${draft.title}\` -> \`${draft.entry_id}\``);
      }
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const notesDir = resolve(ROOT, args.notesDir);
  const outputDir = resolve(args.outputRoot, args.auditName);
  const markdownFiles = await collectMarkdownFiles(notesDir, { recursive: args.recursive });

  if (markdownFiles.length === 0) {
    throw new Error(`No markdown files found under ${notesDir}`);
  }

  const items = [];
  for (const absolutePath of markdownFiles) {
    const relativePath = relative(ROOT, absolutePath);
    const markdownText = await readFile(absolutePath, 'utf8');
    items.push(previewWikiImportFromMarkdown(markdownText, {
      filePath: relativePath,
      entryId: deriveWikiEntryIdFromPath(relativePath),
      metadata: {
        wiki_notes_audit: true,
      },
    }));
  }

  const metadata = {
    audit_name: args.auditName,
    notes_dir: relative(ROOT, notesDir) || args.notesDir,
    recursive: args.recursive,
  };
  const summary = buildSummary(items, metadata);
  const reviewPayload = {
    metadata,
    summary,
    items,
    candidate_card_drafts: items.flatMap((item) => item.candidate_card_drafts ?? []),
  };

  const candidateDraftOutputDir = join(outputDir, 'candidate_card_drafts');

  await mkdir(outputDir, { recursive: true });
  await mkdir(candidateDraftOutputDir, { recursive: true });
  await writeFile(join(outputDir, 'summary.json'), `${JSON.stringify({ metadata, summary }, null, 2)}\n`, 'utf8');
  await writeFile(join(outputDir, 'review.json'), `${JSON.stringify(reviewPayload, null, 2)}\n`, 'utf8');
  await writeFile(join(outputDir, 'review.md'), renderReviewMarkdown(reviewPayload), 'utf8');

  for (const draft of reviewPayload.candidate_card_drafts) {
    await writeFile(
      join(candidateDraftOutputDir, `${draft.entry_id}.md`),
      renderCandidateCardDraftMarkdown(draft),
      'utf8',
    );
  }

  process.stdout.write(`${JSON.stringify({
    metadata,
    summary,
    summary_path: relative(ROOT, join(outputDir, 'summary.json')),
    review_json_path: relative(ROOT, join(outputDir, 'review.json')),
    review_md_path: relative(ROOT, join(outputDir, 'review.md')),
    candidate_card_drafts_dir: relative(ROOT, candidateDraftOutputDir),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
