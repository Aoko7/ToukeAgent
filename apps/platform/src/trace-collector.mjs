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

function collectBlockedToolStats(streamEvents) {
  const toolResults = streamEvents.filter((event) => event.event_type === 'tool_result');
  const blockedItems = toolResults.filter((event) => event.usage?.blocked === true);
  const blockedByCode = {};
  const blockedToolNames = new Set();
  const sandboxBlockedByCode = {};
  const sandboxBlockedToolNames = new Set();
  let sandboxBlockedCount = 0;
  let sandboxEnvironmentPolicy = null;
  const networkIntentSources = {};
  const requestedHosts = new Set();
  const requestedProviders = new Set();
  const requestedUrls = new Set();
  const dynamicAllowedHosts = new Set();
  const dynamicAllowedProviders = new Set();
  const requestedTargets = new Map();
  const dynamicProviderHostBindings = new Map();

  for (const event of blockedItems) {
    const code = String(event.payload?.error_code ?? event.payload?.status ?? 'blocked');
    blockedByCode[code] = (blockedByCode[code] ?? 0) + 1;
    if (event.payload?.tool_name) {
      blockedToolNames.add(String(event.payload.tool_name));
    }
    if (event.usage?.restricted === true) {
      sandboxBlockedCount += 1;
      sandboxBlockedByCode[code] = (sandboxBlockedByCode[code] ?? 0) + 1;
      if (event.payload?.tool_name) {
        sandboxBlockedToolNames.add(String(event.payload.tool_name));
      }
      if (!sandboxEnvironmentPolicy && event.usage?.environment_policy) {
        sandboxEnvironmentPolicy = clone(event.usage.environment_policy);
      }
    }

    const networkIntentSource = String(event.usage?.network_intent_source ?? '').trim();
    if (networkIntentSource) {
      networkIntentSources[networkIntentSource] = (networkIntentSources[networkIntentSource] ?? 0) + 1;
    }
    for (const host of event.usage?.requested_hosts ?? []) {
      if (host) {
        requestedHosts.add(String(host));
      }
    }
    for (const provider of event.usage?.requested_providers ?? []) {
      if (provider) {
        requestedProviders.add(String(provider));
      }
    }
    for (const url of event.usage?.requested_urls ?? []) {
      if (url) {
        requestedUrls.add(String(url));
      }
    }
    for (const host of event.usage?.dynamic_allowed_hosts ?? []) {
      if (host) {
        dynamicAllowedHosts.add(String(host));
      }
    }
    for (const provider of event.usage?.dynamic_allowed_providers ?? []) {
      if (provider) {
        dynamicAllowedProviders.add(String(provider));
      }
    }
    for (const target of event.usage?.requested_targets ?? []) {
      const key = JSON.stringify(target);
      if (key !== undefined) {
        requestedTargets.set(key, clone(target));
      }
    }
    for (const binding of event.usage?.dynamic_allowed_provider_host_bindings ?? []) {
      const key = JSON.stringify(binding);
      if (key !== undefined) {
        dynamicProviderHostBindings.set(key, clone(binding));
      }
    }
  }

  return {
    blocked_tool_result_count: blockedItems.length,
    blocked_tool_error_codes: blockedByCode,
    blocked_tool_names: Array.from(blockedToolNames),
    sandbox_blocked_tool_result_count: sandboxBlockedCount,
    sandbox_blocked_error_codes: sandboxBlockedByCode,
    sandbox_blocked_tool_names: Array.from(sandboxBlockedToolNames),
    sandbox_environment_policy: sandboxEnvironmentPolicy,
    sandbox_network_observability: {
      blocked_network_observation_count: Object.values(networkIntentSources).reduce((sum, value) => sum + value, 0),
      network_intent_sources: networkIntentSources,
      requested_hosts: Array.from(requestedHosts),
      requested_providers: Array.from(requestedProviders),
      requested_urls: Array.from(requestedUrls),
      requested_targets: Array.from(requestedTargets.values()),
      dynamic_allowed_hosts: Array.from(dynamicAllowedHosts),
      dynamic_allowed_providers: Array.from(dynamicAllowedProviders),
      dynamic_provider_host_bindings: Array.from(dynamicProviderHostBindings.values()),
    },
  };
}

function extractRetrievalResult(task) {
  const stepResults = Array.isArray(task?.run_state?.step_results) ? task.run_state.step_results : [];
  return stepResults.find((entry) => entry?.output?.route || entry?.output?.citations || entry?.output?.items)?.output ?? null;
}

export function createTraceCollector({
  auditStore,
  streamStore,
  taskStore,
  evaluationStore,
  reviewStore,
  memoryStore,
  alertStore,
  deadLetterStore,
  handoffStore,
  compressionStore,
  rlStore,
  recoveryDrillStore,
  deliveryStore,
} = {}) {
  function collect(taskId) {
    const task = clone(taskStore?.get(taskId) ?? null);
    const auditEntries = clone(auditStore?.list(taskId) ?? []);
    const streamEvents = clone(streamStore?.snapshot(taskId) ?? []);
    const evaluations = clone(evaluationStore?.list(taskId) ?? []);
    const reviews = clone(reviewStore?.list({ taskId }) ?? []);
    const alerts = clone(alertStore?.list({ taskId }) ?? []);
    const memory = clone(memoryStore?.buildContext({ taskId }) ?? null);
    const deadLetters = clone(deadLetterStore?.list({ taskId }) ?? []);
    const handoffs = clone(handoffStore?.list({ taskId }) ?? []);
    const compressions = clone(compressionStore?.list({ taskId }) ?? []);
    const rl = clone(rlStore?.snapshot(taskId) ?? null);
    const drills = clone(recoveryDrillStore?.list({ taskId }) ?? []);
    const deliveries = clone(deliveryStore?.list({ taskId }) ?? []);
    const latestEvaluation = evaluations.at(-1) ?? null;
    const latestReview = reviews.at(-1) ?? null;
    const latestAlert = alerts.at(-1) ?? null;
    const latestDeadLetter = deadLetters.at(-1) ?? null;
    const latestHandoff = handoffs.at(-1) ?? null;
    const latestCompression = compressions.at(-1) ?? null;
    const latestDrill = drills.at(-1) ?? null;
    const latestDelivery = deliveries.at(-1) ?? null;
    const deliveryReceiptCount = deliveries.reduce((count, item) => count + (item.receipts?.length ?? 0), 0);
    const deliveryCallbackCount = deliveries.reduce((count, item) => count
      + (item.receipts?.filter((receipt) => receipt.callback_state === 'acknowledged' || receipt.status === 'delivered' || receipt.status === 'failed').length ?? 0), 0);
    const retrievalResult = extractRetrievalResult(task);
    const blockedToolStats = collectBlockedToolStats(streamEvents);

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
        alerts.length > 0 ||
        deadLetters.length > 0 ||
        handoffs.length > 0 ||
        compressions.length > 0 ||
        deliveries.length > 0 ||
        drills.length > 0 ||
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
      alerts,
      latest_alert: latestAlert,
      dead_letters: deadLetters,
      latest_dead_letter: latestDeadLetter,
      handoffs,
      latest_handoff: latestHandoff,
      context_compressions: compressions,
      latest_context_compression: latestCompression,
      deliveries,
      latest_delivery: latestDelivery,
      rl,
      recovery_drills: drills,
      latest_recovery_drill: latestDrill,
      audit_entries: auditEntries,
      stream_events: streamEvents,
      metrics: {
        event_count: streamEvents.length,
        audit_count: auditEntries.length,
        evaluation_count: evaluations.length,
        review_count: reviews.length,
        alert_count: alerts.length,
        dead_letter_count: deadLetters.length,
        handoff_count: handoffs.length,
        compression_count: compressions.length,
        delivery_count: deliveries.length,
        delivery_receipt_count: deliveryReceiptCount,
        delivery_callback_count: deliveryCallbackCount,
        recovery_drill_count: drills.length,
        reward_count: rl?.rewards?.length ?? 0,
        policy_log_count: rl?.policy_logs?.length ?? 0,
        safety_gate_count: rl?.safety_gates?.length ?? 0,
        open_alert_count: alerts.filter((alert) => alert.status === 'open').length,
        tool_call_count: streamEvents.filter((event) => event.event_type === 'tool_call').length,
        tool_result_count: streamEvents.filter((event) => event.event_type === 'tool_result').length,
        tool_compliance_rate: countToolCompliance(streamEvents),
        blocked_tool_result_count: blockedToolStats.blocked_tool_result_count,
        blocked_tool_error_codes: blockedToolStats.blocked_tool_error_codes,
        blocked_tool_names: blockedToolStats.blocked_tool_names,
        sandbox_blocked_tool_result_count: blockedToolStats.sandbox_blocked_tool_result_count,
        sandbox_blocked_error_codes: blockedToolStats.sandbox_blocked_error_codes,
        sandbox_blocked_tool_names: blockedToolStats.sandbox_blocked_tool_names,
        sandbox_environment_policy: blockedToolStats.sandbox_environment_policy,
        sandbox_network_observability: blockedToolStats.sandbox_network_observability,
        final_status: task?.status ?? null,
        quality_decision: latestEvaluation?.decision ?? null,
        quality_score: latestEvaluation?.overall_score ?? null,
        retrieval_score: retrievalResult?.quality?.retrieval_score ?? null,
        citation_score: retrievalResult?.quality?.citation_score ?? null,
        contract_coverage_score: retrievalResult?.quality?.contract_coverage_score ?? null,
        retrieval_route_mode: retrievalResult?.route?.mode ?? null,
        retrieval_effective_mode: retrievalResult?.route?.effective_mode ?? null,
        retrieval_recommended_action: retrievalResult?.quality?.recommended_action ?? null,
        query_mode: retrievalResult?.query_analysis?.query_mode ?? null,
        query_boundary_action: retrievalResult?.query_analysis?.boundary?.action ?? null,
        query_explicit_scope_required: Boolean(retrievalResult?.query_analysis?.boundary?.explicit_scope_required),
        query_decomposition_strategy: retrievalResult?.query_analysis?.decomposition?.strategy ?? null,
        query_rewrite_strategy: retrievalResult?.query_analysis?.rewrites?.strategy ?? null,
        query_subquery_count: retrievalResult?.query_analysis?.decomposition?.subqueries?.length ?? 0,
        query_rewrite_count: retrievalResult?.query_analysis?.rewrites?.variants?.length ?? 0,
        query_preferred_sources: Array.from(new Set(
          (retrievalResult?.query_analysis?.decomposition?.subqueries ?? [])
            .map((item) => item?.preferred_source)
            .filter(Boolean),
        )),
        clarification_required: Boolean(retrievalResult?.query_analysis?.clarification?.required),
        intent_tags: retrievalResult?.query_analysis?.intent_tags ?? [],
        filter_policy_mode: retrievalResult?.filter_policy?.mode ?? null,
        filter_hard_enforce_reason: retrievalResult?.filter_policy?.hard_enforce_reason ?? null,
        filter_hard_empty: Boolean(retrievalResult?.filter_policy?.hard_filter_empty),
        filter_hard_empty_reason: retrievalResult?.filter_policy?.hard_filter_empty_reason ?? null,
        source_of_truth_conflict_count: retrievalResult?.quality?.source_of_truth_conflict_count ?? null,
        memory_requested_provider: memory?.requested_provider ?? null,
        memory_effective_provider: memory?.effective_provider ?? null,
        memory_fallback_applied: Boolean(memory?.fallback_applied),
        memory_fallback_reason: memory?.fallback_reason ?? null,
        review_status: latestReview?.review_status ?? null,
        gate_status: task?.metadata?.quality_gate_status ?? null,
        governance_status: task?.metadata?.governance_status ?? null,
        delivery_platforms: Array.from(new Set(deliveries.map((item) => item.target_platform))),
      },
    };

    return bundle;
  }

  return {
    collect,
  };
}
