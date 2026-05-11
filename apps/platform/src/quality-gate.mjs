import { randomUUID } from 'node:crypto';

function roundScore(value) {
  return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 10000) / 10000;
}

function stableFraction(seed) {
  const text = String(seed ?? '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

export function createQualityGate({
  sampleRate = 0,
} = {}) {
  function evaluate(evaluation) {
    const sampleSeed = evaluation.trace_id ?? evaluation.task_id ?? evaluation.evaluation_id ?? randomUUID();
    const sampled = evaluation.decision === 'pass' && sampleRate > 0 && stableFraction(sampleSeed) < sampleRate;

    if (evaluation.decision === 'fail') {
      return {
        gate_id: `gate_${randomUUID()}`,
        task_id: evaluation.task_id,
        trace_id: evaluation.trace_id,
        evaluation_id: evaluation.evaluation_id,
        status: 'blocked',
        review_required: true,
        sampled: false,
        reason: 'quality_gate_failed',
        priority: 'high',
        recommended_actions: evaluation.recommended_actions,
        score: roundScore(evaluation.overall_score),
        created_at: new Date().toISOString(),
      };
    }

    if (evaluation.decision === 'review') {
      return {
        gate_id: `gate_${randomUUID()}`,
        task_id: evaluation.task_id,
        trace_id: evaluation.trace_id,
        evaluation_id: evaluation.evaluation_id,
        status: 'review_required',
        review_required: true,
        sampled: false,
        reason: 'quality_gate_review',
        priority: 'medium',
        recommended_actions: evaluation.recommended_actions,
        score: roundScore(evaluation.overall_score),
        created_at: new Date().toISOString(),
      };
    }

    return {
      gate_id: `gate_${randomUUID()}`,
      task_id: evaluation.task_id,
      trace_id: evaluation.trace_id,
      evaluation_id: evaluation.evaluation_id,
      status: 'passed',
      review_required: sampled,
      sampled,
      reason: sampled ? 'online_sampled_review' : 'quality_gate_passed',
      priority: sampled ? 'low' : 'none',
      recommended_actions: sampled ? ['human_review'] : [],
      score: roundScore(evaluation.overall_score),
      created_at: new Date().toISOString(),
    };
  }

  return {
    evaluate,
  };
}
