export function createGovernanceInspectorController({
  governanceOps,
  governanceSummaryChips,
  governanceDetailOutput,
  clearNode,
  createChip,
  appendDraftJsonSection,
  appendDraftKv,
  appendDraftListSection,
  appendDraftTableSection,
} = {}) {
  function normalizeGovernanceInspectorPayload(payload) {
    return payload;
  }

  function buildGovernanceInspectorSummary(payload) {
    return [
      payload?.metrics?.status ?? 'n/a',
      `alerts:${payload?.alerts?.length ?? 0}`,
    ];
  }

  function clearGovernanceInspector() {
    clearNode(governanceSummaryChips);
    clearNode(governanceDetailOutput);
  }

  function setGovernanceInspectorVisibility(showGovernance) {
    if (governanceOps) {
      governanceOps.hidden = !showGovernance;
    }
  }

  function renderGovernanceInspector(payload) {
    const alerts = Array.isArray(payload?.alerts) ? payload.alerts : [];
    const summary = payload?.tool_governance ?? {};
    const runtime = summary.runtime ?? {};
    const enforcement = summary.enforcement ?? {};
    const catalog = summary.catalog ?? {};
    const taskContext = summary.task_context ?? {};

    clearNode(governanceSummaryChips);
    for (const item of [
      `status:${payload?.metrics?.status ?? 'n/a'}`,
      `alerts:${alerts.length}`,
      `blocked:${runtime.blocked_tool_result_count ?? 0}`,
      `sandbox:${summary?.sandbox?.blocked_count ?? 0}`,
      `toolset:${taskContext.active_toolset_id ?? 'n/a'}`,
      `disabled:${catalog.disabled_tools ?? 0}`,
    ]) {
      governanceSummaryChips.appendChild(createChip(item));
    }

    clearNode(governanceDetailOutput);
    const wrapper = document.createElement('div');
    wrapper.className = 'tool-grid';

    const runtimeGrid = document.createElement('section');
    runtimeGrid.className = 'draft-section';
    const runtimeTitle = document.createElement('strong');
    runtimeTitle.textContent = 'Runtime Governance';
    runtimeGrid.appendChild(runtimeTitle);
    const runtimeMetrics = document.createElement('div');
    runtimeMetrics.className = 'draft-grid';
    appendDraftKv(runtimeMetrics, 'Persona', taskContext.persona_id ?? 'n/a');
    appendDraftKv(runtimeMetrics, 'Active toolset', taskContext.active_toolset_id ?? 'n/a');
    appendDraftKv(runtimeMetrics, 'Blocked results', runtime.blocked_tool_result_count ?? 0);
    appendDraftKv(runtimeMetrics, 'Sandbox blocked', runtime.sandbox_blocked_tool_result_count ?? 0);
    appendDraftKv(runtimeMetrics, 'Blocked rate', runtime.blocked_rate ?? 0);
    appendDraftKv(runtimeMetrics, 'Tool calls', runtime.tool_call_count ?? 0);
    appendDraftKv(runtimeMetrics, 'Tool results', runtime.tool_result_count ?? 0);
    runtimeGrid.appendChild(runtimeMetrics);
    appendDraftListSection(runtimeGrid, 'Blocked tool names', runtime.blocked_tool_names ?? []);
    appendDraftJsonSection(runtimeGrid, 'Blocked reason histogram', runtime.blocked_tool_error_codes ?? {});
    appendDraftListSection(runtimeGrid, 'Sandbox blocked tool names', runtime.sandbox_blocked_tool_names ?? []);
    appendDraftJsonSection(runtimeGrid, 'Sandbox blocked reasons', runtime.sandbox_blocked_error_codes ?? {});

    const enforcementSection = document.createElement('section');
    enforcementSection.className = 'draft-section';
    const enforcementTitle = document.createElement('strong');
    enforcementTitle.textContent = 'Toolset Enforcement';
    enforcementSection.appendChild(enforcementTitle);
    const enforcementGrid = document.createElement('div');
    enforcementGrid.className = 'draft-grid';
    appendDraftKv(enforcementGrid, 'Mode', enforcement.mode ?? 'n/a');
    appendDraftKv(enforcementGrid, 'Policy attached', enforcement.access_policy_present ? 'yes' : 'no');
    appendDraftKv(enforcementGrid, 'Allowed tools', enforcement.projected?.allowed_tool_count ?? 'n/a');
    appendDraftKv(enforcementGrid, 'Blocked tools', enforcement.projected?.blocked_tool_count ?? 'n/a');
    enforcementSection.appendChild(enforcementGrid);
    appendDraftJsonSection(enforcementSection, 'Access policy', enforcement.access_policy ?? {});
    appendDraftJsonSection(enforcementSection, 'Projected blocked reasons', enforcement.projected?.blocked_by_reason ?? {});
    appendDraftListSection(enforcementSection, 'Projected governance notes', enforcement.notes ?? []);
    appendDraftTableSection(
      enforcementSection,
      'Projected blocked tools',
      enforcement.projected?.blocked_tools ?? [],
      [
        { key: 'tool_name', label: 'Tool' },
        { key: 'reason', label: 'Reason' },
        { key: 'summary', label: 'Summary' },
      ],
    );

    const sandboxSection = document.createElement('section');
    sandboxSection.className = 'draft-section';
    const sandboxTitle = document.createElement('strong');
    sandboxTitle.textContent = 'Restricted Sandbox';
    sandboxSection.appendChild(sandboxTitle);
    const sandboxGrid = document.createElement('div');
    sandboxGrid.className = 'draft-grid';
    appendDraftKv(sandboxGrid, 'Environment', summary.sandbox?.environment_name ?? 'n/a');
    appendDraftKv(sandboxGrid, 'Filesystem scope', summary.sandbox?.filesystem_scope ?? 'n/a');
    appendDraftKv(sandboxGrid, 'Network allowed', summary.sandbox?.network_allowed ?? 'n/a');
    appendDraftKv(sandboxGrid, 'Shell allowed', summary.sandbox?.shell_allowed ?? 'n/a');
    appendDraftKv(sandboxGrid, 'Blocked count', summary.sandbox?.blocked_count ?? 0);
    sandboxSection.appendChild(sandboxGrid);
    appendDraftListSection(sandboxSection, 'Allowed paths', summary.sandbox?.allowed_paths ?? []);
    appendDraftListSection(sandboxSection, 'Allowed hosts', summary.sandbox?.allowed_hosts ?? []);
    appendDraftListSection(sandboxSection, 'Allowed providers', summary.sandbox?.allowed_providers ?? []);
    appendDraftListSection(sandboxSection, 'Dynamic hosts', summary.sandbox?.dynamic_allowed_hosts ?? []);
    appendDraftListSection(sandboxSection, 'Dynamic providers', summary.sandbox?.dynamic_allowed_providers ?? []);
    appendDraftTableSection(
      sandboxSection,
      'Provider-host bindings',
      summary.sandbox?.provider_host_bindings ?? [],
      [
        { key: 'provider', label: 'Provider' },
        { key: 'hosts', label: 'Hosts' },
      ],
    );
    appendDraftTableSection(
      sandboxSection,
      'Dynamic provider-host bindings',
      summary.sandbox?.dynamic_provider_host_bindings ?? [],
      [
        { key: 'provider', label: 'Provider' },
        { key: 'hosts', label: 'Hosts' },
      ],
    );
    appendDraftJsonSection(sandboxSection, 'Network observation', summary.sandbox?.network_observation ?? {});
    appendDraftJsonSection(sandboxSection, 'Blocked by reason', summary.sandbox?.blocked_by_reason ?? {});
    appendDraftListSection(sandboxSection, 'Blocked tools', summary.sandbox?.blocked_tool_names ?? []);

    const catalogSection = document.createElement('section');
    catalogSection.className = 'draft-section';
    const catalogTitle = document.createElement('strong');
    catalogTitle.textContent = 'Catalog Risk Surface';
    catalogSection.appendChild(catalogTitle);
    const catalogGrid = document.createElement('div');
    catalogGrid.className = 'draft-grid';
    appendDraftKv(catalogGrid, 'Total tools', catalog.total_tools ?? 0);
    appendDraftKv(catalogGrid, 'Enabled', catalog.enabled_tools ?? 0);
    appendDraftKv(catalogGrid, 'Disabled', catalog.disabled_tools ?? 0);
    appendDraftKv(catalogGrid, 'Beta', catalog.beta_tools ?? 0);
    appendDraftKv(catalogGrid, 'Approval required', catalog.approval_required_tools ?? 0);
    appendDraftKv(catalogGrid, 'Side-effect tools', catalog.side_effect_tools ?? 0);
    catalogSection.appendChild(catalogGrid);
    appendDraftJsonSection(catalogSection, 'By release channel', catalog.by_release_channel ?? {});
    appendDraftJsonSection(catalogSection, 'By risk level', catalog.by_risk_level ?? {});
    appendDraftJsonSection(catalogSection, 'By capability', catalog.by_capability ?? {});

    const alertSection = document.createElement('section');
    alertSection.className = 'draft-section';
    const alertTitle = document.createElement('strong');
    alertTitle.textContent = 'Alert Distribution';
    alertSection.appendChild(alertTitle);
    const alertGrid = document.createElement('div');
    alertGrid.className = 'draft-grid';
    appendDraftKv(alertGrid, 'Open alerts', summary.alerts?.open_count ?? 0);
    appendDraftKv(alertGrid, 'Latest alert code', summary.alerts?.latest_code ?? 'n/a');
    alertSection.appendChild(alertGrid);
    appendDraftJsonSection(alertSection, 'Alerts by category', summary.alerts?.by_category ?? {});
    appendDraftJsonSection(alertSection, 'Alerts by severity', summary.alerts?.by_severity ?? {});

    wrapper.append(runtimeGrid, enforcementSection, sandboxSection, catalogSection, alertSection);
    governanceDetailOutput.appendChild(wrapper);
  }

  function renderGovernanceInspectorPanel(showGovernance, payload) {
    setGovernanceInspectorVisibility(showGovernance);
    if (showGovernance) {
      renderGovernanceInspector(payload);
      return;
    }
    clearGovernanceInspector();
  }

  return {
    normalizeGovernanceInspectorPayload,
    buildGovernanceInspectorSummary,
    clearGovernanceInspector,
    setGovernanceInspectorVisibility,
    renderGovernanceInspectorPanel,
    renderGovernanceInspector,
  };
}
