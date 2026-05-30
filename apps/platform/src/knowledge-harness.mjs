import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callPythonCore } from './python-core-bridge.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const DEFAULT_GENERATION_CASE_PATHS = ['config/generation-judge-cases.json'];
const DEFAULT_WIKI_CASE_PATHS = [
  'config/wiki-freshness-cases.json',
  'config/wiki-project-cases.json',
  'config/wiki-trigma-cases.json',
];
const DEFAULT_MEMORY_CASE_PATHS = ['config/memory-benchmark-cases.json'];

function clone(value) {
  return structuredClone(value);
}

async function readJsonOrJsonl(path) {
  const text = await readFile(path, 'utf8');
  if (path.endsWith('.jsonl')) {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  const payload = JSON.parse(text);
  if (Array.isArray(payload)) {
    return payload.map((item) => ({ ...item }));
  }
  if (payload && typeof payload === 'object') {
    return Array.isArray(payload.cases) ? payload.cases.map((item) => ({ ...item })) : [];
  }
  return [];
}

function resolveCasePaths({ casePaths = [], casePath = null, preset = null, defaultPaths = [] } = {}) {
  const explicitPaths = [
    ...casePaths,
    ...(casePath ? [casePath] : []),
  ].filter(Boolean);

  if (explicitPaths.length > 0) {
    return explicitPaths.map((path) => resolve(REPO_ROOT, path));
  }

  if (preset === 'default_knowledge_suite' || preset === 'knowledge-default') {
    return defaultPaths.map((path) => resolve(REPO_ROOT, path));
  }

  return [];
}

function renderSectionMarkdown(title, summary, cases, formatCase) {
  const lines = [`## ${title}`, ''];
  for (const line of summary) {
    lines.push(line);
  }
  lines.push('', '### Cases', '');
  for (const item of cases) {
    lines.push(formatCase(item));
  }
  lines.push('');
  return lines;
}

function renderKnowledgeReviewMarkdown(result) {
  const summary = result.summary ?? {};
  const generationCases = Array.isArray(result.generation?.cases) ? result.generation.cases : [];
  const wikiCases = Array.isArray(result.wiki?.cases) ? result.wiki.cases : [];
  const memoryCases = Array.isArray(result.memory?.cases) ? result.memory.cases : [];
  const jointAttention = (
    generationCases.filter((item) => item.judge?.decision !== 'pass' || item.judge?.decision_matches_expected === false).length
    + wikiCases.filter((item) => item.judge?.decision !== 'pass' || item.judge?.route?.fallback_applied || item.judge?.quality?.recommended_action !== 'accept').length
    + memoryCases.filter((item) => {
      const values = Object.values(item.judge?.dimensions ?? {});
      const weakest = values.length > 0 ? Math.min(...values.map((value) => Number(value) || 0)) : 1;
      return item.judge?.decision !== 'pass' || weakest < 0.85;
    }).length
  );
  const lines = [
    `# Knowledge Harness Review: ${result.metadata?.suite_name ?? result.metadata?.suite ?? 'knowledge-harness'}`,
    '',
    '## Summary',
    '',
    `- Suites: ${summary.suite_count ?? 0}`,
    `- Cases: ${summary.case_count ?? 0}`,
    `- Joint route match rate: ${(summary.joint_route_match_rate ?? 0).toFixed(4)}`,
    `- Joint expected outcome rate: ${(summary.joint_expected_outcome_rate ?? 0).toFixed(4)}`,
    `- Joint contract coverage score: ${(summary.joint_contract_coverage_score ?? 0).toFixed(4)}`,
    `- Joint guardrail capture rate: ${(summary.joint_guardrail_capture_rate ?? 0).toFixed(4)}`,
    `- Source-of-truth conflict cases: ${summary.source_of_truth_conflict_case_count ?? 0}`,
    `- Explicit contract rate: ${(summary.contract_explicit_rate ?? 0).toFixed(4)}`,
    `- Generation cases: ${summary.generation_case_count ?? 0}`,
    `- Wiki cases: ${summary.wiki_case_count ?? 0}`,
    `- Memory cases: ${summary.memory_case_count ?? 0}`,
    '',
    '## Joint Reviewer Summary',
    '',
    `- Attention cases across suites: ${jointAttention}`,
    `- Joint contract coverage score: ${(summary.joint_contract_coverage_score ?? 0).toFixed(4)}`,
    `- Joint guardrail capture rate: ${(summary.joint_guardrail_capture_rate ?? 0).toFixed(4)}`,
    `- Source-of-truth conflict cases: ${summary.source_of_truth_conflict_case_count ?? 0}`,
    `- Explicit contract rate: ${(summary.contract_explicit_rate ?? 0).toFixed(4)}`,
    '',
  ];

  const generation = result.generation?.summary ?? null;
  const wiki = result.wiki?.summary ?? null;
  const memory = result.memory?.summary ?? null;

  if (generation) {
    lines.push(
      ...renderSectionMarkdown(
        'Generation Suite',
        [
          `- Decision match rate: ${(generation.decision_match_rate ?? 0).toFixed(4)}`,
          `- Route match rate: ${(generation.route_match_rate ?? 0).toFixed(4)}`,
          `- Mean faithfulness: ${(generation.mean_faithfulness ?? 0).toFixed(4)}`,
          `- Mean context precision: ${(generation.mean_context_precision ?? 0).toFixed(4)}`,
        ],
        result.generation.cases ?? [],
        (item) => `- \`${item.case_id}\`: decision=${item.judge?.decision ?? 'unknown'}, route=${item.judge?.route?.actual_route_mode ?? 'n/a'} -> ${item.judge?.route?.actual_effective_mode ?? 'n/a'}`,
      ),
    );
  }

  if (wiki) {
    lines.push(
      ...renderSectionMarkdown(
        'Wiki Suite',
        [
          `- Judge pass rate: ${(wiki.judge_pass_rate ?? 0).toFixed(4)}`,
          `- Route match rate: ${(wiki.route_match_rate ?? 0).toFixed(4)}`,
          `- Fallback match rate: ${(wiki.fallback_match_rate ?? 0).toFixed(4)}`,
          `- Recommended action match rate: ${(wiki.recommended_action_match_rate ?? 0).toFixed(4)}`,
        ],
        result.wiki.cases ?? [],
        (item) => `- \`${item.case_id}\`: decision=${item.judge?.decision ?? 'unknown'}, route=${item.judge?.route?.actual_route_mode ?? 'n/a'} -> ${item.judge?.route?.actual_effective_mode ?? 'n/a'}, recommended=${item.judge?.quality?.recommended_action ?? 'n/a'}`,
      ),
    );
  }

  if (memory) {
    lines.push(
      ...renderSectionMarkdown(
        'Memory Suite',
        [
          `- Pass rate: ${(memory.pass_rate ?? 0).toFixed(4)}`,
          `- Mean overall score: ${(memory.mean_overall_score ?? 0).toFixed(4)}`,
          `- Durable write precision: ${(memory.mean_durable_write_precision ?? 0).toFixed(4)}`,
          `- Memory recall@k: ${(memory.mean_memory_recall_at_k ?? 0).toFixed(4)}`,
        ],
        result.memory.cases ?? [],
        (item) => `- \`${item.case_id}\`: type=${item.case_type ?? 'n/a'}, provider=${item.provider ?? 'n/a'}, decision=${item.judge?.decision ?? 'unknown'}`,
      ),
    );
  }

  return `${lines.join('\n').trim()}\n`;
}

export function createKnowledgeHarness({ harnessStore = null } = {}) {
  async function run({
    generationCases = [],
    generationCasePaths = [],
    generationCasePath = null,
    wikiCases = [],
    wikiCasePaths = [],
    wikiCasePath = null,
    memoryCases = [],
    memoryCasePaths = [],
    memoryCasePath = null,
    preset = null,
    metadata = {},
  } = {}) {
    const startedAt = new Date().toISOString();
    const resolvedGenerationPaths = resolveCasePaths({
      casePaths: generationCasePaths,
      casePath: generationCasePath,
      preset,
      defaultPaths: DEFAULT_GENERATION_CASE_PATHS,
    });
    const resolvedWikiPaths = resolveCasePaths({
      casePaths: wikiCasePaths,
      casePath: wikiCasePath,
      preset,
      defaultPaths: DEFAULT_WIKI_CASE_PATHS,
    });
    const resolvedMemoryPaths = resolveCasePaths({
      casePaths: memoryCasePaths,
      casePath: memoryCasePath,
      preset,
      defaultPaths: DEFAULT_MEMORY_CASE_PATHS,
    });

    let mergedGenerationCases = Array.isArray(generationCases) ? generationCases.map((item) => clone(item)) : [];
    for (const path of resolvedGenerationPaths) {
      mergedGenerationCases = mergedGenerationCases.concat(await readJsonOrJsonl(path));
    }

    let mergedWikiCases = Array.isArray(wikiCases) ? wikiCases.map((item) => clone(item)) : [];
    for (const path of resolvedWikiPaths) {
      mergedWikiCases = mergedWikiCases.concat(await readJsonOrJsonl(path));
    }

    let mergedMemoryCases = Array.isArray(memoryCases) ? memoryCases.map((item) => clone(item)) : [];
    for (const path of resolvedMemoryPaths) {
      mergedMemoryCases = mergedMemoryCases.concat(await readJsonOrJsonl(path));
    }

    const suiteName = metadata.suite_name
      ?? metadata.suite
      ?? (preset ? `knowledge-${preset}` : 'knowledge-harness');

    const evaluation = callPythonCore('evaluate_knowledge_suite', {
      generation: {
        cases: mergedGenerationCases,
        metadata: {
          suite_name: `${suiteName}-generation`,
          case_paths: resolvedGenerationPaths.map((path) => path.replace(`${REPO_ROOT}/`, '')),
        },
      },
      wiki: {
        cases: mergedWikiCases,
        metadata: {
          suite_name: `${suiteName}-wiki`,
          case_paths: resolvedWikiPaths.map((path) => path.replace(`${REPO_ROOT}/`, '')),
        },
      },
      memory: {
        cases: mergedMemoryCases,
        metadata: {
          suite_name: `${suiteName}-memory`,
          case_paths: resolvedMemoryPaths.map((path) => path.replace(`${REPO_ROOT}/`, '')),
        },
      },
      metadata: {
        ...metadata,
        suite_name: suiteName,
      },
    });

    const runRecord = {
      run_id: evaluation.run_id,
      harness_type: 'knowledge',
      status: 'completed',
      created_at: startedAt,
      completed_at: new Date().toISOString(),
      metadata: {
        ...clone(evaluation.metadata ?? {}),
        harness_type: 'knowledge',
      },
      summary: clone(evaluation.summary ?? {}),
      metrics: clone(evaluation.summary ?? {}),
      cases: [
        ...(evaluation.generation?.cases ?? []).map((item) => ({
          suite: 'generation',
          case_id: item.case_id,
          metadata: clone(item.metadata ?? {}),
          query_frontend: clone(item.query_frontend ?? {}),
          reviewer_summary: clone(item.reviewer_summary ?? {}),
          judge: clone(item.judge ?? {}),
        })),
        ...(evaluation.wiki?.cases ?? []).map((item) => ({
          suite: 'wiki',
          case_id: item.case_id,
          metadata: clone(item.metadata ?? {}),
          query_frontend: clone(item.query_frontend ?? {}),
          reviewer_summary: clone(item.reviewer_summary ?? {}),
          judge: clone(item.judge ?? {}),
        })),
        ...(evaluation.memory?.cases ?? []).map((item) => ({
          suite: 'memory',
          case_id: item.case_id,
          metadata: clone(item.metadata ?? {}),
          reviewer_summary: clone(item.reviewer_summary ?? {}),
          judge: clone(item.judge ?? {}),
          case_type: item.case_type ?? null,
          provider: item.provider ?? null,
        })),
      ],
      artifacts: {
        review_json: clone(evaluation),
        review_markdown: renderKnowledgeReviewMarkdown(evaluation),
      },
    };

    if (harnessStore) {
      harnessStore.create(runRecord);
    }

    return {
      ...clone(runRecord),
      evaluation,
    };
  }

  return {
    run,
  };
}
