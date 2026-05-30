import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

function clone(value) {
  return structuredClone(value);
}

function createEmptyState() {
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    long_term: [],
  };
}

function stripTransientFields(entry = {}) {
  const {
    stale: _stale,
    score: _score,
    lexical_score: _lexicalScore,
    semantic_score: _semanticScore,
    importance_score: _importanceScore,
    freshness_score: _freshnessScore,
    stale_penalty: _stalePenalty,
    score_breakdown: _scoreBreakdown,
    ...rest
  } = entry ?? {};
  return clone(rest);
}

function durableKey(entry = {}) {
  return entry?.metadata?.durable_key
    ?? entry?.metadata?.durableKey
    ?? null;
}

function findEntryIndex(entries, entry = {}) {
  const key = durableKey(entry);
  if (key) {
    const byKey = entries.findIndex((item) => durableKey(item) === key);
    if (byKey >= 0) {
      return byKey;
    }
  }

  if (entry?.memory_id) {
    return entries.findIndex((item) => item.memory_id === entry.memory_id);
  }

  return -1;
}

export function createPersistentMemoryProvider({
  filePath,
  clock = () => new Date().toISOString(),
} = {}) {
  if (!filePath) {
    throw new Error('filePath is required for persistent memory provider');
  }

  const resolvedPath = resolve(String(filePath));
  const state = createEmptyState();

  function hydrate(nextState = null) {
    if (!nextState || typeof nextState !== 'object') {
      return;
    }
    state.version = Number.isFinite(nextState?.version) ? Number(nextState.version) : 1;
    state.updated_at = nextState?.updated_at ?? state.updated_at;
    state.long_term = Array.isArray(nextState?.long_term)
      ? nextState.long_term.map((entry) => stripTransientFields(entry))
      : [];
  }

  function readStateFromDisk() {
    if (!existsSync(resolvedPath)) {
      return null;
    }

    const raw = readFileSync(resolvedPath, 'utf8');
    if (!raw.trim()) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return {
      version: Number.isFinite(parsed?.version) ? Number(parsed.version) : 1,
      updated_at: parsed?.updated_at ?? state.updated_at,
      long_term: Array.isArray(parsed?.long_term)
        ? parsed.long_term.map((entry) => stripTransientFields(entry))
        : [],
    };
  }

  function persist() {
    mkdirSync(dirname(resolvedPath), { recursive: true });
    const tmpPath = `${resolvedPath}.${randomUUID()}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(state, null, 2));
    renameSync(tmpPath, resolvedPath);
  }

  function load() {
    hydrate(readStateFromDisk());
  }

  function refresh() {
    load();
  }

  function touch() {
    state.updated_at = clock();
    persist();
  }

  function listLongTerm() {
    refresh();
    return clone(state.long_term);
  }

  function upsertLongTerm(entry = {}) {
    refresh();
    const sanitized = stripTransientFields(entry);
    const index = findEntryIndex(state.long_term, sanitized);
    if (index >= 0) {
      state.long_term[index] = sanitized;
    } else {
      state.long_term.push(sanitized);
    }
    touch();
    return clone(sanitized);
  }

  function snapshot() {
    refresh();
    return {
      file_path: resolvedPath,
      entry_count: state.long_term.length,
      updated_at: state.updated_at,
    };
  }

  load();

  return {
    listLongTerm,
    upsertLongTerm,
    snapshot,
  };
}
