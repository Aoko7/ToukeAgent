import { randomUUID } from 'node:crypto';

function clone(value) {
  return structuredClone(value);
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function summarizeText(text, limit = 120) {
  const normalized = normalizeText(text);
  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}

function termScore(query, entry) {
  const lowered = normalizeText(query).toLowerCase();
  if (!lowered) return 0;

  const haystack = [
    entry.title,
    entry.summary,
    ...(entry.facts ?? []),
    ...(entry.tags ?? []),
    entry.content,
  ].join(' ').toLowerCase();

  const terms = lowered.split(/[\s,.;:!?/|]+/).filter(Boolean);
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 1;
    }
  }

  if (terms.length === 0) {
    return 0;
  }

  return score / terms.length;
}

function looksDurable(text) {
  const lowered = normalizeText(text).toLowerCase();
  if (!lowered) return false;

  const hints = [
    'remember',
    'prefer',
    'always',
    'default',
    'keep',
    'store',
    'persist',
    '记住',
    '偏好',
    '始终',
    '以后',
    '长期',
    '默认',
    '持续',
  ];

  return hints.some((hint) => lowered.includes(hint));
}

function createShortTermEntry(taskId, input) {
  return {
    memory_id: input.memory_id ?? `mem_${randomUUID()}`,
    memory_type: 'short_term',
    task_id: taskId,
    trace_id: input.trace_id ?? taskId,
    phase: input.phase ?? 'update',
    role: input.role ?? 'system',
    title: input.title ?? input.phase ?? 'memory update',
    summary: input.summary ?? null,
    content: input.content ?? null,
    facts: clone(input.facts ?? []),
    tags: clone(input.tags ?? []),
    source: input.source ?? 'task',
    source_task_id: input.source_task_id ?? taskId,
    source_trace_id: input.source_trace_id ?? taskId,
    importance: Number.isFinite(input.importance) ? input.importance : 0.5,
    created_at: input.created_at ?? new Date().toISOString(),
    updated_at: input.updated_at ?? new Date().toISOString(),
    expires_at: input.expires_at ?? null,
    metadata: clone(input.metadata ?? {}),
  };
}

function createLongTermEntry(input) {
  return {
    memory_id: input.memory_id ?? `mem_${randomUUID()}`,
    memory_type: 'long_term',
    task_id: input.task_id ?? null,
    trace_id: input.trace_id ?? null,
    title: input.title ?? 'durable memory',
    summary: input.summary ?? null,
    content: input.content ?? null,
    facts: clone(input.facts ?? []),
    tags: clone(input.tags ?? []),
    source: input.source ?? 'task_completion',
    source_task_id: input.source_task_id ?? input.task_id ?? null,
    source_trace_id: input.source_trace_id ?? input.trace_id ?? null,
    importance: Number.isFinite(input.importance) ? input.importance : 0.8,
    created_at: input.created_at ?? new Date().toISOString(),
    updated_at: input.updated_at ?? new Date().toISOString(),
    expires_at: input.expires_at ?? null,
    metadata: clone(input.metadata ?? {}),
  };
}

export function createMemoryStore() {
  const shortTermByTask = new Map();
  const longTerm = [];

  function appendShortTerm(taskId, input = {}) {
    const entry = createShortTermEntry(taskId, input);
    if (!shortTermByTask.has(taskId)) {
      shortTermByTask.set(taskId, []);
    }
    shortTermByTask.get(taskId).push(entry);
    return clone(entry);
  }

  function listShortTerm(taskId) {
    return clone(shortTermByTask.get(taskId) ?? []);
  }

  function appendLongTerm(input = {}) {
    const entry = createLongTermEntry(input);
    longTerm.push(entry);
    return clone(entry);
  }

  function listLongTerm() {
    return clone(longTerm);
  }

  function searchLongTerm(query, { limit = 4 } = {}) {
    const ranked = longTerm
      .map((entry) => ({
        ...entry,
        score: termScore(query, entry),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return right.importance - left.importance;
      })
      .slice(0, limit);

    return ranked.map((entry) => ({
      memory_id: entry.memory_id,
      memory_type: entry.memory_type,
      title: entry.title,
      summary: entry.summary,
      content: entry.content,
      facts: entry.facts,
      tags: entry.tags,
      source: entry.source,
      source_task_id: entry.source_task_id,
      source_trace_id: entry.source_trace_id,
      importance: entry.importance,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      expires_at: entry.expires_at,
      score: entry.score,
    }));
  }

  function buildContext({ taskId, query = '', limit = 4 } = {}) {
    const session = listShortTerm(taskId);
    const relevantLongTerm = query ? searchLongTerm(query, { limit }) : longTerm.filter((entry) => entry.source_task_id === taskId).slice(0, limit).map((entry) => ({
      memory_id: entry.memory_id,
      memory_type: entry.memory_type,
      title: entry.title,
      summary: entry.summary,
      content: entry.content,
      facts: entry.facts,
      tags: entry.tags,
      source: entry.source,
      source_task_id: entry.source_task_id,
      source_trace_id: entry.source_trace_id,
      importance: entry.importance,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      expires_at: entry.expires_at,
      score: 1,
    }));

    return {
      task_id: taskId,
      short_term: session.slice(-8),
      long_term: relevantLongTerm,
      counts: {
        short_term: session.length,
        long_term: relevantLongTerm.length,
      },
    };
  }

  function promoteDurableMemory({
    taskId,
    traceId,
    personaId,
    messageText,
    responseText = '',
    plan = null,
    source = 'task_completion',
  } = {}) {
    const durableText = `${normalizeText(messageText)} ${normalizeText(responseText)}`;
    if (!looksDurable(durableText)) {
      return null;
    }

    const title = summarizeText(messageText, 80) || 'Durable task memory';
    const facts = [summarizeText(messageText, 200)];
    if (responseText) {
      facts.push(summarizeText(responseText, 200));
    }

    return appendLongTerm({
      task_id: taskId,
      trace_id: traceId,
      title,
      summary: `Durable instruction captured from task ${taskId}`,
      facts,
      tags: ['durable', 'session', personaId ?? 'persona'],
      source,
      source_task_id: taskId,
      source_trace_id: traceId,
      importance: 0.9,
      metadata: {
        persona_id: personaId ?? null,
        plan_id: plan?.plan_id ?? null,
      },
    });
  }

  return {
    appendShortTerm,
    appendLongTerm,
    listShortTerm,
    listLongTerm,
    searchLongTerm,
    buildContext,
    promoteDurableMemory,
  };
}
