import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('generation judge harness evaluates curated rag and wiki cases', () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'toukeagent-generation-eval-'));
  const result = spawnSync(
    'python3',
    [
      'scripts/evaluate_generation_quality.py',
      '--case-path',
      'tests/fixtures/generation-judge-cases.json',
      '--output-root',
      outputRoot,
      '--benchmark-name',
      'test-generation-suite',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.summary.case_count, 6);
  assert.equal(summary.summary.decision_match_rate, 1);
  assert.equal(summary.summary.expected_outcome_rate, 1);
  assert.equal(summary.summary.route_match_rate, 1);
  assert.equal(summary.summary.expected_pass_case_count, 4);
  assert.equal(summary.summary.expected_non_pass_case_count, 2);
  assert.equal(summary.summary.expected_pass_success_rate, 1);
  assert.equal(summary.summary.expected_review_match_rate, 1);
  assert.equal(summary.summary.expected_fail_match_rate, 1);
  assert.equal(summary.summary.expected_non_pass_guardrail_rate, 1);
  assert.ok(typeof summary.summary.mean_behavior_alignment === 'number');
  assert.ok(typeof summary.summary.mean_faithfulness === 'number');
  assert.ok(typeof summary.summary.mean_answer_relevancy === 'number');
  assert.ok(typeof summary.summary.mean_context_recall === 'number');
  assert.ok(typeof summary.summary.mean_context_precision === 'number');
  assert.ok(typeof summary.summary.mean_citation_match_rate === 'number');
  assert.equal(summary.summary.metadata_breakdowns.domain.rag.case_count, 2);
  assert.equal(summary.summary.metadata_breakdowns.domain.wiki.case_count, 4);
  assert.equal(summary.summary.metadata_breakdowns.route_family['rag-first'].case_count, 2);
  assert.equal(summary.summary.metadata_breakdowns.route_family['wiki-first'].case_count, 4);
  assert.equal(summary.summary.metadata_breakdowns.language.en.case_count, 2);
  assert.equal(summary.summary.metadata_breakdowns.language.zh.case_count, 4);
  assert.equal(summary.summary.metadata_breakdowns.tags.clarify.case_count, 1);
  assert.equal(summary.summary.metadata_breakdowns.tags.abstain.case_count, 1);
  assert.equal(existsSync(join(outputRoot, 'test-generation-suite', 'summary.json')), true);
  assert.equal(existsSync(join(outputRoot, 'test-generation-suite', 'review.json')), true);
  assert.equal(existsSync(join(outputRoot, 'test-generation-suite', 'review.md')), true);
  const reviewMarkdown = readFileSync(join(outputRoot, 'test-generation-suite', 'review.md'), 'utf8');
  assert.match(reviewMarkdown, /Reviewer Summary/);
  assert.match(reviewMarkdown, /Query Frontend Signals/);

  const review = JSON.parse(readFileSync(join(outputRoot, 'test-generation-suite', 'review.json'), 'utf8'));
  const clarifyCase = review.cases.find((entry) => entry.case_id === 'wiki_first_clarify_pass');
  const abstainCase = review.cases.find((entry) => entry.case_id === 'wiki_first_abstain_pass');
  assert.ok(clarifyCase);
  assert.ok(abstainCase);
  assert.equal(clarifyCase.judge.decision, 'pass');
  assert.equal(clarifyCase.judge.behavior.actual_behavior, 'clarify');
  assert.equal(clarifyCase.judge.behavior.expected_behavior, 'clarify');
  assert.equal(abstainCase.judge.decision, 'pass');
  assert.equal(abstainCase.judge.behavior.actual_behavior, 'abstain');
  assert.equal(abstainCase.judge.behavior.expected_behavior, 'abstain');
  assert.ok(clarifyCase.query_frontend);
  assert.ok(Array.isArray(clarifyCase.query_frontend.preferred_sources));
  assert.ok(clarifyCase.reviewer_summary);
});
