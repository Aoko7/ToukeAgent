import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callPythonCore } from './python-core-bridge.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const DEFAULT_CASE_PATHS = [
  'config/wiki-freshness-cases.json',
  'config/wiki-project-cases.json',
  'config/wiki-trigma-cases.json',
];

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

function resolveCasePaths({ casePaths = [], casePath = null, preset = null } = {}) {
  const explicitPaths = [
    ...casePaths,
    ...(casePath ? [casePath] : []),
  ].filter(Boolean);

  if (explicitPaths.length > 0) {
    return explicitPaths.map((path) => resolve(REPO_ROOT, path));
  }

  if (preset === 'default_wiki_suite' || preset === 'wiki-default') {
    return DEFAULT_CASE_PATHS.map((path) => resolve(REPO_ROOT, path));
  }

  return [];
}

function renderWikiReviewMarkdown(result) {
  const summary = result.summary ?? {};
  const cases = Array.isArray(result.cases) ? result.cases : [];
  const attentionCases = cases.filter((item) => item.judge?.decision !== 'pass' || item.judge?.route?.fallback_applied || item.judge?.quality?.recommended_action !== 'accept');
  const countValues = (values) => {
    const counts = new Map();
    for (const value of values) {
      const label = String(value ?? 'unknown');
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([key, value]) => `${key}=${value}`).join(', ') || 'n/a';
  };
  const lines = [
    `# Wiki Harness Review: ${result.metadata?.suite_name ?? result.metadata?.suite ?? 'wiki-harness'}`,
    '',
    '## Summary',
    '',
    `- Cases: ${summary.case_count ?? 0}`,
    `- Judge pass rate: ${(summary.judge_pass_rate ?? 0).toFixed(4)}`,
    `- Route match rate: ${(summary.route_match_rate ?? 0).toFixed(4)}`,
    `- Effective route match rate: ${(summary.effective_route_match_rate ?? 0).toFixed(4)}`,
    `- Fallback match rate: ${(summary.fallback_match_rate ?? 0).toFixed(4)}`,
    `- Recommended action match rate: ${(summary.recommended_action_match_rate ?? 0).toFixed(4)}`,
    `- Mean retrieval score: ${(summary.mean_retrieval_score ?? 0).toFixed(4)}`,
    `- Mean freshness score: ${(summary.mean_freshness_score ?? 0).toFixed(4)}`,
    `- Mean contract coverage score: ${(summary.mean_contract_coverage_score ?? 0).toFixed(4)}`,
    '',
    '## Reviewer Summary',
    '',
    `- Pass / review / fail: ${summary.decision_breakdown?.pass ?? 0} / ${summary.decision_breakdown?.review ?? 0} / ${summary.decision_breakdown?.fail ?? 0}`,
    `- Fallback cases: ${cases.filter((item) => item.judge?.route?.fallback_applied).length}`,
    `- Non-accept recommendations: ${cases.filter((item) => item.judge?.quality?.recommended_action !== 'accept').length}`,
    `- Cases needing attention: ${attentionCases.length}`,
    '',
    '## Query Frontend Signals',
    '',
    `- Query modes: ${countValues(cases.map((item) => item.query_frontend?.query_mode ?? 'unknown'))}`,
    `- Decomposition: ${countValues(cases.map((item) => item.query_frontend?.decomposition_strategy ?? 'unknown'))}`,
    `- Rewrite: ${countValues(cases.map((item) => item.query_frontend?.rewrite_strategy ?? 'unknown'))}`,
    `- Preferred sources: ${countValues(cases.flatMap((item) => item.query_frontend?.preferred_sources ?? []))}`,
    '',
  ];

  if (attentionCases.length > 0) {
    for (const item of attentionCases.slice(0, 8)) {
      lines.push(`- \`${item.case_id}\`: ${item.reviewer_summary?.headline ?? item.judge?.decision ?? 'review'} · fallback=${item.judge?.route?.fallback_applied ?? false} · action=${item.judge?.quality?.recommended_action ?? 'n/a'}`);
    }
    lines.push('');
  }

  const breakdowns = summary.metadata_breakdowns ?? {};
  if (breakdowns && typeof breakdowns === 'object' && Object.keys(breakdowns).length > 0) {
    lines.push('## Breakdown', '');
    for (const [key, labelMap] of Object.entries(breakdowns)) {
      lines.push(`### ${key}`, '');
      for (const [label, groupSummary] of Object.entries(labelMap ?? {})) {
        lines.push(
          `- \`${label}\`: cases=${groupSummary.case_count}, pass_rate=${(groupSummary.judge_pass_rate ?? 0).toFixed(4)}, route_match=${(groupSummary.route_match_rate ?? 0).toFixed(4)}, fallback_match=${(groupSummary.fallback_match_rate ?? 0).toFixed(4)}`,
        );
      }
      lines.push('');
    }
  }

  lines.push('## Per Case', '');
  for (const item of result.cases ?? []) {
    lines.push(`### ${item.case_id}`, '');
    lines.push(`- Headline: \`${item.reviewer_summary?.headline ?? 'n/a'}\``);
    lines.push(`- Decision: \`${item.judge?.decision ?? 'unknown'}\``);
    lines.push(`- Score: \`${(item.judge?.score ?? 0).toFixed(4)}\``);
    lines.push(`- Route: \`${item.judge?.route?.actual_route_mode ?? 'n/a'} -> ${item.judge?.route?.actual_effective_mode ?? 'n/a'}\``);
    lines.push(`- Fallback applied: \`${item.judge?.route?.fallback_applied ?? false}\``);
    lines.push(`- Recommended action: \`${item.judge?.quality?.recommended_action ?? 'n/a'}\``);
    lines.push(`- Query frontend: \`mode=${item.query_frontend?.query_mode ?? 'n/a'}, boundary=${item.query_frontend?.boundary_action ?? 'n/a'}, clarify=${item.query_frontend?.clarification_required ?? false}, decompose=${item.query_frontend?.decomposition_strategy ?? 'n/a'}, rewrite=${item.query_frontend?.rewrite_strategy ?? 'n/a'}\``);
    lines.push(`- Preferred sources: \`${(item.query_frontend?.preferred_sources ?? []).join(', ') || 'n/a'}\``);
    lines.push(`- Citation titles: \`${(item.judge?.citation_titles ?? []).join(', ')}\``);
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

export function createWikiHarness({ harnessStore = null } = {}) {
  async function run({
    cases = [],
    casePaths = [],
    casePath = null,
    preset = null,
    metadata = {},
  } = {}) {
    const startedAt = new Date().toISOString();
    const resolvedPaths = resolveCasePaths({ casePaths, casePath, preset });
    let mergedCases = Array.isArray(cases) ? cases.map((item) => clone(item)) : [];
    for (const path of resolvedPaths) {
      const loaded = await readJsonOrJsonl(path);
      mergedCases = mergedCases.concat(loaded);
    }

    const suiteName = metadata.suite_name
      ?? metadata.suite
      ?? (preset ? `wiki-${preset}` : 'wiki-harness');

    const evaluation = callPythonCore('evaluate_wiki_suite', {
      cases: mergedCases,
      metadata: {
        ...metadata,
        suite_name: suiteName,
        case_paths: resolvedPaths.map((path) => path.replace(`${REPO_ROOT}/`, '')),
      },
    });

    const runRecord = {
      run_id: evaluation.run_id,
      harness_type: 'wiki',
      status: 'completed',
      created_at: startedAt,
      completed_at: new Date().toISOString(),
      metadata: {
        ...clone(evaluation.metadata ?? {}),
        harness_type: 'wiki',
      },
      summary: clone(evaluation.summary ?? {}),
      metrics: clone(evaluation.summary ?? {}),
      cases: (evaluation.cases ?? []).map((item) => ({
        case_id: item.case_id,
        metadata: clone(item.metadata ?? {}),
        reference: clone(item.reference ?? {}),
        query_frontend: clone(item.query_frontend ?? {}),
        reviewer_summary: clone(item.reviewer_summary ?? {}),
        judge: clone(item.judge ?? {}),
      })),
      artifacts: {
        review_json: clone(evaluation),
        review_markdown: renderWikiReviewMarkdown(evaluation),
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
