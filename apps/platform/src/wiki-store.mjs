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
    owner: 'provider_ops',
    required_context: ['provider_name', 'freshness_scope'],
    retrieval_hints: ['deepseek', 'pricing', 'version', 'provider status'],
    ttl_seconds: 604800,
    source_of_truth: 'provider_wiki',
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
    owner: 'platform_ops',
    required_context: ['workflow_scope'],
    retrieval_hints: ['delivery workflow', 'task status', 'audit'],
    ttl_seconds: 1209600,
    source_of_truth: 'operations_wiki',
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
    owner: 'persona_ops',
    required_context: ['persona_scope'],
    retrieval_hints: ['persona', 'role switching', 'runtime behavior'],
    ttl_seconds: 1209600,
    source_of_truth: 'persona_wiki',
  },
];

function clone(value) {
  return structuredClone(value);
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function buildSearchTerms(text) {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) {
    return [];
  }

  const terms = new Set();
  for (const token of normalized.split(/[\s,.;:!?/|()[\]{}"'`_-]+/).filter(Boolean)) {
    if (token.length >= 2) {
      terms.add(token);
    }
  }

  const cjkMatches = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const run of cjkMatches) {
    if (run.length <= 12) {
      terms.add(run);
    }
    const maxGram = Math.min(4, run.length);
    for (let size = 2; size <= maxGram; size += 1) {
      for (let index = 0; index <= run.length - size; index += 1) {
        terms.add(run.slice(index, index + size));
      }
    }
  }

  return Array.from(terms).slice(0, 64);
}

function termWeight(term) {
  if (/[\u4e00-\u9fff]/.test(term)) {
    if (term.length >= 4) {
      return 0.65;
    }
    if (term.length === 3) {
      return 0.5;
    }
    return 0.32;
  }
  if (term.length >= 8) {
    return 0.85;
  }
  if (term.length >= 4) {
    return 0.7;
  }
  return 0.45;
}

function summarizeText(text, limit = 120) {
  const normalized = normalizeText(text);
  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}

function uniqueValues(values = []) {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)));
}

function scoreEntry(query, entry) {
  const lowered = normalizeText(query).toLowerCase();
  const terms = buildSearchTerms(lowered);
  const fields = [
    { text: entry.title, weight: 1.25 },
    { text: entry.summary, weight: 0.9 },
    { text: (entry.facts ?? []).join(' '), weight: 0.72 },
    { text: (entry.tags ?? []).join(' '), weight: 1.15 },
    { text: (entry.retrieval_hints ?? []).join(' '), weight: 1.15 },
    { text: entry.source_of_truth, weight: 0.5 },
  ].map((field) => ({
    weight: field.weight,
    lowered: normalizeText(field.text).toLowerCase(),
  }));

  let score = 0;
  for (const term of terms) {
    const weight = termWeight(term);
    for (const field of fields) {
      if (field.lowered.includes(term)) {
        score += weight * field.weight;
        break;
      }
    }
  }

  if (
    lowered.includes('最新')
    || lowered.includes('当前')
    || lowered.includes('状态')
    || lowered.includes('进度')
    || lowered.includes('负责人')
    || lowered.includes('current')
    || lowered.includes('status')
    || lowered.includes('version')
  ) {
    const dynamicHints = [
      ...(entry.tags ?? []),
      ...(entry.retrieval_hints ?? []),
    ].join(' ').toLowerCase();
    if (/(status|version|owner|progress|当前|状态|版本|负责人|进度)/.test(dynamicHints)) {
      score += 0.95;
    }
  }

  return Number(score.toFixed(4));
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
    owner: input.owner ?? existing?.owner ?? 'wiki_curator',
    required_context: clone(input.required_context ?? existing?.required_context ?? []),
    retrieval_hints: clone(input.retrieval_hints ?? existing?.retrieval_hints ?? []),
    ttl_seconds: Number.isFinite(input.ttl_seconds) ? input.ttl_seconds : (existing?.ttl_seconds ?? 7 * 24 * 60 * 60),
    source_of_truth: input.source_of_truth ?? existing?.source_of_truth ?? (input.title ?? existing?.title ?? 'wiki_source'),
    created_at: existing?.created_at ?? input.created_at ?? now,
    updated_at: input.updated_at ?? now,
    expires_at: input.expires_at ?? existing?.expires_at ?? null,
    archived_at: input.archived_at ?? existing?.archived_at ?? null,
    deleted_at: input.deleted_at ?? existing?.deleted_at ?? null,
    deleted: input.deleted ?? existing?.deleted ?? false,
    metadata: clone(input.metadata ?? existing?.metadata ?? {}),
  };
}

function buildConflict(existing, proposedEntry, baseVersion) {
  const changedFields = [];
  const fields = ['title', 'summary', 'facts', 'tags'];

  for (const field of fields) {
    const currentValue = JSON.stringify(existing?.[field] ?? null);
    const proposedValue = JSON.stringify(proposedEntry?.[field] ?? null);
    if (currentValue !== proposedValue) {
      changedFields.push(field);
    }
  }

  return {
    type: 'version_mismatch',
    base_version: baseVersion,
    current_version: existing?.version ?? null,
    changed_fields: changedFields,
    summary: summarizeText(
      `Entry changed from version ${baseVersion} to ${existing?.version ?? 'unknown'}; changed fields: ${changedFields.join(', ') || 'content'}.`,
    ),
  };
}

function normalizeProposal(input, existing = null) {
  const now = new Date().toISOString();
  const baseVersion = Number.isFinite(input.base_version)
    ? Number(input.base_version)
    : (existing?.version ?? null);
    const proposedEntry = {
      entry_id: input.entry_id ?? existing?.entry_id ?? `wiki_${randomUUID()}`,
      title: input.title ?? existing?.title ?? 'Untitled entry',
      summary: input.summary ?? existing?.summary ?? '',
      facts: clone(input.facts ?? existing?.facts ?? []),
      tags: clone(input.tags ?? existing?.tags ?? []),
      owner: input.owner ?? existing?.owner ?? 'wiki_curator',
      required_context: clone(input.required_context ?? existing?.required_context ?? []),
      retrieval_hints: clone(input.retrieval_hints ?? existing?.retrieval_hints ?? []),
      ttl_seconds: Number.isFinite(input.ttl_seconds) ? input.ttl_seconds : (existing?.ttl_seconds ?? 7 * 24 * 60 * 60),
      source_of_truth: input.source_of_truth ?? existing?.source_of_truth ?? (input.title ?? existing?.title ?? 'wiki_source'),
      source: input.source ?? existing?.source ?? 'manual',
      source_task_id: input.source_task_id ?? existing?.source_task_id ?? null,
      source_trace_id: input.source_trace_id ?? existing?.source_trace_id ?? null,
    metadata: clone(input.metadata ?? {}),
  };
  const conflict = existing && baseVersion !== null && baseVersion !== existing.version
    ? buildConflict(existing, proposedEntry, baseVersion)
    : null;

  return {
    proposal_id: input.proposal_id ?? `wikp_${randomUUID()}`,
    entry_id: proposedEntry.entry_id,
    base_version: baseVersion,
    current_version: existing?.version ?? null,
    status: conflict ? 'conflict' : 'pending_review',
    decision: conflict ? 'conflict' : 'pending_review',
    proposed_entry: proposedEntry,
    conflict,
    merge_strategy: null,
    reviewer_id: null,
    review_notes: null,
    source: input.source ?? proposedEntry.source ?? 'manual',
    source_task_id: input.source_task_id ?? proposedEntry.source_task_id ?? null,
    source_trace_id: input.source_trace_id ?? proposedEntry.source_trace_id ?? null,
    metadata: clone(input.metadata ?? {}),
    created_at: now,
    updated_at: now,
    reviewed_at: null,
  };
}

function mergeProposalEntry({ current = null, proposed, mergeStrategy = 'replace' }) {
  if (!current || mergeStrategy === 'replace') {
    return {
      entry_id: proposed.entry_id,
      title: proposed.title,
      summary: proposed.summary,
      facts: clone(proposed.facts ?? []),
      tags: clone(proposed.tags ?? []),
      owner: proposed.owner ?? current?.owner ?? 'wiki_curator',
      required_context: clone(proposed.required_context ?? current?.required_context ?? []),
      retrieval_hints: clone(proposed.retrieval_hints ?? current?.retrieval_hints ?? []),
      ttl_seconds: proposed.ttl_seconds ?? current?.ttl_seconds ?? 7 * 24 * 60 * 60,
      source_of_truth: proposed.source_of_truth ?? current?.source_of_truth ?? proposed.title,
      source: proposed.source ?? current?.source ?? 'manual',
      source_task_id: proposed.source_task_id ?? current?.source_task_id ?? null,
      source_trace_id: proposed.source_trace_id ?? current?.source_trace_id ?? null,
      metadata: {
        ...clone(current?.metadata ?? {}),
        ...clone(proposed.metadata ?? {}),
      },
    };
  }

  if (mergeStrategy === 'combine') {
    return {
      entry_id: current.entry_id,
      title: proposed.title ?? current.title,
      summary: proposed.summary ?? current.summary,
      facts: uniqueValues([...(current.facts ?? []), ...(proposed.facts ?? [])]),
      tags: uniqueValues([...(current.tags ?? []), ...(proposed.tags ?? [])]),
      owner: proposed.owner ?? current.owner ?? 'wiki_curator',
      required_context: uniqueValues([...(current.required_context ?? []), ...(proposed.required_context ?? [])]),
      retrieval_hints: uniqueValues([...(current.retrieval_hints ?? []), ...(proposed.retrieval_hints ?? [])]),
      ttl_seconds: proposed.ttl_seconds ?? current.ttl_seconds ?? 7 * 24 * 60 * 60,
      source_of_truth: proposed.source_of_truth ?? current.source_of_truth ?? proposed.title,
      source: proposed.source ?? current.source ?? 'manual',
      source_task_id: proposed.source_task_id ?? current.source_task_id ?? null,
      source_trace_id: proposed.source_trace_id ?? current.source_trace_id ?? null,
      metadata: {
        ...clone(current.metadata ?? {}),
        ...clone(proposed.metadata ?? {}),
      },
    };
  }

  throw new Error(`Unsupported wiki merge strategy: ${mergeStrategy}`);
}

export function createWikiStore(options = DEFAULT_WIKI_ENTRIES) {
  const entries = Array.isArray(options) ? options : (options?.entries ?? DEFAULT_WIKI_ENTRIES);
  const durableProvider = Array.isArray(options) ? null : (options?.durableProvider ?? null);
  const cache = Array.isArray(options) ? null : (options?.cache ?? null);
  const records = new Map();
  const history = new Map();
  const proposals = new Map();

  function pushHistory(entryId, snapshot) {
    if (!history.has(entryId)) {
      history.set(entryId, []);
    }
    history.get(entryId).push(clone(snapshot));
    durableProvider?.appendHistory?.(entryId, snapshot);
  }

  function saveEntry(entry) {
    durableProvider?.saveEntry?.(entry);
    cache?.invalidate?.();
  }

  function saveProposal(proposal) {
    durableProvider?.saveProposal?.(proposal);
    cache?.invalidate?.();
  }

  function loadDurableState() {
    if (!durableProvider?.loadState) {
      return;
    }
    const state = durableProvider.loadState();
    for (const entry of state.entries ?? []) {
      records.set(entry.entry_id, clone(entry));
    }
    for (const [entryId, snapshots] of state.historyByEntry ?? []) {
      history.set(entryId, clone(snapshots));
    }
    for (const proposal of state.proposals ?? []) {
      proposals.set(proposal.proposal_id, clone(proposal));
    }
  }

  function upsert(input) {
    const existing = input.entry_id ? records.get(input.entry_id) : null;
    const entry = normalizeEntry(input, existing);
    if (existing) {
      pushHistory(existing.entry_id, existing);
    }
    records.set(entry.entry_id, entry);
    saveEntry(entry);
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
    saveEntry(entry);
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
    saveEntry(entry);
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
    saveEntry(entry);
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

  function getHistoryWithCurrent(entryId) {
    const snapshots = clone(history.get(entryId) ?? []);
    const current = records.get(entryId);
    if (current) {
      snapshots.push(clone(current));
    }
    return snapshots;
  }

  function createProposal(input) {
    const existing = input.entry_id ? records.get(input.entry_id) : null;
    const proposal = normalizeProposal(input, existing);
    proposals.set(proposal.proposal_id, proposal);
    saveProposal(proposal);
    return clone(proposal);
  }

  function getProposal(proposalId) {
    const proposal = proposals.get(proposalId);
    return proposal ? clone(proposal) : null;
  }

  function listProposals({ entryId = null, status = null, includeResolved = false } = {}) {
    const resolvedStatuses = new Set(['approved', 'rejected']);
    return Array.from(proposals.values())
      .filter((proposal) => {
        if (entryId && proposal.entry_id !== entryId) {
          return false;
        }
        if (status && proposal.status !== status) {
          return false;
        }
        if (!includeResolved && resolvedStatuses.has(proposal.status)) {
          return false;
        }
        return true;
      })
      .map((proposal) => clone(proposal));
  }

  function reviewProposal(proposalId, {
    decision,
    reviewer_id = null,
    notes = null,
    merge_strategy = null,
    metadata = {},
  } = {}) {
    const proposal = proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Unknown wiki proposal: ${proposalId}`);
    }
    if (proposal.reviewed_at) {
      throw new Error(`Wiki proposal already reviewed: ${proposalId}`);
    }

    const normalizedDecision = String(decision ?? '').toLowerCase();
    if (!['approved', 'rejected'].includes(normalizedDecision)) {
      throw new Error('Wiki proposal decision must be approved or rejected');
    }

    const now = new Date().toISOString();
    const reviewMetadata = {
      ...clone(proposal.metadata ?? {}),
      ...clone(metadata),
    };

    if (normalizedDecision === 'rejected') {
      const rejectedProposal = {
        ...proposal,
        status: 'rejected',
        decision: 'rejected',
        reviewer_id,
        review_notes: notes,
        reviewed_at: now,
        updated_at: now,
        metadata: reviewMetadata,
      };
      proposals.set(proposalId, rejectedProposal);
      saveProposal(rejectedProposal);
      return {
        proposal: clone(rejectedProposal),
        entry: null,
      };
    }

    const current = proposal.entry_id ? records.get(proposal.entry_id) : null;
    const resolvedMergeStrategy = merge_strategy ?? (proposal.conflict ? 'combine' : 'replace');
    const mergedEntry = mergeProposalEntry({
      current,
      proposed: proposal.proposed_entry,
      mergeStrategy: resolvedMergeStrategy,
    });
    const entry = upsert({
      entry_id: mergedEntry.entry_id,
      title: mergedEntry.title,
      summary: mergedEntry.summary,
      facts: mergedEntry.facts,
      tags: mergedEntry.tags,
      owner: mergedEntry.owner,
      required_context: mergedEntry.required_context,
      retrieval_hints: mergedEntry.retrieval_hints,
      ttl_seconds: mergedEntry.ttl_seconds,
      source_of_truth: mergedEntry.source_of_truth,
      status: 'active',
      deleted: false,
      deleted_at: null,
      archived_at: null,
      expires_at: null,
      source: proposal.source ?? mergedEntry.source ?? current?.source ?? 'manual',
      source_task_id: proposal.source_task_id ?? mergedEntry.source_task_id ?? current?.source_task_id ?? null,
      source_trace_id: proposal.source_trace_id ?? mergedEntry.source_trace_id ?? current?.source_trace_id ?? null,
      metadata: {
        ...clone(mergedEntry.metadata ?? {}),
        ...reviewMetadata,
        wiki_proposal_id: proposal.proposal_id,
        wiki_review_status: 'approved',
        wiki_merge_strategy: resolvedMergeStrategy,
        wiki_reviewer_id: reviewer_id,
        wiki_review_notes: notes,
      },
    });

    const approvedProposal = {
      ...proposal,
      status: 'approved',
      decision: 'approved',
      current_version: entry.version,
      merge_strategy: resolvedMergeStrategy,
      reviewer_id,
      review_notes: notes,
      reviewed_at: now,
      updated_at: now,
      metadata: reviewMetadata,
    };
    proposals.set(proposalId, approvedProposal);
    saveProposal(approvedProposal);

    return {
      proposal: clone(approvedProposal),
      entry: clone(entry),
    };
  }

  function rollback(entryId, {
    target_version,
    reviewer_id = null,
    reason = 'rollback',
    metadata = {},
  } = {}) {
    const current = records.get(entryId);
    if (!current) {
      throw new Error(`Unknown wiki entry: ${entryId}`);
    }
    if (!Number.isFinite(target_version)) {
      throw new Error('target_version is required');
    }

    const snapshot = getHistoryWithCurrent(entryId).find((item) => item.version === Number(target_version));
    if (!snapshot) {
      throw new Error(`Unknown wiki version ${target_version} for entry ${entryId}`);
    }

    return upsert({
      entry_id: current.entry_id,
      title: snapshot.title,
      summary: snapshot.summary,
      facts: snapshot.facts,
      tags: snapshot.tags,
      owner: snapshot.owner,
      required_context: snapshot.required_context,
      retrieval_hints: snapshot.retrieval_hints,
      ttl_seconds: snapshot.ttl_seconds,
      source_of_truth: snapshot.source_of_truth,
      status: 'active',
      deleted: false,
      deleted_at: null,
      archived_at: null,
      expires_at: null,
      source: 'rollback',
      source_task_id: current.source_task_id ?? snapshot.source_task_id ?? null,
      source_trace_id: current.source_trace_id ?? snapshot.source_trace_id ?? null,
      metadata: {
        ...clone(snapshot.metadata ?? {}),
        ...clone(metadata),
        rollback_reason: reason,
        rollback_target_version: Number(target_version),
        rollback_from_version: current.version,
        rollback_reviewer_id: reviewer_id,
      },
    });
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
      owner: entry.owner,
      required_context: clone(entry.required_context ?? []),
      retrieval_hints: clone(entry.retrieval_hints ?? []),
      ttl_seconds: entry.ttl_seconds,
      source_of_truth: entry.source_of_truth,
    }));
  }

  function ensureSeed() {
    for (const seed of entries) {
      if (records.has(seed.entry_id)) {
        continue;
      }
      upsert({
        ...seed,
        version: 1,
        status: 'active',
        source: 'seed',
      });
    }
  }

  loadDurableState();
  ensureSeed();

  return {
    upsert,
    expire,
    archive,
    softDelete,
    createProposal,
    getProposal,
    listProposals,
    reviewProposal,
    rollback,
    get,
    list,
    query,
    getHistory,
  };
}
