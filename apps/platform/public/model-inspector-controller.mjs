export function createModelInspectorController({
  modelOps,
  modelSummaryChips,
  modelProviderList,
  modelFallbackList,
  modelDetailOutput,
  clearNode,
  createChip,
} = {}) {
  function normalizeModelInspectorPayload(payload) {
    const task = payload?.task ?? null;
    const runState = task?.run_state ?? payload?.run_state ?? null;
    const modelRoute = runState?.output?.model_route ?? task?.output?.model_route ?? null;
    const fallback = runState?.output?.fallback ?? task?.output?.fallback ?? null;
    return {
      task_id: payload?.task_id ?? task?.task_id ?? null,
      trace_id: payload?.trace_id ?? task?.trace_id ?? null,
      model_route: modelRoute,
      fallback,
      routing_policy: payload?.task?.metadata?.model_routing ?? payload?.metrics?.model_routing ?? null,
      provider_catalog: payload?.task?.metadata?.model_routing?.providers ?? payload?.metrics?.model_routing?.providers ?? null,
      fallback_chain: payload?.task?.metadata?.model_routing?.fallback_chain ?? payload?.metrics?.model_routing?.fallback_chain ?? [],
      output_summary: {
        final_text_preview: runState?.output?.final_text ? runState.output.final_text.slice(0, 240) : null,
        delivery_count: payload?.metrics?.delivery_count ?? 0,
        delivery_platforms: payload?.metrics?.delivery_platforms ?? [],
        retrieval_score: payload?.metrics?.retrieval_score ?? null,
      },
      metrics: {
        delivery_count: payload?.metrics?.delivery_count ?? 0,
        delivery_receipt_count: payload?.metrics?.delivery_receipt_count ?? 0,
        delivery_callback_count: payload?.metrics?.delivery_callback_count ?? 0,
        retrieval_score: payload?.metrics?.retrieval_score ?? null,
        citation_score: payload?.metrics?.citation_score ?? null,
      },
    };
  }

  function buildModelInspectorSummary(payload) {
    return [
      `provider:${payload?.model_route?.provider ?? 'n/a'}`,
      `profile:${payload?.model_route?.profile ?? 'n/a'}`,
      `fallback:${payload?.fallback?.applied ? 'yes' : 'no'}`,
      `providers:${Object.keys(payload?.provider_catalog ?? {}).length}`,
      `chain:${payload?.fallback_chain?.length ?? 0}`,
    ];
  }

  function clearModelInspector() {
    clearNode(modelSummaryChips);
    clearNode(modelProviderList);
    clearNode(modelFallbackList);
    if (modelDetailOutput) {
      modelDetailOutput.textContent = '';
    }
  }

  function setModelInspectorVisibility(showModel) {
    if (modelOps) {
      modelOps.hidden = !showModel;
    }
  }

  function renderModelInspector(payload) {
    const providerCatalog = payload?.provider_catalog ?? {};
    const fallbackChain = Array.isArray(payload?.fallback_chain) ? payload.fallback_chain : [];
    const modelRoute = payload?.model_route ?? null;
    const fallback = payload?.fallback ?? null;

    clearNode(modelSummaryChips);
    const summaryItems = [
      `providers:${Object.keys(providerCatalog).length}`,
      `chain:${fallbackChain.length}`,
    ];
    if (modelRoute?.provider) {
      summaryItems.push(`provider:${modelRoute.provider}`);
    }
    if (modelRoute?.profile) {
      summaryItems.push(`profile:${modelRoute.profile}`);
    }
    if (fallback?.applied) {
      summaryItems.push(`fallback:${fallback.strategy ?? 'local'}`);
    }
    for (const item of summaryItems) {
      modelSummaryChips.appendChild(createChip(item));
    }

    clearNode(modelProviderList);
    const providerEntries = Object.entries(providerCatalog);
    if (providerEntries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No provider catalog data available';
      modelProviderList.appendChild(empty);
    } else {
      for (const [providerId, provider] of providerEntries) {
        const row = document.createElement('div');
        row.className = 'list-item';
        const title = document.createElement('button');
        title.type = 'button';
        title.className = 'recent-task-link';
        title.textContent = `${providerId} · ${provider.label ?? provider.mode ?? 'provider'}`;
        title.addEventListener('click', () => {
          modelDetailOutput.textContent = JSON.stringify(provider, null, 2);
        });
        const meta = document.createElement('div');
        meta.className = 'tiny muted';
        meta.textContent = `${provider.mode ?? 'n/a'} · ${provider.model ?? 'model n/a'} · ${provider.available ? 'available' : 'unavailable'}`;
        row.append(title, meta);
        modelProviderList.appendChild(row);
      }
    }

    clearNode(modelFallbackList);
    if (fallbackChain.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No fallback chain available';
      modelFallbackList.appendChild(empty);
    } else {
      for (const step of fallbackChain) {
        const row = document.createElement('div');
        row.className = 'list-item';
        const title = document.createElement('button');
        title.type = 'button';
        title.className = 'recent-task-link';
        title.textContent = `${step.provider ?? step.strategy ?? 'fallback'} · ${step.profile ?? step.strategy ?? 'route'}`;
        title.addEventListener('click', () => {
          modelDetailOutput.textContent = JSON.stringify(step, null, 2);
        });
        const meta = document.createElement('div');
        meta.className = 'tiny muted';
        meta.textContent = `${step.available ? 'available' : 'planned'} · ${step.reason ?? 'n/a'}`;
        row.append(title, meta);
        modelFallbackList.appendChild(row);
      }
    }

    modelDetailOutput.textContent = JSON.stringify({
      model_route: modelRoute,
      fallback,
      routing_policy: payload?.routing_policy ?? null,
      output_summary: payload?.output_summary ?? null,
      metrics: payload?.metrics ?? null,
    }, null, 2);
  }

  function renderModelInspectorPanel(showModel, payload) {
    setModelInspectorVisibility(showModel);
    if (showModel) {
      renderModelInspector(payload);
      return;
    }
    clearModelInspector();
  }

  return {
    normalizeModelInspectorPayload,
    buildModelInspectorSummary,
    clearModelInspector,
    setModelInspectorVisibility,
    renderModelInspectorPanel,
    renderModelInspector,
  };
}
