import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { callPythonCore } from './python-core-bridge.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const DEFAULT_CASE_PATH = 'config/memory-benchmark-cases.json';

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

  if (preset === 'default_memory_suite' || preset === 'memory-default') {
    return [resolve(REPO_ROOT, DEFAULT_CASE_PATH)];
  }

  return [];
}

function renderMemoryReviewMarkdown(result) {
  const summary = result.summary ?? {};
  const cases = Array.isArray(result.cases) ? result.cases : [];
  const attentionCases = cases.filter((item) => {
    const values = Object.values(item.judge?.dimensions ?? {});
    const weakest = values.length > 0 ? Math.min(...values.map((value) => Number(value) || 0)) : 1;
    return item.judge?.decision !== 'pass' || weakest < 0.85;
  });
  const countValues = (values) => {
    const counts = new Map();
    for (const value of values) {
      const label = String(value ?? 'unknown');
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([key, value]) => `${key}=${value}`).join(', ') || 'n/a';
  };
  const lines = [
    `# Memory Harness Review: ${result.metadata?.suite_name ?? result.metadata?.suite ?? 'memory-harness'}`,
    '',
    '## Summary',
    '',
    `- Cases: ${summary.case_count ?? 0}`,
    `- Pass rate: ${(summary.pass_rate ?? 0).toFixed(4)}`,
    `- Mean overall score: ${(summary.mean_overall_score ?? 0).toFixed(4)}`,
    `- Durable write precision: ${(summary.mean_durable_write_precision ?? 0).toFixed(4)}`,
    `- Durable write recall: ${(summary.mean_durable_write_recall ?? 0).toFixed(4)}`,
    `- Memory recall@k: ${(summary.mean_memory_recall_at_k ?? 0).toFixed(4)}`,
    `- Stale memory rate: ${(summary.mean_stale_memory_rate ?? 0).toFixed(4)}`,
    `- Compression must-keep retention: ${(summary.mean_compression_must_keep_retention ?? 0).toFixed(4)}`,
    `- Handoff sufficiency rate: ${(summary.mean_handoff_sufficiency_rate ?? 0).toFixed(4)}`,
    '',
    '## Reviewer Summary',
    '',
    `- Pass / review / fail: ${summary.decision_breakdown?.pass ?? 0} / ${summary.decision_breakdown?.review ?? 0} / ${summary.decision_breakdown?.fail ?? 0}`,
    `- Case types: ${countValues(cases.map((item) => item.case_type ?? 'unknown'))}`,
    `- Providers: ${countValues(cases.map((item) => item.provider ?? 'unknown'))}`,
    `- Cases needing attention: ${attentionCases.length}`,
    '',
  ];

  if (attentionCases.length > 0) {
    for (const item of attentionCases.slice(0, 6)) {
      lines.push(`- \`${item.case_id}\`: ${item.reviewer_summary?.headline ?? item.judge?.decision ?? 'review'} · weakest=${item.reviewer_summary?.weakest_dimension ?? 'n/a'}`);
    }
    lines.push('');
  }

  const breakdowns = summary.metadata_breakdowns ?? {};
  if (breakdowns && typeof breakdowns === 'object' && Object.keys(breakdowns).length > 0) {
    lines.push('## Breakdown', '');
    for (const [key, labelMap] of Object.entries(breakdowns)) {
      lines.push(`### ${key}`, '');
      for (const [label, groupSummary] of Object.entries(labelMap ?? {})) {
        lines.push(`- \`${label}\`: cases=${groupSummary.case_count}, pass_rate=${(groupSummary.pass_rate ?? 0).toFixed(4)}, mean_overall_score=${(groupSummary.mean_overall_score ?? 0).toFixed(4)}`);
      }
      lines.push('');
    }
  }

  lines.push('## Per Case', '');
  for (const item of result.cases ?? []) {
    lines.push(`### ${item.case_id}`, '');
    lines.push(`- Headline: \`${item.reviewer_summary?.headline ?? 'n/a'}\``);
    lines.push(`- Type: \`${item.case_type}\``);
    lines.push(`- Provider: \`${item.provider}\``);
    lines.push(`- Decision: \`${item.judge?.decision ?? 'unknown'}\``);
    lines.push(`- Score: \`${(item.judge?.score ?? 0).toFixed(4)}\``);
    lines.push(`- Weakest dimension: \`${item.reviewer_summary?.weakest_dimension ?? 'n/a'}\``);
    lines.push(`- Dimensions: \`${JSON.stringify(item.judge?.dimensions ?? {}, null, 0)}\``);
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

export function createMemoryHarness({ harnessStore = null } = {}) {
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
      ?? (preset ? `memory-${preset}` : 'memory-harness');

    const evaluation = callPythonCore('evaluate_memory_suite', {
      cases: mergedCases,
      metadata: {
        ...metadata,
        suite_name: suiteName,
        case_paths: resolvedPaths.map((path) => path.replace(`${REPO_ROOT}/`, '')),
      },
    });

    const runRecord = {
      run_id: evaluation.run_id,
      harness_type: 'memory',
      status: 'completed',
      created_at: startedAt,
      completed_at: new Date().toISOString(),
      metadata: {
        ...clone(evaluation.metadata ?? {}),
        harness_type: 'memory',
      },
      summary: clone(evaluation.summary ?? {}),
      metrics: clone(evaluation.summary ?? {}),
      cases: (evaluation.cases ?? []).map((item) => ({
        case_id: item.case_id,
        case_type: item.case_type,
        provider: item.provider,
        provider_strategy: clone(item.provider_strategy ?? {}),
        metadata: clone(item.metadata ?? {}),
        reviewer_summary: clone(item.reviewer_summary ?? {}),
        judge: clone(item.judge ?? {}),
      })),
      artifacts: {
        review_json: clone(evaluation),
        review_markdown: renderMemoryReviewMarkdown(evaluation),
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
