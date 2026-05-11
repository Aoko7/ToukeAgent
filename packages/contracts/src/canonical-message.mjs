import { asArray, asObject, asOptionalString, asString, clone, assert, isPlainObject } from './_shared.mjs';

const CONTENT_TYPES = new Set(['text', 'mention', 'image', 'file', 'quote', 'action']);

function normalizeContentPart(part) {
  assert(isPlainObject(part), 'content item must be an object');
  const type = asString(part.type ?? 'text', 'content.type');
  assert(CONTENT_TYPES.has(type), `content.type must be one of ${Array.from(CONTENT_TYPES).join(', ')}`);

  switch (type) {
    case 'text':
      return { type, text: asString(part.text ?? '', 'content.text') };
    case 'mention':
      return {
        type,
        id: asString(part.id, 'content.id'),
        display_name: asOptionalString(part.display_name, 'content.display_name'),
      };
    case 'image':
      return {
        type,
        url: asString(part.url, 'content.url'),
        alt_text: asOptionalString(part.alt_text, 'content.alt_text'),
      };
    case 'file':
      return {
        type,
        name: asString(part.name, 'content.name'),
        url: asOptionalString(part.url, 'content.url'),
        mime_type: asOptionalString(part.mime_type, 'content.mime_type'),
        size_bytes: part.size_bytes ?? null,
      };
    case 'quote':
      return {
        type,
        message_id: asString(part.message_id, 'content.message_id'),
        text: asOptionalString(part.text, 'content.text'),
      };
    case 'action':
      return {
        type,
        name: asString(part.name, 'content.name'),
        label: asOptionalString(part.label, 'content.label'),
      };
    default:
      throw new TypeError(`Unsupported content type: ${type}`);
  }
}

function normalizeActor(value, name) {
  const actor = asObject(value, name);
  return {
    id: asString(actor.id, `${name}.id`),
    role: asString(actor.role, `${name}.role`),
    display_name: asOptionalString(actor.display_name, `${name}.display_name`),
  };
}

export function createCanonicalMessage(input) {
  const message = asObject(input, 'canonical message');
  const content = asArray(message.content, 'content').map(normalizeContentPart);

  return {
    message_id: asString(message.message_id, 'message_id'),
    source_platform: asString(message.source_platform, 'source_platform'),
    source_message_id: asString(message.source_message_id, 'source_message_id'),
    workspace_id: asString(message.workspace_id, 'workspace_id'),
    channel_id: asString(message.channel_id, 'channel_id'),
    conversation_id: asString(message.conversation_id, 'conversation_id'),
    thread_id: asOptionalString(message.thread_id, 'thread_id'),
    sender: normalizeActor(message.sender, 'sender'),
    recipient: normalizeActor(message.recipient, 'recipient'),
    created_at: asString(message.created_at ?? new Date().toISOString(), 'created_at'),
    content,
    attachments: asArray(message.attachments, 'attachments').map((item) => clone(item)),
    quoted_messages: asArray(message.quoted_messages, 'quoted_messages').map((item) => clone(item)),
    intent_tags: asArray(message.intent_tags, 'intent_tags').map((item) => asString(item, 'intent_tags item')),
    risk_flags: asArray(message.risk_flags, 'risk_flags').map((item) => asString(item, 'risk_flags item')),
    persona_hint: asOptionalString(message.persona_hint, 'persona_hint'),
    trace_id: asString(message.trace_id, 'trace_id'),
    metadata: asObject(message.metadata, 'metadata'),
  };
}
