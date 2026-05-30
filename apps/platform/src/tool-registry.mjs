import {
  createToolCallRequest,
  createToolCallResult,
  createToolDefinition,
} from '../../../packages/contracts/src/index.mjs';
import { callPythonCore } from './python-core-bridge.mjs';
import { createRestrictedExecutionEnvironment } from './restricted-exec.mjs';
import { buildToolPolicy, evaluateToolAttempt } from './tool-policy.mjs';
import { createWikiStore } from './wiki-store.mjs';
import { createHybridRetrievalRouter } from './retrieval-router.mjs';

function clone(value) {
  return structuredClone(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export function createToolRegistry({
  executionEnvironment = createRestrictedExecutionEnvironment(),
} = {}) {
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

function evaluateToolAccess({ definition, request }) {
  if (definition.enabled === false) {
    return {
      allowed: false,
      reason: 'tool_disabled',
      summary: `Tool ${definition.tool_name} is disabled in the active registry`,
      missing_permissions: [],
      missing_capabilities: [],
      policy: request.access_policy ?? null,
    };
  }

  const accessPolicy = request.access_policy;
  if (!accessPolicy) {
    return {
      allowed: true,
      reason: 'no_access_policy',
      summary: 'No tool access policy attached to the request',
      missing_permissions: [],
      missing_capabilities: [],
      policy: null,
    };
  }

  return callPythonCore(
    'evaluate_tool_access',
    { definition, request },
    { caller: 'apps/platform/src/tool-registry.mjs' },
  );
}

async function executeWithPolicy({ request, definition, handler }) {
  const accessDecision = evaluateToolAccess({ definition, request });
  if (!accessDecision.allowed) {
    return createToolCallResult({
      call_id: request.call_id,
      status: 'error',
      error_code: accessDecision.reason,
      summary: accessDecision.summary,
      result: {},
      evidence: [],
      metrics: {
        blocked: true,
        access_policy_applied: true,
        toolset_id: accessDecision.policy?.toolset_id ?? null,
        missing_permissions: accessDecision.missing_permissions ?? [],
        missing_capabilities: accessDecision.missing_capabilities ?? [],
        risk_level: definition.risk_level,
        idempotent: Boolean(definition.idempotent),
        attempt_count: 0,
        retry_count: 0,
      },
    });
  }

  const policy = buildToolPolicy(definition);
  let attempt = 0;
  let lastFailure = null;

    while (attempt < policy.max_attempts) {
      attempt += 1;
      try {
        const rawResult = await withTimeout(() => executionEnvironment.execute({
          definition,
          request,
          handler,
          context: {
            definition,
            attempt,
            retry_policy: policy,
            approved: Boolean(request.approval?.approved),
            approval_id: request.approval?.approval_id ?? null,
            access_policy: request.access_policy ?? null,
          },
        }), definition.timeout_ms);
        const result = createToolCallResult({
          call_id: request.call_id,
          ...rawResult,
        });
        const evaluation = evaluateToolAttempt({
          definition,
          policy,
          attempt,
          status: result.status,
          extra: {
            error_code: result.error_code ?? null,
            ...result.metrics,
            cache_hit: false,
            execution_environment: executionEnvironment.name,
          },
        });
        const finalResult = {
          ...result,
          metrics: evaluation.metrics,
        };

        if (!evaluation.should_retry) {
          return finalResult;
        }

        lastFailure = finalResult;
      } catch (error) {
        const failureStatus = error?.name === 'ToolTimeoutError' ? 'timeout' : 'error';
        const evaluation = evaluateToolAttempt({
          definition,
          policy,
          attempt,
          status: failureStatus,
          extra: {
            error_code: failureStatus === 'timeout' ? 'tool_timeout' : 'tool_execution_error',
            cache_hit: false,
            execution_environment: executionEnvironment.name,
          },
        });
        const failure = createToolCallResult({
          call_id: request.call_id,
          status: failureStatus,
          error_code: failureStatus === 'timeout' ? 'tool_timeout' : 'tool_execution_error',
          summary: error instanceof Error ? error.message : 'Tool execution failed',
          result: {},
          evidence: [],
          metrics: evaluation.metrics,
        });

        if (!evaluation.should_retry) {
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
  registry.register(
    {
      tool_name: 'approval_sensitive_tool',
      description: 'Simulate a high-risk action that requires human approval',
      permissions: ['write_state'],
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
          approved_action: { type: 'string' },
        },
      },
      risk_level: 'high',
      timeout_ms: 5_000,
      retry_policy: {
        max_attempts: 1,
        retry_on: ['timeout'],
      },
      idempotent: false,
      side_effect_scope: 'external_state',
      requires_approval: true,
      enabled: true,
      release_channel: 'stable',
      capabilities: ['operations'],
    },
    async (request) => {
      const query = String(request.arguments.query ?? '');

      return {
        status: 'success',
        summary: 'Human approval granted and risky action recorded',
        result: {
          approved_action: `approved:${query.slice(0, 60)}`,
        },
        evidence: [
          {
            approval_source: 'human_review',
            step_id: request.caller.step_id ?? null,
          },
        ],
        metrics: { latency_ms: 4 },
      };
    },
  );

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
        doc_type: 'architecture',
        project: 'platform',
        tags: ['architecture', 'planning', 'agent-platform'],
        authority: 'high',
        owner: 'docs_team',
        required_context: ['document_scope', 'persona_scope'],
        retrieval_hints: ['architecture overview', 'planning loop', 'platform design'],
        version: 'v1',
        source_of_truth: 'platform_docs',
      },
      {
        doc_id: 'doc_delivery_loop',
        title: 'Delivery loop',
        snippet: 'Plan, retrieve, execute, verify, and report progress.',
        score: normalizedQuery.includes('review') ? 0.91 : 0.84,
        source_type: 'rag',
        freshness: 'stable',
        doc_type: 'process',
        project: 'delivery',
        tags: ['delivery', 'workflow', 'verification'],
        authority: 'high',
        owner: 'delivery_ops',
        required_context: ['workflow_scope'],
        retrieval_hints: ['delivery loop', 'verification', 'execution workflow'],
        version: 'v1',
        source_of_truth: 'delivery_docs',
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
      enabled: true,
      release_channel: 'stable',
      capabilities: ['retrieval', 'docs_lookup'],
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
      enabled: true,
      release_channel: 'stable',
      capabilities: ['retrieval', 'wiki_lookup'],
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
      enabled: true,
      release_channel: 'stable',
      capabilities: ['retrieval'],
    },
    async (request) => {
      const query = String(request.arguments.query ?? '');
      const personaId = request.caller.persona_id ?? 'researcher';
      const result = retrievalRouter.retrieve({ query, personaId });

      return {
        status: 'success',
        summary: `Retrieved ${result.items.length} sources via ${result.route.mode} (score ${result.quality.retrieval_score})`,
        result,
        evidence: result.citations.map((citation) => ({
          ...citation,
          citation_score: citation.score,
        })),
        metrics: {
          latency_ms: 16,
          retrieval_score: result.quality.retrieval_score,
          citation_score: result.quality.citation_score,
        },
      };
    },
  );
}
