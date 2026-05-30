import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarnessStore } from '../apps/platform/src/harness-store.mjs';
import { createWikiHarness } from '../apps/platform/src/wiki-harness.mjs';

test('wiki harness runs default suite through the platform harness store', async () => {
  const harnessStore = createHarnessStore();
  const harness = createWikiHarness({ harnessStore });

  const run = await harness.run({
    preset: 'default_wiki_suite',
    metadata: {
      suite: 'wiki-platform-smoke',
    },
  });

  assert.equal(run.harness_type, 'wiki');
  assert.equal(run.summary.case_count, 14);
  assert.equal(run.summary.judge_pass_rate, 1);
  assert.equal(run.summary.route_match_rate, 1);
  assert.ok(run.artifacts.review_json);
  assert.match(run.artifacts.review_markdown, /Wiki Harness Review/);
  assert.match(run.artifacts.review_markdown, /Reviewer Summary/);
  assert.match(run.artifacts.review_markdown, /Query Frontend Signals/);
  assert.equal(run.cases[0].query_frontend.query_mode, 'status_lookup');
  assert.ok(Array.isArray(run.cases[0].query_frontend.preferred_sources));
  assert.ok(run.cases[0].reviewer_summary);

  const persisted = harnessStore.get(run.run_id);
  assert.equal(persisted.harness_type, 'wiki');
  assert.equal(persisted.summary.case_count, 14);
  assert.ok(persisted.cases[0].reviewer_summary);
  assert.equal(harnessStore.list({ harnessType: 'wiki' }).length, 1);
  assert.equal(harnessStore.list({ harnessType: 'memory' }).length, 0);
});
