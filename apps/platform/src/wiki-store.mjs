import { randomUUID } from 'node:crypto';

const DEFAULT_WIKI_ENTRIES = [
  {
    entry_id: 'wiki_deepseek_provider',
    title: 'DeepSeek provider profile',
    summary: 'Operational notes for the DeepSeek provider, especially for pricing, versions, and fast-changing service metadata.',
    facts: [
      'Treat pricing, model availability, and release metadata as dynamic facts.',
      'Prefer the wiki path when the request asks for versions, pricing, or current provider status.',
    ],
    tags: ['deepseek', 'provider', 'pricing', 'version', 'status'],
  },
  {
    entry_id: 'wiki_delivery_workflow',
    title: 'Delivery workflow status model',
    summary: 'The platform tracks request acceptance, planning, running, auditing, and delivery as distinct operational states.',
    facts: [
      'Task state snapshots expose the latest execution view.',
      'Audit traces preserve the end-to-end evidence chain.',
    ],
    tags: ['workflow', 'status', 'task', 'audit', 'operations'],
  },
  {
    entry_id: 'wiki_persona_operations',
    title: 'Persona operations guide',
    summary: 'Personas remain runtime-configurable and can be switched without changing audit or permission rules.',
    facts: [
      'Use role switching for assistant, reviewer, or operator modes.',
      'Persona changes alter behavior strategy, not compliance boundaries.',
    ],
    tags: ['persona', 'role', 'operations', 'runtime'],
  },
];

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

function scoreEntry(query, entry) {
  const lowered = normalizeText(query).toLowerCase();
  const haystack = [
    entry.title,
    entry.summary,
    ...(entry.facts ?? []),
    ...(entry.tags ?? []),
  ].join(' ').toLowerCase();

  const terms = lowered.split(/[\s,.;:!?/|]+/).filter(Boolean);
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 1;
    }
  }

  if (lowered.includes('最新') || lowered.includes('current') || lowered.includes('status') || lowered.includes('版本')) {
    score += entry.tags.includes('status') || entry.tags.includes('version') ? 1 : 0;
  }

  return score;
}

function normalizeEntry(input, existing = null) {
  const now = new Date().toISOString();
  return {
    entry_id: input.entry_id ?? existing?.entry_id ?? `wiki_${randomUUID()}`,
    title: input.title ?? existing?.title ?? 'Untitled entry',
    summary: input.summary ?? existing?.summary ?? '',
    facts: clone(input.facts ?? existing?.facts ?? []),
    tags: clone(input.tags ?? existing?.tags ?? []),
    status: input.status ?? existing?.status ?? 'active',
    version: Number.isFinite(input.version) ? input.version : (existing?.version ?? 0) + 1,
    source: input.source ?? existing?.source ?? 'manual',
    source_task_id: input.source_task_id ?? existing?.source_task_id ?? null,
    source_trace_id: input.source_trace_id ?? existing?.source_trace_id ?? null,
    created_at: existing?.created_at ?? input.created_at ?? now,
    updated_at: input.updated_at ?? now,
    expires_at: input.expires_at ?? existing?.expires_at ?? null,
    archived_at: input.archived_at ?? existing?.archived_at ?? null,
    deleted_at: input.deleted_at ?? existing?.deleted_at ?? null,
    deleted: input.deleted ?? existing?.deleted ?? false,
    metadata: clone(input.metadata ?? existing?.metadata ?? {}),
  };
}

export function createWikiStore(entries = DEFAULT_WIKI_ENTRIES) {
  const records = new Map();
  const history = new Map();

  function pushHistory(entryId, snapshot) {
    if (!history.has(entryId)) {
      history.set(entryId, []);
    }
    history.get(entryId).push(clone(snapshot));
  }

  function upsert(input) {
    const existing = input.entry_id ? records.get(input.entry_id) : null;
    const entry = normalizeEntry(input, existing);
    if (existing) {
      pushHistory(existing.entry_id, existing);
    }
    records.set(entry.entry_id, entry);
    return clone(entry);
  }

  function expire(entryId, { reason = 'expired', metadata = {} } = {}) {
    const existing = records.get(entryId);
    if (!existing) {
      throw new Error(`Unknown wiki entry: ${entryId}`);
    }

    pushHistory(existing.entry_id, existing);
    const now = new Date().toISOString();
    const entry = {
      ...existing,
      status: 'expired',
      deleted: false,
      expires_at: now,
      updated_at: now,
      metadata: {
        ...existing.metadata,
        ...clone(metadata),
        expire_reason: reason,
      },
    };

    records.set(entryId, entry);
    return clone(entry);
  }

  function archive(entryId, { reason = 'archived', metadata = {} } = {}) {
    const existing = records.get(entryId);
    if (!existing) {
      throw new Error(`Unknown wiki entry: ${entryId}`);
    }

    pushHistory(existing.entry_id, existing);
    const now = new Date().toISOString();
    const entry = {
      ...existing,
      status: 'archived',
      deleted: false,
      archived_at: now,
      updated_at: now,
      metadata: {
        ...existing.metadata,
        ...clone(metadata),
        archive_reason: reason,
      },
    };

    records.set(entryId, entry);
    return clone(entry);
  }

  function softDelete(entryId, { reason = 'deleted', metadata = {} } = {}) {
    const existing = records.get(entryId);
    if (!existing) {
      throw new Error(`Unknown wiki entry: ${entryId}`);
    }

    pushHistory(existing.entry_id, existing);
    const now = new Date().toISOString();
    const entry = {
      ...existing,
      status: 'deleted',
      deleted: true,
      deleted_at: now,
      updated_at: now,
      metadata: {
        ...existing.metadata,
        ...clone(metadata),
        delete_reason: reason,
      },
    };

    records.set(entryId, entry);
    return clone(entry);
  }

  function get(entryId) {
    const entry = records.get(entryId);
    return entry ? clone(entry) : null;
  }

  function list({ includeExpired = false, includeArchived = false, includeDeleted = false } = {}) {
    return Array.from(records.values())
      .filter((entry) => {
        if (entry.status === 'expired' && !includeExpired) {
          return false;
        }
        if (entry.status === 'archived' && !includeArchived) {
          return false;
        }
        if (entry.status === 'deleted' && !includeDeleted) {
          return false;
        }
        return true;
      })
      .map((entry) => clone(entry));
  }

  function getHistory(entryId) {
    return clone(history.get(entryId) ?? []);
  }

  function query({ query, limit = 2, includeExpired = false, includeArchived = false, includeDeleted = false }) {
    const ranked = list({ includeExpired, includeArchived, includeDeleted })
      .map((entry) => ({
        ...entry,
        score: scoreEntry(query, entry),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    return ranked.map((entry, index) => ({
      entry_id: entry.entry_id,
      title: entry.title,
      snippet: entry.summary,
      score: Math.max(0.75, 0.95 - index * 0.08),
      source_type: 'wiki',
      freshness: entry.status === 'expired' ? 'historical' : 'dynamic',
      status: entry.status,
      updated_at: entry.updated_at,
      version: entry.version,
    }));
  }

  function ensureSeed() {
    for (const seed of entries) {
      upsert({
        ...seed,
        version: 1,
        status: 'active',
        source: 'seed',
      });
    }
  }

  ensureSeed();

  return {
    upsert,
    expire,
    archive,
    softDelete,
    get,
    list,
    query,
    getHistory,
  };
}
