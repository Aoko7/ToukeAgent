import {
  createToolCallRequest,
  createToolCallResult,
  createToolDefinition,
} from '../../../packages/contracts/src/index.mjs';
import { createWikiStore } from './wiki-store.mjs';
import { createHybridRetrievalRouter } from './retrieval-router.mjs';

export function createToolRegistry() {
  const tools = new Map();

  function register(definitionInput, handler) {
    const definition = createToolDefinition(definitionInput);
    tools.set(definition.tool_name, { definition, handler });
    return definition;
  }

  function resolve(toolName) {
    const entry = tools.get(toolName);
    if (!entry) {
      throw new Error(`Unknown tool: ${toolName}`);
    }
    return entry;
  }

  async function invoke(requestInput) {
    const request = createToolCallRequest(requestInput);
    const { handler } = resolve(request.tool_name);
    const rawResult = await handler(request);
    return createToolCallResult({
      call_id: request.call_id,
      ...rawResult,
    });
  }

  function list() {
    return Array.from(tools.values()).map((entry) => entry.definition);
  }

  return { register, resolve, invoke, list };
}

export function registerDefaultTools(registry, { wikiStore = createWikiStore() } = {}) {
  const searchStableDocs = ({ query, personaId }) => {
    const normalizedQuery = String(query ?? '').toLowerCase();
    return [
      {
        doc_id: 'doc_architecture_overview',
        title: 'Architecture overview',
        snippet: `Stable architecture guidance for ${personaId} persona`,
        score: normalizedQuery.includes('plan') ? 0.96 : 0.88,
        source_type: 'rag',
        freshness: 'stable',
      },
      {
        doc_id: 'doc_delivery_loop',
        title: 'Delivery loop',
        snippet: 'Plan, retrieve, execute, verify, and report progress.',
        score: normalizedQuery.includes('review') ? 0.91 : 0.84,
        source_type: 'rag',
        freshness: 'stable',
      },
    ];
  };
  const queryWiki = ({ query }) => wikiStore.query({ query, limit: 2 });
  const retrievalRouter = createHybridRetrievalRouter({ searchStableDocs, queryWiki });

  registry.register(
    {
      tool_name: 'search_docs',
      description: 'Search a stable internal docs corpus',
      permissions: ['read_docs'],
      input_schema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
          persona_id: { type: 'string' },
        },
      },
      output_schema: {
        type: 'object',
        properties: {
          items: { type: 'array' },
        },
      },
      risk_level: 'low',
      idempotent: true,
      side_effect_scope: 'none',
      requires_approval: false,
    },
    async (request) => {
      const query = String(request.arguments.query ?? '');
      const personaId = request.caller.persona_id ?? 'researcher';
      const items = searchStableDocs({ query, personaId });

      return {
        status: 'success',
        summary: `Retrieved ${items.length} stable documents`,
        result: { items },
        evidence: items.map((item) => ({ doc_id: item.doc_id, title: item.title })),
        metrics: { latency_ms: 12 },
      };
    },
  );

  registry.register(
    {
      tool_name: 'query_wiki',
      description: 'Query the dynamic structured wiki path',
      permissions: ['read_wiki'],
      input_schema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
        },
      },
      output_schema: {
        type: 'object',
        properties: {
          items: { type: 'array' },
        },
      },
      risk_level: 'low',
      idempotent: true,
      side_effect_scope: 'none',
      requires_approval: false,
    },
    async (request) => {
      const query = String(request.arguments.query ?? '');
      const items = queryWiki({ query });

      return {
        status: 'success',
        summary: `Retrieved ${items.length} dynamic wiki entries`,
        result: { items },
        evidence: items.map((item) => ({ entry_id: item.entry_id, title: item.title })),
        metrics: { latency_ms: 8 },
      };
    },
  );

  registry.register(
    {
      tool_name: 'hybrid_retrieve',
      description: 'Route retrieval across stable RAG docs and dynamic wiki entries',
      permissions: ['read_docs', 'read_wiki'],
      input_schema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
          persona_id: { type: 'string' },
        },
      },
      output_schema: {
        type: 'object',
        properties: {
          route: { type: 'object' },
          items: { type: 'array' },
        },
      },
      risk_level: 'low',
      idempotent: true,
      side_effect_scope: 'none',
      requires_approval: false,
    },
    async (request) => {
      const query = String(request.arguments.query ?? '');
      const personaId = request.caller.persona_id ?? 'researcher';
      const result = retrievalRouter.retrieve({ query, personaId });

      return {
        status: 'success',
        summary: `Retrieved ${result.items.length} sources via ${result.route.mode}`,
        result,
        evidence: result.citations,
        metrics: { latency_ms: 16 },
      };
    },
  );
}
