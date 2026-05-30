import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSinglePaperChunkFixture } from './helpers/chunk-fixture.mjs';

function buildChunkRootForManifests() {
  const outputDir = mkdtempSync(join(tmpdir(), 'toukeagent-benchmark-chunks-'));
  for (const manifestPath of [
    'data/papers/manifests/acl-2024-offset0-limit20.jsonl',
    'data/papers/manifests/emnlp-2024-offset0-limit20.jsonl',
  ]) {
    const ingest = spawnSync(
      'python3',
      [
        'scripts/ingest_papers.py',
        '--manifest-path',
        manifestPath,
        '--limit',
        '1',
        '--output-dir',
        outputDir,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );
    assert.equal(ingest.status, 0, ingest.stderr);
  }
  return outputDir;
}

test('retrieval benchmark compares baseline and cleaned chunk corpora', () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'toukeagent-retrieval-benchmark-'));
  const chunkRoot = buildChunkRootForManifests();
  const result = spawnSync(
    'python3',
    [
      'scripts/benchmark_retrieval_quality.py',
      '--manifest-path',
      'data/papers/manifests/acl-2024-offset0-limit20.jsonl',
      '--manifest-path',
      'data/papers/manifests/emnlp-2024-offset0-limit20.jsonl',
      '--baseline-chunk-root',
      chunkRoot,
      '--candidate-chunk-root',
      chunkRoot,
      '--output-root',
      outputRoot,
      '--benchmark-name',
      'test-benchmark',
      '--query-case-path',
      'tests/fixtures/retrieval-benchmark-cases.json',
      '--gold-case-path',
      'tests/fixtures/retrieval-benchmark-gold.json',
      '--top-k',
      '3',
      '--force-backend',
      'deterministic_hash',
      '--index-batch-size',
      '64',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.queries, 2);
  assert.equal(summary.query_mode, 'curated');
  assert.deepEqual(summary.recall_modes, { baseline: 'hybrid', candidate: 'hybrid' });
  assert.deepEqual(summary.rrf_channel_weights, { baseline: {}, candidate: {} });
  assert.deepEqual(summary.ablations, {
    baseline: { query: 'none', evidence: 'none' },
    candidate: { query: 'none', evidence: 'none' },
  });
  assert.equal(summary.baseline.query_count, 2);
  assert.equal(summary.candidate.query_count, 2);
  assert.equal(summary.baseline.recall_mode, 'hybrid');
  assert.equal(summary.candidate.recall_mode, 'hybrid');
  assert.deepEqual(summary.baseline.rrf_channel_weights, {});
  assert.deepEqual(summary.candidate.rrf_channel_weights, {});
  assert.equal(summary.baseline.query_ablation, 'none');
  assert.equal(summary.candidate.query_ablation, 'none');
  assert.equal(summary.baseline.evidence_ablation, 'none');
  assert.equal(summary.candidate.evidence_ablation, 'none');
  assert.ok(typeof summary.baseline.top1_accuracy === 'number');
  assert.ok(typeof summary.candidate.top1_accuracy === 'number');
  assert.ok(typeof summary.baseline.hit_at_1 === 'number');
  assert.ok(typeof summary.candidate.hit_at_1 === 'number');
  assert.ok(typeof summary.baseline.hit_at_3 === 'number');
  assert.ok(typeof summary.candidate.hit_at_3 === 'number');
  assert.ok(typeof summary.baseline.mrr === 'number');
  assert.ok(typeof summary.candidate.mrr === 'number');
  assert.ok(typeof summary.delta.mean_citation_proxy === 'number');
  assert.ok(typeof summary.delta.mean_support_low_signal_ratio === 'number');
  assert.ok(typeof summary.delta.filter_plan_hard_enforce_rate === 'number');
  assert.ok(typeof summary.delta.filter_result_hard_enforce_rate === 'number');
  assert.ok(typeof summary.delta.filter_hard_empty_rate === 'number');
  assert.ok(typeof summary.delta.filter_recovered_soft_prefer_rate === 'number');
  assert.ok(typeof summary.delta.filter_mode_drift_rate === 'number');
  assert.ok(typeof summary.delta.requested_filter_case_rate === 'number');
  assert.ok(typeof summary.delta.effective_filter_case_rate === 'number');
  assert.ok(typeof summary.delta.mean_context_recall === 'number');
  assert.ok(typeof summary.delta.mean_context_precision === 'number');
  assert.ok(typeof summary.delta.mean_snippet_context_recall === 'number');
  assert.ok(typeof summary.delta.mean_snippet_context_precision === 'number');
  assert.ok(typeof summary.delta.mean_citation_span_match_rate === 'number');
  assert.ok(typeof summary.delta.top1_miss_count === 'number');
  assert.ok(typeof summary.delta.hard_negative_top1_collision_rate === 'number');
  assert.ok(typeof summary.delta.hard_negative_top3_collision_rate === 'number');
  assert.ok(typeof summary.delta.hard_negative_outranked_expected_rate === 'number');
  assert.ok(typeof summary.delta.hit_at_1 === 'number');
  assert.ok(typeof summary.delta.hit_at_3 === 'number');
  assert.ok(typeof summary.delta.mrr === 'number');
  assert.equal(summary.evaluation_fidelity.label, 'hash_smoke_only');
  assert.equal(summary.evaluation_fidelity.level, 'low');
  assert.equal(summary.baseline.annotated_case_count, 2);
  assert.equal(summary.candidate.annotated_case_count, 2);
  assert.equal(summary.baseline.snippet_annotated_case_count, 2);
  assert.equal(summary.candidate.snippet_annotated_case_count, 2);
  assert.ok(typeof summary.baseline.mean_context_recall === 'number');
  assert.ok(typeof summary.candidate.mean_context_recall === 'number');
  assert.ok(typeof summary.baseline.mean_context_precision === 'number');
  assert.ok(typeof summary.candidate.mean_context_precision === 'number');
  assert.ok(typeof summary.baseline.filter_plan_hard_enforce_rate === 'number');
  assert.ok(typeof summary.candidate.filter_plan_hard_enforce_rate === 'number');
  assert.ok(typeof summary.baseline.filter_result_hard_enforce_rate === 'number');
  assert.ok(typeof summary.candidate.filter_result_hard_enforce_rate === 'number');
  assert.ok(typeof summary.baseline.filter_hard_empty_rate === 'number');
  assert.ok(typeof summary.candidate.filter_hard_empty_rate === 'number');
  assert.ok(typeof summary.baseline.filter_recovered_soft_prefer_rate === 'number');
  assert.ok(typeof summary.candidate.filter_recovered_soft_prefer_rate === 'number');
  assert.ok(typeof summary.baseline.filter_mode_drift_rate === 'number');
  assert.ok(typeof summary.candidate.filter_mode_drift_rate === 'number');
  assert.ok(typeof summary.baseline.requested_filter_case_rate === 'number');
  assert.ok(typeof summary.candidate.requested_filter_case_rate === 'number');
  assert.ok(typeof summary.baseline.effective_filter_case_rate === 'number');
  assert.ok(typeof summary.candidate.effective_filter_case_rate === 'number');
  assert.ok(typeof summary.baseline.mean_snippet_context_recall === 'number');
  assert.ok(typeof summary.candidate.mean_snippet_context_recall === 'number');
  assert.ok(typeof summary.baseline.mean_snippet_context_precision === 'number');
  assert.ok(typeof summary.candidate.mean_snippet_context_precision === 'number');
  assert.ok(typeof summary.baseline.mean_citation_span_match_rate === 'number');
  assert.ok(typeof summary.candidate.mean_citation_span_match_rate === 'number');
  assert.equal(summary.baseline.hard_negative_case_count, 2);
  assert.equal(summary.candidate.hard_negative_case_count, 2);
  assert.ok(typeof summary.baseline.top1_miss_count === 'number');
  assert.ok(typeof summary.candidate.top1_miss_count === 'number');
  assert.equal(typeof summary.baseline.top_distractor_taxonomy, 'object');
  assert.equal(typeof summary.candidate.top_distractor_taxonomy, 'object');
  assert.equal(summary.baseline.group_breakdowns.conference_id.acl.case_count, 1);
  assert.equal(summary.baseline.group_breakdowns.conference_id.emnlp.case_count, 1);
  assert.equal(summary.candidate.group_breakdowns.difficulty['hard-negative'].case_count, 1);
  assert.equal(summary.candidate.group_breakdowns.difficulty.standard.case_count, 1);
  assert.equal(summary.candidate.group_breakdowns.query_mode.procedure.case_count, 1);
  assert.equal(summary.candidate.group_breakdowns.boundary_action.decompose.case_count, 1);
  assert.equal(summary.candidate.group_breakdowns.route_mode['rag-first'].case_count, 2);
  assert.equal(summary.candidate.group_breakdowns.filter_result_mode.soft_prefer.case_count, 2);
  assert.equal(summary.candidate.group_breakdowns.filter_hard_empty.false.case_count, 2);
  assert.equal(summary.candidate.group_breakdowns.tags.llm.case_count, 1);
  assert.equal(summary.candidate.group_breakdowns.tags.prompting.case_count, 1);
  assert.equal(typeof summary.candidate.group_breakdowns.difficulty['hard-negative'].top_distractor_taxonomy, 'object');
  assert.equal(existsSync(join(outputRoot, 'test-benchmark', 'benchmark-summary.json')), true);
  assert.equal(existsSync(join(outputRoot, 'test-benchmark', 'resolved-queries.json')), true);
  assert.equal(existsSync(join(outputRoot, 'test-benchmark', 'review.json')), true);
  assert.equal(existsSync(join(outputRoot, 'test-benchmark', 'review.md')), true);
  assert.ok(typeof summary.review_json_path === 'string');
  assert.ok(typeof summary.review_md_path === 'string');

  const review = JSON.parse(readFileSync(summary.review_json_path, 'utf8'));
  assert.deepEqual(review.recall_modes, { baseline: 'hybrid', candidate: 'hybrid' });
  assert.deepEqual(review.rrf_channel_weights, { baseline: {}, candidate: {} });
  assert.deepEqual(review.ablations, {
    baseline: { query: 'none', evidence: 'none' },
    candidate: { query: 'none', evidence: 'none' },
  });
  assert.equal(review.baseline.recall_mode, 'hybrid');
  assert.equal(review.candidate.recall_mode, 'hybrid');
  assert.deepEqual(review.baseline.rrf_channel_weights, {});
  assert.deepEqual(review.candidate.rrf_channel_weights, {});
  assert.equal(review.baseline.query_ablation, 'none');
  assert.equal(review.candidate.query_ablation, 'none');
  assert.equal(review.baseline.evidence_ablation, 'none');
  assert.equal(review.candidate.evidence_ablation, 'none');
  const mageCandidate = review.candidate.review_entries.find((entry) => entry.case_id === 'mage_deepfake_text');
  assert.ok(mageCandidate);
  assert.equal(mageCandidate.query_mode, 'procedure');
  assert.equal(mageCandidate.boundary_action, 'decompose');
  assert.equal(mageCandidate.clarification_required, false);
  assert.equal(mageCandidate.decomposition_strategy, 'procedure_split');
  assert.equal(mageCandidate.rewrite_strategy, 'decompose_then_expand');
  assert.equal(mageCandidate.subquery_count, 2);
  assert.equal(mageCandidate.rewrite_count, 2);
  assert.deepEqual(mageCandidate.preferred_sources, ['rag']);
  assert.equal(mageCandidate.difficulty, 'hard-negative');
  assert.equal(Array.isArray(mageCandidate.hard_negative_doc_ids), true);
  assert.equal(mageCandidate.hard_negative_doc_ids.length, 1);
  assert.equal(mageCandidate.hard_negative_case_count, 1);
  assert.equal(mageCandidate.query_frontend.query_mode, 'procedure');
  assert.equal(mageCandidate.query_frontend.boundary_action, 'decompose');
  assert.equal(mageCandidate.query_frontend.subquery_count, 2);
  assert.equal(mageCandidate.filter_plan_mode, 'soft_prefer');
  assert.equal(mageCandidate.filter_policy_mode, 'soft_prefer');
  assert.equal(mageCandidate.filter_hard_empty, false);
  assert.equal(mageCandidate.filter_fallback_reason, null);
  assert.equal(typeof mageCandidate.filtered_candidate_count, 'number');
  assert.deepEqual(mageCandidate.requested_filters, {});
  assert.deepEqual(mageCandidate.effective_filters, {});
  assert.equal(mageCandidate.filter_recovered_soft_prefer ?? false, false);
  assert.equal(mageCandidate.filter_mode_drift, false);

  const candidateMiss = review.candidate.review_entries.find((entry) => entry.top_distractor_present);
  assert.ok(candidateMiss);
  assert.equal(typeof candidateMiss.top_distractor_taxonomy, 'string');
  assert.equal(Array.isArray(candidateMiss.top_distractor_query_overlap), true);
  assert.equal(Array.isArray(candidateMiss.top_distractor_shared_families), true);
  assert.equal(typeof review.candidate.top_distractor_taxonomy, 'object');
});

test('retrieval benchmark low-signal heuristic flags chart and figure-heavy snippets', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import importlib.util
import json
from pathlib import Path

module_path = Path("scripts/benchmark_retrieval_quality.py").resolve()
spec = importlib.util.spec_from_file_location("benchmark_retrieval_quality", module_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

payload = {
    "axis_chart": module.is_low_signal_support_text("0 UE 1 UE 2 UEs 3 UEs 400Memory (MB) Vanilla 5G-Spector (b) RIC Memory overhead."),
    "figure_metric": module.is_low_signal_support_text("1.0 Similarity score Success threshold Figure 11: Left: Number of successful adversarial circuits."),
    "plain_prose": module.is_low_signal_support_text("We evaluate retrieval quality across technical documents and observe fewer duplicate chunks after denoising."),
}
print(json.dumps(payload))
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.axis_chart, true);
  assert.equal(payload.figure_metric, true);
  assert.equal(payload.plain_prose, false);
});

test('retrieval fusion downranks low-signal figure chunks during runtime rerank', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json
from toukeagent_core import retrieval as module

figure_payload = {
    "doc_id": "paper::figure::1",
    "chunk_id": "paper::figure::1::chunk::1",
    "paper_title": "Quantized Side Tuning",
    "title": "Quantized Side Tuning",
    "source_type": "rag",
    "freshness": "stable",
    "text": "Figure 11: 0 UE 1 UE 2 UEs 3 UEs 400Memory (MB) Vanilla 5G-Spector (b) RIC Memory overhead.",
    "section_path": ["4 Results", "Figure 11"],
    "metadata": {"conference_id": "acl", "publication_year": 2024},
}
method_payload = {
    "doc_id": "paper::method::1",
    "chunk_id": "paper::method::1::chunk::1",
    "paper_title": "Quantized Side Tuning",
    "title": "Quantized Side Tuning",
    "source_type": "rag",
    "freshness": "stable",
    "text": "We propose quantized side tuning as a fast and memory efficient tuning method for quantized large language models.",
    "section_path": ["3 Method"],
    "metadata": {"conference_id": "acl", "publication_year": 2024},
}

semantic_hits = module._normalize_scores([
    {"payload": figure_payload, "score": 1.0, "metadata_match_score": 1.0},
    {"payload": method_payload, "score": 0.93, "metadata_match_score": 1.0},
], "score")
bm25_hits = module._normalize_scores([
    {"payload": figure_payload, "score": 1.0, "metadata_match_score": 1.0},
    {"payload": method_payload, "score": 0.94, "metadata_match_score": 1.0},
], "score")
items, diagnostics = module._fuse_ranked_hits(
    semantic_hits,
    bm25_hits,
    limit=2,
    effective_mode="rag-first",
    filters={"conference_id": ["acl"]},
    filter_policy={"mode": "soft_prefer"},
    query_terms=["quantized", "side", "tuning"],
)
print(json.dumps({
    "doc_ids": [item.get("doc_id") for item in items],
    "low_signal_flags": [item.get("low_signal") for item in items],
    "rerank_adjustments": [item.get("rerank_adjustment") for item in items],
    "diagnostics": diagnostics,
}))
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.doc_ids, ['paper::method::1', 'paper::figure::1']);
  assert.deepEqual(payload.low_signal_flags, [false, true]);
  assert.ok(payload.rerank_adjustments[0] > payload.rerank_adjustments[1]);
  assert.equal(payload.diagnostics.low_signal_candidate_count, 1);
});

test('retrieval support selection prefers substantive sections over front matter', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import importlib.util
import json
from pathlib import Path

module_path = Path("toukeagent_core/retrieval.py").resolve()
from toukeagent_core import retrieval as module

chunks = [
    {"score": 0.59, "section_path": ["Front Matter"], "section": "Front Matter"},
    {"score": 0.54, "section_path": ["Abstract"], "section": "Abstract"},
    {"score": 0.49, "section_path": ["4 Experiments", "4.4 Results"], "section": "4.4 Results"},
    {"score": 0.40, "section_path": ["2 Related Work"], "section": "2 Related Work"},
    {"score": 0.38, "section_path": ["3 FIZZ", "3.3 Atomic Facts Scoring"], "section": "3.3 Atomic Facts Scoring"},
]

selected = module.select_supporting_chunks(chunks, max_chunks=3)
payload = [" > ".join(chunk.get("section_path") or []) for chunk in selected]
print(json.dumps(payload))
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.includes('Front Matter'), false);
  assert.equal(payload.includes('2 Related Work'), true);
  assert.equal(payload.includes('3 FIZZ > 3.3 Atomic Facts Scoring'), true);
  assert.equal(payload.includes('4 Experiments > 4.4 Results'), false);
  assert.equal(payload.length, 2);
});

test('retrieval support selection compacts background when method and conclusion already cover the paper', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json
from toukeagent_core import retrieval as module

chunks = [
    {
        "score": 0.43,
        "retrieval_score": 0.39,
        "section_path": ["1 Introduction"],
        "section": "1 Introduction",
        "snippet": "This introduction discusses side networks and memory footprint for finetuning large language models.",
    },
    {
        "score": 0.58,
        "retrieval_score": 0.42,
        "section_path": ["3 Quantized Side Tuning"],
        "section": "3 Quantized Side Tuning",
        "snippet": "This section details the quantized side tuning procedure and its lower memory overhead.",
    },
    {
        "score": 0.47,
        "retrieval_score": 0.39,
        "section_path": ["5 Conclusion"],
        "section": "5 Conclusion",
        "snippet": "We summarize the dual-stage process with 4-bit quantization and a side network.",
    },
]

selected = module.select_supporting_chunks(
    chunks,
    max_chunks=3,
    query_terms=["side", "tuning", "quantized", "memory", "overhead"],
)
payload = [" > ".join(chunk.get("section_path") or []) for chunk in selected]
print(json.dumps(payload))
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload, ['3 Quantized Side Tuning', '5 Conclusion']);
});

test('retrieval support selection keeps introduction over related work when compressing duplicate backgrounds', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json
from toukeagent_core import retrieval as module

chunks = [
    {
        "score": 0.43,
        "retrieval_score": 0.39,
        "section_path": ["2 Related Work"],
        "section": "2 Related Work",
        "snippet": "This section surveys prior detectors and out-of-distribution settings for machine-generated text.",
    },
    {
        "score": 0.58,
        "retrieval_score": 0.39,
        "section_path": ["1 Introduction"],
        "section": "1 Introduction",
        "snippet": "This introduction highlights limits in specific domains and deepfake texts in the wild.",
    },
    {
        "score": 0.47,
        "retrieval_score": 0.39,
        "section_path": ["7 Analysis", "7.2 Double-edged Sword of Perplexity Bias"],
        "section": "7.2 Double-edged Sword of Perplexity Bias",
        "snippet": "We analyze perplexity bias and paraphrasing attacks in detection.",
    },
]

selected = module.select_supporting_chunks(
    chunks,
    max_chunks=3,
    query_terms=["deepfake", "text", "wild", "domains", "perplexity"],
)
payload = [" > ".join(chunk.get("section_path") or []) for chunk in selected]
print(json.dumps(payload))
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.sort(), ['1 Introduction', '7 Analysis > 7.2 Double-edged Sword of Perplexity Bias'].sort());
});

test('retrieval support selection can collapse method plus conclusion into a single summary chunk', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json
from toukeagent_core import retrieval as module

chunks = [
    {
        "score": 0.58,
        "retrieval_score": 0.42,
        "section_path": ["3 Quantized Side Tuning"],
        "section": "3 Quantized Side Tuning",
        "snippet": "This section details quantized side tuning with lower memory overhead and side-network design choices.",
    },
    {
        "score": 0.47,
        "retrieval_score": 0.39,
        "section_path": ["5 Conclusion"],
        "section": "5 Conclusion",
        "snippet": "In this paper, we propose a novel fast and memory-efficient finetuning framework for quantized LLMs with lower memory overhead. The dual-stage process first quantizes the LLM into 4-bit and then introduces a side network.",
    },
]

selected = module.select_supporting_chunks(
    chunks,
    max_chunks=3,
    query_terms=["side", "tuning", "quantized", "llms", "lower", "memory", "overhead"],
)
payload = [" > ".join(chunk.get("section_path") or []) for chunk in selected]
print(json.dumps(payload))
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload, ['5 Conclusion']);
});

test('retrieval benchmark hard-negative collision helper tracks distractor ranks', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import importlib.util
import json
from pathlib import Path

module_path = Path("scripts/benchmark_retrieval_quality.py").resolve()
spec = importlib.util.spec_from_file_location("benchmark_retrieval_quality", module_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

case = {
    "hard_negative_doc_ids": ["paper::neg::1", "paper::neg::2"],
    "hard_negative_titles": ["Distractor A", "Distractor B"],
}
items = [
    {"doc_id": "paper::neg::1", "title": "Distractor A"},
    {"doc_id": "paper::gold::1", "title": "Gold"},
    {"doc_id": "paper::neg::2", "title": "Distractor B"},
]
payload = module.evaluate_hard_negative_collisions(case, items, top_k=3, expected_rank=2)
print(json.dumps(payload))
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.hard_negative_case_count, 1);
  assert.equal(payload.hard_negative_best_rank, 1);
  assert.equal(payload.hard_negative_top1_collision, true);
  assert.equal(payload.hard_negative_top3_collision, true);
  assert.equal(payload.hard_negative_outranked_expected, true);
  assert.equal(payload.hard_negative_hits.length, 2);
});

test('retrieval benchmark top distractor taxonomy distinguishes generic llm neighbors', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import importlib.util
import json
from pathlib import Path

module_path = Path("scripts/benchmark_retrieval_quality.py").resolve()
spec = importlib.util.spec_from_file_location("benchmark_retrieval_quality", module_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

case = {
    "query": "compare fine tuning and retrieval for injecting new factual knowledge into llms",
    "expected_doc_id": "paper::gold::1",
    "expected_title": "Fine-Tuning or Retrieval? Comparing Knowledge Injection in LLMs",
    "conference_id": "emnlp",
    "publication_year": 2024,
    "tags": ["rag", "knowledge-injection"],
}
top_item_review = {
    "doc_id": "paper::neg::generic",
    "title": "Thinking Fair and Slow: On the Efficacy of Structured Prompts for Debiasing Language Models",
    "conference_id": "emnlp",
    "publication_year": 2024,
    "supporting_chunks": [
        {"snippet": "We study structured prompts for debiasing language models under fairness constraints."}
    ],
}
payload = module.analyze_top_distractor(case, top_item_review)
print(json.dumps(payload))
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.top_distractor_present, true);
  assert.equal(payload.top_distractor_taxonomy, 'generic_llm_neighbor');
  assert.deepEqual(payload.top_distractor_query_overlap, []);
  assert.equal(payload.top_distractor_same_conference, true);
  assert.equal(payload.top_distractor_same_year, true);
});

test('retrieval benchmark marks off-topic lexical neighbors as surface overlap noise', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import importlib.util
import json
from pathlib import Path

module_path = Path("scripts/benchmark_retrieval_quality.py").resolve()
spec = importlib.util.spec_from_file_location("benchmark_retrieval_quality", module_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

case = {
    "query": "multi-level benchmark for evaluating robustness of large language models in tool learning under noise",
    "expected_doc_id": "paper::gold::rotbench",
    "expected_title": "RoTBench: A Multi-Level Benchmark for Evaluating the Robustness of Large Language Models in Tool Learning",
    "conference_id": "emnlp",
    "publication_year": 2024,
    "tags": ["benchmark", "tool-learning"],
}
item = {
    "doc_id": "paper::acl::ronli",
    "title": "A Novel Cartography-Based Curriculum Learning Method Applied on RoNLI: The First Romanian Natural Language Inference Corpus",
    "conference_id": "acl",
    "publication_year": 2024,
    "supporting_chunks": [
        {"snippet": "This benchmark-like learning setup studies Romanian inference curriculum signals under noisy labels."}
    ],
}
payload = module.analyze_distractor(case, item, rank=2)
print(json.dumps(payload))
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.top_distractor_taxonomy, 'surface_overlap_noise');
  assert.equal(Array.isArray(payload.top_distractor_noise_terms), true);
  assert.equal(payload.top_distractor_noise_terms.includes('education_language'), true);
});

test('confusable negative mining suggests ranked distractors for current cases', () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'toukeagent-confusable-negative-'));
  const outputPath = join(outputRoot, 'suggestions.json');
  const chunkRoot = buildChunkRootForManifests();
  const result = spawnSync(
    'python3',
    [
      'scripts/mine_confusable_negatives.py',
      '--manifest-path',
      'data/papers/manifests/acl-2024-offset0-limit20.jsonl',
      '--manifest-path',
      'data/papers/manifests/emnlp-2024-offset0-limit20.jsonl',
      '--query-case-path',
      'tests/fixtures/retrieval-benchmark-cases.json',
      '--chunk-root',
      chunkRoot,
      '--top-k',
      '3',
      '--force-backend',
      'deterministic_hash',
      '--index-batch-size',
      '64',
      '--output-path',
      outputPath,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.queries, 2);
  assert.equal(payload.top_k, 3);
  assert.equal(payload.evaluation_fidelity.label, 'hash_smoke_only');
  assert.ok(typeof payload.suggestion_status_counts === 'object');
  assert.ok(typeof payload.suggested_taxonomy_counts === 'object');
  assert.ok(typeof payload.adoptable_suggestion_count === 'number');
  assert.equal(Array.isArray(payload.suggestions), true);
  assert.equal(payload.suggestions.length, 2);
  assert.equal(existsSync(outputPath), true);

  for (const suggestion of payload.suggestions) {
    assert.equal(typeof suggestion.case_id, 'string');
    assert.equal(typeof suggestion.query, 'string');
    assert.equal(Array.isArray(suggestion.retrieved_titles), true);
    assert.ok(suggestion.retrieved_titles.length >= 1);
    if (suggestion.suggested_hard_negative_doc_id) {
      assert.notEqual(suggestion.suggested_hard_negative_doc_id, suggestion.expected_doc_id);
      assert.equal(typeof suggestion.suggested_hard_negative_rank, 'number');
      assert.equal(typeof suggestion.suggested_hard_negative_taxonomy, 'string');
      assert.equal(Array.isArray(suggestion.suggested_shared_families), true);
      assert.equal(typeof suggestion.suggestion_status, 'string');
    }
  }
});

test('confusable negative mining downgrades surface overlap suggestions', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import importlib.util
import json
from pathlib import Path

module_path = Path("scripts/mine_confusable_negatives.py").resolve()
spec = importlib.util.spec_from_file_location("mine_confusable_negatives", module_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

payload = {
    "surface_noise": module._suggestion_status(rank=2, already_configured=False, taxonomy="surface_overlap_noise", same_conference=False),
    "rank_pressure": module._suggestion_status(rank=2, already_configured=False, taxonomy="specific_topic_neighbor", same_conference=False),
    "configured": module._suggestion_status(rank=2, already_configured=True, taxonomy="known_hard_negative", same_conference=False),
}
print(json.dumps(payload))
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.surface_noise, 'review_surface_noise');
  assert.equal(payload.rank_pressure, 'adopt_rank_pressure');
  assert.equal(payload.configured, 'already_configured');
});

test('curated hard-negative config includes EM camera near-neighbor pair', () => {
  const cases = JSON.parse(readFileSync('config/retrieval-benchmark-hard-negative-cases.json', 'utf8')).cases;
  const gold = JSON.parse(readFileSync('config/retrieval-benchmark-hard-negative-gold-cases.json', 'utf8'));

  const spyCamera = cases.find((entry) => entry.case_id === 'spy_camera_vs_em_eye');
  const emEye = cases.find((entry) => entry.case_id === 'em_eye_vs_spy_camera');
  assert.ok(spyCamera);
  assert.ok(emEye);
  assert.equal(spyCamera.query, 'embedded camera electromagnetic emissions and long-range spy camera detection');
  assert.deepEqual(spyCamera.hard_negative_titles, ['EM Eye: Characterizing Electromagnetic Side-channel Eavesdropping on Embedded Cameras']);
  assert.equal(emEye.query, 'electromagnetic side-channel eavesdropping on embedded cameras');
  assert.deepEqual(emEye.hard_negative_titles, ['Eye of Sauron: {Long-Range} Hidden Spy Camera Detection and Positioning with Inbuilt Memory {EM} Radiation']);

  const spyGold = gold.find((entry) => entry.case_id === 'spy_camera_vs_em_eye');
  const emGold = gold.find((entry) => entry.case_id === 'em_eye_vs_spy_camera');
  assert.ok(spyGold);
  assert.ok(emGold);
  assert.equal(spyGold.required_supports.length, 2);
  assert.equal(emGold.required_supports.length, 2);
});

test('curated hard-negative config includes multi-domain near-neighbor additions', () => {
  const cases = JSON.parse(readFileSync('config/retrieval-benchmark-hard-negative-cases.json', 'utf8')).cases;
  const gold = JSON.parse(readFileSync('config/retrieval-benchmark-hard-negative-gold-cases.json', 'utf8'));

  const expected = [
    ['quantized_side_tuning_vs_bitdistiller', 'BitDistiller: Unleashing the Potential of Sub-4-Bit LLMs via Self-Distillation'],
    ['mage_vs_demasq', 'DEMASQ: Unmasking the ChatGPT Wordsmith'],
    ['attackgnn_vs_insight', '{INSIGHT}: Attacking {Industry-Adopted} Learning Resilient Logic Locking Techniques Using Explainable Graph Neural Network'],
    ['pakistani_creators_vs_onlyfans', '"I feel physically safe but not politically safe": Understanding the Digital Threats and Safety Practices of {OnlyFans} Creators'],
  ];

  for (const [caseId, hardNegativeTitle] of expected) {
    const entry = cases.find((item) => item.case_id === caseId);
    assert.ok(entry, `missing case ${caseId}`);
    assert.deepEqual(entry.hard_negative_titles, [hardNegativeTitle]);
    const goldEntry = gold.find((item) => item.case_id === caseId);
    assert.ok(goldEntry, `missing gold ${caseId}`);
    assert.equal(goldEntry.required_supports.length, 2);
  }
});

test('query clarification heuristic does not fire on substring collisions', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json
from toukeagent_core.retrieval import choose_retrieval_route, build_query_analysis

query = "unintelligible prompts that preserve model behavior"
route = choose_retrieval_route(query)
analysis = build_query_analysis(query, route)
print(json.dumps({
    "clarification_required": bool((analysis.get("clarification") or {}).get("required")),
    "boundary_action": (analysis.get("boundary") or {}).get("action"),
    "query_mode": analysis.get("query_mode"),
}))
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.clarification_required, false);
  assert.equal(payload.boundary_action, 'answer');
  assert.equal(payload.query_mode, 'lookup');
});

test('query frontend comparison decomposition keeps shared context in rewrites', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json
from toukeagent_core.retrieval import choose_retrieval_route, build_query_analysis

query = "compare fine tuning and retrieval for injecting new factual knowledge into llms"
route = choose_retrieval_route(query)
analysis = build_query_analysis(query, route)
print(json.dumps({
    "query_mode": analysis.get("query_mode"),
    "strategy": (analysis.get("decomposition") or {}).get("strategy"),
    "subqueries": [item.get("query_text") for item in (analysis.get("decomposition") or {}).get("subqueries") or []],
    "rewrites": [item.get("text") for item in (analysis.get("rewrites") or {}).get("variants") or []],
}))
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.query_mode, 'compare');
  assert.equal(payload.strategy, 'comparison_split');
  assert.equal(payload.subqueries.length, 2);
  assert.match(payload.subqueries[0], /fine tuning/i);
  assert.match(payload.subqueries[1], /retrieval/i);
  assert.equal(payload.rewrites.length, 2);
  assert.match(payload.rewrites[0], /injecting new factual knowledge into llms/i);
});

test('retrieval benchmark snippet span metric penalizes section hit without anchor hit', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import importlib.util
import json
from pathlib import Path

module_path = Path("scripts/benchmark_retrieval_quality.py").resolve()
spec = importlib.util.spec_from_file_location("benchmark_retrieval_quality", module_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

expected_item = {
    "supporting_chunks": [
        {
            "chunk_id": "chunk_a",
            "doc_id": "doc_1",
            "title": "Doc 1",
            "section": "1 Introduction",
            "section_path": ["1 Introduction"],
            "metadata": {},
            "snippet": "This chunk mentions the benchmark setup but never states the privacy utility trade-off.",
        },
        {
            "chunk_id": "chunk_b",
            "doc_id": "doc_1",
            "title": "Doc 1",
            "section": "1 Introduction",
            "section_path": ["1 Introduction"],
            "metadata": {},
            "snippet": "We propose a benchmark to fairly quantify the privacy-utility trade-off across several attacks.",
        },
    ]
}
gold_case = {
    "required_supports": [
        {
            "label": "strict_intro_anchor",
            "section_any_of": ["introduction"],
            "snippet_all_of": ["fairly quantify", "privacy-utility trade-off"],
            "snippet_none_of": ["never states"],
        }
    ]
}
payload = module.evaluate_gold_support({"case_id": "synthetic"}, expected_item, gold_case)
print(json.dumps({
    "snippet_context_recall": payload["snippet_context_recall"],
    "snippet_context_precision": payload["snippet_context_precision"],
    "citation_span_match_rate": payload["citation_span_match_rate"],
    "requirement_reviews": payload["requirements"],
}))
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.snippet_context_recall, 1);
  assert.equal(payload.snippet_context_precision, 0.5);
  assert.equal(payload.citation_span_match_rate, 0.5);
  assert.equal(payload.requirement_reviews[0].section_candidate_chunk_ids.length, 2);
  assert.equal(payload.requirement_reviews[0].matched_chunk_ids.length, 1);
});
