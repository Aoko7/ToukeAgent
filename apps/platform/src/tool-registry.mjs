import {
  createToolCallRequest,
  createToolCallResult,
  createToolDefinition,
} from '../../../packages/contracts/src/index.mjs';
import { createWikiStore } from './wiki-store.mjs';
import { createHybridRetrievalRouter } from './retrieval-router.mjs';

function clone(value) {
  return structuredClone(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeRetryPolicy(definition) {
  const explicit = definition.retry_policy ?? {};
  const retryableByDefault = definition.idempotent && (definition.risk_level === 'low' || definition.risk_level === 'medium');

  return {
    max_attempts: Number.isFinite(explicit.max_attempts) ? Math.max(1, explicit.max_attempts) : (retryableByDefault ? 2 : 1),
    backoff_ms: Number.isFinite(explicit.backoff_ms) ? Math.max(0, explicit.backoff_ms) : 0,
    retry_on: Array.isArray(explicit.retry_on) && explicit.retry_on.length > 0 ? explicit.retry_on.slice() : ['error', 'timeout'],
  };
}

function shouldRetry({ status, attempt, policy }) {
  return attempt < policy.max_attempts && policy.retry_on.includes(status);
}

function createPolicyMetrics(definition, policy, attempt, extra = {}) {
  return {
    timeout_ms: definition.timeout_ms,
    attempt_count: attempt,
    retry_count: Math.max(0, attempt - 1),
    risk_level: definition.risk_level,
    idempotent: definition.idempotent,
    policy_max_attempts: policy.max_attempts,
    policy_retry_on: policy.retry_on.slice(),
    ...extra,
  };
}

async function withTimeout(operation, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`Tool execution exceeded timeout of ${timeoutMs}ms`);
      error.name = 'ToolTimeoutError';
      reject(error);
    }, timeoutMs);

    Promise.resolve()
      .then(operation)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export function createToolRegistry() {
  const tools = new Map();
  const idempotentCache = new Map();
  const inFlight = new Map();

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

  function buildIdempotencyKey(request) {
    return `${request.tool_name}:${request.call_id}:${JSON.stringify(request.arguments)}`;
  }

  async function executeWithPolicy({ request, definition, handler }) {
    const policy = normalizeRetryPolicy(definition);
    let attempt = 0;
    let lastFailure = null;

    while (attempt < policy.max_attempts) {
      attempt += 1;
      try {
        const rawResult = await withTimeout(() => handler(request, {
          definition,
          attempt,
          retry_policy: policy,
        }), definition.timeout_ms);
        const result = createToolCallResult({
          call_id: request.call_id,
          ...rawResult,
        });
        const finalResult = {
          ...result,
          metrics: {
            ...result.metrics,
            ...createPolicyMetrics(definition, policy, attempt, {
              cache_hit: false,
            }),
          },
        };

        if (!shouldRetry({ status: finalResult.status, attempt, policy })) {
          return finalResult;
        }

        lastFailure = finalResult;
      } catch (error) {
        const failureStatus = error?.name === 'ToolTimeoutError' ? 'timeout' : 'error';
        const failure = createToolCallResult({
          call_id: request.call_id,
          status: failureStatus,
          error_code: failureStatus === 'timeout' ? 'tool_timeout' : 'tool_execution_error',
          summary: error instanceof Error ? error.message : 'Tool execution failed',
          result: {},
          evidence: [],
          metrics: createPolicyMetrics(definition, policy, attempt, {
            cache_hit: false,
          }),
        });

        if (!shouldRetry({ status: failure.status, attempt, policy })) {
          return failure;
        }

        lastFailure = failure;
      }

      if (policy.backoff_ms > 0) {
        await sleep(policy.backoff_ms);
      }
    }

    return lastFailure ?? createToolCallResult({
      call_id: request.call_id,
      status: 'error',
      error_code: 'tool_execution_error',
      summary: 'Tool execution failed without a terminal result',
      result: {},
      evidence: [],
      metrics: {},
    });
  }

  async function invoke(requestInput) {
    const request = createToolCallRequest(requestInput);
    const { definition, handler } = resolve(request.tool_name);
    const idempotencyKey = buildIdempotencyKey(request);

    if (definition.idempotent && idempotentCache.has(idempotencyKey)) {
      const cached = clone(idempotentCache.get(idempotencyKey));
      cached.metrics = {
        ...cached.metrics,
        cache_hit: true,
      };
      return cached;
    }

    if (definition.idempotent && inFlight.has(idempotencyKey)) {
      const shared = await inFlight.get(idempotencyKey);
      return {
        ...clone(shared),
        metrics: {
          ...shared.metrics,
          cache_hit: true,
          shared_inflight: true,
        },
      };
    }

    const executionPromise = executeWithPolicy({ request, definition, handler });
    if (definition.idempotent) {
      inFlight.set(idempotencyKey, executionPromise);
    }

    try {
      const result = await executionPromise;
      if (definition.idempotent && result.status === 'success') {
        idempotentCache.set(idempotencyKey, clone(result));
      }
      return result;
    } finally {
      if (definition.idempotent) {
        inFlight.delete(idempotencyKey);
      }
    }
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
      timeout_ms: 5_000,
      retry_policy: {
        max_attempts: 2,
        retry_on: ['error', 'timeout'],
      },
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
      timeout_ms: 5_000,
      retry_policy: {
        max_attempts: 2,
        retry_on: ['error', 'timeout'],
      },
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
      timeout_ms: 5_000,
      retry_policy: {
        max_attempts: 2,
        retry_on: ['error', 'timeout'],
      },
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
