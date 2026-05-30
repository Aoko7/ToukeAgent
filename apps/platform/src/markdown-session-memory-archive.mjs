import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function clone(value) {
  return structuredClone(value);
}

function sanitizeStem(value) {
  return String(value ?? 'task')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'task';
}

function taskFilePath(rootDir, taskId) {
  return join(rootDir, `${sanitizeStem(taskId)}.md`);
}

function ensureHeader(filePath, taskId) {
  if (existsSync(filePath)) {
    return;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `# Session Memory ${taskId}\n\n> Short-term task memory archive.\n\n`,
    'utf8',
  );
}

function parseEntries(text) {
  const matches = text.matchAll(/```json session-memory\n([\s\S]*?)\n```\n?/g);
  const entries = [];
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && typeof parsed === 'object') {
        entries.push(parsed);
      }
    } catch {
    }
  }
  return entries;
}

export function createMarkdownSessionMemoryArchive({
  rootDir,
} = {}) {
  if (!rootDir) {
    throw new Error('rootDir is required for markdown session memory archive');
  }

  const resolvedRootDir = resolve(String(rootDir));
  mkdirSync(resolvedRootDir, { recursive: true });

  function appendShortTerm(entry = {}) {
    const taskId = entry.task_id ?? entry.trace_id ?? 'task';
    const filePath = taskFilePath(resolvedRootDir, taskId);
    ensureHeader(filePath, taskId);
    appendFileSync(
      filePath,
      [
        `## ${entry.title ?? entry.phase ?? 'memory update'}`,
        '',
        `- memory_id: ${entry.memory_id ?? ''}`,
        `- created_at: ${entry.created_at ?? ''}`,
        `- updated_at: ${entry.updated_at ?? ''}`,
        `- phase: ${entry.phase ?? ''}`,
        `- role: ${entry.role ?? ''}`,
        `- workspace_id: ${entry.workspace_id ?? ''}`,
        `- persona_id: ${entry.persona_id ?? ''}`,
        '',
        '```json session-memory',
        JSON.stringify(entry, null, 2),
        '```',
        '',
      ].join('\n'),
      'utf8',
    );
  }

  function listShortTerm(taskId) {
    const filePath = taskFilePath(resolvedRootDir, taskId);
    if (!existsSync(filePath)) {
      return [];
    }
    return parseEntries(readFileSync(filePath, 'utf8')).map((entry) => clone(entry));
  }

  function snapshot(taskId) {
    const items = listShortTerm(taskId);
    return {
      root_dir: resolvedRootDir,
      file_path: taskFilePath(resolvedRootDir, taskId),
      entry_count: items.length,
      last_memory_id: items.at(-1)?.memory_id ?? null,
      updated_at: items.at(-1)?.updated_at ?? items.at(-1)?.created_at ?? null,
    };
  }

  return {
    appendShortTerm,
    listShortTerm,
    snapshot,
  };
}
