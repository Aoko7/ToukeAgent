import {
  createToolCallRequest,
  createToolCallResult,
  createToolDefinition,
} from '../../../packages/contracts/src/index.mjs';

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

export function registerDefaultTools(registry) {
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
      const query = String(request.arguments.query ?? '').toLowerCase();
      const personaId = request.caller.persona_id ?? 'researcher';
      const items = [
        {
          doc_id: 'doc_architecture_overview',
          title: 'Architecture overview',
          snippet: `Stable architecture guidance for ${personaId} persona`,
          score: query.includes('plan') ? 0.96 : 0.88,
        },
        {
          doc_id: 'doc_delivery_loop',
          title: 'Delivery loop',
          snippet: 'Plan, retrieve, execute, verify, and report progress.',
          score: query.includes('review') ? 0.91 : 0.84,
        },
      ];

      return {
        status: 'success',
        summary: `Retrieved ${items.length} stable documents`,
        result: { items },
        evidence: items.map((item) => ({ doc_id: item.doc_id, title: item.title })),
        metrics: { latency_ms: 12 },
      };
    },
  );
}
