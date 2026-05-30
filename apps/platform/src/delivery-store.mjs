import { randomUUID } from 'node:crypto';
import { createPlatformDeliveryReceipt, createPlatformDeliveryRequest } from '../../../packages/contracts/src/index.mjs';

function clone(value) {
  return structuredClone(value);
}

function createStoredDelivery(input) {
  return {
    ...createPlatformDeliveryRequest({
      delivery_id: input.delivery_id ?? `delivery_${randomUUID()}`,
      task_id: input.task_id,
      trace_id: input.trace_id,
      source_platform: input.source_platform ?? null,
      target_platform: input.target_platform,
      channel_id: input.channel_id ?? null,
      conversation_id: input.conversation_id ?? null,
      source_message_id: input.source_message_id ?? null,
      response_message_id: input.response_message_id ?? null,
      adapter_profile_id: input.adapter_profile_id ?? null,
      rendered_payload: input.rendered_payload ?? {},
      status: input.status ?? 'queued',
      callback_state: input.callback_state ?? 'pending',
      provider_reference: input.provider_reference ?? null,
      submitted_at: input.submitted_at ?? null,
      delivered_at: input.delivered_at ?? null,
      metadata: input.metadata ?? {},
    }),
    receipts: clone(input.receipts ?? []),
  };
}

export function createPlatformDeliveryStore() {
  const deliveries = new Map();

  function ensure(deliveryId) {
    if (!deliveries.has(deliveryId)) {
      throw new Error(`Unknown delivery: ${deliveryId}`);
    }
    return deliveries.get(deliveryId);
  }

  function create(input) {
    const stored = createStoredDelivery(input);
    deliveries.set(stored.delivery_id, stored);
    return clone(stored);
  }

  function update(deliveryId, patch = {}) {
    const current = ensure(deliveryId);
    const next = {
      ...current,
      ...clone(patch),
      delivery_id: deliveryId,
      task_id: patch.task_id ?? current.task_id,
      trace_id: patch.trace_id ?? current.trace_id,
      target_platform: patch.target_platform ?? current.target_platform,
      source_platform: patch.source_platform ?? current.source_platform ?? null,
      channel_id: patch.channel_id ?? current.channel_id ?? null,
      conversation_id: patch.conversation_id ?? current.conversation_id ?? null,
      source_message_id: patch.source_message_id ?? current.source_message_id ?? null,
      response_message_id: patch.response_message_id ?? current.response_message_id ?? null,
      adapter_profile_id: patch.adapter_profile_id ?? current.adapter_profile_id ?? null,
      rendered_payload: patch.rendered_payload === undefined
        ? clone(current.rendered_payload ?? {})
        : clone(patch.rendered_payload),
      status: patch.status ?? current.status,
      callback_state: patch.callback_state ?? current.callback_state,
      provider_reference: patch.provider_reference ?? current.provider_reference ?? null,
      submitted_at: patch.submitted_at ?? current.submitted_at ?? null,
      delivered_at: patch.delivered_at ?? current.delivered_at ?? null,
      created_at: patch.created_at ?? current.created_at,
      updated_at: patch.updated_at ?? new Date().toISOString(),
      metadata: {
        ...(current.metadata ?? {}),
        ...(patch.metadata ? clone(patch.metadata) : {}),
      },
      receipts: patch.receipts ? clone(patch.receipts) : clone(current.receipts ?? []),
    };

    deliveries.set(deliveryId, next);
    return clone(next);
  }

  function appendReceipt(deliveryId, input = {}) {
    const current = ensure(deliveryId);
    const receipt = createPlatformDeliveryReceipt({
      receipt_id: input.receipt_id ?? `receipt_${randomUUID()}`,
      delivery_id: deliveryId,
      task_id: input.task_id ?? current.task_id,
      trace_id: input.trace_id ?? current.trace_id,
      target_platform: input.target_platform ?? current.target_platform,
      adapter_profile_id: input.adapter_profile_id ?? current.adapter_profile_id ?? null,
      status: input.status ?? 'sent',
      callback_state: input.callback_state ?? 'acknowledged',
      provider_reference: input.provider_reference ?? current.provider_reference ?? null,
      external_message_id: input.external_message_id ?? null,
      http_status: input.http_status ?? 200,
      body: input.body ?? {},
      error: input.error ?? null,
      recorded_at: input.recorded_at ?? new Date().toISOString(),
      metadata: input.metadata ?? {},
    });

    const next = {
      ...current,
      receipts: [...(current.receipts ?? []), receipt],
      status: receipt.status,
      callback_state: receipt.callback_state,
      provider_reference: receipt.provider_reference ?? current.provider_reference ?? null,
      delivered_at: receipt.status === 'delivered' ? receipt.recorded_at : current.delivered_at ?? null,
      updated_at: receipt.recorded_at,
    };

    deliveries.set(deliveryId, next);
    return clone(receipt);
  }

  function get(deliveryId) {
    const current = deliveries.get(deliveryId);
    return current ? clone(current) : null;
  }

  function list({ taskId = null, targetPlatform = null, status = null } = {}) {
    return Array.from(deliveries.values())
      .filter((item) => (taskId ? item.task_id === taskId : true))
      .filter((item) => (targetPlatform ? item.target_platform === targetPlatform : true))
      .filter((item) => (status ? item.status === status : true))
      .map((item) => clone(item));
  }

  function findByProviderReference(providerReference) {
    if (!providerReference) {
      return null;
    }
    const entry = Array.from(deliveries.values()).find((item) => item.provider_reference === providerReference);
    return entry ? clone(entry) : null;
  }

  function listReceipts({ taskId = null, deliveryId = null } = {}) {
    return Array.from(deliveries.values())
      .filter((item) => (taskId ? item.task_id === taskId : true))
      .filter((item) => (deliveryId ? item.delivery_id === deliveryId : true))
      .flatMap((item) => item.receipts ?? [])
      .map((item) => clone(item));
  }

  return {
    appendReceipt,
    create,
    findByProviderReference,
    get,
    list,
    listReceipts,
    update,
  };
}
