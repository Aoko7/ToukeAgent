import { asArray, asBoolean, asNumber, asObject, asOptionalString, asString, assert, clone } from './_shared.mjs';
import { randomUUID } from 'node:crypto';

const STREAM_EVENT_TYPES = new Set([
  'start',
  'delta',
  'tool_call',
  'tool_result',
  'status',
  'error',
  'done',
  'cancel',
  'heartbeat',
]);

function normalizePayload(eventType, payload) {
  const data = asObject(payload, 'payload');
  switch (eventType) {
    case 'start':
      return {
        title: asString(data.title ?? 'Starting', 'payload.title'),
        mode: asOptionalString(data.mode, 'payload.mode') ?? 'assistant',
      };
    case 'delta':
      return { text: asString(data.text ?? '', 'payload.text') };
    case 'tool_call':
      return {
        tool_name: asString(data.tool_name, 'payload.tool_name'),
        call_id: asString(data.call_id, 'payload.call_id'),
        summary: asOptionalString(data.summary, 'payload.summary'),
      };
    case 'tool_result':
      return {
        call_id: asString(data.call_id, 'payload.call_id'),
        tool_name: asOptionalString(data.tool_name, 'payload.tool_name'),
        status: asString(data.status ?? 'success', 'payload.status'),
        summary: asOptionalString(data.summary, 'payload.summary'),
        error_code: asOptionalString(data.error_code, 'payload.error_code'),
      };
    case 'status':
      return {
        state: asString(data.state, 'payload.state'),
        message: asOptionalString(data.message, 'payload.message'),
      };
    case 'error':
      return {
        code: asString(data.code ?? 'unknown_error', 'payload.code'),
        message: asString(data.message ?? 'Unexpected error', 'payload.message'),
        details: asObject(data.details, 'payload.details', {}),
      };
    case 'done':
      return {
        final_message_id: asOptionalString(data.final_message_id, 'payload.final_message_id'),
        finish_reason: asString(data.finish_reason ?? 'completed', 'payload.finish_reason'),
      };
    case 'cancel':
      return {
        reason: asOptionalString(data.reason, 'payload.reason') ?? 'cancelled',
      };
    case 'heartbeat':
      return {
        note: asOptionalString(data.note, 'payload.note') ?? 'keepalive',
      };
    default:
      return clone(data);
  }
}

export function createStreamEvent(input) {
  const event = asObject(input, 'stream event');
  const event_type = asString(event.event_type, 'event_type');
  assert(STREAM_EVENT_TYPES.has(event_type), `event_type must be one of ${Array.from(STREAM_EVENT_TYPES).join(', ')}`);

  const isTerminal = event.is_terminal ?? ['done', 'error', 'cancel'].includes(event_type);

  return {
    event_id: asString(event.event_id ?? `evt_${randomUUID()}`, 'event_id'),
    event_type,
    seq: asNumber(event.seq, 'seq', 0),
    trace_id: asString(event.trace_id, 'trace_id'),
    task_id: asString(event.task_id, 'task_id'),
    run_id: asString(event.run_id ?? event.task_id, 'run_id'),
    step_id: asOptionalString(event.step_id, 'step_id'),
    persona_id: asOptionalString(event.persona_id, 'persona_id'),
    timestamp: asString(event.timestamp ?? new Date().toISOString(), 'timestamp'),
    is_terminal: asBoolean(isTerminal, 'is_terminal', isTerminal),
    visibility: asString(event.visibility ?? 'internal', 'visibility'),
    payload: normalizePayload(event_type, event.payload ?? {}),
    usage: asObject(event.usage, 'usage', {}),
    error: event.error === undefined || event.error === null ? null : asObject(event.error, 'error'),
    metadata: asObject(event.metadata, 'metadata', {}),
  };
}

export { STREAM_EVENT_TYPES };
