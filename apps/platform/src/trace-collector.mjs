function clone(value) {
  return structuredClone(value);
}

function countToolCompliance(streamEvents) {
  const toolResults = streamEvents.filter((event) => event.event_type === 'tool_result');
  if (toolResults.length === 0) {
    return 1;
  }

  const successful = toolResults.filter((event) => String(event.payload?.status ?? '').toLowerCase() === 'success').length;
  return successful / toolResults.length;
}

export function createTraceCollector({
  auditStore,
  streamStore,
  taskStore,
  evaluationStore,
  reviewStore,
  memoryStore,
} = {}) {
  function collect(taskId) {
    const task = clone(taskStore?.get(taskId) ?? null);
    const auditEntries = clone(auditStore?.list(taskId) ?? []);
    const streamEvents = clone(streamStore?.snapshot(taskId) ?? []);
    const evaluations = clone(evaluationStore?.list(taskId) ?? []);
    const reviews = clone(reviewStore?.list({ taskId }) ?? []);
    const memory = clone(memoryStore?.buildContext({ taskId }) ?? null);
    const latestEvaluation = evaluations.at(-1) ?? null;
    const latestReview = reviews.at(-1) ?? null;

    const bundle = {
      task_id: taskId,
      trace_id: task?.trace_id ?? taskId,
      collected_at: new Date().toISOString(),
      exists: Boolean(
        task?.message ||
        task?.plan ||
        task?.run_state ||
        auditEntries.length > 0 ||
        streamEvents.length > 0 ||
        evaluations.length > 0 ||
        reviews.length > 0 ||
        (memory?.short_term?.length ?? 0) > 0 ||
        (memory?.long_term?.length ?? 0) > 0,
      ),
      task,
      plan: task?.plan ?? null,
      run_state: task?.run_state ?? null,
      memory,
      evaluations,
      latest_evaluation: latestEvaluation,
      reviews,
      latest_review: latestReview,
      audit_entries: auditEntries,
      stream_events: streamEvents,
      metrics: {
        event_count: streamEvents.length,
        audit_count: auditEntries.length,
        evaluation_count: evaluations.length,
        review_count: reviews.length,
        tool_call_count: streamEvents.filter((event) => event.event_type === 'tool_call').length,
        tool_result_count: streamEvents.filter((event) => event.event_type === 'tool_result').length,
        tool_compliance_rate: countToolCompliance(streamEvents),
        final_status: task?.status ?? null,
        quality_decision: latestEvaluation?.decision ?? null,
        quality_score: latestEvaluation?.overall_score ?? null,
        review_status: latestReview?.review_status ?? null,
        gate_status: task?.metadata?.quality_gate_status ?? null,
      },
    };

    return bundle;
  }

  return {
    collect,
  };
}
