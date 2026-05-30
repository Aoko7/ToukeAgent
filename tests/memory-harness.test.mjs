import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryHarness } from '../apps/platform/src/memory-harness.mjs';
import { createHarnessStore } from '../apps/platform/src/harness-store.mjs';

test('memory harness runs default suite through the platform harness store', async () => {
  const harnessStore = createHarnessStore();
  const harness = createMemoryHarness({ harnessStore });

  const run = await harness.run({
    preset: 'default_memory_suite',
    metadata: {
      suite: 'memory-platform-smoke',
    },
  });

  assert.equal(run.harness_type, 'memory');
  assert.equal(run.summary.case_count, 4);
  assert.equal(run.summary.pass_rate, 1);
  assert.equal(run.summary.mean_overall_score, 0.9167);
  assert.ok(run.artifacts.review_json);
  assert.match(run.artifacts.review_markdown, /Memory Harness Review/);
  assert.match(run.artifacts.review_markdown, /Reviewer Summary/);
  assert.ok(run.cases[0].reviewer_summary);
  assert.equal(typeof run.cases[0].reviewer_summary.score, 'number');

  const persisted = harnessStore.get(run.run_id);
  assert.equal(persisted.harness_type, 'memory');
  assert.equal(persisted.summary.case_count, 4);
  assert.ok(persisted.cases[0].reviewer_summary);
  assert.equal(harnessStore.list({ harnessType: 'memory' }).length, 1);
  assert.equal(harnessStore.list({ harnessType: 'task' }).length, 0);
});
