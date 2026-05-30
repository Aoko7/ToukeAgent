import { randomUUID } from 'node:crypto';
import { asArray, asBoolean, asNumber, asObject, asOptionalString, asString, clone } from './_shared.mjs';

const DELIVERY_STATUSES = new Set(['queued', 'rendered', 'sending', 'sent', 'delivered', 'failed', 'cancelled']);
const CALLBACK_STATES = new Set(['pending', 'awaiting_callback', 'acknowledged', 'failed', 'not_supported']);
const ADAPTER_STATUS = new Set(['active', 'inactive', 'experimental']);

function normalizeStatus(value, name, allowed, fallback) {
  const status = asOptionalString(value, name) ?? fallback;
  if (!allowed.has(status)) {
    throw new TypeError(`${name} must be one of ${Array.from(allowed).join(', ')}`);
  }
  return status;
}

export function createPlatformAdapterProfile(input) {
  const profile = asObject(input, 'platform adapter profile');
  const platformId = asString(profile.platform_id, 'platform_id');

  return {
    platform_id: platformId,
    label: asOptionalString(profile.label, 'label') ?? platformId,
    status: normalizeStatus(profile.status, 'status', ADAPTER_STATUS, 'active'),
    render_mode: asOptionalString(profile.render_mode, 'render_mode') ?? 'plain_text',
    callback_supported: asBoolean(profile.callback_supported, 'callback_supported', true),
    fallback_platform: asOptionalString(profile.fallback_platform, 'fallback_platform'),
    capabilities: clone(asObject(profile.capabilities, 'capabilities', {})),
    transport: clone(asObject(profile.transport, 'transport', {})),
    metadata: clone(asObject(profile.metadata, 'metadata', {})),
    created_at: asOptionalString(profile.created_at, 'created_at') ?? new Date().toISOString(),
  };
}

export function createPlatformDeliveryRequest(input) {
  const request = asObject(input, 'platform delivery request');
  const deliveryId = asOptionalString(request.delivery_id, 'delivery_id') ?? `delivery_${randomUUID()}`;
  const taskId = asString(request.task_id, 'task_id');
  const traceId = asString(request.trace_id, 'trace_id');

  return {
    delivery_id: deliveryId,
    task_id: taskId,
    trace_id: traceId,
    source_platform: asOptionalString(request.source_platform, 'source_platform'),
    target_platform: asString(request.target_platform, 'target_platform'),
    channel_id: asOptionalString(request.channel_id, 'channel_id'),
    conversation_id: asOptionalString(request.conversation_id, 'conversation_id'),
    source_message_id: asOptionalString(request.source_message_id, 'source_message_id'),
    response_message_id: asOptionalString(request.response_message_id, 'response_message_id'),
    adapter_profile_id: asOptionalString(request.adapter_profile_id, 'adapter_profile_id'),
    rendered_payload: clone(asObject(request.rendered_payload, 'rendered_payload', {})),
    status: normalizeStatus(request.status, 'status', DELIVERY_STATUSES, 'queued'),
    callback_state: normalizeStatus(request.callback_state, 'callback_state', CALLBACK_STATES, 'pending'),
    provider_reference: asOptionalString(request.provider_reference, 'provider_reference'),
    submitted_at: asOptionalString(request.submitted_at, 'submitted_at'),
    delivered_at: asOptionalString(request.delivered_at, 'delivered_at'),
    created_at: asOptionalString(request.created_at, 'created_at') ?? new Date().toISOString(),
    updated_at: asOptionalString(request.updated_at, 'updated_at') ?? new Date().toISOString(),
    metadata: clone(asObject(request.metadata, 'metadata', {})),
  };
}

export function createPlatformDeliveryReceipt(input) {
  const receipt = asObject(input, 'platform delivery receipt');
  const receiptId = asOptionalString(receipt.receipt_id, 'receipt_id') ?? `receipt_${randomUUID()}`;
  const taskId = asString(receipt.task_id, 'task_id');
  const traceId = asString(receipt.trace_id, 'trace_id');

  return {
    receipt_id: receiptId,
    delivery_id: asString(receipt.delivery_id, 'delivery_id'),
    task_id: taskId,
    trace_id: traceId,
    target_platform: asString(receipt.target_platform, 'target_platform'),
    adapter_profile_id: asOptionalString(receipt.adapter_profile_id, 'adapter_profile_id'),
    status: normalizeStatus(receipt.status, 'status', DELIVERY_STATUSES, 'sent'),
    callback_state: normalizeStatus(receipt.callback_state, 'callback_state', CALLBACK_STATES, 'acknowledged'),
    provider_reference: asOptionalString(receipt.provider_reference, 'provider_reference'),
    external_message_id: asOptionalString(receipt.external_message_id, 'external_message_id'),
    http_status: asNumber(receipt.http_status, 'http_status', 200),
    body: clone(asObject(receipt.body, 'body', {})),
    error: receipt.error === undefined || receipt.error === null ? null : clone(asObject(receipt.error, 'error', {})),
    recorded_at: asOptionalString(receipt.recorded_at, 'recorded_at') ?? new Date().toISOString(),
    metadata: clone(asObject(receipt.metadata, 'metadata', {})),
  };
}
