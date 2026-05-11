import { randomUUID } from 'node:crypto';

function clone(value) {
  return structuredClone(value);
}

function mean(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundScore(value) {
  return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 10000) / 10000;
}

function normalizeCase(caseItem, index) {
  const input = clone(caseItem?.input ?? caseItem?.message ?? caseItem ?? {});
  const taskId = input.trace_id ?? caseItem?.task_id ?? `harness_task_${randomUUID()}`;
  const messageId = input.message_id ?? `msg_${taskId}`;
  return {
    case_id: caseItem?.case_id ?? `case_${index + 1}`,
    input: {
      ...input,
      message_id: messageId,
      source_message_id: input.source_message_id ?? `raw_${messageId}`,
      trace_id: taskId,
    },
    reference: clone(caseItem?.reference ?? {}),
    metadata: clone(caseItem?.metadata ?? {}),
  };
}

export function createEvaluationHarness({
  executeTask,
  collectTraceBundle,
  harnessStore = null,
} = {}) {
  if (typeof executeTask !== 'function') {
    throw new Error('executeTask is required');
  }
  if (typeof collectTraceBundle !== 'function') {
    throw new Error('collectTraceBundle is required');
  }

  async function run({ cases = [], metadata = {} } = {}) {
    const startedAt = new Date().toISOString();
    const normalizedCases = cases.map((caseItem, index) => normalizeCase(caseItem, index));
    const caseResults = [];

    for (const caseItem of normalizedCases) {
      const execution = await executeTask(caseItem.input);
      const taskId = execution?.task_id ?? caseItem.input.trace_id;
      const traceBundle = collectTraceBundle(taskId);
      const latestEvaluation = traceBundle.latest_evaluation ?? null;
      const latestReview = traceBundle.latest_review ?? null;

      caseResults.push({
        case_id: caseItem.case_id,
        task_id: taskId,
        trace_id: execution?.message?.trace_id ?? caseItem.input.trace_id,
        execution,
        trace_bundle: traceBundle,
        reference: caseItem.reference,
        metadata: caseItem.metadata,
        metrics: {
          success: traceBundle.metrics.final_status === 'completed',
          quality_passed: latestEvaluation?.decision === 'pass',
          reviewed: Boolean(latestReview),
          review_required: traceBundle.metrics.gate_status === 'review_required' || traceBundle.metrics.gate_status === 'blocked',
          citation_consistency: Number(latestEvaluation?.dimensions?.citation_consistency ?? 0),
          tool_compliance_rate: traceBundle.metrics.tool_compliance_rate,
        },
      });
    }

    const summary = {
      case_count: caseResults.length,
      success_rate: roundScore(mean(caseResults.map((item) => (item.metrics.success ? 1 : 0)))),
      quality_pass_rate: roundScore(mean(caseResults.map((item) => (item.metrics.quality_passed ? 1 : 0)))),
      review_rate: roundScore(mean(caseResults.map((item) => (item.metrics.reviewed ? 1 : 0)))),
      citation_accuracy: roundScore(mean(caseResults.map((item) => item.metrics.citation_consistency))),
      tool_compliance_rate: roundScore(mean(caseResults.map((item) => item.metrics.tool_compliance_rate))),
    };

    const runRecord = {
      run_id: `harness_${randomUUID()}`,
      status: 'completed',
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      metadata: clone(metadata),
      summary,
      metrics: summary,
      cases: caseResults.map((item) => ({
        case_id: item.case_id,
        task_id: item.task_id,
        trace_id: item.trace_id,
        metrics: item.metrics,
        reference: item.reference,
        metadata: item.metadata,
      })),
    };

    if (harnessStore) {
      harnessStore.create(runRecord);
    }

    return {
      ...runRecord,
      case_results: caseResults,
    };
  }

  return {
    run,
  };
}
