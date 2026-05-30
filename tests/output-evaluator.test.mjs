import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutputEvaluator } from '../apps/platform/src/output-evaluator.mjs';

test('output evaluator scores completed responses across quality dimensions', () => {
  const evaluator = createOutputEvaluator();
  const result = evaluator.evaluate({
    message: {
      message_id: 'msg_eval_1',
      trace_id: 'trace_eval_1',
    },
    persona: {
      persona_id: 'researcher',
    },
    plan: {
      plan_id: 'plan_eval_1',
    },
    runState: {
      task_id: 'trace_eval_1',
      trace_id: 'trace_eval_1',
      persona_id: 'researcher',
      total_steps: 3,
      completed_steps: 3,
      output: {
        final_text: 'Retrieval route: wiki-first\nContext: Release notes (wiki)',
      },
      step_results: [
        {
          step_id: 'step_1',
          output: null,
        },
        {
          step_id: 'step_2',
          output: {
            route: { mode: 'wiki-first' },
            citations: [
              { title: 'Release notes', source_type: 'wiki', score: 0.96, freshness: 'dynamic' },
            ],
            quality: {
              retrieval_score: 0.91,
              citation_score: 0.94,
              route_alignment_score: 0.93,
              recommended_action: 'accept',
            },
          },
        },
      ],
    },
  });

  assert.equal(result.decision, 'pass');
  assert.ok(result.overall_score >= 0.82);
  assert.ok(result.dimensions.factuality >= 0.88);
  assert.ok(result.dimensions.citation_consistency >= 0.88);
  assert.equal(result.evidence.route_mode, 'wiki-first');
  assert.equal(result.evidence.retrieval_score, 0.91);
  assert.equal(result.recommended_actions.length, 0);
});

test('output evaluator recommends review or retry when output is weak', () => {
  const evaluator = createOutputEvaluator();
  const result = evaluator.evaluate({
    message: {
      message_id: 'msg_eval_2',
      trace_id: 'trace_eval_2',
    },
    persona: {
      persona_id: 'researcher',
    },
    plan: {
      plan_id: 'plan_eval_2',
    },
    runState: {
      task_id: 'trace_eval_2',
      trace_id: 'trace_eval_2',
      persona_id: 'researcher',
      total_steps: 2,
      completed_steps: 1,
      output: {
        final_text: 'sk-1234567890abcdef potential leak',
      },
      step_results: [],
    },
  });

  assert.equal(result.decision, 'fail');
  assert.ok(result.overall_score < 0.6);
  assert.ok(result.evidence.unsafe_markers.includes('api_key'));
  assert.ok(result.recommended_actions.includes('human_review'));
});

test('output evaluator treats redacted output as review-worthy', () => {
  const evaluator = createOutputEvaluator();
  const result = evaluator.evaluate({
    message: {
      message_id: 'msg_eval_3',
      trace_id: 'trace_eval_3',
    },
    persona: {
      persona_id: 'researcher',
    },
    plan: {
      plan_id: 'plan_eval_3',
    },
    runState: {
      task_id: 'trace_eval_3',
      trace_id: 'trace_eval_3',
      persona_id: 'researcher',
      total_steps: 3,
      completed_steps: 3,
      output: {
        final_text: 'Retrieval route: wiki-first\nContext: Release notes (wiki)\nNote: [REDACTED:api_key]',
      },
      step_results: [
        {
          step_id: 'step_1',
          output: null,
        },
        {
          step_id: 'step_2',
          output: {
            route: { mode: 'wiki-first' },
            citations: [
              { title: 'Release notes', source_type: 'wiki' },
            ],
            quality: {
              retrieval_score: 0.72,
              citation_score: 0.74,
              route_alignment_score: 0.77,
              recommended_action: 'supplement_rag',
            },
          },
        },
      ],
    },
  });

  assert.equal(result.decision, 'review');
  assert.equal(result.evidence.redaction_marker_count, 1);
  assert.deepEqual(result.evidence.unsafe_markers, []);
  assert.ok(result.recommended_actions.includes('human_review'));
  assert.ok(result.recommended_actions.includes('supplement_rag'));
});
