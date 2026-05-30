export function createDeliveryInspectorController({
  state,
  deliveryOps,
  deliveryPlatformFilter,
  deliveryStatusFilter,
  deliverySortOrder,
  deliverySelectedId,
  deliverySummaryChips,
  deliveryList,
  deliveryReceiptList,
  deliveryDetailOutput,
  clearNode,
  createChip,
  formatTimestamp,
  fetchJson,
  loadInspector,
  syncSelectOptions,
  controls = {},
} = {}) {
  let eventsBound = false;

  const {
    deliveryRefreshButton,
    deliveryClearFiltersButton,
  } = controls;

  function compareDeliveryItems(left, right, sortMode) {
    if (sortMode === 'oldest') {
      return String(left.submitted_at ?? '').localeCompare(String(right.submitted_at ?? ''));
    }
    if (sortMode === 'status') {
      return String(left.status ?? '').localeCompare(String(right.status ?? ''))
        || String(left.delivery_id ?? '').localeCompare(String(right.delivery_id ?? ''));
    }
    if (sortMode === 'platform') {
      return String(left.target_platform ?? '').localeCompare(String(right.target_platform ?? ''))
        || String(right.submitted_at ?? '').localeCompare(String(left.submitted_at ?? ''));
    }

    return String(right.submitted_at ?? '').localeCompare(String(left.submitted_at ?? ''));
  }

  function buildDeliveryInspectorSummary(payload) {
    return [
      `count:${payload?.items?.length ?? 0}`,
      `receipts:${payload?.receipts?.length ?? 0}`,
    ];
  }

  function normalizeDeliveryInspectorPayload(payload) {
    return {
      task_id: payload?.task_id ?? null,
      delivery_id: payload?.delivery_id ?? null,
      items: (payload?.items ?? []).map((item) => ({
        delivery_id: item.delivery_id,
        task_id: item.task_id ?? payload?.task_id ?? null,
        target_platform: item.target_platform,
        status: item.status,
        callback_state: item.callback_state,
        adapter_profile_id: item.adapter_profile_id,
        provider_reference: item.provider_reference,
        submitted_at: item.submitted_at,
        delivered_at: item.delivered_at,
        source_platform: item.source_platform ?? null,
        channel_id: item.channel_id ?? null,
        conversation_id: item.conversation_id ?? null,
        response_message_id: item.response_message_id ?? null,
        rendered_payload: item.rendered_payload ?? {},
        metadata: item.metadata ?? {},
        receipt_count: item.receipts?.length ?? 0,
        receipts: Array.isArray(item.receipts) ? item.receipts : [],
      })),
      receipts: (payload?.receipts ?? []).map((receipt) => ({
        receipt_id: receipt.receipt_id,
        delivery_id: receipt.delivery_id,
        status: receipt.status,
        callback_state: receipt.callback_state,
        target_platform: receipt.target_platform,
        provider_reference: receipt.provider_reference,
        external_message_id: receipt.external_message_id,
        recorded_at: receipt.recorded_at,
        body: receipt.body ?? null,
        error: receipt.error ?? null,
        metadata: receipt.metadata ?? {},
      })),
    };
  }

  function buildDeliveriesEndpoint(taskId = state.taskId) {
    const params = new URLSearchParams({
      task_id: taskId,
    });
    if (deliveryPlatformFilter?.value && deliveryPlatformFilter.value !== 'all') {
      params.set('target_platform', deliveryPlatformFilter.value);
    }
    if (deliveryStatusFilter?.value && deliveryStatusFilter.value !== 'all') {
      params.set('status', deliveryStatusFilter.value);
    }
    return `/api/deliveries?${params.toString()}`;
  }

  async function loadDeliveryInspectorData(taskId = state.taskId) {
    const payload = await fetchJson(buildDeliveriesEndpoint(taskId));
    return normalizeDeliveryInspectorPayload(payload);
  }

  function clearDeliveryInspector() {
    clearNode(deliverySummaryChips);
    clearNode(deliveryList);
    clearNode(deliveryReceiptList);
    if (deliveryDetailOutput) {
      deliveryDetailOutput.textContent = '';
    }
    if (deliverySelectedId) {
      deliverySelectedId.value = '';
    }
  }

  function setDeliveryInspectorVisibility(showDeliveries) {
    if (deliveryOps) {
      deliveryOps.hidden = !showDeliveries;
    }
  }

  function renderDeliveryInspectorPanel(showDeliveries, payload) {
    setDeliveryInspectorVisibility(showDeliveries);
    if (showDeliveries) {
      renderDeliveryInspector(payload);
      return;
    }
    clearDeliveryInspector();
  }

  function renderDeliveryInspector(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const receipts = Array.isArray(payload?.receipts) ? payload.receipts : [];
    state.deliveryItems = items;
    state.deliveryReceipts = receipts;
    const sortValue = deliverySortOrder?.value || 'newest';

    syncSelectOptions(deliveryPlatformFilter, items.map((item) => item.target_platform), {
      baseValue: 'all',
      baseLabel: 'all',
    });
    syncSelectOptions(deliveryStatusFilter, items.map((item) => item.status), {
      baseValue: 'all',
      baseLabel: 'all',
    });
    if (deliverySortOrder) {
      deliverySortOrder.value = sortValue;
    }
    const platformValue = deliveryPlatformFilter?.value || 'all';
    const statusValue = deliveryStatusFilter?.value || 'all';

    const filtered = items
      .filter((item) => platformValue === 'all' || item.target_platform === platformValue)
      .filter((item) => statusValue === 'all' || item.status === statusValue)
      .slice()
      .sort((left, right) => compareDeliveryItems(left, right, sortValue));

    if (!filtered.some((item) => item.delivery_id === state.deliverySelectedId)) {
      state.deliverySelectedId = filtered[0]?.delivery_id ?? null;
    }
    if (deliverySelectedId) {
      deliverySelectedId.value = state.deliverySelectedId ?? '';
    }

    const selectedDelivery = filtered.find((item) => item.delivery_id === state.deliverySelectedId) ?? filtered[0] ?? null;
    const selectedReceipts = selectedDelivery
      ? receipts.filter((receipt) => receipt.delivery_id === selectedDelivery.delivery_id)
      : receipts;
    if (!selectedReceipts.some((receipt) => receipt.receipt_id === state.deliverySelectedReceiptId)) {
      state.deliverySelectedReceiptId = selectedReceipts[0]?.receipt_id ?? null;
    }

    clearNode(deliverySummaryChips);
    const summaryItems = [
      `items:${items.length}`,
      `filtered:${filtered.length}`,
      `receipts:${receipts.length}`,
    ];
    if (selectedDelivery) {
      summaryItems.push(`delivery:${selectedDelivery.delivery_id}`);
      summaryItems.push(selectedDelivery.status ?? 'unknown');
      summaryItems.push(selectedDelivery.target_platform ?? 'n/a');
    }
    for (const item of summaryItems) {
      deliverySummaryChips.appendChild(createChip(item));
    }

    clearNode(deliveryList);
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No deliveries match the current filters';
      deliveryList.appendChild(empty);
    } else {
      for (const item of filtered) {
        const row = document.createElement('div');
        row.className = 'list-item';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-task-link';
        button.dataset.active = String(item.delivery_id === state.deliverySelectedId);
        button.textContent = `${item.delivery_id} · ${item.status ?? 'queued'} · ${item.target_platform ?? 'n/a'}`;
        button.addEventListener('click', () => {
          state.deliverySelectedId = item.delivery_id;
          state.deliverySelectedReceiptId = null;
          renderDeliveryInspector(payload);
        });

        const meta = document.createElement('div');
        meta.className = 'tiny muted';
        meta.textContent = `${formatTimestamp(item.submitted_at)} · receipts:${item.receipt_count ?? 0}`;

        row.append(button, meta);
        deliveryList.appendChild(row);
      }
    }

    clearNode(deliveryReceiptList);
    if (!selectedDelivery) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'Select a delivery to inspect receipts';
      deliveryReceiptList.appendChild(empty);
    } else if (selectedReceipts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-item';
      empty.textContent = 'No receipts recorded for the selected delivery';
      deliveryReceiptList.appendChild(empty);
    } else {
      for (const receipt of selectedReceipts) {
        const row = document.createElement('div');
        row.className = 'list-item';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-task-link';
        button.dataset.active = String(receipt.receipt_id === state.deliverySelectedReceiptId);
        button.textContent = `${receipt.receipt_id} · ${receipt.status ?? 'sent'} · ${receipt.callback_state ?? 'pending'}`;
        button.addEventListener('click', () => {
          state.deliverySelectedReceiptId = receipt.receipt_id;
          renderDeliveryInspector(payload);
        });

        const meta = document.createElement('div');
        meta.className = 'tiny muted';
        meta.textContent = `${receipt.target_platform ?? 'n/a'} · ${formatTimestamp(receipt.recorded_at)}`;

        row.append(button, meta);
        deliveryReceiptList.appendChild(row);
      }
    }

    const selectedReceipt = selectedReceipts.find((receipt) => receipt.receipt_id === state.deliverySelectedReceiptId) ?? selectedReceipts[0] ?? null;
    if (deliveryDetailOutput) {
      deliveryDetailOutput.textContent = JSON.stringify({
        selected_delivery: selectedDelivery,
        selected_receipt: selectedReceipt,
        all_receipts: selectedReceipts,
      }, null, 2);
    }
  }

  function bindDeliveryInspectorEvents() {
    if (eventsBound) {
      return;
    }
    eventsBound = true;

    deliveryRefreshButton?.addEventListener('click', () => void loadInspector('deliveries'));
    deliveryClearFiltersButton?.addEventListener('click', () => {
      if (deliveryPlatformFilter) {
        deliveryPlatformFilter.value = 'all';
      }
      if (deliveryStatusFilter) {
        deliveryStatusFilter.value = 'all';
      }
      if (deliverySortOrder) {
        deliverySortOrder.value = 'newest';
      }
      state.deliverySelectedId = null;
      state.deliverySelectedReceiptId = null;
      if (state.activeInspector === 'deliveries') {
        void loadInspector('deliveries');
      }
    });
    deliveryPlatformFilter?.addEventListener('change', () => {
      state.deliverySelectedId = null;
      state.deliverySelectedReceiptId = null;
      if (state.activeInspector === 'deliveries') {
        void loadInspector('deliveries');
      }
    });
    deliveryStatusFilter?.addEventListener('change', () => {
      state.deliverySelectedId = null;
      state.deliverySelectedReceiptId = null;
      if (state.activeInspector === 'deliveries') {
        void loadInspector('deliveries');
      }
    });
    deliverySortOrder?.addEventListener('change', () => {
      if (state.activeInspector === 'deliveries' && state.currentInspector) {
        renderDeliveryInspector(state.currentInspector);
      }
    });
  }

  return {
    bindDeliveryInspectorEvents,
    compareDeliveryItems,
    buildDeliveryInspectorSummary,
    normalizeDeliveryInspectorPayload,
    buildDeliveriesEndpoint,
    loadDeliveryInspectorData,
    clearDeliveryInspector,
    setDeliveryInspectorVisibility,
    renderDeliveryInspectorPanel,
    renderDeliveryInspector,
  };
}
