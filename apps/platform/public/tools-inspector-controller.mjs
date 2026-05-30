export function createToolsInspectorController({
  state,
  toolsOps,
  toolsSummaryChips,
  toolsDetailOutput,
  clearNode,
  createChip,
} = {}) {
  function normalizeToolsInspectorPayload(payload) {
    return {
      items: Array.isArray(payload?.items) ? payload.items : [],
      toolsets: Array.isArray(payload?.toolsets)
        ? payload.toolsets
        : Array.isArray(state.personaCatalog?.toolsets)
          ? state.personaCatalog.toolsets
          : [],
    };
  }

  function buildToolsInspectorSummary(payload) {
    return [
      `tools:${payload?.items?.length ?? 0}`,
      `toolsets:${payload?.toolsets?.length ?? 0}`,
      `enabled:${payload?.items?.filter((item) => item.enabled !== false).length ?? 0}`,
      `beta:${payload?.items?.filter((item) => item.release_channel === 'beta').length ?? 0}`,
    ];
  }

  function clearToolsInspector() {
    clearNode(toolsSummaryChips);
    clearNode(toolsDetailOutput);
  }

  function setToolsInspectorVisibility(showTools) {
    if (toolsOps) {
      toolsOps.hidden = !showTools;
    }
  }

  function renderToolsInspector(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const toolsets = Array.isArray(payload?.toolsets) ? payload.toolsets : [];

    clearNode(toolsSummaryChips);
    for (const item of [
      `tools:${items.length}`,
      `toolsets:${toolsets.length}`,
      `enabled:${items.filter((entry) => entry.enabled !== false).length}`,
      `disabled:${items.filter((entry) => entry.enabled === false).length}`,
    ]) {
      toolsSummaryChips.appendChild(createChip(item));
    }

    clearNode(toolsDetailOutput);
    const wrapper = document.createElement('div');
    wrapper.className = 'tool-grid';

    const toolsetSection = document.createElement('section');
    toolsetSection.className = 'draft-section';
    const toolsetTitle = document.createElement('strong');
    toolsetTitle.textContent = 'Toolsets';
    toolsetSection.appendChild(toolsetTitle);

    if (toolsets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tiny muted';
      empty.textContent = 'No toolsets found';
      toolsetSection.appendChild(empty);
    } else {
      const toolsetGrid = document.createElement('div');
      toolsetGrid.className = 'tool-section-grid';
      for (const toolset of toolsets) {
        const card = document.createElement('article');
        card.className = 'tool-card';

        const titleRow = document.createElement('div');
        titleRow.className = 'tool-card-title';
        const title = document.createElement('strong');
        title.textContent = toolset.toolset_id ?? 'toolset';
        const chip = createChip(`${toolset.release_channel ?? 'stable'} · ${toolset.enabled === false ? 'disabled' : 'enabled'}`);
        titleRow.append(title, chip);

        const meta = document.createElement('div');
        meta.className = 'tool-card-meta';
        meta.textContent = toolset.description ?? toolset.label ?? 'n/a';

        const list = document.createElement('ul');
        list.className = 'tool-card-list';
        for (const text of [
          `permissions: ${(toolset.allowed_permissions ?? []).join(', ') || 'n/a'}`,
          `required capabilities: ${(toolset.required_capabilities ?? []).join(', ') || 'n/a'}`,
          `allowed channels: ${(toolset.allowed_release_channels ?? []).join(', ') || 'n/a'}`,
          `side effects: ${toolset.allow_side_effects ? 'allowed' : 'blocked'}`,
        ]) {
          const li = document.createElement('li');
          li.textContent = text;
          list.appendChild(li);
        }

        card.append(titleRow, meta, list);
        toolsetGrid.appendChild(card);
      }
      toolsetSection.appendChild(toolsetGrid);
    }

    const toolSection = document.createElement('section');
    toolSection.className = 'draft-section';
    const toolTitle = document.createElement('strong');
    toolTitle.textContent = 'Registered Tools';
    toolSection.appendChild(toolTitle);

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tiny muted';
      empty.textContent = 'No registered tools found';
      toolSection.appendChild(empty);
    } else {
      const toolGrid = document.createElement('div');
      toolGrid.className = 'tool-section-grid';
      for (const item of items) {
        const card = document.createElement('article');
        card.className = 'tool-card';

        const titleRow = document.createElement('div');
        titleRow.className = 'tool-card-title';
        const title = document.createElement('strong');
        title.textContent = item.tool_name ?? 'tool';
        const chip = createChip(`${item.release_channel ?? 'stable'} · ${item.enabled === false ? 'disabled' : item.risk_level ?? 'n/a'}`);
        titleRow.append(title, chip);

        const meta = document.createElement('div');
        meta.className = 'tool-card-meta';
        meta.textContent = item.description ?? item.tool_name ?? 'n/a';

        const list = document.createElement('ul');
        list.className = 'tool-card-list';
        for (const text of [
          `permissions: ${(item.permissions ?? []).join(', ') || 'n/a'}`,
          `capabilities: ${(item.capabilities ?? []).join(', ') || 'n/a'}`,
          `side effects: ${item.side_effect_scope ?? 'n/a'}`,
          `approval: ${item.requires_approval ? 'required' : 'not required'}`,
        ]) {
          const li = document.createElement('li');
          li.textContent = text;
          list.appendChild(li);
        }

        card.append(titleRow, meta, list);
        toolGrid.appendChild(card);
      }
      toolSection.appendChild(toolGrid);
    }

    wrapper.append(toolsetSection, toolSection);
    toolsDetailOutput.appendChild(wrapper);
  }

  function renderToolsInspectorPanel(showTools, payload) {
    setToolsInspectorVisibility(showTools);
    if (showTools) {
      renderToolsInspector(payload);
      return;
    }
    clearToolsInspector();
  }

  return {
    normalizeToolsInspectorPayload,
    buildToolsInspectorSummary,
    clearToolsInspector,
    setToolsInspectorVisibility,
    renderToolsInspectorPanel,
    renderToolsInspector,
  };
}
