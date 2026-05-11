import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCanonicalMessage, createStreamEvent } from '../../packages/contracts/src/index.mjs';
import { createStreamStore } from './src/stream-store.mjs';
import { createPersonaRegistry } from './src/persona-registry.mjs';
import { createPlanner } from './src/planner.mjs';
import { runAgentTask } from './src/runtime.mjs';
import { createToolRegistry, registerDefaultTools } from './src/tool-registry.mjs';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const streamStore = createStreamStore();
const personaRegistry = createPersonaRegistry();
const planner = createPlanner();
const toolRegistry = createToolRegistry();
registerDefaultTools(toolRegistry);

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
  const plan = planner.createPlan({ message, persona });
  const { runState, events } = await runAgentTask({
    message,
    persona,
    plan,
    toolRegistry,
    store,
  });

  return {
    message,
    persona,
    plan,
    run_state: runState,
    task_id: message.trace_id,
    stream_url: `/api/stream?task_id=${encodeURIComponent(message.trace_id)}`,
    events,
  };
}

export function createPlatformServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/health') {
      sendJson(response, 200, { ok: true, service: 'toukeagent-platform' }, { headOnly: request.method === 'HEAD' });
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
