import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseRetrievalRoute, createHybridRetrievalRouter } from '../apps/platform/src/retrieval-router.mjs';

test('hybrid retrieval router prefers wiki-first for dynamic structured queries', () => {
  const router = createHybridRetrievalRouter({
    searchStableDocs: () => [{ doc_id: 'doc_1', title: 'Stable doc', source_type: 'rag' }],
    queryWiki: () => [{ entry_id: 'wiki_1', title: 'Dynamic wiki', source_type: 'wiki' }],
  });

  const result = router.retrieve({
    query: '请告诉我最新版本和价格状态',
    personaId: 'researcher',
  });

  assert.equal(chooseRetrievalRoute('请告诉我最新版本和价格状态').mode, 'wiki-first');
  assert.equal(result.route.mode, 'wiki-first');
  assert.equal(result.items[0].source_type, 'wiki');
});

test('hybrid retrieval router prefers rag-first for stable architecture queries', () => {
  const router = createHybridRetrievalRouter({
    searchStableDocs: () => [{ doc_id: 'doc_1', title: 'Stable doc', source_type: 'rag' }],
    queryWiki: () => [{ entry_id: 'wiki_1', title: 'Dynamic wiki', source_type: 'wiki' }],
  });

  const result = router.retrieve({
    query: 'Explain the architecture and delivery loop',
    personaId: 'researcher',
  });

  assert.equal(chooseRetrievalRoute('Explain the architecture and delivery loop').mode, 'rag-first');
  assert.equal(result.route.mode, 'rag-first');
  assert.equal(result.items[0].source_type, 'rag');
});
