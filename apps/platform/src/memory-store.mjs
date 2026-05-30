import { randomUUID } from 'node:crypto';
import { callPythonCore } from './python-core-bridge.mjs';

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

function parseTimestamp(value) {
  const timestamp = Date.parse(String(value ?? ''));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function resolveProviderStrategy(providerStrategy = {}) {
  const source = providerStrategy && typeof providerStrategy === 'object' ? providerStrategy : {};
  const retrievalPolicy = source.retrieval_policy ?? source.retrievalPolicy ?? {};
  const writePolicy = source.write_policy ?? source.writePolicy ?? {};
  const compressionPolicy = source.compression_policy ?? source.compressionPolicy ?? {};
  return {
    provider: source.provider ?? 'local_builtin',
    provider_label: source.provider_label ?? source.providerLabel ?? 'Local builtin memory',
    requested_provider: source.requested_provider ?? source.requestedProvider ?? source.provider ?? 'local_builtin',
    requested_provider_label: source.requested_provider_label ?? source.requestedProviderLabel ?? source.provider_label ?? source.providerLabel ?? 'Local builtin memory',
    effective_provider: source.effective_provider ?? source.effectiveProvider ?? source.provider ?? 'local_builtin',
    effective_provider_label: source.effective_provider_label ?? source.effectiveProviderLabel ?? source.provider_label ?? source.providerLabel ?? 'Local builtin memory',
    workspace_isolated: source.workspace_isolated ?? source.workspaceIsolated ?? true,
    persona_isolated: source.persona_isolated ?? source.personaIsolated ?? true,
    fallback_chain: clone(source.fallback_chain ?? source.fallbackChain ?? [{ provider: 'local_builtin', reason: 'local_recovery' }]),
    fallback_applied: source.fallback_applied ?? source.fallbackApplied ?? false,
    fallback_reason: source.fallback_reason ?? source.fallbackReason ?? null,
    retrieval_policy: {
      default_top_k: Number.isFinite(retrievalPolicy.default_top_k) ? retrievalPolicy.default_top_k : 4,
      prefer_long_term: retrievalPolicy.prefer_long_term ?? true,
      stale_after_hours: Number.isFinite(retrievalPolicy.stale_after_hours) ? retrievalPolicy.stale_after_hours : 168,
    },
    write_policy: {
      allow_auto_promote: writePolicy.allow_auto_promote ?? true,
      durable_write_threshold: Number.isFinite(writePolicy.durable_write_threshold) ? writePolicy.durable_write_threshold : 0.85,
      require_verification: writePolicy.require_verification ?? true,
    },
    compression_policy: {
      allow_snapshot_reuse: compressionPolicy.allow_snapshot_reuse ?? true,
      require_must_keep: compressionPolicy.require_must_keep ?? true,
    },
    capabilities: clone(source.capabilities ?? source.effective_capabilities ?? source.effectiveCapabilities ?? {}),
    requested_capabilities: clone(source.requested_capabilities ?? source.requestedCapabilities ?? source.capabilities ?? {}),
    effective_capabilities: clone(source.effective_capabilities ?? source.effectiveCapabilities ?? source.capabilities ?? {}),
    providers: clone(source.providers ?? {}),
  };
}

function applyDefaultCapabilities(strategy) {
  const requestedProvider = strategy.requested_provider ?? strategy.provider ?? 'local_builtin';
  const effectiveProvider = strategy.effective_provider ?? strategy.provider ?? 'local_builtin';
  const defaultsFor = (providerId) => {
    if (providerId === 'mem0_compatible') {
      return {
        short_term: true,
        long_term: true,
        durable_persistence: true,
        semantic_recall: true,
        compression_reuse: true,
      };
    }
    return {
      short_term: true,
      long_term: true,
      durable_persistence: false,
      semantic_recall: false,
      compression_reuse: true,
    };
  };

  return {
    ...strategy,
    capabilities: {
      ...defaultsFor(effectiveProvider),
      ...(strategy.capabilities ?? {}),
    },
    requested_capabilities: {
      ...defaultsFor(requestedProvider),
      ...(strategy.requested_capabilities ?? {}),
    },
    effective_capabilities: {
      ...defaultsFor(effectiveProvider),
      ...(strategy.effective_capabilities ?? strategy.capabilities ?? {}),
    },
  };
}

function pickScopeValue(input, key) {
  if (input?.[key] !== undefined && input?.[key] !== null && String(input[key]).trim() !== '') {
    return input[key];
  }
  const metadataValue = input?.metadata?.[key];
  if (metadataValue !== undefined && metadataValue !== null && String(metadataValue).trim() !== '') {
    return metadataValue;
  }
  return null;
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
    workspace_id: pickScopeValue(input, 'workspace_id'),
    persona_id: pickScopeValue(input, 'persona_id'),
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
    workspace_id: pickScopeValue(input, 'workspace_id'),
    persona_id: pickScopeValue(input, 'persona_id'),
    created_at: input.created_at ?? new Date().toISOString(),
    updated_at: input.updated_at ?? new Date().toISOString(),
    expires_at: input.expires_at ?? null,
    metadata: clone(input.metadata ?? {}),
  };
}

export function createMemoryStore({ providerStrategy = null, durableProvider = null, shortTermArchive = null } = {}) {
  const strategy = applyDefaultCapabilities(resolveProviderStrategy(providerStrategy ?? {}));
  const shortTermByTask = new Map();
  const persistentLongTerm = durableProvider?.listLongTerm?.() ?? [];
  const longTerm = Array.isArray(persistentLongTerm) ? persistentLongTerm.map((entry) => clone(entry)) : [];

  function syncShortTermFromArchive(taskId) {
    if (!taskId || !shortTermArchive?.listShortTerm) {
      return;
    }
    const archived = shortTermArchive.listShortTerm(taskId);
    if (!Array.isArray(archived) || archived.length === 0) {
      return;
    }
    const existing = shortTermByTask.get(taskId) ?? [];
    const knownIds = new Set(existing.map((entry) => entry.memory_id));
    const merged = [...existing];
    for (const entry of archived) {
      if (entry?.memory_id && knownIds.has(entry.memory_id)) {
        continue;
      }
      merged.push(clone(entry));
      if (entry?.memory_id) {
        knownIds.add(entry.memory_id);
      }
    }
    shortTermByTask.set(taskId, merged);
  }

  function syncLongTermFromProvider() {
    if (!durableProvider?.listLongTerm) {
      return;
    }
    const latestLongTerm = durableProvider.listLongTerm();
    if (!Array.isArray(latestLongTerm)) {
      return;
    }
    longTerm.length = 0;
    for (const entry of latestLongTerm) {
      longTerm.push(clone(entry));
    }
  }

  function persistLongTermEntry(entry) {
    if (!durableProvider?.upsertLongTerm) {
      return;
    }

    durableProvider.upsertLongTerm(entry);
  }

  function inferTaskScope(taskId) {
    syncLongTermFromProvider();
    syncShortTermFromArchive(taskId);
    const session = shortTermByTask.get(taskId) ?? [];
    for (let index = session.length - 1; index >= 0; index -= 1) {
      const entry = session[index];
      const workspaceId = entry?.workspace_id ?? entry?.metadata?.workspace_id ?? null;
      const personaId = entry?.persona_id ?? entry?.metadata?.persona_id ?? null;
      if (workspaceId || personaId) {
        return { workspaceId, personaId };
      }
    }

    const durable = longTerm.find((entry) => entry.source_task_id === taskId || entry.task_id === taskId);
    if (durable) {
      return {
        workspaceId: durable.workspace_id ?? durable.metadata?.workspace_id ?? null,
        personaId: durable.persona_id ?? durable.metadata?.persona_id ?? null,
      };
    }

    return {
      workspaceId: null,
      personaId: null,
    };
  }

  function isExpired(entry, now = Date.now()) {
    const expiresAt = parseTimestamp(entry?.expires_at);
    if (!expiresAt) {
      return false;
    }
    return now >= expiresAt;
  }

  function isStale(entry, now = Date.now()) {
    if (isExpired(entry, now)) {
      return true;
    }
    const staleAfterHours = Number(strategy.retrieval_policy?.stale_after_hours ?? 0);
    if (!staleAfterHours || staleAfterHours <= 0) {
      return false;
    }
    const updatedAt = parseTimestamp(entry?.updated_at) ?? parseTimestamp(entry?.created_at);
    if (!updatedAt) {
      return false;
    }
    return now - updatedAt > staleAfterHours * 60 * 60 * 1000;
  }

  function applyScopeFilters(entries, {
    workspaceId = null,
    personaId = null,
    excludeStale = false,
    now = Date.now(),
  } = {}) {
    syncLongTermFromProvider();
    return entries
      .filter((entry) => {
        if (strategy.workspace_isolated && workspaceId) {
          const actual = entry.workspace_id ?? entry.metadata?.workspace_id ?? null;
          if (actual && actual !== workspaceId) {
            return false;
          }
        }
        if (strategy.persona_isolated && personaId) {
          const actual = entry.persona_id ?? entry.metadata?.persona_id ?? null;
          if (actual && actual !== personaId) {
            return false;
          }
        }
        return true;
      })
      .map((entry) => ({
        ...entry,
        stale: isStale(entry, now),
      }))
      .filter((entry) => (excludeStale ? !entry.stale : true));
  }

  function appendShortTerm(taskId, input = {}) {
    const entry = createShortTermEntry(taskId, input);
    syncShortTermFromArchive(taskId);
    if (!shortTermByTask.has(taskId)) {
      shortTermByTask.set(taskId, []);
    }
    shortTermByTask.get(taskId).push(entry);
    shortTermArchive?.appendShortTerm?.(entry);
    return clone(entry);
  }

  function listShortTerm(taskId) {
    syncShortTermFromArchive(taskId);
    return clone(shortTermByTask.get(taskId) ?? []);
  }

  function appendLongTerm(input = {}) {
    syncLongTermFromProvider();
    const entry = createLongTermEntry(input);
    const durableKey = entry.metadata?.durable_key ?? entry.metadata?.durableKey ?? null;
    const existingIndex = durableKey
      ? longTerm.findIndex((item) => (item.metadata?.durable_key ?? item.metadata?.durableKey ?? null) === durableKey)
      : -1;
    const merged = existingIndex >= 0
      ? {
        ...longTerm[existingIndex],
        ...entry,
        created_at: longTerm[existingIndex].created_at ?? entry.created_at,
        updated_at: entry.updated_at,
        facts: Array.from(new Set([...(longTerm[existingIndex].facts ?? []), ...(entry.facts ?? [])])),
        tags: Array.from(new Set([...(longTerm[existingIndex].tags ?? []), ...(entry.tags ?? [])])),
        metadata: {
          ...(longTerm[existingIndex].metadata ?? {}),
          ...(entry.metadata ?? {}),
        },
      }
      : entry;

    if (existingIndex >= 0) {
      longTerm[existingIndex] = merged;
    } else {
      longTerm.push(merged);
    }

    persistLongTermEntry(merged);
    return clone(merged);
  }

  function listLongTerm(options = {}) {
    return clone(applyScopeFilters(longTerm, options));
  }

  function searchLongTerm(query, {
    limit = 4,
    workspaceId = null,
    personaId = null,
    excludeStale = false,
    now = Date.now(),
  } = {}) {
    const scopedEntries = applyScopeFilters(longTerm, {
      workspaceId,
      personaId,
      excludeStale,
      now,
    });

    const ranked = callPythonCore('rank_memory_recall', {
      query,
      entries: scopedEntries,
      limit,
      strategy,
      now,
      runtime: {
        semantic_recall: strategy.effective_capabilities?.semantic_recall ?? strategy.capabilities?.semantic_recall ?? false,
      },
    }).items ?? [];

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
      workspace_id: entry.workspace_id ?? null,
      persona_id: entry.persona_id ?? null,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      expires_at: entry.expires_at,
      stale: entry.stale ?? false,
      score: entry.score,
      lexical_score: entry.lexical_score ?? null,
      semantic_score: entry.semantic_score ?? null,
      score_breakdown: clone(entry.score_breakdown ?? {}),
    }));
  }

  function buildContext({
    taskId,
    query = '',
    limit = strategy.retrieval_policy.default_top_k,
    workspaceId = null,
    personaId = null,
    excludeStale = false,
    now = null,
  } = {}) {
    const inferredScope = inferTaskScope(taskId);
    const resolvedWorkspaceId = workspaceId ?? inferredScope.workspaceId;
    const resolvedPersonaId = personaId ?? inferredScope.personaId;
    const session = listShortTerm(taskId);
    const inferredNow = Number.isFinite(now) ? now : Date.now();
    const relevantLongTerm = query
      ? searchLongTerm(query, {
        limit,
        workspaceId: resolvedWorkspaceId,
        personaId: resolvedPersonaId,
        excludeStale,
        now: inferredNow,
      })
      : applyScopeFilters(longTerm, {
        workspaceId: resolvedWorkspaceId,
        personaId: resolvedPersonaId,
        excludeStale,
        now: inferredNow,
      })
        .filter((entry) => entry.source_task_id === taskId)
        .slice(0, limit)
        .map((entry) => ({
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
          workspace_id: entry.workspace_id ?? null,
          persona_id: entry.persona_id ?? null,
          created_at: entry.created_at,
          updated_at: entry.updated_at,
          expires_at: entry.expires_at,
          stale: entry.stale ?? false,
          score: 1,
        }));

    return {
      provider: strategy.effective_provider,
      provider_label: strategy.effective_provider_label,
      requested_provider: strategy.requested_provider,
      requested_provider_label: strategy.requested_provider_label,
      effective_provider: strategy.effective_provider,
      effective_provider_label: strategy.effective_provider_label,
      fallback_applied: strategy.fallback_applied,
      fallback_reason: strategy.fallback_reason,
      task_id: taskId,
      workspace_id: resolvedWorkspaceId ?? null,
      persona_id: resolvedPersonaId ?? null,
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
    workspaceId,
    messageText,
    responseText = '',
    plan = null,
    source = 'task_completion',
  } = {}) {
    if (!strategy.write_policy.allow_auto_promote) {
      return null;
    }

    const decision = callPythonCore('judge_durable_memory_write', {
      strategy,
      task_id: taskId,
      trace_id: traceId,
      persona_id: personaId,
      workspace_id: workspaceId,
      message_text: messageText,
      response_text: responseText,
      source,
      plan_id: plan?.plan_id ?? null,
    });

    if (!decision?.should_promote || !decision?.normalized_entry) {
      return null;
    }

    return appendLongTerm(decision.normalized_entry);
  }

  function describeStrategy() {
    return clone({
      ...strategy,
      provider: strategy.effective_provider,
      provider_label: strategy.effective_provider_label,
      runtime_persistence: durableProvider?.snapshot ? 'file_json' : 'process_memory',
      durable_store: durableProvider?.snapshot ? durableProvider.snapshot() : null,
      short_term_persistence: shortTermArchive ? 'markdown_archive' : 'process_memory',
      short_term_archive: shortTermArchive?.snapshot ? {
        root_dir: shortTermArchive.snapshot('task').root_dir,
      } : null,
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
    describeStrategy,
    durableProviderSnapshot: durableProvider?.snapshot ? () => clone(durableProvider.snapshot()) : () => null,
    shortTermArchiveSnapshot: shortTermArchive?.snapshot ? (taskId) => clone(shortTermArchive.snapshot(taskId)) : () => null,
  };
}
