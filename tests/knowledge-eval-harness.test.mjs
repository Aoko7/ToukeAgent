import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('knowledge joint harness evaluates expanded generation and wiki suites together', () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'toukeagent-knowledge-eval-'));
  const result = spawnSync(
    'python3',
    [
      'scripts/evaluate_knowledge_quality.py',
      '--generation-case-path',
      'config/generation-judge-cases.json',
      '--wiki-case-path',
      'config/wiki-freshness-cases.json',
      '--wiki-case-path',
      'config/wiki-project-cases.json',
      '--wiki-case-path',
      'config/wiki-trigma-cases.json',
      '--memory-case-path',
      'config/memory-benchmark-cases.json',
      '--output-root',
      outputRoot,
      '--benchmark-name',
      'test-knowledge-suite-expanded',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.summary.suite_count, 3);
  assert.equal(summary.summary.case_count, 29);
  assert.equal(summary.summary.generation_case_count, 11);
  assert.equal(summary.summary.wiki_case_count, 14);
  assert.equal(summary.summary.memory_case_count, 4);
  assert.ok(typeof summary.summary.joint_route_match_rate === 'number');
  assert.ok(typeof summary.summary.joint_expected_outcome_rate === 'number');
  assert.ok(typeof summary.summary.joint_contract_coverage_score === 'number');
  assert.ok(typeof summary.summary.joint_guardrail_capture_rate === 'number');
  assert.ok(typeof summary.summary.source_of_truth_conflict_case_count === 'number');
  assert.ok(typeof summary.summary.contract_explicit_rate === 'number');
  assert.equal(summary.summary.generation_summary.case_count, 11);
  assert.equal(summary.summary.generation_summary.expected_outcome_rate, 1);
  assert.equal(summary.summary.generation_summary.expected_pass_case_count, 7);
  assert.equal(summary.summary.generation_summary.expected_non_pass_case_count, 4);
  assert.equal(summary.summary.generation_summary.expected_pass_success_rate, 1);
  assert.equal(summary.summary.generation_summary.expected_non_pass_guardrail_rate, 1);
  assert.equal(summary.summary.wiki_summary.case_count, 14);
  assert.equal(summary.summary.memory_summary.case_count, 4);
  assert.equal(existsSync(join(outputRoot, 'test-knowledge-suite-expanded', 'summary.json')), true);
  assert.equal(existsSync(join(outputRoot, 'test-knowledge-suite-expanded', 'review.json')), true);
  assert.equal(existsSync(join(outputRoot, 'test-knowledge-suite-expanded', 'review.md')), true);
  const reviewMarkdown = readFileSync(join(outputRoot, 'test-knowledge-suite-expanded', 'review.md'), 'utf8');
  assert.match(reviewMarkdown, /Joint Reviewer Summary/);
  assert.match(reviewMarkdown, /Attention cases across suites/);

  const review = JSON.parse(readFileSync(join(outputRoot, 'test-knowledge-suite-expanded', 'review.json'), 'utf8'));
  assert.equal(review.generation.summary.case_count, 11);
  assert.equal(review.wiki.summary.case_count, 14);
  assert.equal(review.memory.summary.case_count, 4);
  assert.ok(review.generation.cases.find((entry) => entry.case_id === 'wiki_first_fallback_review'));
  assert.ok(review.generation.cases.find((entry) => entry.case_id === 'wiki_project_source_conflict_abstain_pass'));
  assert.ok(review.wiki.cases.find((entry) => entry.case_id === 'wiki_dynamic_fresh_accept'));
  assert.ok(review.wiki.cases.find((entry) => entry.case_id === 'wiki_project_source_conflict_needs_supplement'));
  assert.ok(review.wiki.cases.find((entry) => entry.case_id === 'wiki_trigma_mainline_map_accept'));
  assert.ok(review.memory.cases.find((entry) => entry.case_id === 'memory_recall_with_one_stale_hit'));
  assert.ok(review.generation.cases[0].query_frontend);
  assert.ok(review.wiki.cases[0].reviewer_summary);
});
