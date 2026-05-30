export function createApprovalInspectorController({
  state,
  approvalOps,
  approvalSelectedId,
  approvalSummaryChips,
  approvalList,
  approvalChangeList,
  approvalDetailOutput,
  clearNode,
  createChip,
} = {}) {
  function normalizeApprovalInspectorPayload(payload) {
    return {
      task_id: payload?.task_id ?? payload?.task?.task_id ?? null,
      task: payload?.task ?? null,
      preview: payload?.preview ?? null,
      items: (payload?.items ?? []).map((item) => ({
        ...item,
        preview: item.preview ?? payload?.preview ?? null,
      })),
    };
  }

  function buildApprovalInspectorSummary(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return [
      `count:${items.length}`,
      `pending:${items.filter((item) => item.review_status === 'pending').length}`,
      payload?.preview?.task_snapshot?.current_step_id ? `step:${payload.preview.task_snapshot.current_step_id}` : 'step:n/a',
    ];
  }

  function clearApprovalInspector() {
    clearNode(approvalSummaryChips);
    clearNode(approvalList);
    clearNode(approvalChangeList);
    if (approvalDetailOutput) {
      approvalDetailOutput.textContent = '';
    }
    if (approvalSelectedId) {
      approvalSelectedId.value = '';
    }
  }

  function setApprovalInspectorVisibility(showApproval) {
    if (approvalOps) {
      approvalOps.hidden = !showApproval;
    }
  }

  function renderApprovalInspector(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    state.approvalItems = items;
    const selected = items.find((item) => item.review_id === state.approvalSelectedId) ?? items[0] ?? null;
    state.approvalSelectedId = selected?.review_id ?? null;
    if (approvalSelectedId) {
      approvalSelectedId.value = state.approvalSelectedId ?? '';
    }

    clearNode(approvalSummaryChips);
    const summaryItems = [
      `items:${items.length}`,
      `pending:${items.filter((item) => item.review_status === 'pending').length}`,
    ];
    if (selected) {
      summaryItems.push(`review:${selected.review_id}`);
      summaryItems.push(selected.review_status ?? 'pending');
      summaryItems.push(selected.preview?.paused_step?.tool_name ?? selected.preview?.paused_step?.kind ?? 'n/a');
    }
    for (const item of summaryItems) {
      approvalSummaryChips.appendChild(createChip(item));
    }

    clearNode(approvalList);
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No approval reviews found';
      approvalList.appendChild(empty);
    } else {
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'list-item';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-task-link';
        button.dataset.active = String(item.review_id === state.approvalSelectedId);
        button.textContent = `${item.review_id} · ${item.review_status ?? 'pending'} · ${item.preview?.paused_step?.title ?? item.summary ?? 'approval'}`;
        button.addEventListener('click', () => {
          state.approvalSelectedId = item.review_id;
          renderApprovalInspector(payload);
        });

        const meta = document.createElement('div');
        meta.className = 'tiny muted';
        meta.textContent = `${item.reason ?? 'approval_required'} · ${item.preview?.task_snapshot?.current_step_id ?? 'step n/a'}`;

        row.append(button, meta);
        approvalList.appendChild(row);
      }
    }

    clearNode(approvalChangeList);
    const preview = selected?.preview ?? null;
    const changes = Array.isArray(preview?.changes) ? preview.changes : [];
    if (!selected) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'Select an approval to inspect its diff preview';
      approvalChangeList.appendChild(empty);
    } else if (changes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No diff preview available for this approval';
      approvalChangeList.appendChild(empty);
    } else {
      for (const change of changes) {
        const row = document.createElement('div');
        row.className = 'list-item';
        const title = document.createElement('div');
        title.className = 'recent-task-link';
        title.textContent = change.field;
        const meta = document.createElement('div');
        meta.className = 'tiny muted';
        meta.textContent = `${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`;
        row.append(title, meta);
        approvalChangeList.appendChild(row);
      }
    }

    if (approvalDetailOutput) {
      approvalDetailOutput.textContent = JSON.stringify({
        selected_review: selected,
        preview,
        task_snapshot: payload?.task ?? null,
        approval_queue: items,
      }, null, 2);
    }
  }

  function renderApprovalInspectorPanel(showApproval, payload) {
    setApprovalInspectorVisibility(showApproval);
    if (showApproval) {
      renderApprovalInspector(payload);
      return;
    }
    clearApprovalInspector();
  }

  return {
    normalizeApprovalInspectorPayload,
    buildApprovalInspectorSummary,
    clearApprovalInspector,
    setApprovalInspectorVisibility,
    renderApprovalInspectorPanel,
    renderApprovalInspector,
  };
}
