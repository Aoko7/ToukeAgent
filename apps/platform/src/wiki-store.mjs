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
    updated_at: '2026-05-11T00:00:00.000Z',
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
    updated_at: '2026-05-11T00:00:00.000Z',
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
    updated_at: '2026-05-11T00:00:00.000Z',
  },
];

function scoreEntry(query, entry) {
  const lowered = query.toLowerCase();
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

export function createWikiStore(entries = DEFAULT_WIKI_ENTRIES) {
  return {
    list() {
      return entries.slice();
    },
    query({ query, limit = 2 }) {
      const ranked = entries
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
        freshness: 'dynamic',
        updated_at: entry.updated_at,
      }));
    },
  };
}
