import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseRetrievalRoute, createHybridRetrievalRouter } from '../apps/platform/src/retrieval-router.mjs';

test('hybrid retrieval router prefers wiki-first for dynamic structured queries', () => {
  const router = createHybridRetrievalRouter({
    searchStableDocs: () => [{ doc_id: 'doc_1', chunk_id: 'chunk_1', title: 'Stable doc', source_type: 'rag', text: 'Stable excerpt' }],
    queryWiki: () => [{ entry_id: 'wiki_1', title: 'Dynamic wiki', source_type: 'wiki' }],
  });

  const result = router.retrieve({
    query: '请告诉我最新版本和价格状态',
    personaId: 'researcher',
  });

  assert.equal(chooseRetrievalRoute('请告诉我最新版本和价格状态').mode, 'wiki-first');
  assert.equal(result.route.mode, 'wiki-first');
  assert.equal(result.route.effective_mode, 'wiki-first');
  assert.equal(result.query_analysis.filter_hints.freshness, 'dynamic');
  assert.equal(result.query_analysis.query_mode, 'status_lookup');
  assert.ok(result.query_analysis.filter_hints.entity_tags.includes('pricing'));
  assert.ok(result.query_analysis.intent_tags.includes('pricing_lookup'));
  assert.ok(result.query_analysis.intent_tags.includes('version_lookup'));
  assert.equal(result.query_analysis.boundary.action, 'decompose');
  assert.equal(result.query_analysis.boundary.explicit_scope_required, false);
  assert.equal(result.query_analysis.decomposition.subqueries.length, 2);
  assert.ok(result.retrieval_plan.rag.channels.some((channel) => channel.name === 'semantic'));
  assert.ok(result.retrieval_plan.rag.channels.some((channel) => channel.name === 'bm25'));
  assert.equal(result.retrieval_plan.query_frontend.boundary_action, 'decompose');
  assert.equal(result.items[0].source_type, 'wiki');
  assert.ok(result.quality.retrieval_score >= 0.8);
  assert.ok(result.quality.contract_coverage_score >= 0.9);
  assert.equal(result.quality.recommended_action, 'accept');
  assert.ok(result.citations.every((citation) => typeof citation.score === 'number'));
  assert.ok(result.citations.every((citation) => citation.owner));
  assert.ok(result.citations.every((citation) => citation.knowledge_contract));
  assert.ok(Array.isArray(result.supporting_chunks));
});

test('hybrid retrieval router prefers rag-first for stable architecture queries', () => {
  const router = createHybridRetrievalRouter({
    searchStableDocs: () => [{ doc_id: 'doc_1', chunk_id: 'chunk_1', title: 'Stable doc', source_type: 'rag', text: 'Stable excerpt' }],
    queryWiki: () => [{ entry_id: 'wiki_1', title: 'Dynamic wiki', source_type: 'wiki' }],
  });

  const result = router.retrieve({
    query: 'Explain the architecture and delivery loop',
    personaId: 'researcher',
  });

  assert.equal(chooseRetrievalRoute('Explain the architecture and delivery loop').mode, 'rag-first');
  assert.equal(result.route.mode, 'rag-first');
  assert.equal(result.query_analysis.filter_hints.freshness, 'stable');
  assert.ok(result.query_analysis.filter_hints.doc_types.includes('architecture') || result.query_analysis.filter_hints.doc_types.includes('process'));
  assert.ok(result.query_analysis.intent_tags.includes('architecture_lookup'));
  assert.equal(result.items[0].source_type, 'rag');
  assert.equal(result.doc_aggregates[0].doc_id, 'doc_1');
  assert.ok(result.doc_aggregates[0].supporting_chunks.length >= 1);
  assert.ok(result.quality.citation_score >= 0.75);
  assert.equal(result.quality.primary_source_count, 1);
  assert.ok(result.raw_items[0].knowledge_contract.owner);
  assert.ok(result.raw_items[0].knowledge_contract.required_context.length >= 1);
});

test('hybrid retrieval router keeps strategy queries on rag-first even when they mention current state', () => {
  const result = chooseRetrievalRoute('请用中文简要介绍你当前的多Agent协调策略与RAG路线。');

  assert.equal(result.mode, 'rag-first');
  assert.ok(result.dynamic_score < result.stable_score);
  assert.ok(result.matched_hints.includes('当前'));
  assert.ok(result.matched_stable_hints.includes('策略'));
});

test('hybrid retrieval router falls back to rag evidence when wiki-first has no dynamic hits', () => {
  const router = createHybridRetrievalRouter({
    searchStableDocs: () => [{ doc_id: 'doc_1', chunk_id: 'chunk_1', title: 'Stable doc', source_type: 'rag', freshness: 'stable', text: 'Stable excerpt' }],
    queryWiki: () => [],
  });

  const result = router.retrieve({
    query: '请告诉我最新版本和价格状态',
    personaId: 'researcher',
  });

  assert.equal(result.route.mode, 'wiki-first');
  assert.equal(result.route.effective_mode, 'rag-first');
  assert.equal(result.route.fallback_applied, true);
  assert.equal(result.items[0].source_type, 'rag');
  assert.equal(result.quality.recommended_action, 'supplement_wiki');
});

test('hybrid retrieval query frontend asks for clarification when the subject is implicit', () => {
  const router = createHybridRetrievalRouter({
    searchStableDocs: () => [{ doc_id: 'doc_1', chunk_id: 'chunk_1', title: 'Stable doc', source_type: 'rag', freshness: 'stable', text: 'Stable excerpt' }],
    queryWiki: () => [{ entry_id: 'wiki_1', title: 'Dynamic wiki', source_type: 'wiki', summary: 'Current version page' }],
  });

  const result = router.retrieve({
    query: '这个现在是什么版本？',
    personaId: 'researcher',
  });

  assert.equal(result.route.mode, 'wiki-first');
  assert.equal(result.query_analysis.clarification.required, true);
  assert.equal(result.query_analysis.boundary.action, 'clarify');
  assert.ok(result.query_analysis.clarification.questions[0].includes('具体指'));
  assert.equal(result.retrieval_plan.query_frontend.clarification_required, true);
});

test('hybrid retrieval upgrades explicit scope query to hard filter even without explicit payload filters', () => {
  const router = createHybridRetrievalRouter({
    searchStableDocs: () => [
      {
        doc_id: 'doc_acl_2024',
        chunk_id: 'chunk_acl_2024',
        title: 'ACL 2024 release notes',
        source_type: 'rag',
        freshness: 'stable',
        text: 'ACL 2024 specific content',
        metadata: {
          conference_id: 'acl',
          publication_year: 2024,
        },
      },
      {
        doc_id: 'doc_emnlp_2024',
        chunk_id: 'chunk_emnlp_2024',
        title: 'EMNLP 2024 release notes',
        source_type: 'rag',
        freshness: 'stable',
        text: 'EMNLP 2024 specific content',
        metadata: {
          conference_id: 'emnlp',
          publication_year: 2024,
        },
      },
    ],
    queryWiki: () => [],
  });

  const result = router.retrieve({
    query: '只看 ACL 2024 的版本状态',
    personaId: 'researcher',
  });

  assert.equal(result.query_analysis.filter_hints.explicit_scope, true);
  assert.equal(result.query_analysis.boundary.explicit_scope_required, true);
  assert.equal(result.filter_policy.mode, 'hard_enforce');
  assert.deepEqual(result.effective_filters, {
    conference_id: ['acl'],
    publication_year: [2024],
  });
  assert.equal(result.raw_items.length, 1);
  assert.equal(result.raw_items[0].metadata.conference_id, 'acl');
});

test('hybrid retrieval reports hard_filter_empty when explicit scope has no matching candidates', () => {
  const router = createHybridRetrievalRouter({
    searchStableDocs: () => [
      {
        doc_id: 'doc_emnlp_2024',
        chunk_id: 'chunk_emnlp_2024',
        title: 'EMNLP 2024 release notes',
        source_type: 'rag',
        freshness: 'stable',
        text: 'EMNLP 2024 specific content',
        metadata: {
          conference_id: 'emnlp',
          publication_year: 2024,
        },
      },
    ],
    queryWiki: () => [],
  });

  const result = router.retrieve({
    query: '只看 ACL 2024 的版本状态',
    personaId: 'researcher',
  });

  assert.equal(result.retrieval_plan.filter_plan.mode, 'hard_enforce');
  assert.equal(result.filter_policy.hard_filter_empty, true);
  assert.equal(result.filter_policy.recovered_soft_prefer, true);
  assert.equal(result.filter_policy.fallback_reason, 'hard_filter_empty_soft_prefer_recovery');
  assert.equal(result.route.fallback_applied, false);
  assert.equal(result.route.fallback_reason, null);
  assert.equal(result.filter_policy.mode, 'soft_prefer');
  assert.equal(result.raw_items.length, 1);
  assert.equal(result.quality.recommended_action, 'supplement_wiki');
});

test('hybrid retrieval decomposes comparison queries into explicit subqueries with rag preference', () => {
  const router = createHybridRetrievalRouter({
    searchStableDocs: () => [
      { doc_id: 'doc_1', chunk_id: 'chunk_1', title: 'Fine-tuning', source_type: 'rag', text: 'Fine-tuning excerpt' },
      { doc_id: 'doc_2', chunk_id: 'chunk_2', title: 'Retrieval', source_type: 'rag', text: 'Retrieval excerpt' },
    ],
    queryWiki: () => [],
  });

  const result = router.retrieve({
    query: 'compare fine tuning and retrieval for injecting new factual knowledge into llms',
    personaId: 'researcher',
  });

  assert.equal(result.query_analysis.query_mode, 'compare');
  assert.equal(result.query_analysis.decomposition.enabled, true);
  assert.equal(result.query_analysis.decomposition.strategy, 'comparison_split');
  assert.equal(result.query_analysis.boundary.action, 'decompose');
  assert.equal(result.query_analysis.decomposition.subqueries.length, 2);
  assert.match(result.query_analysis.decomposition.subqueries[0].query_text, /fine tuning/i);
  assert.match(result.query_analysis.decomposition.subqueries[1].query_text, /retrieval/i);
  assert.equal(result.query_analysis.decomposition.subqueries[0].preferred_source, 'rag');
  assert.equal(result.query_analysis.decomposition.subqueries[1].preferred_source, 'rag');
  assert.equal(result.query_analysis.rewrites.variants.length, 2);
  assert.match(result.query_analysis.rewrites.variants[0].text, /injecting new factual knowledge into llms/i);
});

test('hybrid retrieval decomposes procedure queries into action-specific subqueries', () => {
  const router = createHybridRetrievalRouter({
    searchStableDocs: () => [{ doc_id: 'doc_1', chunk_id: 'chunk_1', title: 'MAGE', source_type: 'rag', text: 'Procedure excerpt' }],
    queryWiki: () => [],
  });

  const result = router.retrieve({
    query: 'how does MAGE detect machine-generated deepfake text in the wild and explain ppl cue',
    personaId: 'researcher',
  });

  assert.equal(result.query_analysis.query_mode, 'procedure');
  assert.equal(result.query_analysis.decomposition.enabled, true);
  assert.equal(result.query_analysis.decomposition.strategy, 'procedure_split');
  assert.equal(result.query_analysis.decomposition.subqueries.length, 2);
  assert.match(result.query_analysis.decomposition.subqueries[0].query_text, /^how does MAGE detect/i);
  assert.match(result.query_analysis.decomposition.subqueries[1].query_text, /^how does MAGE explain/i);
  assert.ok(result.query_analysis.decomposition.subqueries.every((item) => item.preferred_source === 'rag'));
  assert.equal(result.query_analysis.rewrites.variants.length, 2);
  assert.match(result.query_analysis.rewrites.variants[0].text, /workflow steps/i);
  assert.match(result.query_analysis.rewrites.variants[1].text, /workflow steps/i);
});
