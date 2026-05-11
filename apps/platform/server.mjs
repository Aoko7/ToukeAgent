import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCanonicalMessage } from '../../packages/contracts/src/index.mjs';
import { createStreamStore } from './src/stream-store.mjs';
import { createPersonaRegistry } from './src/persona-registry.mjs';
import { createPlanner } from './src/planner.mjs';
import { runAgentTask } from './src/runtime.mjs';
import { createToolRegistry, registerDefaultTools } from './src/tool-registry.mjs';
import { createDeepSeekClient } from './src/deepseek-client.mjs';
import { createResponseComposer } from './src/response-composer.mjs';
import { createEventBus } from './src/event-bus.mjs';
import { createAsyncWorker } from './src/async-worker.mjs';
import { createAuditStore } from './src/audit-store.mjs';
import { createTaskStore } from './src/task-store.mjs';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const streamStore = createStreamStore();
const auditStore = createAuditStore();
const taskStore = createTaskStore();
const personaRegistry = createPersonaRegistry();
const planner = createPlanner();
const toolRegistry = createToolRegistry();
const deepseekClient = createDeepSeekClient();
const responseComposer = createResponseComposer({ client: deepseekClient });
const eventBus = createEventBus();
const worker = createAsyncWorker({ bus: eventBus });
registerDefaultTools(toolRegistry);

worker.register('tool.invoke', async ({ request }) => toolRegistry.invoke(request));
worker.register('response.compose', async ({ persona, message, plan, retrievalResult }) => ({
  content: await responseComposer.compose({ persona, message, plan, retrievalResult }),
  summary: 'Response composed',
}));

eventBus.subscribeAll((event) => {
  if (event.task_id) {
    auditStore.append(event.task_id, {
      trace_id: event.trace_id ?? event.task_id,
      kind: event.topic,
      payload: event,
    });
  }
});

function contentType(pathname) {
  switch (extname(pathname)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
  }
  return body ? JSON.parse(body) : {};
}

function sendJson(response, statusCode, payload, { headOnly = false } = {}) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(headOnly ? undefined : JSON.stringify(payload, null, 2));
}

export function formatSseEvent(event) {
  return `id: ${event.event_id}\n` +
    `event: ${event.event_type}\n` +
    `data: ${JSON.stringify(event)}\n\n`;
}

function sendSseEvent(response, event) {
  response.write(formatSseEvent(event));
}

function serveFile(response, filePath, { headOnly = false } = {}) {
  readFile(filePath)
    .then((body) => {
      response.writeHead(200, {
        'content-type': contentType(filePath),
        'cache-control': 'no-store',
      });
      response.end(headOnly ? undefined : body);
    })
    .catch(() => {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
    });
}

export async function processInboundMessage(input, store = streamStore) {
  const message = createCanonicalMessage(input);
  const persona = personaRegistry.get(message.persona_hint);
  const taskSummary = {
    message_id: message.message_id,
    source_platform: message.source_platform,
    workspace_id: message.workspace_id,
    channel_id: message.channel_id,
    conversation_id: message.conversation_id,
    persona_hint: message.persona_hint,
    content_preview: message.content.find((part) => part.type === 'text')?.text ?? '',
  };
  auditStore.append(message.trace_id, {
    trace_id: message.trace_id,
    kind: 'message.received',
    payload: {
      message_id: message.message_id,
      source_platform: message.source_platform,
      workspace_id: message.workspace_id,
      channel_id: message.channel_id,
      conversation_id: message.conversation_id,
    },
  });
  taskStore.upsert(message.trace_id, {
    trace_id: message.trace_id,
    status: 'received',
    phase: 'received',
    persona_id: persona.persona_id,
    message: taskSummary,
    metadata: {
      source_platform: message.source_platform,
      workspace_id: message.workspace_id,
      channel_id: message.channel_id,
      conversation_id: message.conversation_id,
    },
    checkpoint: {
      kind: 'message.received',
      summary: 'Inbound message accepted',
    },
  });
  auditStore.append(message.trace_id, {
    trace_id: message.trace_id,
    kind: 'message.normalized',
    payload: {
      persona_hint: message.persona_hint,
      content_types: message.content.map((part) => part.type),
    },
  });
  taskStore.upsert(message.trace_id, {
    phase: 'normalized',
    checkpoint: {
      kind: 'message.normalized',
      summary: 'Canonical message normalized',
    },
  });
  const plan = planner.createPlan({ message, persona });
  auditStore.append(message.trace_id, {
    trace_id: message.trace_id,
    kind: 'plan.created',
    payload: {
      plan_id: plan.plan_id,
      persona_id: persona.persona_id,
      step_count: plan.steps.length,
      step_titles: plan.steps.map((step) => step.title),
    },
  });
  taskStore.upsert(message.trace_id, {
    status: 'planning',
    phase: 'planning',
    plan_id: plan.plan_id,
    total_steps: plan.steps.length,
    plan: {
      plan_id: plan.plan_id,
      goal: plan.goal,
      summary: plan.summary,
      step_count: plan.steps.length,
      steps: plan.steps,
    },
    checkpoint: {
      kind: 'plan.created',
      summary: 'Plan created',
    },
  });
  const { runState, events } = await runAgentTask({
    message,
    persona,
    plan,
    toolRegistry,
    store,
    responseComposer,
    worker,
    eventBus,
    onTaskUpdate: ({ phase, summary, runState: snapshot, metadata }) => {
      taskStore.upsert(message.trace_id, {
        status: snapshot?.status ?? 'running',
        phase,
        plan_id: plan.plan_id,
        persona_id: persona.persona_id,
        current_step_id: snapshot?.current_step_id ?? null,
        completed_steps: snapshot?.completed_steps ?? 0,
        total_steps: snapshot?.total_steps ?? plan.steps.length,
        step_results: snapshot?.step_results ?? [],
        output: snapshot?.output ?? null,
        run_state: snapshot ?? null,
        metadata: {
          ...(metadata ?? {}),
          source_platform: message.source_platform,
        },
        checkpoint: {
          kind: phase,
          summary,
          metadata: metadata ?? {},
        },
      });
    },
  });
  auditStore.append(message.trace_id, {
    trace_id: message.trace_id,
    kind: 'run.completed',
    payload: {
      status: runState.status,
      completed_steps: runState.completed_steps,
      output: runState.output,
    },
  });
  taskStore.upsert(message.trace_id, {
    status: runState.status,
    phase: 'completed',
    current_step_id: runState.current_step_id,
    completed_steps: runState.completed_steps,
    total_steps: runState.total_steps,
    step_results: runState.step_results,
    run_state: runState,
    output: runState.output,
    checkpoint: {
      kind: 'run.completed',
      summary: 'Task completed',
    },
  });

  return {
    message,
    persona,
    plan,
    run_state: runState,
    task_id: message.trace_id,
    stream_url: `/api/stream?task_id=${encodeURIComponent(message.trace_id)}`,
    audit_url: `/api/traces?task_id=${encodeURIComponent(message.trace_id)}`,
    task_url: `/api/tasks?task_id=${encodeURIComponent(message.trace_id)}`,
    events,
  };
}

export function getTraceEntries(taskId) {
  return auditStore.list(taskId);
}

export function getTaskSnapshot(taskId) {
  return taskStore.get(taskId);
}

export function createPlatformServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/health') {
      const workerSnapshot = worker.snapshot();
      sendJson(response, 200, {
        ok: true,
        service: 'toukeagent-platform',
        model_provider: deepseekClient.isConfigured ? 'deepseek' : 'local',
        model: deepseekClient.model,
        model_config_source: deepseekClient.configSource,
        model_config_path: deepseekClient.configPath,
        worker_active: workerSnapshot.active,
        worker_queued: workerSnapshot.queued,
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/traces') {
      const taskId = url.searchParams.get('task_id');
      if (!taskId) {
        sendJson(response, 400, { error: 'task_id is required' });
        return;
      }

      sendJson(response, 200, {
        task_id: taskId,
        entries: auditStore.list(taskId),
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/tasks') {
      const taskId = url.searchParams.get('task_id');
      if (!taskId) {
        sendJson(response, 400, { error: 'task_id is required' });
        return;
      }

      sendJson(response, 200, {
        task_id: taskId,
        task: taskStore.get(taskId),
      }, { headOnly: request.method === 'HEAD' });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/stream') {
      const taskId = url.searchParams.get('task_id');
      if (!taskId) {
        sendJson(response, 400, { error: 'task_id is required' });
        return;
      }

      const lastEventId = Number(url.searchParams.get('last_seq') ?? request.headers['last-event-id'] ?? 0);
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });

      const replay = streamStore.replay(taskId, Number.isFinite(lastEventId) ? lastEventId : 0);
      for (const event of replay) {
        sendSseEvent(response, event);
      }

      response.write('event: heartbeat\n');
      response.write(`data: ${JSON.stringify({ ok: true })}\n\n`);

      const unsubscribe = streamStore.subscribe(taskId, (event) => {
        sendSseEvent(response, event);
      });

      const heartbeat = setInterval(() => {
        response.write('event: heartbeat\n');
        response.write(`data: ${JSON.stringify({ ok: true, timestamp: new Date().toISOString() })}\n\n`);
      }, 15_000);

      request.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });

      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/messages') {
      try {
        const input = await readJsonBody(request);
        sendJson(response, 200, await processInboundMessage(input, streamStore));
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad Request' });
      }
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/app.mjs') {
      serveFile(response, join(PUBLIC_DIR, 'app.mjs'), { headOnly: request.method === 'HEAD' });
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && (url.pathname === '/' || url.pathname === '/index.html')) {
      serveFile(response, join(PUBLIC_DIR, 'index.html'), { headOnly: request.method === 'HEAD' });
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
  });

  return { server, streamStore };
}

export async function startPlatformServer({ port = 3000 } = {}) {
  const { server, streamStore } = createPlatformServer();
  await new Promise((resolve) => {
    server.listen({ port, host: '127.0.0.1' }, resolve);
  });
  const address = server.address();
  return {
    server,
    streamStore,
    url: typeof address === 'object' && address !== null ? `http://127.0.0.1:${address.port}` : `http://127.0.0.1:${port}`,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT ?? 3000);
  const { url } = await startPlatformServer({ port });
  console.log(`ToukeAgent platform server running at ${url}`);
}
