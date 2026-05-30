import { callPythonCore } from './python-core-bridge.mjs';

export function chooseRetrievalRoute(query) {
  return callPythonCore(
    'choose_retrieval_route',
    { query },
    { caller: 'apps/platform/src/retrieval-router.mjs' },
  );
}

export function createHybridRetrievalRouter({ searchStableDocs, queryWiki }) {
  return {
    retrieve({ query, personaId }) {
      const stable_items = searchStableDocs({ query, personaId });
      const dynamic_items = queryWiki({ query });
      return callPythonCore(
        'retrieve',
        {
          query,
          persona_id: personaId,
          stable_items,
          dynamic_items,
        },
        { caller: 'apps/platform/src/retrieval-router.mjs' },
      );
    },
  };
}
