import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarnessStore } from '../apps/platform/src/harness-store.mjs';
import { createKnowledgeHarness } from '../apps/platform/src/knowledge-harness.mjs';

test('knowledge harness runs default suite through the platform harness store', async () => {
  const harnessStore = createHarnessStore();
  const harness = createKnowledgeHarness({ harnessStore });

  const run = await harness.run({
    preset: 'default_knowledge_suite',
    metadata: {
      suite: 'knowledge-platform-smoke',
    },
  });

  assert.equal(run.harness_type, 'knowledge');
  assert.equal(run.summary.suite_count, 3);
  assert.equal(run.summary.case_count, 29);
  assert.equal(run.summary.generation_case_count, 11);
  assert.equal(run.summary.wiki_case_count, 14);
  assert.equal(run.summary.memory_case_count, 4);
  assert.equal(run.summary.joint_route_match_rate, 1);
  assert.equal(run.summary.joint_expected_outcome_rate, 1);
  assert.equal(typeof run.summary.joint_contract_coverage_score, 'number');
  assert.equal(typeof run.summary.joint_guardrail_capture_rate, 'number');
  assert.equal(typeof run.summary.source_of_truth_conflict_case_count, 'number');
  assert.equal(typeof run.summary.contract_explicit_rate, 'number');
  assert.equal(run.summary.generation_summary.expected_outcome_rate, 1);
  assert.equal(run.summary.generation_summary.expected_pass_success_rate, 1);
  assert.equal(run.summary.generation_summary.expected_non_pass_guardrail_rate, 1);
  assert.ok(run.artifacts.review_json);
  assert.match(run.artifacts.review_markdown, /Knowledge Harness Review/);
  assert.match(run.artifacts.review_markdown, /Joint Reviewer Summary/);
  assert.match(run.artifacts.review_markdown, /Joint contract coverage score/);
  assert.match(run.artifacts.review_markdown, /Source-of-truth conflict cases/);
  assert.ok(run.cases.find((item) => item.suite === 'generation')?.query_frontend);
  assert.ok(run.cases.find((item) => item.suite === 'wiki')?.reviewer_summary);
  assert.ok(run.cases.find((item) => item.suite === 'memory')?.reviewer_summary);

  const persisted = harnessStore.get(run.run_id);
  assert.equal(persisted.harness_type, 'knowledge');
  assert.equal(persisted.summary.case_count, 29);
  assert.ok(persisted.cases.find((item) => item.suite === 'generation')?.reviewer_summary);
  assert.equal(harnessStore.list({ harnessType: 'knowledge' }).length, 1);
  assert.equal(harnessStore.list({ harnessType: 'memory' }).length, 0);
});
