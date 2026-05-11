import { randomUUID } from 'node:crypto';

function clone(value) {
  return structuredClone(value);
}

function roundScore(value) {
  return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100) / 100;
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function detectUnsafeMarkers(text) {
  const normalized = String(text ?? '');
  const patterns = [
    { label: 'api_key', pattern: /\bsk-[A-Za-z0-9]{16,}\b/g },
    { label: 'token', pattern: /\b(?:access[_ -]?token|refresh[_ -]?token)\b/i },
    { label: 'password', pattern: /\bpassword\b/i },
  ];

  return patterns
    .filter(({ pattern }) => pattern.test(normalized))
    .map(({ label }) => label);
}

function extractRetrievalResult(runState) {
  const stepResults = Array.isArray(runState?.step_results) ? runState.step_results : [];
  return stepResults.find((entry) => entry?.output?.route || entry?.output?.citations || entry?.output?.items)?.output ?? null;
}

export function createOutputEvaluator() {
  function evaluate({ message, persona, plan, runState }) {
    const finalText = String(runState?.output?.final_text ?? '');
    const retrievalResult = extractRetrievalResult(runState);
    const citations = Array.isArray(retrievalResult?.citations) ? retrievalResult.citations : [];
    const routeMode = retrievalResult?.route?.mode ?? null;
    const stepRatio = Number(runState?.total_steps) > 0
      ? Number(runState?.completed_steps ?? 0) / Number(runState.total_steps)
      : 0;
    const unsafeMarkers = detectUnsafeMarkers(finalText);
    const lowerText = finalText.toLowerCase();
    const citedTitleCount = citations.filter((citation) => {
      const title = String(citation?.title ?? '').trim();
      return title && lowerText.includes(title.toLowerCase());
    }).length;
    const hasOutput = finalText.trim().length > 0;

    const dimensions = {
      factuality: citations.length > 0 ? 0.86 : (hasOutput ? 0.58 : 0.2),
      citation_consistency: citations.length === 0
        ? 0.45
        : (citedTitleCount > 0 || routeMode ? 0.84 : 0.72),
      task_completion: Math.min(1, stepRatio * 0.75 + (hasOutput ? 0.25 : 0)),
      format_compliance: !hasOutput ? 0.2 : (finalText.length <= 4000 ? 0.92 : 0.72),
      safety: unsafeMarkers.length > 0 ? 0.1 : 0.94,
    };

    const overallScore = roundScore(average(Object.values(dimensions)));
    const decision = overallScore >= 0.82 ? 'pass' : overallScore >= 0.6 ? 'review' : 'fail';
    const recommendedActions = decision === 'pass'
      ? []
      : decision === 'review'
        ? ['supplement_retrieval', 'human_review']
        : ['retry', 'degrade', 'human_review'];

    return {
      evaluation_id: `eval_${randomUUID()}`,
      task_id: runState?.task_id ?? message?.trace_id ?? null,
      trace_id: runState?.trace_id ?? message?.trace_id ?? null,
      persona_id: persona?.persona_id ?? runState?.persona_id ?? null,
      plan_id: plan?.plan_id ?? runState?.plan_id ?? null,
      message_id: message?.message_id ?? null,
      overall_score: overallScore,
      decision,
      dimensions: Object.fromEntries(
        Object.entries(dimensions).map(([key, value]) => [key, roundScore(value)]),
      ),
      evidence: {
        route_mode: routeMode,
        citation_count: citations.length,
        cited_title_count: citedTitleCount,
        step_completion_ratio: roundScore(stepRatio),
        output_length: finalText.length,
        unsafe_markers: unsafeMarkers,
      },
      recommended_actions: recommendedActions,
      created_at: new Date().toISOString(),
    };
  }

  function evaluateBatch(items) {
    return items.map((item) => evaluate(item));
  }

  return {
    evaluate,
    evaluateBatch,
  };
}
