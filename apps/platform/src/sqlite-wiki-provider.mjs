import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

function clone(value) {
  return structuredClone(value);
}

function parseJson(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) {
    return clone(fallback);
  }
  return JSON.parse(value);
}

export function createSQLiteWikiProvider({
  filePath,
} = {}) {
  if (!filePath) {
    throw new Error('filePath is required for sqlite wiki provider');
  }

  const resolvedPath = resolve(String(filePath));
  const dbDir = dirname(resolvedPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const db = new DatabaseSync(resolvedPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS wiki_entries (
      entry_id TEXT PRIMARY KEY,
      status TEXT,
      title TEXT,
      summary TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wiki_history (
      entry_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      recorded_at TEXT,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (entry_id, version)
    );

    CREATE TABLE IF NOT EXISTS wiki_proposals (
      proposal_id TEXT PRIMARY KEY,
      entry_id TEXT,
      status TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL
    );
  `);

  const selectEntries = db.prepare(`
    SELECT payload_json
    FROM wiki_entries
    ORDER BY entry_id
  `);
  const selectHistory = db.prepare(`
    SELECT entry_id, payload_json
    FROM wiki_history
    ORDER BY entry_id, version
  `);
  const selectProposals = db.prepare(`
    SELECT payload_json
    FROM wiki_proposals
    ORDER BY proposal_id
  `);
  const upsertEntry = db.prepare(`
    INSERT INTO wiki_entries (entry_id, status, title, summary, updated_at, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(entry_id) DO UPDATE SET
      status = excluded.status,
      title = excluded.title,
      summary = excluded.summary,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `);
  const upsertHistory = db.prepare(`
    INSERT INTO wiki_history (entry_id, version, recorded_at, payload_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(entry_id, version) DO UPDATE SET
      recorded_at = excluded.recorded_at,
      payload_json = excluded.payload_json
  `);
  const upsertProposal = db.prepare(`
    INSERT INTO wiki_proposals (proposal_id, entry_id, status, updated_at, payload_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(proposal_id) DO UPDATE SET
      entry_id = excluded.entry_id,
      status = excluded.status,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `);
  const countEntries = db.prepare('SELECT COUNT(*) AS count FROM wiki_entries');
  const countProposals = db.prepare('SELECT COUNT(*) AS count FROM wiki_proposals');
  const maxUpdatedAt = db.prepare(`
    SELECT MAX(updated_at) AS updated_at
    FROM (
      SELECT updated_at FROM wiki_entries
      UNION ALL
      SELECT updated_at FROM wiki_proposals
    )
  `);

  function loadState() {
    const entries = selectEntries.all().map((row) => parseJson(row.payload_json, null)).filter(Boolean);
    const proposals = selectProposals.all().map((row) => parseJson(row.payload_json, null)).filter(Boolean);
    const historyByEntry = new Map();
    for (const row of selectHistory.all()) {
      const snapshot = parseJson(row.payload_json, null);
      if (!snapshot) {
        continue;
      }
      if (!historyByEntry.has(row.entry_id)) {
        historyByEntry.set(row.entry_id, []);
      }
      historyByEntry.get(row.entry_id).push(snapshot);
    }
    return {
      entries,
      proposals,
      historyByEntry,
    };
  }

  function saveEntry(entry) {
    upsertEntry.run(
      entry.entry_id,
      entry.status ?? 'active',
      entry.title ?? 'Untitled entry',
      entry.summary ?? '',
      entry.updated_at ?? null,
      JSON.stringify(entry),
    );
  }

  function appendHistory(entryId, snapshot) {
    upsertHistory.run(
      entryId,
      Number(snapshot?.version ?? 0),
      snapshot?.updated_at ?? snapshot?.created_at ?? null,
      JSON.stringify(snapshot),
    );
  }

  function saveProposal(proposal) {
    upsertProposal.run(
      proposal.proposal_id,
      proposal.entry_id ?? null,
      proposal.status ?? 'pending_review',
      proposal.updated_at ?? null,
      JSON.stringify(proposal),
    );
  }

  function snapshot() {
    return {
      file_path: resolvedPath,
      entry_count: Number(countEntries.get()?.count ?? 0),
      proposal_count: Number(countProposals.get()?.count ?? 0),
      updated_at: maxUpdatedAt.get()?.updated_at ?? null,
    };
  }

  return {
    loadState,
    saveEntry,
    appendHistory,
    saveProposal,
    snapshot,
  };
}
