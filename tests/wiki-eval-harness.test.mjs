import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('wiki quality harness evaluates freshness, fallback, and route consistency', () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'toukeagent-wiki-eval-'));
  const result = spawnSync(
    'python3',
    [
      'scripts/evaluate_wiki_quality.py',
      '--case-path',
      'config/wiki-freshness-cases.json',
      '--case-path',
      'config/wiki-project-cases.json',
      '--case-path',
      'config/wiki-trigma-cases.json',
      '--output-root',
      outputRoot,
      '--benchmark-name',
      'test-wiki-suite',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.summary.case_count, 14);
  assert.equal(summary.summary.judge_pass_rate, 1);
  assert.equal(summary.summary.route_match_rate, 1);
  assert.equal(summary.summary.effective_route_match_rate, 1);
  assert.equal(summary.summary.fallback_match_rate, 1);
  assert.equal(summary.summary.recommended_action_match_rate, 1);
  assert.ok(typeof summary.summary.mean_retrieval_score === 'number');
  assert.ok(typeof summary.summary.mean_freshness_score === 'number');
  assert.ok(typeof summary.summary.mean_contract_coverage_score === 'number');
  assert.equal(summary.summary.metadata_breakdowns.domain.wiki.case_count, 13);
  assert.equal(summary.summary.metadata_breakdowns.domain.rag.case_count, 1);
  assert.equal(summary.summary.metadata_breakdowns.route_family['wiki-first'].case_count, 13);
  assert.equal(summary.summary.metadata_breakdowns.route_family['rag-first'].case_count, 1);
  assert.equal(existsSync(join(outputRoot, 'test-wiki-suite', 'summary.json')), true);
  assert.equal(existsSync(join(outputRoot, 'test-wiki-suite', 'review.json')), true);
  assert.equal(existsSync(join(outputRoot, 'test-wiki-suite', 'review.md')), true);
  const reviewMarkdown = readFileSync(join(outputRoot, 'test-wiki-suite', 'review.md'), 'utf8');
  assert.match(reviewMarkdown, /Reviewer Summary/);
  assert.match(reviewMarkdown, /Query Frontend Signals/);

  const review = JSON.parse(readFileSync(join(outputRoot, 'test-wiki-suite', 'review.json'), 'utf8'));
  const fallbackCase = review.cases.find((entry) => entry.case_id === 'wiki_first_fallback_to_rag');
  const staleCase = review.cases.find((entry) => entry.case_id === 'wiki_stale_dynamic_needs_supplement');
  const refreshPairCase = review.cases.find((entry) => entry.case_id === 'wiki_project_stale_refresh_pair_accept');
  const sourceConflictCase = review.cases.find((entry) => entry.case_id === 'wiki_project_source_conflict_needs_supplement');
  const architectureCase = review.cases.find((entry) => entry.case_id === 'wiki_project_architecture_status_accept');
  const binmaeCase = review.cases.find((entry) => entry.case_id === 'wiki_project_binmae_status_accept');
  const importAugCase = review.cases.find((entry) => entry.case_id === 'wiki_project_import_augmentation_status_accept');
  const upxCase = review.cases.find((entry) => entry.case_id === 'wiki_project_upx_status_accept');
  const trigmaMainlineCase = review.cases.find((entry) => entry.case_id === 'wiki_trigma_mainline_map_accept');
  const trigmaLeaderboardCase = review.cases.find((entry) => entry.case_id === 'wiki_trigma_workspace_leaderboard_accept');
  const trigmaGateCase = review.cases.find((entry) => entry.case_id === 'wiki_trigma_gate_status_accept');
  assert.ok(fallbackCase);
  assert.ok(staleCase);
  assert.ok(refreshPairCase);
  assert.ok(sourceConflictCase);
  assert.ok(architectureCase);
  assert.ok(binmaeCase);
  assert.ok(importAugCase);
  assert.ok(upxCase);
  assert.ok(trigmaMainlineCase);
  assert.ok(trigmaLeaderboardCase);
  assert.ok(trigmaGateCase);
  assert.equal(fallbackCase.judge.route.actual_effective_mode, 'rag-first');
  assert.equal(fallbackCase.judge.route.fallback_applied, true);
  assert.equal(fallbackCase.judge.quality.recommended_action, 'supplement_wiki');
  assert.equal(staleCase.judge.quality.recommended_action, 'supplement_rag');
  assert.equal(refreshPairCase.judge.quality.recommended_action, 'accept');
  assert.equal(sourceConflictCase.judge.quality.recommended_action, 'supplement_rag');
  assert.equal(sourceConflictCase.judge.quality.primary_source_count, 2);
  assert.equal(architectureCase.judge.quality.recommended_action, 'accept');
  assert.equal(binmaeCase.judge.quality.recommended_action, 'accept');
  assert.equal(importAugCase.judge.quality.recommended_action, 'accept');
  assert.equal(upxCase.judge.quality.recommended_action, 'accept');
  assert.equal(trigmaMainlineCase.judge.quality.recommended_action, 'accept');
  assert.equal(trigmaLeaderboardCase.judge.quality.recommended_action, 'accept');
  assert.equal(trigmaGateCase.judge.quality.recommended_action, 'accept');
  assert.equal(fallbackCase.query_frontend.query_mode, 'status_lookup');
  assert.ok(Array.isArray(fallbackCase.query_frontend.preferred_sources));
  assert.ok(fallbackCase.reviewer_summary);
});
