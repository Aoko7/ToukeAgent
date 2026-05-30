function clone(value) {
  return structuredClone(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(text, limit = 4000) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, Math.max(0, limit - 3))}...`;
}

function summarizeText(text, limit = 160) {
  return normalizeText(text, limit);
}

function pickMessageText(message) {
  return toArray(message?.content)
    .filter((item) => item?.type === 'text')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

function detectAttachmentType(input = {}) {
  const declaredType = String(input.type ?? input.kind ?? '').toLowerCase();
  if (declaredType === 'image' || declaredType === 'file' || declaredType === 'video') {
    return declaredType;
  }

  const mimeType = String(input.mime_type ?? input.mimeType ?? '').toLowerCase();
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType.startsWith('video/')) {
    return 'video';
  }

  const url = String(input.url ?? input.href ?? '').toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(url)) {
    return 'image';
  }
  if (/\.(mp4|mov|webm|m4v)$/.test(url)) {
    return 'video';
  }
  return 'file';
}

function normalizeAttachment(input, index) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const url = input.url ?? input.href ?? null;
  const name = input.name ?? input.title ?? input.filename ?? `attachment_${index + 1}`;
  const type = detectAttachmentType(input);

  return {
    type,
    name: String(name),
    url: url ? String(url) : null,
    mime_type: input.mime_type ?? input.mimeType ?? null,
    size_bytes: input.size_bytes ?? input.sizeBytes ?? null,
    alt_text: input.alt_text ?? input.altText ?? null,
    caption: input.caption ?? input.summary ?? null,
    metadata: clone(input.metadata ?? {}),
  };
}

function attachmentKey(attachment) {
  return [
    attachment.type ?? '',
    attachment.url ?? '',
    attachment.name ?? '',
  ].join('|');
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function extractRetrievalOutput(runState) {
  const stepResults = toArray(runState?.step_results);
  return stepResults.find((entry) => entry?.output?.route || entry?.output?.citations || entry?.output?.items)?.output ?? null;
}

function normalizeCitation(input, index) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const title = String(input.title ?? input.name ?? `Source ${index + 1}`).trim();
  return {
    title,
    source_type: input.source_type ?? input.sourceType ?? 'context',
    doc_id: input.doc_id ?? null,
    entry_id: input.entry_id ?? null,
    url: input.url ?? null,
    snippet: input.snippet ?? input.summary ?? null,
    freshness: input.freshness ?? null,
    score: input.score ?? input.citation_score ?? null,
  };
}

function citationKey(citation) {
  return [
    citation.doc_id ?? '',
    citation.entry_id ?? '',
    citation.title ?? '',
    citation.url ?? '',
  ].join('|');
}

function collectCitations(retrievalOutput) {
  const directCitations = toArray(retrievalOutput?.citations)
    .map(normalizeCitation)
    .filter(Boolean);

  const itemBackfill = toArray(retrievalOutput?.items)
    .map(normalizeCitation)
    .filter(Boolean);

  return uniqueBy(
    directCitations.length > 0 ? directCitations : itemBackfill,
    citationKey,
  );
}

function collectAttachments({ task, metadata, runState }) {
  const taskMessage = task?.message_snapshot ?? task?.message ?? null;
  const candidates = [
    ...toArray(runState?.output?.attachments),
    ...toArray(task?.metadata?.delivery_attachments),
    ...toArray(metadata?.attachments),
    ...toArray(taskMessage?.attachments),
  ];

  return uniqueBy(
    candidates.map(normalizeAttachment).filter(Boolean),
    attachmentKey,
  );
}

function formatCitationLine(citation) {
  const sourceId = citation.doc_id ?? citation.entry_id ?? citation.source_type ?? 'source';
  const score = citation.score !== null && citation.score !== undefined ? ` (${citation.score})` : '';
  return `- ${citation.title} [${sourceId}]${score}`;
}

function formatAttachmentLine(attachment) {
  const label = attachment.url ? `${attachment.name} <${attachment.url}>` : attachment.name;
  return `- ${label}`;
}

export function createOutboundMessageEnvelope({
  responseText = '',
  task = null,
  persona = null,
  plan = null,
  traceId = task?.trace_id ?? task?.task_id ?? null,
  sourcePlatform = task?.message?.source_platform ?? null,
  metadata = {},
  runState = task?.run_state ?? null,
} = {}) {
  const message = task?.message_snapshot ?? task?.message ?? null;
  const body = normalizeText(responseText ?? runState?.output?.final_text ?? '');
  const retrievalOutput = extractRetrievalOutput(runState);
  const citations = collectCitations(retrievalOutput);
  const attachments = collectAttachments({ task, metadata, runState });
  const media = attachments.filter((item) => item.type === 'image' || item.type === 'video');
  const files = attachments.filter((item) => item.type !== 'image' && item.type !== 'video');
  const userContext = pickMessageText(message);

  return {
    title: `${persona?.name ?? 'Agent'} response`,
    summary: plan?.summary ?? plan?.goal ?? summarizeText(body, 160),
    body,
    user_context: summarizeText(userContext, 160),
    citations,
    attachments: files,
    media,
    route_mode: retrievalOutput?.route?.mode ?? null,
    retrieval_quality: retrievalOutput?.quality ?? null,
    trace: {
      trace_id: traceId,
      task_id: task?.task_id ?? runState?.task_id ?? null,
      source_platform: sourcePlatform,
      channel_id: message?.channel_id ?? null,
      conversation_id: message?.conversation_id ?? null,
    },
    plan: {
      plan_id: plan?.plan_id ?? null,
      goal: plan?.goal ?? null,
      summary: plan?.summary ?? null,
    },
    metadata: clone(metadata ?? {}),
  };
}

export function buildWebDeliveryPayload(context = {}) {
  const envelope = createOutboundMessageEnvelope(context);
  const sections = [
    {
      title: 'Response',
      text: envelope.body,
    },
    {
      title: 'Trace',
      text: [
        envelope.trace.trace_id,
        envelope.trace.source_platform,
        envelope.trace.task_id,
      ].filter(Boolean).join(' · '),
    },
  ];

  if (envelope.citations.length > 0) {
    sections.push({
      title: 'Sources',
      text: envelope.citations.map(formatCitationLine).join('\n'),
    });
  }

  if (envelope.attachments.length > 0) {
    sections.push({
      title: 'Attachments',
      text: envelope.attachments.map(formatAttachmentLine).join('\n'),
    });
  }

  return {
    kind: 'web_delivery',
    template: 'rich_card',
    title: envelope.title,
    text: envelope.body,
    summary: envelope.summary,
    sections,
    citations: envelope.citations,
    attachments: envelope.attachments,
    media: envelope.media,
    route_mode: envelope.route_mode,
    retrieval_quality: envelope.retrieval_quality,
    trace: envelope.trace,
    plan: envelope.plan,
    metadata: envelope.metadata,
  };
}

export function buildSlackDeliveryPayload(context = {}) {
  const envelope = createOutboundMessageEnvelope(context);
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${envelope.title}*\n${envelope.body}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: [
            envelope.summary,
            envelope.route_mode,
            envelope.trace.trace_id,
          ].filter(Boolean).join(' · '),
        },
      ],
    },
  ];

  for (const item of envelope.media.slice(0, 3)) {
    if (!item.url) {
      continue;
    }
    blocks.push({
      type: 'image',
      image_url: item.url,
      alt_text: item.alt_text ?? item.name,
      title: {
        type: 'plain_text',
        text: item.name,
      },
    });
  }

  if (envelope.citations.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Sources*\n${envelope.citations.map(formatCitationLine).join('\n')}`,
      },
    });
  }

  if (envelope.attachments.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Attachments*\n${envelope.attachments.map((item) => item.url ? `- <${item.url}|${item.name}>` : `- ${item.name}`).join('\n')}`,
      },
    });
  }

  return {
    text: envelope.body,
    blocks,
    attachments: envelope.attachments,
    media: envelope.media,
    citations: envelope.citations,
    unfurl_links: false,
    unfurl_media: false,
    route_mode: envelope.route_mode,
    retrieval_quality: envelope.retrieval_quality,
    metadata: envelope.metadata,
  };
}

export function buildTelegramDeliveryPayload(context = {}) {
  const envelope = createOutboundMessageEnvelope(context);
  const textParts = [
    envelope.title,
    envelope.body,
    envelope.citations.length > 0 ? `Sources:\n${envelope.citations.map(formatCitationLine).join('\n')}` : null,
    envelope.attachments.length > 0 ? `Attachments:\n${envelope.attachments.map(formatAttachmentLine).join('\n')}` : null,
  ].filter(Boolean);

  const mediaGroup = envelope.media
    .filter((item) => item.url)
    .map((item, index) => ({
      type: item.type === 'video' ? 'video' : 'photo',
      media: item.url,
      caption: index === 0 ? envelope.summary : item.caption ?? item.name,
    }));

  const inlineKeyboard = envelope.citations
    .filter((item) => item.url)
    .slice(0, 3)
    .map((item) => [{ text: summarizeText(item.title, 28), url: item.url }]);

  return {
    text: textParts.join('\n\n'),
    media_group: mediaGroup,
    attachments: envelope.attachments,
    citations: envelope.citations,
    reply_markup: {
      inline_keyboard: inlineKeyboard,
    },
    route_mode: envelope.route_mode,
    retrieval_quality: envelope.retrieval_quality,
    metadata: {
      ...envelope.metadata,
      trace_id: envelope.trace.trace_id,
      source_platform: envelope.trace.source_platform,
      task_id: envelope.trace.task_id,
      plan_id: envelope.plan.plan_id,
    },
  };
}

export function buildGenericDeliveryPayload(context = {}) {
  const envelope = createOutboundMessageEnvelope(context);
  const textParts = [
    envelope.title,
    envelope.body,
    envelope.citations.length > 0 ? `Sources:\n${envelope.citations.map(formatCitationLine).join('\n')}` : null,
    envelope.attachments.length > 0 ? `Attachments:\n${envelope.attachments.map(formatAttachmentLine).join('\n')}` : null,
  ].filter(Boolean);

  return {
    text: textParts.join('\n\n'),
    summary: envelope.summary,
    citations: envelope.citations,
    attachments: envelope.attachments,
    media: envelope.media,
    route_mode: envelope.route_mode,
    retrieval_quality: envelope.retrieval_quality,
    metadata: {
      ...envelope.metadata,
      trace_id: envelope.trace.trace_id,
      source_platform: envelope.trace.source_platform,
      task_id: envelope.trace.task_id,
      persona_id: context.persona?.persona_id ?? null,
      plan_id: envelope.plan.plan_id,
    },
  };
}
