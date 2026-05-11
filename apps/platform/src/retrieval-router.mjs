const DYNAMIC_HINTS = [
  'latest',
  'today',
  'current',
  'status',
  'version',
  'pricing',
  'price',
  'release',
  'owner',
  '最新',
  '当前',
  '今天',
  '状态',
  '版本',
  '价格',
  '进度',
  '负责人',
];

export function chooseRetrievalRoute(query) {
  const lowered = String(query ?? '').toLowerCase();
  const matchedHints = DYNAMIC_HINTS.filter((hint) => lowered.includes(hint));
  const mode = matchedHints.length > 0 ? 'wiki-first' : 'rag-first';

  return {
    mode,
    matched_hints: matchedHints,
    rationale: mode === 'wiki-first'
      ? 'dynamic structured facts appear likely, so prefer the wiki path first'
      : 'stable reference material appears likely, so prefer the RAG path first',
  };
}

export function createHybridRetrievalRouter({ searchStableDocs, queryWiki }) {
  return {
    retrieve({ query, personaId }) {
      const route = chooseRetrievalRoute(query);
      const stableItems = searchStableDocs({ query, personaId });
      const dynamicItems = queryWiki({ query });
      const ordered = route.mode === 'wiki-first'
        ? [...dynamicItems, ...stableItems]
        : [...stableItems, ...dynamicItems];
      const items = ordered.slice(0, 4);

      return {
        route,
        items,
        stable_items: stableItems,
        dynamic_items: dynamicItems,
        citations: items.map((item) => ({
          id: item.doc_id ?? item.entry_id,
          title: item.title,
          source_type: item.source_type,
        })),
      };
    },
  };
}
