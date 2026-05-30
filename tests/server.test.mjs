import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getAlertSnapshot,
  getApprovalSnapshot,
  compareMemoryCandidateSuiteWithGold,
  getCompressionSnapshot,
  getDeadLetterSnapshot,
  getDeliverySnapshot,
  getHandoffSnapshot,
  getMultiAgentSnapshot,
  getGovernanceSnapshot,
  getHarnessRun,
  getKnowledgeSnapshot,
  getRecoveryDrillSnapshot,
  formatSseEvent,
  getEvaluationSnapshot,
  getMemorySnapshot,
  getMemoryGoldHistory,
  compareWikiCandidateSuiteWithObservedRun,
  getRLSnapshot,
  getTraceBundle,
  getReviewSnapshot,
  getTaskSnapshot,
  getTraceEntries,
  inspectContextBudget,
  createPlatformServer,
  dispatchPlatformWorkerJob,
  processInboundMessage,
  registerPlatformWorkerHandler,
  replayDeadLetterExecution,
  replayTaskExecution,
  recoverTaskExecution,
  rollbackMemoryGoldPromotion,
  rollbackMemoryGoldPromotions,
  runMemoryHarness,
  runKnowledgeHarness,
  runWikiHarness,
  resumeTaskExecution,
  runEvaluationHarness,
  saveMemoryHarnessDraftArtifact,
  saveWikiHarnessDraftArtifact,
  promoteWikiHarnessDraftArtifactToSuite,
  listWikiCandidateSuites,
  getWikiCandidateSuite,
  searchMemory,
  takeoverTaskExecution,
} from '../apps/platform/server.mjs';
import { createStreamStore } from '../apps/platform/src/stream-store.mjs';

function parseSseChunks(text) {
  return text
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const parsed = { event: null, id: null, data: null };
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event: ')) {
          parsed.event = line.slice('event: '.length);
        } else if (line.startsWith('id: ')) {
          parsed.id = line.slice('id: '.length);
        } else if (line.startsWith('data: ')) {
          parsed.data = line.slice('data: '.length);
        }
      }
      return parsed;
    });
}

test('server pipeline builds plan, run state, and stores stream events', async () => {
  const store = createStreamStore();
  const message = {
    message_id: 'msg_test_1',
    source_platform: 'web',
    source_message_id: 'raw_test_1',
    workspace_id: 'ws_test',
    channel_id: 'console',
    conversation_id: 'conv_test',
    sender: { id: 'user_1', role: 'user' },
    recipient: { id: 'agent_1', role: 'agent' },
    content: [{ type: 'text', text: 'hello world' }],
    trace_id: 'trace_test',
    persona_hint: 'researcher',
  };

  const result = await processInboundMessage(message, store);
  const replay = store.replay('trace_test', 0);
  const sseText = replay.map(formatSseEvent).join('');

  assert.equal(result.task_id, 'trace_test');
  assert.equal(result.persona.persona_id, 'researcher');
  assert.equal(result.plan.steps.length, 3);
  assert.equal(result.plan.steps[1].tool_name, 'hybrid_retrieve');
  assert.equal(result.run_state.status, 'completed');
  assert.match(result.task_url, /\/api\/tasks\?task_id=/);
  assert.match(result.memory_url, /\/api\/memory\?task_id=/);
  assert.match(result.evaluation_url, /\/api\/evaluations\?task_id=/);
  assert.match(result.review_url, /\/api\/reviews\?task_id=/);
  assert.match(result.trace_bundle_url, /\/api\/traces\/bundle\?task_id=/);
  assert.match(result.wiki_url, /\/api\/wiki/);
  assert.equal(result.quality_gate.status, 'passed');
  assert.ok(result.run_state.output.model_route);
  assert.ok(result.run_state.output.fallback);
  assert.ok(result.run_state.output.model_route.provider);
  assert.equal(result.run_state.output.orchestrator_mode ?? 'legacy', 'legacy');
  assert.ok(Array.isArray(result.deliveries));
  assert.ok(result.deliveries.length > 0);
  assert.equal(result.deliveries[0].delivery.target_platform, 'web');
  assert.equal(replay[0].event_type, 'start');
  assert.equal(replay.at(-1).event_type, 'done');
  assert.equal(replay[2].event_type, 'delta');
  assert.ok(replay.some((event) => event.event_type === 'tool_call'));
  assert.ok(replay.some((event) => event.event_type === 'tool_result'));
  assert.ok(replay.some((event) => event.event_type === 'status' && event.payload.state === 'worker_queued'));
  assert.ok(replay.some((event) => event.event_type === 'status' && event.payload.state === 'worker_running'));
  assert.ok(replay.some((event) => event.event_type === 'status' && event.payload.state === 'worker_completed'));
  assert.match(sseText, /event: start/);
  assert.match(sseText, /event: done/);
  assert.match(sseText, /trace_test/);
  assert.match(sseText, /Plan ready/);

  const traceEntries = getTraceEntries('trace_test');
  assert.ok(traceEntries.some((entry) => entry.kind === 'message.received'));
  assert.ok(traceEntries.some((entry) => entry.kind === 'plan.created'));
  assert.ok(traceEntries.some((entry) => entry.kind === 'worker.job.queued'));
  assert.ok(traceEntries.some((entry) => entry.kind === 'worker.job.completed'));
  assert.ok(traceEntries.some((entry) => entry.kind === 'run.completed'));

  const task = getTaskSnapshot('trace_test');
  assert.equal(task.task_id, 'trace_test');
  assert.equal(task.status, 'completed');
  assert.equal(task.phase, 'completed');
  assert.ok(task.metadata.model_routing);
  assert.equal(task.plan.plan_id, result.plan.plan_id);
  assert.equal(task.total_steps, 3);
  assert.equal(task.completed_steps, 3);
  assert.ok(task.checkpoints.some((entry) => entry.kind === 'plan.created'));
  assert.ok(task.checkpoints.some((entry) => entry.kind === 'run.completed'));

  const memory = getMemorySnapshot('trace_test');
  assert.equal(memory.task_id, 'trace_test');
  assert.ok(memory.short_term.length > 0);
  assert.equal(memory.workspace_id, 'ws_test');
  assert.equal(memory.persona_id, 'researcher');
  assert.ok(memory.provider);
  assert.ok(memory.requested_provider);
  assert.ok(memory.effective_provider);
  assert.ok(memory.runtime_summary);
  assert.equal(memory.runtime_summary.provider_mode, memory.effective_provider);
  assert.equal(memory.runtime_summary.short_term_count, memory.counts.short_term);
  assert.equal(memory.runtime_summary.long_term_count, memory.counts.long_term);
  assert.ok(memory.runtime_summary.handoff_count > 0);
  assert.ok(memory.runtime_summary.compression_count > 0);
  assert.ok(memory.linked_artifacts);
  assert.ok(memory.linked_artifacts.latest_handoff);
  assert.ok(memory.linked_artifacts.latest_compression);
  assert.ok(memory.linked_artifacts.short_term_archive);
  assert.equal(memory.runtime_summary.short_term_persistence, 'markdown_archive');

  const knowledge = getKnowledgeSnapshot('trace_test');
  assert.equal(knowledge.task_id, 'trace_test');
  assert.equal(typeof knowledge.query, 'string');
  assert.ok(Array.isArray(knowledge.chain_stages));
  assert.ok(knowledge.chain_stages.find((item) => item.stage_id === 'hybrid_retrieval'));
  assert.ok(knowledge.chain_stages.find((item) => item.stage_id === 'memory_recall'));
  assert.ok(knowledge.retrieval?.route);
  assert.ok(knowledge.memory?.runtime_summary);
  assert.equal(knowledge.chain_summary.memory_provider, knowledge.memory.runtime_summary.provider_mode);
  assert.ok(Object.prototype.hasOwnProperty.call(knowledge.chain_summary, 'query_mode'));
  assert.ok(Object.prototype.hasOwnProperty.call(knowledge.chain_summary, 'decomposition_strategy'));
  assert.ok(Array.isArray(knowledge.chain_summary.preferred_sources));
  assert.ok(knowledge.chain_stages.find((item) => item.stage_id === 'query_frontend')?.data?.query_frontend_summary);

  const evaluations = getEvaluationSnapshot('trace_test');
  assert.ok(evaluations.length > 0);
  assert.equal(evaluations.at(-1).decision, 'pass');

  const reviews = getReviewSnapshot('trace_test');
  assert.equal(reviews.length, 0);

  const bundle = getTraceBundle('trace_test');
  assert.equal(bundle.exists, true);
  assert.equal(bundle.metrics.final_status, 'completed');
  assert.equal(bundle.metrics.tool_compliance_rate, 1);
  assert.ok(bundle.metrics.retrieval_score > 0);
  assert.ok(bundle.metrics.citation_score > 0);
  assert.ok(bundle.metrics.handoff_count > 0);
  assert.ok(bundle.metrics.compression_count > 0);
  assert.ok(bundle.metrics.delivery_count > 0);
  assert.ok(bundle.metrics.reward_count > 0);

  const handoffs = getHandoffSnapshot('trace_test');
  assert.ok(handoffs.length > 0);
  assert.ok(handoffs[0].context_snapshot_id);
  const multiAgent = getMultiAgentSnapshot('trace_test');
  assert.ok(multiAgent.coordination);
  assert.ok(Array.isArray(multiAgent.coordination.suggestions));
  assert.ok(multiAgent.coordination.join_strategy.mode);

  const compressions = getCompressionSnapshot('trace_test');
  assert.ok(compressions.length > 0);

  const rl = getRLSnapshot('trace_test');
  assert.ok(rl.rewards.length > 0);
  assert.ok(rl.policy_logs.length > 0);
  assert.ok(rl.safety_gates.length > 0);

  const contextBudget = inspectContextBudget('trace_test');
  assert.ok(contextBudget.token_estimate > 0);

  const taskReplay = replayTaskExecution('trace_test');
  assert.equal(taskReplay.task.task_id, 'trace_test');
  assert.ok(taskReplay.stream_events.length > 0);
  assert.equal(getDeliverySnapshot('trace_test').length, bundle.metrics.delivery_count);
});

test('server exposes platform adapters and delivery callbacks over HTTP', async () => {
  const { server } = createPlatformServer();
  const handler = server.listeners('request')[0];

  async function invoke({ method, url, body = null, headers = {} }) {
    const response = {
      statusCode: 0,
      headers: {},
      chunks: [],
      writeHead(statusCode, responseHeaders) {
        this.statusCode = statusCode;
        this.headers = responseHeaders ?? {};
      },
      write(chunk) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return true;
      },
      end(chunk) {
        if (chunk !== undefined) {
          this.write(chunk);
        }
        this.finished = true;
      },
    };

    const request = {
      method,
      url,
      headers,
      on() {},
      async *[Symbol.asyncIterator]() {
        if (body !== null) {
          yield Buffer.from(JSON.stringify(body));
        }
      },
    };

    await handler(request, response);
    return {
      statusCode: response.statusCode,
      body: Buffer.concat(response.chunks).toString('utf8'),
      headers: response.headers,
    };
  }

  const healthResponse = await invoke({
    method: 'GET',
    url: '/api/health',
  });
  assert.equal(healthResponse.statusCode, 200);
  const healthResult = JSON.parse(healthResponse.body);
  assert.ok(healthResult.model_routing);
  assert.ok(healthResult.model_routing.profiles.fast);
  assert.ok(healthResult.model_routing.fallback);
  assert.ok(healthResult.model_routing.providers.deepseek);
  assert.ok(healthResult.model_routing.providers.local);
  assert.ok(healthResult.memory_provider);
  assert.ok(healthResult.memory_provider.requested_provider);
  assert.ok(healthResult.memory_provider.effective_provider);

  const message = {
    message_id: 'msg_http_delivery_1',
    source_platform: 'web',
    source_message_id: 'raw_http_delivery_1',
    workspace_id: 'ws_http_delivery',
    channel_id: 'console',
    conversation_id: 'conv_http_delivery_1',
    sender: { id: 'user_1', role: 'user' },
    recipient: { id: 'agent_1', role: 'agent' },
    content: [{ type: 'text', text: 'Please send this through the new delivery layer.' }],
    trace_id: 'trace_http_delivery_1',
    persona_hint: 'researcher',
  };

  const messageResponse = await invoke({
    method: 'POST',
    url: '/api/messages',
    body: message,
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(messageResponse.statusCode, 200);
  const messageResult = JSON.parse(messageResponse.body);
  assert.equal(messageResult.task_id, 'trace_http_delivery_1');
  assert.ok(Array.isArray(messageResult.deliveries));
  assert.equal(messageResult.deliveries[0].delivery.target_platform, 'web');

  const memoryResponse = await invoke({
    method: 'GET',
    url: '/api/memory?task_id=trace_http_delivery_1&workspace_id=ws_http_delivery&persona_id=researcher',
  });
  assert.equal(memoryResponse.statusCode, 200);
  const memoryResult = JSON.parse(memoryResponse.body);
  assert.ok(memoryResult.provider_strategy);
  assert.ok(memoryResult.provider_strategy.provider);
  assert.ok(memoryResult.provider_strategy.runtime_persistence);
  assert.ok(memoryResult.provider_strategy.requested_provider);
  assert.ok(memoryResult.provider_strategy.effective_provider);
  assert.equal(memoryResult.memory.task_id, 'trace_http_delivery_1');
  assert.equal(memoryResult.memory.workspace_id, 'ws_http_delivery');
  assert.equal(memoryResult.memory.persona_id, 'researcher');
  assert.equal(memoryResult.memory.requested_provider, memoryResult.provider_strategy.requested_provider);
  assert.equal(memoryResult.memory.effective_provider, memoryResult.provider_strategy.effective_provider);
  assert.ok(memoryResult.memory.runtime_summary);
  assert.equal(memoryResult.memory.runtime_summary.provider_mode, memoryResult.memory.effective_provider);
  assert.equal(typeof memoryResult.memory.runtime_summary.short_term_count, 'number');
  assert.equal(typeof memoryResult.memory.runtime_summary.long_term_count, 'number');
  assert.equal(memoryResult.memory.runtime_summary.short_term_persistence, 'markdown_archive');
  assert.equal(typeof memoryResult.memory.runtime_summary.handoff_count, 'number');
  assert.equal(typeof memoryResult.memory.runtime_summary.compression_count, 'number');
  assert.ok(memoryResult.memory.linked_artifacts);
  assert.ok(Object.prototype.hasOwnProperty.call(memoryResult.memory.linked_artifacts, 'latest_handoff'));
  assert.ok(Object.prototype.hasOwnProperty.call(memoryResult.memory.linked_artifacts, 'latest_compression'));
  assert.ok(Object.prototype.hasOwnProperty.call(memoryResult.memory.linked_artifacts, 'short_term_archive'));

  const knowledgeResponse = await invoke({
    method: 'GET',
    url: '/api/knowledge?task_id=trace_http_delivery_1',
  });
  assert.equal(knowledgeResponse.statusCode, 200);
  const knowledgeResult = JSON.parse(knowledgeResponse.body);
  assert.equal(knowledgeResult.task_id, 'trace_http_delivery_1');
  assert.equal(typeof knowledgeResult.query, 'string');
  assert.ok(Array.isArray(knowledgeResult.chain_stages));
  assert.ok(knowledgeResult.chain_stages.find((item) => item.stage_id === 'wiki_lookup'));
  assert.ok(knowledgeResult.chain_stages.find((item) => item.stage_id === 'knowledge_governance'));
  assert.ok(knowledgeResult.chain_stages.find((item) => item.stage_id === 'response_grounding'));
  assert.ok(knowledgeResult.memory.runtime_summary);
  assert.ok(knowledgeResult.wiki);
  assert.ok(knowledgeResult.governance);
  assert.ok(Array.isArray(knowledgeResult.governance.risks));
  assert.equal(typeof knowledgeResult.governance.summary.contract_coverage_score, 'number');
  assert.equal(typeof knowledgeResult.wiki.catalog_count, 'number');
  assert.ok(Object.prototype.hasOwnProperty.call(knowledgeResult.chain_summary, 'filter_policy_mode'));
  assert.ok(Object.prototype.hasOwnProperty.call(knowledgeResult.chain_summary, 'source_of_truth_conflict_count'));
  assert.ok(Object.prototype.hasOwnProperty.call(knowledgeResult.chain_summary, 'knowledge_risk_count'));
  assert.ok(Object.prototype.hasOwnProperty.call(knowledgeResult.chain_summary, 'query_mode'));
  assert.ok(Object.prototype.hasOwnProperty.call(knowledgeResult.chain_summary, 'decomposition_strategy'));
  assert.ok(Array.isArray(knowledgeResult.chain_summary.preferred_sources));
  assert.ok(knowledgeResult.chain_stages.find((item) => item.stage_id === 'query_frontend')?.data?.query_frontend_summary);

  const adaptersResponse = await invoke({
    method: 'GET',
    url: '/api/platform-adapters',
  });
  assert.equal(adaptersResponse.statusCode, 200);
  const adaptersResult = JSON.parse(adaptersResponse.body);
  assert.ok(adaptersResult.adapters.some((item) => item.platform_id === 'web'));
  assert.ok(adaptersResult.adapters.some((item) => item.platform_id === 'slack'));

  const personasResponse = await invoke({
    method: 'GET',
    url: '/api/personas',
  });
  assert.equal(personasResponse.statusCode, 200);
  const personasResult = JSON.parse(personasResponse.body);
  assert.equal(personasResult.default_persona_id, 'researcher');
  assert.ok(personasResult.personas.some((item) => item.persona_id === 'retriever'));
  assert.ok(personasResult.packs.some((item) => item.pack_id === 'analysis_pack'));
  assert.ok(personasResult.toolsets.some((item) => item.toolset_id === 'analysis_toolset'));

  const toolsResponse = await invoke({
    method: 'GET',
    url: '/api/tools',
  });
  assert.equal(toolsResponse.statusCode, 200);
  const toolsResult = JSON.parse(toolsResponse.body);
  assert.ok(Array.isArray(toolsResult.items));
  assert.ok(toolsResult.items.some((item) => item.tool_name === 'search_docs'));
  assert.ok(Array.isArray(toolsResult.toolsets));
  assert.ok(toolsResult.toolsets.some((item) => item.toolset_id === 'review_toolset'));

  const deliveriesResponse = await invoke({
    method: 'GET',
    url: '/api/deliveries?task_id=trace_http_delivery_1',
  });
  assert.equal(deliveriesResponse.statusCode, 200);
  const deliveriesResult = JSON.parse(deliveriesResponse.body);
  assert.equal(deliveriesResult.items.length, 1);

  const callbackResponse = await invoke({
    method: 'POST',
    url: '/api/delivery-callbacks',
    body: {
      delivery_id: deliveriesResult.items[0].delivery_id,
      status: 'delivered',
      callback_state: 'acknowledged',
      external_message_id: 'http_delivery_1',
    },
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(callbackResponse.statusCode, 200);
  const callbackResult = JSON.parse(callbackResponse.body);
  assert.equal(callbackResult.delivery.status, 'delivered');
  assert.equal(callbackResult.delivery.callback_state, 'acknowledged');

  const filteredDeliveriesResponse = await invoke({
    method: 'GET',
    url: '/api/deliveries?task_id=trace_http_delivery_1&target_platform=web&status=delivered',
  });
  assert.equal(filteredDeliveriesResponse.statusCode, 200);
  const filteredDeliveries = JSON.parse(filteredDeliveriesResponse.body);
  assert.equal(filteredDeliveries.items.length, 1);
  assert.equal(filteredDeliveries.items[0].target_platform, 'web');
  assert.equal(filteredDeliveries.items[0].status, 'delivered');

  const deliverySnapshot = getDeliverySnapshot('trace_http_delivery_1');
  assert.equal(deliverySnapshot[0].status, 'delivered');

  const multiAgentResponse = await invoke({
    method: 'GET',
    url: '/api/multi-agent?task_id=trace_http_delivery_1',
  });
  assert.equal(multiAgentResponse.statusCode, 200);
  const multiAgentResult = JSON.parse(multiAgentResponse.body);
  assert.equal(multiAgentResult.task_id, 'trace_http_delivery_1');
  assert.ok(Array.isArray(multiAgentResult.handoffs));
  assert.ok(multiAgentResult.aggregate);
  assert.ok(multiAgentResult.coordination);
  assert.ok(multiAgentResult.coordination.join_strategy.mode);
  assert.ok(Array.isArray(multiAgentResult.coordination.suggestions));

  const traceBundleDownloadResponse = await invoke({
    method: 'GET',
    url: '/api/traces/bundle?task_id=trace_http_delivery_1&download=1',
  });
  assert.equal(traceBundleDownloadResponse.statusCode, 200);
  assert.match(traceBundleDownloadResponse.headers['content-disposition'], /attachment; filename="trace-bundle-trace_http_delivery_1\.json"/);

  const auditDownloadResponse = await invoke({
    method: 'GET',
    url: '/api/traces?task_id=trace_http_delivery_1&download=1',
  });
  assert.equal(auditDownloadResponse.statusCode, 200);
  assert.match(auditDownloadResponse.headers['content-disposition'], /attachment; filename="trace-audit-trace_http_delivery_1\.json"/);

  const replayDownloadResponse = await invoke({
    method: 'GET',
    url: '/api/replay?task_id=trace_http_delivery_1&download=1',
  });
  assert.equal(replayDownloadResponse.statusCode, 200);
  assert.match(replayDownloadResponse.headers['content-disposition'], /attachment; filename="trace-replay-trace_http_delivery_1\.json"/);

  const memoryHarnessResponse = await invoke({
    method: 'POST',
    url: '/api/harness/runs',
    body: {
      harness_type: 'memory',
      preset: 'default_memory_suite',
      metadata: {
        suite: 'http-memory-harness',
      },
    },
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(memoryHarnessResponse.statusCode, 200);
  const memoryHarnessResult = JSON.parse(memoryHarnessResponse.body);
  assert.equal(memoryHarnessResult.run.harness_type, 'memory');
  assert.equal(memoryHarnessResult.run.summary.case_count, 4);

  const memoryHarnessListResponse = await invoke({
    method: 'GET',
    url: '/api/harness/runs?harness_type=memory',
  });
  assert.equal(memoryHarnessListResponse.statusCode, 200);
  const memoryHarnessListResult = JSON.parse(memoryHarnessListResponse.body);
  assert.ok(memoryHarnessListResult.runs.some((item) => item.run_id === memoryHarnessResult.run.run_id));

  const memoryDraftResponse = await invoke({
    method: 'GET',
    url: '/api/harness/memory-draft?task_id=trace_http_delivery_1',
  });
  assert.equal(memoryDraftResponse.statusCode, 200);
  const memoryDraftResult = JSON.parse(memoryDraftResponse.body);
  assert.equal(memoryDraftResult.task_id, 'trace_http_delivery_1');
  assert.ok(memoryDraftResult.summary.generated_case_count >= 2);
  assert.ok(memoryDraftResult.summary.case_types_generated.includes('compression_fidelity'));
  assert.ok(memoryDraftResult.summary.case_types_generated.includes('handoff_sufficiency'));

  const memoryDraftDownloadResponse = await invoke({
    method: 'GET',
    url: '/api/harness/memory-draft?task_id=trace_http_delivery_1&download=1',
  });
  assert.equal(memoryDraftDownloadResponse.statusCode, 200);
  assert.match(memoryDraftDownloadResponse.headers['content-disposition'], /attachment; filename="memory-harness-draft-trace_http_delivery_1\.json"/);

  const wikiDraftResponse = await invoke({
    method: 'GET',
    url: '/api/harness/wiki-draft?task_id=trace_http_delivery_1',
  });
  assert.equal(wikiDraftResponse.statusCode, 200);
  const wikiDraftResult = JSON.parse(wikiDraftResponse.body);
  assert.equal(wikiDraftResult.task_id, 'trace_http_delivery_1');
  assert.equal(wikiDraftResult.summary.generated_case_count, 1);
  assert.equal(wikiDraftResult.cases[0].metadata.domain, 'wiki');

  const wikiDraftDownloadResponse = await invoke({
    method: 'GET',
    url: '/api/harness/wiki-draft?task_id=trace_http_delivery_1&download=1',
  });
  assert.equal(wikiDraftDownloadResponse.statusCode, 200);
  assert.match(wikiDraftDownloadResponse.headers['content-disposition'], /attachment; filename="wiki-harness-draft-trace_http_delivery_1\.json"/);

  const draftSaveDir = mkdtempSync(join(tmpdir(), 'toukeagent-memory-draft-save-'));
  try {
    const memoryDraftSaveResponse = await invoke({
      method: 'POST',
      url: '/api/harness/memory-draft/save',
      body: {
        task_id: 'trace_http_delivery_1',
        case_id: 'trace_http_delivery_1_trace_compression_fidelity',
        output_path: `${draftSaveDir}/trace_http_delivery_1_trace_compression_fidelity.json`,
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(memoryDraftSaveResponse.statusCode, 200);
    const memoryDraftSaved = JSON.parse(memoryDraftSaveResponse.body);
    assert.match(memoryDraftSaved.file_path, /trace_http_delivery_1_trace_compression_fidelity\.json$/);

    const savedArtifact = JSON.parse(readFileSync(memoryDraftSaved.file_path, 'utf8'));
    assert.equal(savedArtifact.artifact_type, 'memory_harness_case_draft');
    assert.equal(savedArtifact.summary.selected_case_count, 1);
    assert.deepEqual(savedArtifact.summary.selected_case_types, ['compression_fidelity']);
  } finally {
    rmSync(draftSaveDir, { recursive: true, force: true });
  }

  const wikiDraftSaveDir = mkdtempSync(join(tmpdir(), 'toukeagent-wiki-draft-save-'));
  try {
    const wikiDraftSaveResponse = await invoke({
      method: 'POST',
      url: '/api/harness/wiki-draft/save',
      body: {
        task_id: 'trace_http_delivery_1',
        case_id: 'trace_http_delivery_1_trace_wiki_case',
        output_path: `${wikiDraftSaveDir}/trace_http_delivery_1_trace_wiki_case.json`,
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(wikiDraftSaveResponse.statusCode, 200);
    const wikiDraftSaved = JSON.parse(wikiDraftSaveResponse.body);
    assert.match(wikiDraftSaved.file_path, /trace_http_delivery_1_trace_wiki_case\.json$/);

    const savedArtifact = JSON.parse(readFileSync(wikiDraftSaved.file_path, 'utf8'));
    assert.equal(savedArtifact.artifact_type, 'wiki_harness_case_draft');
    assert.equal(savedArtifact.summary.selected_case_count, 1);
    assert.equal(savedArtifact.cases[0].metadata.domain, 'wiki');
  } finally {
    rmSync(wikiDraftSaveDir, { recursive: true, force: true });
  }

  const wikiPromoteDir = mkdtempSync(join(tmpdir(), 'toukeagent-wiki-draft-promote-http-'));
  try {
    const wikiDraftPromoteResponse = await invoke({
      method: 'POST',
      url: '/api/harness/wiki-draft/promote',
      body: {
        task_id: 'trace_http_delivery_1',
        case_id: 'trace_http_delivery_1_trace_wiki_case',
        suite_path: `${wikiPromoteDir}/wiki-candidate-suite.json`,
        suite_name: 'wiki-candidate-suite',
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(wikiDraftPromoteResponse.statusCode, 200);
    const promotedWiki = JSON.parse(wikiDraftPromoteResponse.body);
    assert.match(promotedWiki.file_path, /wiki-candidate-suite\.json$/);
    assert.equal(promotedWiki.summary.promoted_case_count, 1);
    assert.deepEqual(promotedWiki.summary.added_case_ids, ['trace_http_delivery_1_trace_wiki_case']);
    assert.equal(promotedWiki.governance_summary.pending_case_count, 1);

    const wikiCandidateListResponse = await invoke({
      method: 'GET',
      url: `/api/harness/wiki-candidate-suites?root_path=${encodeURIComponent(wikiPromoteDir.replace(`${process.cwd()}/`, ''))}`,
    });
    assert.equal(wikiCandidateListResponse.statusCode, 200);
    const wikiCandidateList = JSON.parse(wikiCandidateListResponse.body).suites;
    const listedWikiSuite = wikiCandidateList.find((item) => item.relative_path === promotedWiki.relative_path);
    assert.ok(listedWikiSuite);
    assert.equal(listedWikiSuite.governance_summary.pending_case_count, 1);

    const wikiCandidateDetailResponse = await invoke({
      method: 'GET',
      url: `/api/harness/wiki-candidate-suites?suite_path=${encodeURIComponent(promotedWiki.relative_path)}`,
    });
    assert.equal(wikiCandidateDetailResponse.statusCode, 200);
    const wikiCandidateDetail = JSON.parse(wikiCandidateDetailResponse.body).suite;
    assert.equal(wikiCandidateDetail.suite_id, 'wiki-candidate-suite');
    assert.ok(wikiCandidateDetail.cases.some((item) => item.case_id === 'trace_http_delivery_1_trace_wiki_case'));
    assert.equal(wikiCandidateDetail.governance_summary.pending_case_count, 1);

    const wikiCandidateReviewResponse = await invoke({
      method: 'POST',
      url: '/api/harness/wiki-candidate-suites/review',
      body: {
        suite_path: promotedWiki.relative_path,
        case_id: 'trace_http_delivery_1_trace_wiki_case',
        decision: 'approved',
        reviewer_id: 'wiki_reviewer_http',
        notes: 'route and citations look stable',
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(wikiCandidateReviewResponse.statusCode, 200);
    const reviewedWikiSuite = JSON.parse(wikiCandidateReviewResponse.body).suite;
    const reviewedWikiCase = reviewedWikiSuite.cases.find((item) => item.case_id === 'trace_http_delivery_1_trace_wiki_case');
    assert.equal(reviewedWikiCase.metadata.review_status, 'approved');
    assert.equal(reviewedWikiCase.metadata.reviewer_id, 'wiki_reviewer_http');
    assert.equal(JSON.parse(wikiCandidateReviewResponse.body).governance_summary.approved_case_count, 1);

    const wikiCandidateBatchReviewResponse = await invoke({
      method: 'POST',
      url: '/api/harness/wiki-candidate-suites/review',
      body: {
        suite_path: promotedWiki.relative_path,
        case_ids: ['trace_http_delivery_1_trace_wiki_case'],
        decision: 'needs_revision',
        reviewer_id: 'wiki_reviewer_http',
        notes: 'tighten expected citations',
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(wikiCandidateBatchReviewResponse.statusCode, 200);
    const batchReviewedWikiSuite = JSON.parse(wikiCandidateBatchReviewResponse.body).suite;
    assert.equal(batchReviewedWikiSuite.cases[0].metadata.review_status, 'needs_revision');
    assert.equal(batchReviewedWikiSuite.metadata.last_batch_reviewed_case_ids[0], 'trace_http_delivery_1_trace_wiki_case');
    assert.equal(JSON.parse(wikiCandidateBatchReviewResponse.body).governance_summary.needs_revision_case_count, 1);

    const wikiCandidateRunResponse = await invoke({
      method: 'POST',
      url: '/api/harness/wiki-candidate-suites/run',
      body: {
        suite_path: promotedWiki.relative_path,
        suite_name: 'wiki-candidate-suite-run',
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(wikiCandidateRunResponse.statusCode, 200);
    const wikiCandidateRun = JSON.parse(wikiCandidateRunResponse.body).run;
    assert.equal(wikiCandidateRun.harness_type, 'wiki');
    assert.equal(wikiCandidateRun.summary.case_count, 1);
  } finally {
    rmSync(wikiPromoteDir, { recursive: true, force: true });
  }

  const promoteDir = mkdtempSync(join(tmpdir(), 'toukeagent-memory-draft-promote-'));
  try {
    const goldPath = `${promoteDir}/memory-gold.json`;
    const historyPath = `${promoteDir}/memory-gold-history.json`;
    const memoryDraftPromoteResponse = await invoke({
      method: 'POST',
      url: '/api/harness/memory-draft/promote',
      body: {
        task_id: 'trace_http_delivery_1',
        case_id: 'trace_http_delivery_1_trace_handoff_sufficiency',
        suite_path: `${promoteDir}/candidate-suite.json`,
        suite_name: 'candidate-suite',
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(memoryDraftPromoteResponse.statusCode, 200);
    const promoted = JSON.parse(memoryDraftPromoteResponse.body);
    assert.match(promoted.file_path, /candidate-suite\.json$/);
    assert.equal(promoted.summary.promoted_case_count, 1);
    assert.deepEqual(promoted.summary.added_case_ids, ['trace_http_delivery_1_trace_handoff_sufficiency']);

    const promotedSuite = JSON.parse(readFileSync(promoted.file_path, 'utf8'));
    assert.equal(promotedSuite.suite_id, 'candidate-suite');
    assert.ok(promotedSuite.cases.some((item) => item.case_id === 'trace_http_delivery_1_trace_handoff_sufficiency'));

    const memoryCandidateListResponse = await invoke({
      method: 'GET',
      url: `/api/harness/memory-candidate-suites?root_path=${encodeURIComponent(promoteDir.replace(`${process.cwd()}/`, ''))}`,
    });
    assert.equal(memoryCandidateListResponse.statusCode, 200);
    const memoryCandidateList = JSON.parse(memoryCandidateListResponse.body).suites;
    const listed = memoryCandidateList.find((item) => item.relative_path === promoted.relative_path);
    assert.ok(listed);

    const memoryCandidateDetailResponse = await invoke({
      method: 'GET',
      url: `/api/harness/memory-candidate-suites?suite_path=${encodeURIComponent(promoted.relative_path)}`,
    });
    assert.equal(memoryCandidateDetailResponse.statusCode, 200);
    const memoryCandidateDetail = JSON.parse(memoryCandidateDetailResponse.body).suite;
    assert.equal(memoryCandidateDetail.suite_id, 'candidate-suite');
    assert.ok(memoryCandidateDetail.cases.some((item) => item.case_id === 'trace_http_delivery_1_trace_handoff_sufficiency'));

    const memoryCandidateReviewResponse = await invoke({
      method: 'POST',
      url: '/api/harness/memory-candidate-suites/review',
      body: {
        suite_path: promoted.relative_path,
        case_id: 'trace_http_delivery_1_trace_handoff_sufficiency',
        decision: 'approved',
        reviewer_id: 'reviewer_http',
        notes: 'ready for gold',
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(memoryCandidateReviewResponse.statusCode, 200);
    const reviewedSuite = JSON.parse(memoryCandidateReviewResponse.body).suite;
    const reviewedCase = reviewedSuite.cases.find((item) => item.case_id === 'trace_http_delivery_1_trace_handoff_sufficiency');
    assert.equal(reviewedCase.metadata.review_status, 'approved');

    const memoryCandidateNeedsRevisionResponse = await invoke({
      method: 'POST',
      url: '/api/harness/memory-candidate-suites/review',
      body: {
        suite_path: promoted.relative_path,
        case_id: 'trace_http_delivery_1_trace_handoff_sufficiency',
        decision: 'needs_revision',
        reviewer_id: 'reviewer_http',
        notes: 'needs tighter expected fields',
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(memoryCandidateNeedsRevisionResponse.statusCode, 200);
    const needsRevisionSuite = JSON.parse(memoryCandidateNeedsRevisionResponse.body).suite;
    const needsRevisionCase = needsRevisionSuite.cases.find((item) => item.case_id === 'trace_http_delivery_1_trace_handoff_sufficiency');
    assert.equal(needsRevisionCase.metadata.review_status, 'needs_revision');

    const blockedPromoteGoldResponse = await invoke({
      method: 'POST',
      url: '/api/harness/memory-candidate-suites/promote-gold',
      body: {
        suite_path: promoted.relative_path,
        case_id: 'trace_http_delivery_1_trace_handoff_sufficiency',
        gold_path: goldPath,
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(blockedPromoteGoldResponse.statusCode, 400);
    assert.match(JSON.parse(blockedPromoteGoldResponse.body).error, /Approved candidate case not found/);

    const memoryCandidateApprovedAgainResponse = await invoke({
      method: 'POST',
      url: '/api/harness/memory-candidate-suites/review',
      body: {
        suite_path: promoted.relative_path,
        case_id: 'trace_http_delivery_1_trace_handoff_sufficiency',
        decision: 'approved',
        reviewer_id: 'reviewer_http',
        notes: 'ready for gold',
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(memoryCandidateApprovedAgainResponse.statusCode, 200);

    const memoryCandidateBatchReviewResponse = await invoke({
      method: 'POST',
      url: '/api/harness/memory-candidate-suites/review',
      body: {
        suite_path: promoted.relative_path,
        case_ids: ['trace_http_delivery_1_trace_handoff_sufficiency'],
        decision: 'approved',
        reviewer_id: 'reviewer_http',
        notes: 'batch approved for compare',
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(memoryCandidateBatchReviewResponse.statusCode, 200);
    const batchReviewedSuite = JSON.parse(memoryCandidateBatchReviewResponse.body).suite;
    assert.equal(batchReviewedSuite.metadata.last_batch_reviewed_case_ids[0], 'trace_http_delivery_1_trace_handoff_sufficiency');

    const memoryCandidatePromoteGoldResponse = await invoke({
      method: 'POST',
      url: '/api/harness/memory-candidate-suites/promote-gold',
      body: {
        suite_path: promoted.relative_path,
        case_id: 'trace_http_delivery_1_trace_handoff_sufficiency',
        gold_path: goldPath,
        history_path: historyPath,
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(memoryCandidatePromoteGoldResponse.statusCode, 200);
    const promotedGold = JSON.parse(memoryCandidatePromoteGoldResponse.body);
    assert.match(promotedGold.file_path, /memory-gold\.json$/);
    assert.ok(promotedGold.gold.cases.some((item) => item.case_id === 'trace_http_delivery_1_trace_handoff_sufficiency'));
    assert.match(promotedGold.history_path, /memory-gold-history\.json$/);
    const savedGold = JSON.parse(readFileSync(goldPath, 'utf8'));
    assert.ok(savedGold.cases.some((item) => item.case_id === 'trace_http_delivery_1_trace_handoff_sufficiency'));

    const compareCaseResponse = await invoke({
      method: 'GET',
      url: `/api/harness/memory-candidate-suites/compare?suite_path=${encodeURIComponent(promoted.relative_path)}&case_id=${encodeURIComponent('trace_http_delivery_1_trace_handoff_sufficiency')}&gold_path=${encodeURIComponent(goldPath)}`,
    });
    assert.equal(compareCaseResponse.statusCode, 200);
    const compareCase = JSON.parse(compareCaseResponse.body).comparison;
    assert.equal(compareCase.case_id, 'trace_http_delivery_1_trace_handoff_sufficiency');
    assert.equal(compareCase.gold_exists, true);

    const compareSuiteResponse = await invoke({
      method: 'GET',
      url: `/api/harness/memory-candidate-suites/compare?suite_path=${encodeURIComponent(promoted.relative_path)}&gold_path=${encodeURIComponent(goldPath)}`,
    });
    assert.equal(compareSuiteResponse.statusCode, 200);
    const compareSuite = JSON.parse(compareSuiteResponse.body).comparison;
    assert.equal(compareSuite.case_count, 1);
    assert.ok(compareSuite.comparisons[0].field_diff_summary.reference.total >= 1);

    const goldHistoryResponse = await invoke({
      method: 'GET',
      url: `/api/harness/memory-gold/history?case_id=${encodeURIComponent('trace_http_delivery_1_trace_handoff_sufficiency')}&history_path=${encodeURIComponent(historyPath)}`,
    });
    assert.equal(goldHistoryResponse.statusCode, 200);
    const goldHistory = JSON.parse(goldHistoryResponse.body).events;
    assert.equal(goldHistory.length, 1);
    assert.equal(goldHistory[0].event_type, 'promote_gold');

    const rollbackGoldResponse = await invoke({
      method: 'POST',
      url: '/api/harness/memory-gold/rollback',
      body: {
        case_id: 'trace_http_delivery_1_trace_handoff_sufficiency',
        gold_path: goldPath,
        history_path: historyPath,
        reviewer_id: 'reviewer_http',
        reason: 'rollback for compare flow',
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(rollbackGoldResponse.statusCode, 200);
    const rolledBackGold = JSON.parse(rollbackGoldResponse.body);
    assert.equal(rolledBackGold.summary.removed_from_gold, true);
    const afterRollbackGold = JSON.parse(readFileSync(goldPath, 'utf8'));
    assert.equal(afterRollbackGold.cases.some((item) => item.case_id === 'trace_http_delivery_1_trace_handoff_sufficiency'), false);

    const goldHistoryAfterRollback = await getMemoryGoldHistory({
      historyPath,
      caseId: 'trace_http_delivery_1_trace_handoff_sufficiency',
    });
    assert.equal(goldHistoryAfterRollback.events.length, 2);
    assert.equal(goldHistoryAfterRollback.events.at(-1).event_type, 'rollback_gold');

    const rePromoteResponse = await invoke({
      method: 'POST',
      url: '/api/harness/memory-candidate-suites/promote-gold',
      body: {
        suite_path: promoted.relative_path,
        case_id: 'trace_http_delivery_1_trace_handoff_sufficiency',
        gold_path: goldPath,
        history_path: historyPath,
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(rePromoteResponse.statusCode, 200);

    const batchRollbackGoldResponse = await invoke({
      method: 'POST',
      url: '/api/harness/memory-gold/rollback',
      body: {
        case_ids: ['trace_http_delivery_1_trace_handoff_sufficiency', 'missing_case'],
        gold_path: goldPath,
        history_path: historyPath,
        reviewer_id: 'reviewer_http',
        reason: 'batch rollback for governance flow',
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(batchRollbackGoldResponse.statusCode, 200);
    const batchRollbackGold = JSON.parse(batchRollbackGoldResponse.body);
    assert.equal(batchRollbackGold.summary.requested_case_count, 2);
    assert.equal(batchRollbackGold.summary.rolled_back_case_count, 1);
    assert.equal(batchRollbackGold.summary.failed_case_count, 1);
    assert.deepEqual(batchRollbackGold.summary.failed_case_ids, ['missing_case']);
    assert.equal(batchRollbackGold.results.find((item) => item.case_id === 'trace_http_delivery_1_trace_handoff_sufficiency').ok, true);
    assert.equal(batchRollbackGold.results.find((item) => item.case_id === 'missing_case').ok, false);
    const afterBatchRollbackGold = JSON.parse(readFileSync(goldPath, 'utf8'));
    assert.equal(afterBatchRollbackGold.cases.some((item) => item.case_id === 'trace_http_delivery_1_trace_handoff_sufficiency'), false);

    const memoryCandidateRunResponse = await invoke({
      method: 'POST',
      url: '/api/harness/memory-candidate-suites/run',
      body: {
        suite_path: promoted.relative_path,
        suite_name: 'candidate-suite-run',
      },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(memoryCandidateRunResponse.statusCode, 200);
    const memoryCandidateRun = JSON.parse(memoryCandidateRunResponse.body).run;
    assert.equal(memoryCandidateRun.harness_type, 'memory');
    assert.equal(memoryCandidateRun.summary.case_count, 1);
  } finally {
    rmSync(promoteDir, { recursive: true, force: true });
  }
});

test('server stream endpoint replays SSE events and respects last_seq resume', async () => {
  const { server } = createPlatformServer();
  const handler = server.listeners('request')[0];

  async function invoke({ method, url, body = null, headers = {} }) {
    const listeners = new Map();
    const response = {
      statusCode: 0,
      headers: {},
      chunks: [],
      writeHead(statusCode, responseHeaders) {
        this.statusCode = statusCode;
        this.headers = responseHeaders ?? {};
      },
      write(chunk) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return true;
      },
      end(chunk) {
        if (chunk !== undefined) {
          this.write(chunk);
        }
        this.finished = true;
      },
    };

    const request = {
      method,
      url,
      headers,
      on(event, handlerFn) {
        listeners.set(event, handlerFn);
      },
      emit(event) {
        const listener = listeners.get(event);
        if (listener) {
          listener();
        }
      },
      async *[Symbol.asyncIterator]() {
        if (body !== null) {
          yield Buffer.from(JSON.stringify(body));
        }
      },
    };

    await handler(request, response);
    return {
      statusCode: response.statusCode,
      body: Buffer.concat(response.chunks).toString('utf8'),
      headers: response.headers,
      close() {
        request.emit('close');
      },
    };
  }

  const message = {
    message_id: 'msg_stream_http_1',
    source_platform: 'web',
    source_message_id: 'raw_stream_http_1',
    workspace_id: 'ws_stream_http',
    channel_id: 'console',
    conversation_id: 'conv_stream_http_1',
    sender: { id: 'user_1', role: 'user' },
    recipient: { id: 'agent_1', role: 'agent' },
    content: [{ type: 'text', text: 'Stream this request with replay and resume evidence.' }],
    trace_id: 'trace_stream_http_1',
    persona_hint: 'researcher',
  };

  const messageResponse = await invoke({
    method: 'POST',
    url: '/api/messages',
    body: message,
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(messageResponse.statusCode, 200);
  const messageResult = JSON.parse(messageResponse.body);
  assert.equal(messageResult.run_state.status, 'completed');

  const streamResponse = await invoke({
    method: 'GET',
    url: '/api/stream?task_id=trace_stream_http_1',
  });
  assert.equal(streamResponse.statusCode, 200);
  assert.match(streamResponse.headers['content-type'], /text\/event-stream/);
  const sseEvents = parseSseChunks(streamResponse.body);
  const replayEvents = sseEvents
    .filter((event) => event.event !== 'heartbeat' && event.data)
    .map((event) => ({ ...event, data: JSON.parse(event.data) }));
  assert.ok(replayEvents.length > 0);
  assert.equal(replayEvents[0].event, 'start');
  assert.equal(replayEvents.at(-1).event, 'done');
  assert.ok(sseEvents.some((event) => event.event === 'heartbeat'));
  const lastSeq = replayEvents.at(-1).data.seq;
  streamResponse.close();

  const resumeResponse = await invoke({
    method: 'GET',
    url: `/api/stream?task_id=trace_stream_http_1&last_seq=${lastSeq - 2}`,
  });
  assert.equal(resumeResponse.statusCode, 200);
  const resumeEvents = parseSseChunks(resumeResponse.body)
    .filter((event) => event.event !== 'heartbeat' && event.data)
    .map((event) => ({ ...event, data: JSON.parse(event.data) }));
  assert.ok(resumeEvents.length > 0);
  assert.ok(resumeEvents.every((event) => event.data.seq > lastSeq - 2));
  assert.equal(resumeEvents.at(-1).event, 'done');
  resumeResponse.close();
});

test('server stream endpoint can receive in-flight events before the task starts', async () => {
  const { server } = createPlatformServer();
  const handler = server.listeners('request')[0];

  async function invoke({ method, url, body = null, headers = {} }) {
    const listeners = new Map();
    const response = {
      statusCode: 0,
      headers: {},
      chunks: [],
      writeHead(statusCode, responseHeaders) {
        this.statusCode = statusCode;
        this.headers = responseHeaders ?? {};
      },
      write(chunk) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return true;
      },
      end(chunk) {
        if (chunk !== undefined) {
          this.write(chunk);
        }
        this.finished = true;
      },
    };

    const request = {
      method,
      url,
      headers,
      on(event, handlerFn) {
        listeners.set(event, handlerFn);
      },
      emit(event) {
        const listener = listeners.get(event);
        if (listener) {
          listener();
        }
      },
      async *[Symbol.asyncIterator]() {
        if (body !== null) {
          yield Buffer.from(JSON.stringify(body));
        }
      },
    };

    await handler(request, response);
    return {
      statusCode: response.statusCode,
      body: Buffer.concat(response.chunks).toString('utf8'),
      headers: response.headers,
      response,
      close() {
        request.emit('close');
      },
    };
  }

  const traceId = 'trace_stream_live_1';
  const streamResponse = await invoke({
    method: 'GET',
    url: `/api/stream?task_id=${traceId}`,
  });
  assert.equal(streamResponse.statusCode, 200);
  assert.match(streamResponse.headers['content-type'], /text\/event-stream/);

  const message = {
    message_id: 'msg_stream_live_1',
    source_platform: 'web',
    source_message_id: 'raw_stream_live_1',
    workspace_id: 'ws_stream_live',
    channel_id: 'console',
    conversation_id: 'conv_stream_live_1',
    sender: { id: 'user_1', role: 'user' },
    recipient: { id: 'agent_1', role: 'agent' },
    content: [{ type: 'text', text: 'Open the stream first, then deliver live task events.' }],
    trace_id: traceId,
    persona_hint: 'researcher',
  };

  const messageResponse = await invoke({
    method: 'POST',
    url: '/api/messages',
    body: message,
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(messageResponse.statusCode, 200);
  const messageResult = JSON.parse(messageResponse.body);
  assert.equal(messageResult.run_state.status, 'completed');

  const inflightEvents = parseSseChunks(Buffer.concat(streamResponse.response.chunks).toString('utf8'))
    .filter((event) => event.event !== 'heartbeat' && event.data)
    .map((event) => ({ ...event, data: JSON.parse(event.data) }));

  assert.ok(inflightEvents.length > 0);
  assert.equal(inflightEvents[0].event, 'start');
  assert.equal(inflightEvents.at(-1).event, 'done');
  assert.ok(inflightEvents.some((event) => event.event === 'tool_call'));
  assert.ok(inflightEvents.some((event) => event.event === 'status' && event.data.payload?.state === 'worker_running'));

  streamResponse.close();
});

test('server exposes worker queue inspection and requeue controls', async () => {
  const { server } = createPlatformServer();
  const handler = server.listeners('request')[0];

  async function invoke({ method, url, body = null, headers = {} }) {
    const response = {
      statusCode: 0,
      headers: {},
      chunks: [],
      writeHead(statusCode, responseHeaders) {
        this.statusCode = statusCode;
        this.headers = responseHeaders ?? {};
      },
      write(chunk) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return true;
      },
      end(chunk) {
        if (chunk !== undefined) {
          this.write(chunk);
        }
        this.finished = true;
      },
    };

    const request = {
      method,
      url,
      headers,
      on() {},
      async *[Symbol.asyncIterator]() {
        if (body !== null) {
          yield Buffer.from(JSON.stringify(body));
        }
      },
    };

    await handler(request, response);
    return {
      statusCode: response.statusCode,
      body: Buffer.concat(response.chunks).toString('utf8'),
      headers: response.headers,
    };
  }

  await processInboundMessage({
    message_id: 'msg_worker_queue_http_1',
    source_platform: 'web',
    source_message_id: 'raw_worker_queue_http_1',
    workspace_id: 'ws_worker_queue_http',
    channel_id: 'console',
    conversation_id: 'conv_worker_queue_http_1',
    sender: { id: 'user_1', role: 'user' },
    recipient: { id: 'agent_1', role: 'agent' },
    content: [{ type: 'text', text: 'Please exercise the worker queue endpoint.' }],
    trace_id: 'trace_worker_queue_http_1',
    persona_hint: 'researcher',
  }, createStreamStore());

  const queueResponse = await invoke({
    method: 'GET',
    url: '/api/worker-queue',
  });
  assert.equal(queueResponse.statusCode, 200);
  const queueResult = JSON.parse(queueResponse.body).queue;
  assert.equal(typeof queueResult.queued, 'number');
  assert.equal(typeof queueResult.running, 'number');
  assert.ok(queueResult.jobs.some((job) => job.task_id === 'trace_worker_queue_http_1'));
  assert.ok(queueResult.jobs.some((job) => job.linked_context && job.linked_context.task_id === job.task_id));

  const filteredQueueResponse = await invoke({
    method: 'GET',
    url: '/api/worker-queue?task_id=trace_worker_queue_http_1',
  });
  assert.equal(filteredQueueResponse.statusCode, 200);
  const filteredQueueResult = JSON.parse(filteredQueueResponse.body).queue;
  assert.equal(filteredQueueResult.filters.task_id, 'trace_worker_queue_http_1');
  assert.ok(filteredQueueResult.filtered_jobs.every((job) => job.task_id === 'trace_worker_queue_http_1'));
  assert.ok(filteredQueueResult.filtered_jobs.every((job) => job.linked_context?.dead_letters));
  assert.ok(filteredQueueResult.filtered_jobs.every((job) => job.linked_context?.recovery_drills));
  assert.ok(filteredQueueResult.filtered_jobs.every((job) => job.linked_context?.alerts));

  const requeueResponse = await invoke({
    method: 'POST',
    url: '/api/worker-queue/requeue-stale',
  });
  assert.equal(requeueResponse.statusCode, 200);
  const requeueResult = JSON.parse(requeueResponse.body);
  assert.equal(typeof requeueResult.requeued_count, 'number');
  assert.ok(requeueResult.queue);
});

test('server exposes wiki proposal review, history, and rollback endpoints', async () => {
  const { server } = createPlatformServer();
  const handler = server.listeners('request')[0];

  async function invoke({ method, url, body = null, headers = {} }) {
    const response = {
      statusCode: 0,
      headers: {},
      chunks: [],
      writeHead(statusCode, responseHeaders) {
        this.statusCode = statusCode;
        this.headers = responseHeaders ?? {};
      },
      write(chunk) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return true;
      },
      end(chunk) {
        if (chunk !== undefined) {
          this.write(chunk);
        }
        this.finished = true;
      },
    };

    const request = {
      method,
      url,
      headers,
      on() {},
      async *[Symbol.asyncIterator]() {
        if (body !== null) {
          yield Buffer.from(JSON.stringify(body));
        }
      },
    };

    await handler(request, response);
    return {
      statusCode: response.statusCode,
      body: Buffer.concat(response.chunks).toString('utf8'),
      headers: response.headers,
    };
  }

  const createResponse = await invoke({
    method: 'POST',
    url: '/api/wiki',
    body: {
      entry_id: 'wiki_http_case',
      title: 'HTTP wiki case',
      summary: 'Version 1',
      facts: ['fact v1'],
      tags: ['status'],
      source: 'manual',
      source_trace_id: 'wiki_http_trace',
    },
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(createResponse.statusCode, 200);
  const created = JSON.parse(createResponse.body).entry;
  assert.equal(created.version, 1);

  const catalogResponse = await invoke({
    method: 'GET',
    url: '/api/wiki',
  });
  assert.equal(catalogResponse.statusCode, 200);
  const catalogPayload = JSON.parse(catalogResponse.body);
  assert.ok(catalogPayload.provider_strategy);
  assert.equal(catalogPayload.provider_strategy.provider, 'sqlite');
  assert.equal(catalogPayload.provider_strategy.runtime_persistence, 'sqlite');
  assert.ok(catalogPayload.provider_strategy.durable_store);
  assert.ok(catalogPayload.provider_strategy.durable_store.entry_count >= 1);
  assert.ok(catalogPayload.runtime_summary);
  assert.equal(catalogPayload.runtime_summary.provider, 'sqlite');
  assert.equal(catalogPayload.runtime_summary.runtime_persistence, 'sqlite');
  assert.equal(catalogPayload.runtime_summary.cache_backend, 'disabled');
  assert.equal(typeof catalogPayload.runtime_summary.durable_store_entry_count, 'number');

  const proposalResponse = await invoke({
    method: 'POST',
    url: '/api/wiki/proposals',
    body: {
      entry_id: 'wiki_http_case',
      base_version: 1,
      title: 'HTTP wiki case',
      summary: 'Version 2',
      facts: ['fact v1', 'fact v2'],
      tags: ['status', 'review'],
      source: 'llm',
      source_trace_id: 'wiki_http_trace',
    },
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(proposalResponse.statusCode, 200);
  const proposal = JSON.parse(proposalResponse.body).proposal;
  assert.equal(proposal.status, 'pending_review');

  const proposalsListResponse = await invoke({
    method: 'GET',
    url: '/api/wiki/proposals?entry_id=wiki_http_case',
  });
  assert.equal(proposalsListResponse.statusCode, 200);
  const proposalsList = JSON.parse(proposalsListResponse.body).proposals;
  assert.equal(proposalsList.length, 1);

  const reviewResponse = await invoke({
    method: 'POST',
    url: '/api/wiki/proposals/review',
    body: {
      proposal_id: proposal.proposal_id,
      decision: 'approved',
      reviewer_id: 'reviewer_http',
      notes: 'ship it',
    },
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(reviewResponse.statusCode, 200);
  const reviewed = JSON.parse(reviewResponse.body);
  assert.equal(reviewed.proposal.status, 'approved');
  assert.equal(reviewed.entry.version, 2);

  const resolvedProposalsResponse = await invoke({
    method: 'GET',
    url: '/api/wiki/proposals?entry_id=wiki_http_case&include_resolved=1',
  });
  assert.equal(resolvedProposalsResponse.statusCode, 200);
  const resolvedProposals = JSON.parse(resolvedProposalsResponse.body).proposals;
  assert.equal(resolvedProposals.length, 1);
  assert.equal(resolvedProposals[0].status, 'approved');

  const historyResponse = await invoke({
    method: 'GET',
    url: '/api/wiki/history?entry_id=wiki_http_case',
  });
  assert.equal(historyResponse.statusCode, 200);
  const history = JSON.parse(historyResponse.body);
  assert.equal(history.current.version, 2);
  assert.equal(history.history.length, 1);

  const rollbackResponse = await invoke({
    method: 'POST',
    url: '/api/wiki/rollback',
    body: {
      entry_id: 'wiki_http_case',
      target_version: 1,
      reviewer_id: 'reviewer_http',
      reason: 'restore version 1',
      source_trace_id: 'wiki_http_trace',
    },
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(rollbackResponse.statusCode, 200);
  const rolledBack = JSON.parse(rollbackResponse.body).entry;
  assert.equal(rolledBack.version, 3);
  assert.equal(rolledBack.summary, 'Version 1');

  const fetchEntryResponse = await invoke({
    method: 'GET',
    url: '/api/wiki?entry_id=wiki_http_case',
  });
  assert.equal(fetchEntryResponse.statusCode, 200);
  const fetchedEntryPayload = JSON.parse(fetchEntryResponse.body);
  const fetchedEntry = fetchedEntryPayload.entry;
  assert.equal(fetchedEntry.summary, 'Version 1');
  assert.ok(fetchedEntryPayload.provider_strategy);
  assert.ok(fetchedEntryPayload.runtime_summary);

  const wikiTrace = getTraceEntries('wiki_http_case');
  assert.ok(wikiTrace.some((entry) => entry.kind === 'wiki.upsert'));
  assert.ok(wikiTrace.some((entry) => entry.kind === 'wiki.proposal.created'));
  assert.ok(wikiTrace.some((entry) => entry.kind === 'wiki.proposal.reviewed'));
  assert.ok(wikiTrace.some((entry) => entry.kind === 'wiki.rollback'));

  const importProposalResponse = await invoke({
    method: 'POST',
    url: '/api/wiki/import-markdown',
    body: {
      mode: 'proposal',
      markdown: `---
entry_id: wiki_markdown_http_case
title: Markdown Imported Wiki
tags: [markdown, imported]
owner: wiki_ops
ttl_seconds: 3600
source_of_truth: markdown_note
---

# Markdown Imported Wiki

## Summary
Fresh structured note from markdown.

## Facts
- imported fact one
- imported fact two
`,
      source_trace_id: 'wiki_http_trace',
    },
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(importProposalResponse.statusCode, 200);
  const importedProposal = JSON.parse(importProposalResponse.body);
  assert.equal(importedProposal.mode, 'proposal');
  assert.equal(importedProposal.proposal.entry_id, 'wiki_markdown_http_case');
  assert.equal(importedProposal.proposal.proposed_entry.owner, 'wiki_ops');

  const importUpsertResponse = await invoke({
    method: 'POST',
    url: '/api/wiki/import-markdown',
    body: {
      mode: 'upsert',
      markdown: `# Inline Wiki Entry

Inline summary paragraph.

## Facts
- inline fact
`,
      entry_id: 'wiki_inline_http_case',
      source_trace_id: 'wiki_http_trace',
    },
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(importUpsertResponse.statusCode, 200);
  const importedEntry = JSON.parse(importUpsertResponse.body);
  assert.equal(importedEntry.mode, 'upsert');
  assert.equal(importedEntry.entry.entry_id, 'wiki_inline_http_case');
  assert.equal(importedEntry.entry.version, 1);

  const wikiImportTrace = getTraceEntries('wiki_markdown_http_case');
  assert.ok(wikiImportTrace.some((entry) => entry.kind === 'wiki.markdown_imported'));

  const tempRoot = mkdtempSync(join(tmpdir(), 'toukeagent-wiki-batch-'));
  const markdownDir = join(tempRoot, 'notes');
  await mkdir(markdownDir, { recursive: true });
  await writeFile(join(markdownDir, 'pricing.md'), `---
title: Pricing Status
tags: [pricing, status]
owner: wiki_ops
---

# Pricing Status

## Summary
Current provider pricing status note.

## Facts
- pricing changed today
`);
  await writeFile(join(markdownDir, 'version.md'), `# Version Status

Current version status note.

## Facts
- latest version is tracked here
`);

  const relativeMarkdownDir = markdownDir.replace(`${process.cwd()}/`, '');
  const importBatchResponse = await invoke({
    method: 'POST',
    url: '/api/wiki/import-markdown-batch',
    body: {
      mode: 'upsert',
      directory_path: relativeMarkdownDir,
      source_trace_id: 'wiki_http_trace',
    },
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(importBatchResponse.statusCode, 200);
  const importedBatch = JSON.parse(importBatchResponse.body);
  assert.equal(importedBatch.mode, 'upsert');
  assert.equal(importedBatch.file_count, 2);
  assert.equal(importedBatch.items.length, 2);
  assert.ok(importedBatch.items.every((item) => item.entry));

  const batchQueryResponse = await invoke({
    method: 'GET',
    url: '/api/wiki?q=pricing status',
  });
  assert.equal(batchQueryResponse.statusCode, 200);
  const batchQuery = JSON.parse(batchQueryResponse.body);
  assert.ok(batchQuery.items.some((item) => item.entry_id === 'wiki_pricing'));
  assert.ok(batchQuery.provider_strategy);
  assert.ok(batchQuery.runtime_summary);
  assert.equal(batchQuery.runtime_summary.provider, 'sqlite');

  rmSync(tempRoot, { recursive: true, force: true });
});

test('server records exhausted worker failures into dead-letter state without duplicate task records', async () => {
  registerPlatformWorkerHandler('test.worker.fail.final', async () => {
    throw new Error('worker final failure');
  });

  await assert.rejects(
    dispatchPlatformWorkerJob({
      job_type: 'test.worker.fail.final',
      trace_id: 'trace_worker_dead_letter_http',
      task_id: 'trace_worker_dead_letter_http',
      run_id: 'run_worker_dead_letter_http',
      payload: {},
      retry_limit: 2,
      dead_letter_on_failure: true,
      dead_letter_reason: 'worker_job_failed',
    }),
    (error) => {
      assert.equal(error.message, 'worker final failure');
      assert.ok(error.dead_letter_record);
      assert.equal(error.dead_letter_record.reason, 'worker_job_failed');
      return true;
    },
  );

  const deadLetters = getDeadLetterSnapshot('trace_worker_dead_letter_http');
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0].reason, 'worker_job_failed');
  assert.equal(deadLetters[0].metadata.worker_attempts, 2);
  assert.equal(deadLetters[0].metadata.retry_limit, 2);
  assert.deepEqual(deadLetters[0].payload.worker_input, {});
});

test('server replays dead-lettered worker jobs back into queue main path', async () => {
  let attempts = 0;
  registerPlatformWorkerHandler('test.worker.replay.success_after_dead_letter', async ({ value }) => {
    attempts += 1;
    if (attempts <= 2) {
      throw new Error(`worker replay failure ${attempts}`);
    }

    return {
      summary: 'worker replay success',
      echoed: value,
    };
  });

  await assert.rejects(
    dispatchPlatformWorkerJob({
      job_type: 'test.worker.replay.success_after_dead_letter',
      trace_id: 'trace_worker_dead_letter_replay',
      task_id: 'trace_worker_dead_letter_replay',
      run_id: 'run_worker_dead_letter_replay',
      payload: { value: 'replay me' },
      retry_limit: 2,
      dead_letter_on_failure: true,
      dead_letter_reason: 'worker_job_failed',
    }),
    (error) => {
      assert.equal(error.message, 'worker replay failure 2');
      assert.ok(error.dead_letter_record);
      return true;
    },
  );

  const deadLetter = getDeadLetterSnapshot('trace_worker_dead_letter_replay')[0];
  assert.ok(deadLetter);
  assert.equal(deadLetter.status, 'open');
  assert.deepEqual(deadLetter.payload.worker_input, { value: 'replay me' });

  const replayed = await replayDeadLetterExecution(deadLetter.dead_letter_id, {
    operatorId: 'operator_1',
    notes: 'retry from dead-letter',
  });

  assert.equal(replayed.replay.result.summary, 'worker replay success');
  assert.equal(replayed.replay.result.echoed, 'replay me');
  assert.equal(replayed.replay.job.status, 'completed');
  assert.equal(replayed.replay.job.job_type, 'test.worker.replay.success_after_dead_letter');

  const updated = getDeadLetterSnapshot('trace_worker_dead_letter_replay')[0];
  assert.equal(updated.status, 'replayed');
  assert.equal(updated.metadata.replay_status, 'completed');
  assert.equal(updated.metadata.replay_operator_id, 'operator_1');
  assert.equal(updated.metadata.replay_notes, 'retry from dead-letter');
  assert.equal(updated.metadata.replay_job_id, replayed.replay.job.job_id);
  assert.equal(updated.metadata.replay_id, replayed.replay.replay_id);
  assert.equal(attempts, 3);
});

test('server exposes dead-letter replay over HTTP', async () => {
  const { server } = createPlatformServer();
  const handler = server.listeners('request')[0];

  async function invoke({ method, url, body = null, headers = {} }) {
    const response = {
      statusCode: 0,
      headers: {},
      chunks: [],
      writeHead(statusCode, responseHeaders) {
        this.statusCode = statusCode;
        this.headers = responseHeaders ?? {};
      },
      write(chunk) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return true;
      },
      end(chunk) {
        if (chunk !== undefined) {
          this.write(chunk);
        }
        this.finished = true;
      },
    };

    const request = {
      method,
      url,
      headers,
      on() {},
      async *[Symbol.asyncIterator]() {
        if (body !== null) {
          yield Buffer.from(JSON.stringify(body));
        }
      },
    };

    await handler(request, response);
    return {
      statusCode: response.statusCode,
      body: Buffer.concat(response.chunks).toString('utf8'),
      headers: response.headers,
    };
  }

  let attempts = 0;
  registerPlatformWorkerHandler('test.worker.replay.http', async ({ value }) => {
    attempts += 1;
    if (attempts <= 2) {
      throw new Error(`worker http replay failure ${attempts}`);
    }

    return {
      summary: 'worker http replay success',
      echoed: value,
    };
  });

  await assert.rejects(
    dispatchPlatformWorkerJob({
      job_type: 'test.worker.replay.http',
      trace_id: 'trace_worker_dead_letter_replay_http',
      task_id: 'trace_worker_dead_letter_replay_http',
      run_id: 'run_worker_dead_letter_replay_http',
      payload: { value: 'http replay me' },
      retry_limit: 2,
      dead_letter_on_failure: true,
      dead_letter_reason: 'worker_job_failed',
    }),
    /worker http replay failure 2/,
  );

  const deadLetter = getDeadLetterSnapshot('trace_worker_dead_letter_replay_http')[0];
  assert.ok(deadLetter);

  const replayResponse = await invoke({
    method: 'POST',
    url: '/api/dead-letters/replay',
    body: {
      dead_letter_id: deadLetter.dead_letter_id,
      operator_id: 'operator_http',
      notes: 'http replay',
    },
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(replayResponse.statusCode, 200);

  const replayResult = JSON.parse(replayResponse.body);
  assert.equal(replayResult.dead_letter.status, 'replayed');
  assert.equal(replayResult.replay.job.status, 'completed');
  assert.equal(replayResult.replay.result.summary, 'worker http replay success');
  assert.equal(replayResult.replay.result.echoed, 'http replay me');
  assert.equal(attempts, 3);
});

test('console page exposes task-centric controls, wiki management, and inspector layout', async () => {
  const html = await readFile(new URL('../apps/platform/public/index.html', import.meta.url), 'utf8');
  const approvalInspectorControllerJs = await readFile(new URL('../apps/platform/public/approval-inspector-controller.mjs', import.meta.url), 'utf8');
  const appJs = await readFile(new URL('../apps/platform/public/app.mjs', import.meta.url), 'utf8');
  const compareReviewerRenderersJs = await readFile(new URL('../apps/platform/public/compare-reviewer-renderers.mjs', import.meta.url), 'utf8');
  const candidateSuiteRenderersJs = await readFile(new URL('../apps/platform/public/candidate-suite-renderers.mjs', import.meta.url), 'utf8');
  const consoleShellControllerJs = await readFile(new URL('../apps/platform/public/console-shell-controller.mjs', import.meta.url), 'utf8');
  const deadLetterInspectorControllerJs = await readFile(new URL('../apps/platform/public/dead-letter-inspector-controller.mjs', import.meta.url), 'utf8');
  const deliveryInspectorControllerJs = await readFile(new URL('../apps/platform/public/delivery-inspector-controller.mjs', import.meta.url), 'utf8');
  const governanceInspectorControllerJs = await readFile(new URL('../apps/platform/public/governance-inspector-controller.mjs', import.meta.url), 'utf8');
  const harnessDetailRenderersJs = await readFile(new URL('../apps/platform/public/harness-detail-renderers.mjs', import.meta.url), 'utf8');
  const harnessInspectorControllerJs = await readFile(new URL('../apps/platform/public/harness-inspector-controller.mjs', import.meta.url), 'utf8');
  const inspectorShellControllerJs = await readFile(new URL('../apps/platform/public/inspector-shell-controller.mjs', import.meta.url), 'utf8');
  const knowledgeInspectorControllerJs = await readFile(new URL('../apps/platform/public/knowledge-inspector-controller.mjs', import.meta.url), 'utf8');
  const memoryInspectorControllerJs = await readFile(new URL('../apps/platform/public/memory-inspector-controller.mjs', import.meta.url), 'utf8');
  const modelInspectorControllerJs = await readFile(new URL('../apps/platform/public/model-inspector-controller.mjs', import.meta.url), 'utf8');
  const queueInspectorControllerJs = await readFile(new URL('../apps/platform/public/queue-inspector-controller.mjs', import.meta.url), 'utf8');
  const recoveryInspectorControllerJs = await readFile(new URL('../apps/platform/public/recovery-inspector-controller.mjs', import.meta.url), 'utf8');
  const sharedRenderersJs = await readFile(new URL('../apps/platform/public/shared-renderers.mjs', import.meta.url), 'utf8');
  const taskActionsControllerJs = await readFile(new URL('../apps/platform/public/task-actions-controller.mjs', import.meta.url), 'utf8');
  const taskTraceControllerJs = await readFile(new URL('../apps/platform/public/task-trace-controller.mjs', import.meta.url), 'utf8');
  const toolsInspectorControllerJs = await readFile(new URL('../apps/platform/public/tools-inspector-controller.mjs', import.meta.url), 'utf8');
  const wikiInspectorControllerJs = await readFile(new URL('../apps/platform/public/wiki-inspector-controller.mjs', import.meta.url), 'utf8');

  assert.match(html, /id="console-shell"/);
  assert.match(html, /id="persona-switcher"/);
  assert.match(html, /id="task-summary"/);
  assert.match(html, /id="task-recent-list"/);
  assert.match(html, /id="stream-timeline"/);
  assert.match(html, /id="inspector-tabs"/);
  assert.match(html, /id="inspector-output"/);
  assert.match(html, /id="wiki-management"/);
  assert.match(html, /id="refresh-wiki"/);
  assert.match(html, /id="submit-wiki-proposal"/);
  assert.match(html, /id="import-wiki-markdown"/);
  assert.match(html, /id="wiki-output"/);
  assert.match(html, /id="delivery-ops"/);
  assert.match(html, /id="delivery-platform-filter"/);
  assert.match(html, /id="delivery-receipt-list"/);
  assert.match(html, /id="model-ops"/);
  assert.match(html, /id="model-provider-list"/);
  assert.match(html, /id="tools-ops"/);
  assert.match(html, /id="tools-detail-output"/);
  assert.match(html, /id="memory-ops"/);
  assert.match(html, /id="memory-summary-chips"/);
  assert.match(html, /id="memory-detail-output"/);
  assert.match(html, /id="governance-ops"/);
  assert.match(html, /id="governance-summary-chips"/);
  assert.match(html, /id="governance-detail-output"/);
  assert.match(html, /id="harness-ops"/);
  assert.match(html, /id="harness-type-filter"/);
  assert.match(html, /id="harness-run-list"/);
  assert.match(html, /id="harness-detail-output"/);
  assert.match(html, /id="run-memory-harness"/);
  assert.match(html, /id="run-wiki-harness"/);
  assert.match(html, /id="draft-memory-harness"/);
  assert.match(html, /id="draft-wiki-harness"/);
  assert.match(html, /id="download-memory-draft"/);
  assert.match(html, /id="download-wiki-draft"/);
  assert.match(html, /id="save-memory-draft-case"/);
  assert.match(html, /id="save-wiki-draft-case"/);
  assert.match(html, /id="promote-memory-draft-case"/);
  assert.match(html, /id="promote-wiki-draft-case"/);
  assert.match(html, /id="refresh-memory-candidate-suites"/);
  assert.match(html, /id="run-memory-candidate-suite"/);
  assert.match(html, /id="refresh-wiki-candidate-suites"/);
  assert.match(html, /id="run-wiki-candidate-suite"/);
  assert.match(html, /id="approve-wiki-candidate-case"/);
  assert.match(html, /id="batch-review-wiki-candidate-cases"/);
  assert.match(html, /id="compare-wiki-candidate-case"/);
  assert.match(html, /id="compare-wiki-candidate-suite"/);
  assert.match(html, /id="approve-memory-candidate-case"/);
  assert.match(html, /id="batch-review-memory-candidate-cases"/);
  assert.match(html, /id="compare-memory-candidate-case"/);
  assert.match(html, /id="compare-memory-candidate-suite"/);
  assert.match(html, /id="memory-candidate-review-decision"/);
  assert.match(html, /id="memory-candidate-reviewer-id"/);
  assert.match(html, /id="memory-candidate-review-notes"/);
  assert.match(html, /id="wiki-candidate-review-decision"/);
  assert.match(html, /id="wiki-candidate-reviewer-id"/);
  assert.match(html, /id="wiki-candidate-review-notes"/);
  assert.match(html, /id="promote-memory-candidate-case-gold"/);
  assert.match(html, /id="rollback-memory-gold-case"/);
  assert.match(html, /id="batch-rollback-memory-gold-cases"/);
  assert.match(html, /id="load-memory-gold-history"/);
  assert.match(html, /id="harness-draft-case-list"/);
  assert.match(html, /id="harness-candidate-suite-list"/);
  assert.match(html, /id="approval-ops"/);
  assert.match(html, /id="approval-selected-id"/);
  assert.match(html, /id="approval-change-list"/);
  assert.match(html, /id="approval-detail-output"/);
  assert.match(html, /id="dead-letter-ops"/);
  assert.match(html, /id="dead-letter-status-filter"/);
  assert.match(html, /id="dead-letter-replayable-filter"/);
  assert.match(html, /id="dead-letter-selected-id"/);
  assert.match(html, /id="refresh-dead-letters"/);
  assert.match(html, /id="replay-dead-letter"/);
  assert.match(html, /id="recover-dead-letter-task"/);
  assert.match(html, /id="dead-letter-summary-chips"/);
  assert.match(html, /id="dead-letter-list"/);
  assert.match(html, /id="dead-letter-detail-output"/);
  assert.match(html, /id="recovery-ops"/);
  assert.match(html, /id="recovery-status-filter"/);
  assert.match(html, /id="recovery-selected-id"/);
  assert.match(html, /id="refresh-recovery-drills"/);
  assert.match(html, /id="recovery-summary-chips"/);
  assert.match(html, /id="recovery-list"/);
  assert.match(html, /id="recovery-detail-output"/);
  assert.match(html, /id="knowledge-ops"/);
  assert.match(html, /id="knowledge-query"/);
  assert.match(html, /id="knowledge-selected-stage"/);
  assert.match(html, /id="knowledge-summary-chips"/);
  assert.match(html, /id="knowledge-stage-list"/);
  assert.match(html, /id="knowledge-detail-output"/);
  assert.match(html, /id="queue-ops"/);
  assert.match(html, /id="queue-task-filter"/);
  assert.match(html, /id="queue-trace-filter"/);
  assert.match(html, /id="queue-worker-filter"/);
  assert.match(html, /id="queue-status-filter"/);
  assert.match(html, /id="queue-selected-id"/);
  assert.match(html, /id="refresh-queue"/);
  assert.match(html, /id="requeue-stale-jobs"/);
  assert.match(html, /id="inspect-queue-dead-letters"/);
  assert.match(html, /id="inspect-queue-recovery"/);
  assert.match(html, /id="inspect-queue-governance"/);
  assert.match(html, /id="clear-queue-filters"/);
  assert.match(html, /id="queue-summary-chips"/);
  assert.match(html, /id="queue-job-list"/);
  assert.match(html, /id="queue-detail-output"/);
  assert.match(html, /id="refresh-task"/);
  assert.match(html, /id="reload-inspector"/);
  assert.match(html, /id="export-trace-bundle"/);
  assert.match(html, /id="export-audit-snapshot"/);
  assert.match(html, /id="replay-task"/);
  assert.match(html, /id="recover-task"/);
  assert.match(html, /id="approve-task"/);
  assert.match(html, /id="takeover-task"/);
  assert.match(html, /id="load-task"/);
  assert.match(html, /id="disconnect-task"/);
  assert.match(html, /id="approve-task"/);
  assert.match(html, /id="takeover-task"/);
  assert.match(html, /id="load-task"/);
  assert.match(html, /id="disconnect-task"/);
  assert.match(appJs, /\['model', 'Model'\]/);
  assert.match(appJs, /\['tools', 'Tools'\]/);
  assert.match(appJs, /\['governance', 'Gov'\]/);
  assert.match(appJs, /\['harness', 'Harness'\]/);
  assert.match(appJs, /\['wiki', 'Wiki'\]/);
  assert.match(appJs, /\['deliveries', 'Deliveries'\]/);
  assert.match(appJs, /\['queue', 'Queue'\]/);
  assert.match(appJs, /\['knowledge', 'Knowledge'\]/);
  assert.match(appJs, /\['deadLetters', 'Dead Letters'\]/);
  assert.match(appJs, /\['recovery', 'Recovery'\]/);
  assert.match(appJs, /renderHarnessInspector/);
  assert.match(appJs, /createKnowledgeInspectorController/);
  assert.match(appJs, /createDeadLetterInspectorController/);
  assert.match(appJs, /createDeliveryInspectorController/);
  assert.match(appJs, /createGovernanceInspectorController/);
  assert.match(appJs, /createModelInspectorController/);
  assert.match(appJs, /createMemoryInspectorController/);
  assert.match(appJs, /createQueueInspectorController/);
  assert.match(appJs, /createApprovalInspectorController/);
  assert.match(appJs, /createRecoveryInspectorController/);
  assert.match(appJs, /createInspectorShellController/);
  assert.match(appJs, /createSharedRenderers/);
  assert.match(appJs, /createConsoleShellController/);
  assert.match(appJs, /createTaskActionsController/);
  assert.match(appJs, /createTaskTraceController/);
  assert.match(appJs, /createToolsInspectorController/);
  assert.match(appJs, /createWikiInspectorController/);
  assert.match(queueInspectorControllerJs, /queueTaskFilter/);
  assert.match(queueInspectorControllerJs, /queueTraceFilter/);
  assert.match(queueInspectorControllerJs, /queueWorkerFilter/);
  assert.match(queueInspectorControllerJs, /queueStatusFilter/);
  assert.match(queueInspectorControllerJs, /queueSelectedId/);
  assert.match(queueInspectorControllerJs, /queueRefreshButton/);
  assert.match(queueInspectorControllerJs, /queueRequeueStaleButton/);
  assert.match(queueInspectorControllerJs, /inspectQueueDeadLettersButton/);
  assert.match(queueInspectorControllerJs, /inspectQueueRecoveryButton/);
  assert.match(queueInspectorControllerJs, /inspectQueueGovernanceButton/);
  assert.match(queueInspectorControllerJs, /queueClearFiltersButton/);
  assert.match(queueInspectorControllerJs, /inspectSelectedQueueTask/);
  assert.match(queueInspectorControllerJs, /linked_context/);
  assert.match(harnessInspectorControllerJs, /runDefaultMemoryHarnessSuite/);
  assert.match(harnessInspectorControllerJs, /runDefaultWikiHarnessSuite/);
  assert.match(harnessInspectorControllerJs, /draftMemoryHarnessFromCurrentTask/);
  assert.match(harnessInspectorControllerJs, /draftWikiHarnessFromCurrentTask/);
  assert.match(harnessDetailRenderersJs, /renderMemoryHarnessDraft/);
  assert.match(harnessDetailRenderersJs, /renderMemoryHarnessDraftDetail/);
  assert.match(harnessDetailRenderersJs, /renderWikiHarnessDraft/);
  assert.match(harnessDetailRenderersJs, /renderWikiHarnessDraftDetail/);
  assert.match(harnessInspectorControllerJs, /downloadCurrentMemoryDraft/);
  assert.match(harnessInspectorControllerJs, /downloadCurrentWikiDraft/);
  assert.match(harnessInspectorControllerJs, /saveSelectedMemoryDraftCase/);
  assert.match(harnessInspectorControllerJs, /saveSelectedWikiDraftCase/);
  assert.match(harnessInspectorControllerJs, /promoteSelectedMemoryDraftCase/);
  assert.match(harnessInspectorControllerJs, /promoteSelectedWikiDraftCase/);
  assert.match(harnessInspectorControllerJs, /refreshMemoryCandidateSuites/);
  assert.match(harnessInspectorControllerJs, /runSelectedMemoryCandidateSuite/);
  assert.match(harnessInspectorControllerJs, /refreshWikiCandidateSuites/);
  assert.match(harnessInspectorControllerJs, /runSelectedWikiCandidateSuite/);
  assert.match(harnessInspectorControllerJs, /approveSelectedWikiCandidateCase/);
  assert.match(harnessInspectorControllerJs, /batchReviewSelectedWikiCandidateCases/);
  assert.match(appJs, /compareWikiCandidateCaseButton/);
  assert.match(appJs, /compareWikiCandidateSuiteButton/);
  assert.match(harnessInspectorControllerJs, /compareSelectedWikiCandidateCase/);
  assert.match(harnessInspectorControllerJs, /compareSelectedWikiCandidateSuite/);
  assert.match(appJs, /renderMemoryCandidateSuites/);
  assert.match(appJs, /renderWikiCandidateSuites/);
  assert.match(sharedRenderersJs, /appendWikiSuiteComparisonSection/);
  assert.match(appJs, /createCompareReviewerRenderers/);
  assert.match(appJs, /createCandidateSuiteRenderers/);
  assert.match(appJs, /createHarnessDetailRenderers/);
  assert.match(appJs, /createHarnessInspectorController/);
  assert.match(compareReviewerRenderersJs, /appendWikiComparisonReviewerSummary/);
  assert.match(compareReviewerRenderersJs, /appendWikiComparisonGapSection/);
  assert.match(compareReviewerRenderersJs, /appendWikiCaseComparisonReviewerDetail/);
  assert.match(appJs, /renderWikiCandidateComparisonDetail/);
  assert.match(candidateSuiteRenderersJs, /buildWikiCandidateSuiteStats/);
  assert.match(harnessInspectorControllerJs, /approveSelectedMemoryCandidateCase/);
  assert.match(harnessInspectorControllerJs, /batchReviewSelectedMemoryCandidateCases/);
  assert.match(compareReviewerRenderersJs, /appendMemoryComparisonReviewerSummary/);
  assert.match(compareReviewerRenderersJs, /appendMemoryComparisonGapSection/);
  assert.match(compareReviewerRenderersJs, /appendMemoryCaseComparisonReviewerDetail/);
  assert.match(harnessInspectorControllerJs, /compareSelectedMemoryCandidateCase/);
  assert.match(harnessInspectorControllerJs, /compareSelectedMemoryCandidateSuite/);
  assert.match(appJs, /memoryCandidateReviewDecision/);
  assert.match(appJs, /memoryCandidateReviewerId/);
  assert.match(appJs, /memoryCandidateReviewNotes/);
  assert.match(harnessInspectorControllerJs, /promoteSelectedMemoryCandidateCaseToGold/);
  assert.match(harnessInspectorControllerJs, /rollbackSelectedMemoryGoldPromotion/);
  assert.match(harnessInspectorControllerJs, /batchRollbackSelectedMemoryGoldPromotions/);
  assert.match(harnessInspectorControllerJs, /loadSelectedMemoryGoldHistory/);
  assert.match(candidateSuiteRenderersJs, /buildMemoryCandidateSuiteStats/);
  assert.match(appJs, /renderMemoryGoldHistoryAudit/);
  assert.match(compareReviewerRenderersJs, /export function createCompareReviewerRenderers/);
  assert.match(compareReviewerRenderersJs, /field_diffs/);
  assert.match(compareReviewerRenderersJs, /renderComparisonDetail/);
  assert.match(compareReviewerRenderersJs, /createMemoryCompareRenderConfig/);
  assert.match(compareReviewerRenderersJs, /createWikiCompareRenderConfig/);
  assert.match(compareReviewerRenderersJs, /appendMemoryComparisonReviewerSummary/);
  assert.match(compareReviewerRenderersJs, /appendMemoryComparisonGapSection/);
  assert.match(compareReviewerRenderersJs, /appendMemoryCaseComparisonReviewerDetail/);
  assert.match(compareReviewerRenderersJs, /appendWikiComparisonReviewerSummary/);
  assert.match(compareReviewerRenderersJs, /appendWikiComparisonGapSection/);
  assert.match(compareReviewerRenderersJs, /appendWikiCaseComparisonReviewerDetail/);
  assert.match(compareReviewerRenderersJs, /renderMemoryCandidateComparisonDetail/);
  assert.match(compareReviewerRenderersJs, /renderWikiCandidateComparisonDetail/);
  assert.match(candidateSuiteRenderersJs, /export function createCandidateSuiteRenderers/);
  assert.match(candidateSuiteRenderersJs, /buildMemoryCandidateSuiteStats/);
  assert.match(candidateSuiteRenderersJs, /buildWikiCandidateSuiteStats/);
  assert.match(candidateSuiteRenderersJs, /renderMemoryGoldHistoryAudit/);
  assert.match(candidateSuiteRenderersJs, /renderMemoryCandidateSuiteDetail/);
  assert.match(candidateSuiteRenderersJs, /renderMemoryCandidateSuites/);
  assert.match(candidateSuiteRenderersJs, /renderWikiCandidateSuiteDetail/);
  assert.match(candidateSuiteRenderersJs, /renderWikiCandidateSuites/);
  assert.match(harnessDetailRenderersJs, /export function createHarnessDetailRenderers/);
  assert.match(harnessDetailRenderersJs, /getHarnessCaseTone/);
  assert.match(harnessDetailRenderersJs, /buildHarnessCaseSubtitle/);
  assert.match(harnessDetailRenderersJs, /renderHarnessRunReviewerDetail/);
  assert.match(harnessDetailRenderersJs, /renderMemoryHarnessDraftDetail/);
  assert.match(harnessDetailRenderersJs, /renderMemoryHarnessDraft/);
  assert.match(harnessDetailRenderersJs, /renderWikiHarnessDraft/);
  assert.match(harnessDetailRenderersJs, /renderWikiHarnessDraftDetail/);
  assert.match(harnessInspectorControllerJs, /export function createHarnessInspectorController/);
  assert.match(harnessInspectorControllerJs, /renderHarnessInspector/);
  assert.match(harnessInspectorControllerJs, /runDefaultMemoryHarnessSuite/);
  assert.match(harnessInspectorControllerJs, /runDefaultWikiHarnessSuite/);
  assert.match(harnessInspectorControllerJs, /runDefaultKnowledgeHarnessSuite/);
  assert.match(harnessInspectorControllerJs, /draftMemoryHarnessFromCurrentTask/);
  assert.match(harnessInspectorControllerJs, /draftWikiHarnessFromCurrentTask/);
  assert.match(harnessInspectorControllerJs, /refreshMemoryCandidateSuites/);
  assert.match(harnessInspectorControllerJs, /refreshWikiCandidateSuites/);
  assert.match(harnessInspectorControllerJs, /runSelectedMemoryCandidateSuite/);
  assert.match(harnessInspectorControllerJs, /runSelectedWikiCandidateSuite/);
  assert.match(harnessInspectorControllerJs, /bindHarnessInspectorEvents/);
  assert.match(harnessInspectorControllerJs, /buildHarnessRunsEndpoint/);
  assert.match(harnessInspectorControllerJs, /normalizeHarnessInspectorPayload/);
  assert.match(harnessInspectorControllerJs, /buildHarnessInspectorSummary/);
  assert.match(harnessInspectorControllerJs, /loadHarnessInspectorData/);
  assert.match(harnessInspectorControllerJs, /clearHarnessInspector/);
  assert.match(harnessInspectorControllerJs, /setHarnessInspectorVisibility/);
  assert.match(harnessInspectorControllerJs, /renderHarnessInspectorPanel/);
  assert.match(harnessInspectorControllerJs, /\/api\/harness\/runs/);
  assert.match(harnessInspectorControllerJs, /\/api\/harness\/memory-draft/);
  assert.match(harnessInspectorControllerJs, /\/api\/harness\/wiki-draft/);
  assert.match(harnessInspectorControllerJs, /\/api\/harness\/memory-draft\/save/);
  assert.match(harnessInspectorControllerJs, /\/api\/harness\/wiki-draft\/save/);
  assert.match(harnessInspectorControllerJs, /\/api\/harness\/memory-draft\/promote/);
  assert.match(harnessInspectorControllerJs, /\/api\/harness\/wiki-draft\/promote/);
  assert.match(harnessInspectorControllerJs, /\/api\/harness\/memory-candidate-suites/);
  assert.match(harnessInspectorControllerJs, /\/api\/harness\/wiki-candidate-suites/);
  assert.match(harnessInspectorControllerJs, /\/api\/harness\/memory-candidate-suites\/review/);
  assert.match(harnessInspectorControllerJs, /\/api\/harness\/memory-candidate-suites\/compare/);
  assert.match(harnessInspectorControllerJs, /\/api\/harness\/memory-candidate-suites\/promote-gold/);
  assert.match(harnessInspectorControllerJs, /\/api\/harness\/wiki-candidate-suites\/run/);
  assert.match(harnessInspectorControllerJs, /\/api\/harness\/wiki-candidate-suites\/review/);
  assert.match(harnessInspectorControllerJs, /\/api\/harness\/wiki-candidate-suites\/compare/);
  assert.match(harnessInspectorControllerJs, /\/api\/harness\/memory-gold\/history/);
  assert.match(harnessInspectorControllerJs, /\/api\/harness\/memory-gold\/rollback/);
  assert.match(appJs, /harness-type-filter/);
  assert.match(harnessInspectorControllerJs, /review_markdown/);
  assert.match(deliveryInspectorControllerJs, /export function createDeliveryInspectorController/);
  assert.match(deliveryInspectorControllerJs, /compareDeliveryItems/);
  assert.match(deliveryInspectorControllerJs, /renderDeliveryInspector/);
  assert.match(deliveryInspectorControllerJs, /normalizeDeliveryInspectorPayload/);
  assert.match(deliveryInspectorControllerJs, /buildDeliveryInspectorSummary/);
  assert.match(deliveryInspectorControllerJs, /bindDeliveryInspectorEvents/);
  assert.match(deliveryInspectorControllerJs, /clearDeliveryInspector/);
  assert.match(deliveryInspectorControllerJs, /setDeliveryInspectorVisibility/);
  assert.match(deliveryInspectorControllerJs, /renderDeliveryInspectorPanel/);
  assert.match(deliveryInspectorControllerJs, /\/api\/deliveries/);
  assert.match(deadLetterInspectorControllerJs, /export function createDeadLetterInspectorController/);
  assert.match(deadLetterInspectorControllerJs, /normalizeDeadLetterInspectorPayload/);
  assert.match(deadLetterInspectorControllerJs, /buildDeadLetterInspectorSummary/);
  assert.match(deadLetterInspectorControllerJs, /buildDeadLettersEndpoint/);
  assert.match(deadLetterInspectorControllerJs, /loadDeadLetterInspectorData/);
  assert.match(deadLetterInspectorControllerJs, /clearDeadLetterInspector/);
  assert.match(deadLetterInspectorControllerJs, /setDeadLetterInspectorVisibility/);
  assert.match(deadLetterInspectorControllerJs, /renderDeadLetterInspectorPanel/);
  assert.match(deadLetterInspectorControllerJs, /renderDeadLetterInspector/);
  assert.match(deadLetterInspectorControllerJs, /renderDeadLetterDetail/);
  assert.match(deadLetterInspectorControllerJs, /refreshDeadLetters/);
  assert.match(deadLetterInspectorControllerJs, /replaySelectedDeadLetter/);
  assert.match(deadLetterInspectorControllerJs, /recoverTaskFromSelectedDeadLetter/);
  assert.match(deadLetterInspectorControllerJs, /bindDeadLetterInspectorEvents/);
  assert.match(deadLetterInspectorControllerJs, /\/api\/dead-letters/);
  assert.match(deadLetterInspectorControllerJs, /\/api\/dead-letters\/replay/);
  assert.match(deadLetterInspectorControllerJs, /\/api\/tasks\/recover/);
  assert.match(queueInspectorControllerJs, /export function createQueueInspectorController/);
  assert.match(queueInspectorControllerJs, /buildQueueQueryParams/);
  assert.match(queueInspectorControllerJs, /buildQueueEndpoint/);
  assert.match(queueInspectorControllerJs, /getSelectedQueueJob/);
  assert.match(queueInspectorControllerJs, /normalizeQueueInspectorPayload/);
  assert.match(queueInspectorControllerJs, /buildQueueInspectorSummary/);
  assert.match(queueInspectorControllerJs, /loadQueueInspectorData/);
  assert.match(queueInspectorControllerJs, /clearQueueInspector/);
  assert.match(queueInspectorControllerJs, /setQueueInspectorVisibility/);
  assert.match(queueInspectorControllerJs, /renderQueueInspectorPanel/);
  assert.match(queueInspectorControllerJs, /renderQueueInspector/);
  assert.match(queueInspectorControllerJs, /inspectSelectedQueueTask/);
  assert.match(queueInspectorControllerJs, /requeueStaleJobs/);
  assert.match(queueInspectorControllerJs, /clearQueueFilters/);
  assert.match(queueInspectorControllerJs, /bindQueueInspectorEvents/);
  assert.match(queueInspectorControllerJs, /\/api\/worker-queue/);
  assert.match(queueInspectorControllerJs, /\/api\/worker-queue\/requeue-stale/);
  assert.match(recoveryInspectorControllerJs, /export function createRecoveryInspectorController/);
  assert.match(recoveryInspectorControllerJs, /normalizeRecoveryInspectorPayload/);
  assert.match(recoveryInspectorControllerJs, /buildRecoveryInspectorSummary/);
  assert.match(recoveryInspectorControllerJs, /buildRecoveryEndpoint/);
  assert.match(recoveryInspectorControllerJs, /loadRecoveryInspectorData/);
  assert.match(recoveryInspectorControllerJs, /clearRecoveryInspector/);
  assert.match(recoveryInspectorControllerJs, /setRecoveryInspectorVisibility/);
  assert.match(recoveryInspectorControllerJs, /renderRecoveryInspectorPanel/);
  assert.match(recoveryInspectorControllerJs, /renderRecoveryInspector/);
  assert.match(recoveryInspectorControllerJs, /renderRecoveryDetail/);
  assert.match(recoveryInspectorControllerJs, /refreshRecoveryDrills/);
  assert.match(recoveryInspectorControllerJs, /bindRecoveryInspectorEvents/);
  assert.match(recoveryInspectorControllerJs, /\/api\/recovery\/drills/);
  assert.match(approvalInspectorControllerJs, /export function createApprovalInspectorController/);
  assert.match(approvalInspectorControllerJs, /normalizeApprovalInspectorPayload/);
  assert.match(approvalInspectorControllerJs, /buildApprovalInspectorSummary/);
  assert.match(approvalInspectorControllerJs, /clearApprovalInspector/);
  assert.match(approvalInspectorControllerJs, /setApprovalInspectorVisibility/);
  assert.match(approvalInspectorControllerJs, /renderApprovalInspectorPanel/);
  assert.match(approvalInspectorControllerJs, /renderApprovalInspector/);
  assert.match(governanceInspectorControllerJs, /export function createGovernanceInspectorController/);
  assert.match(governanceInspectorControllerJs, /normalizeGovernanceInspectorPayload/);
  assert.match(governanceInspectorControllerJs, /buildGovernanceInspectorSummary/);
  assert.match(governanceInspectorControllerJs, /clearGovernanceInspector/);
  assert.match(governanceInspectorControllerJs, /setGovernanceInspectorVisibility/);
  assert.match(governanceInspectorControllerJs, /renderGovernanceInspectorPanel/);
  assert.match(governanceInspectorControllerJs, /renderGovernanceInspector/);
  assert.match(modelInspectorControllerJs, /export function createModelInspectorController/);
  assert.match(modelInspectorControllerJs, /normalizeModelInspectorPayload/);
  assert.match(modelInspectorControllerJs, /buildModelInspectorSummary/);
  assert.match(modelInspectorControllerJs, /clearModelInspector/);
  assert.match(modelInspectorControllerJs, /setModelInspectorVisibility/);
  assert.match(modelInspectorControllerJs, /renderModelInspectorPanel/);
  assert.match(modelInspectorControllerJs, /renderModelInspector/);
  assert.match(modelInspectorControllerJs, /provider_catalog/);
  assert.match(knowledgeInspectorControllerJs, /export function createKnowledgeInspectorController/);
  assert.match(knowledgeInspectorControllerJs, /normalizeKnowledgeInspectorPayload/);
  assert.match(knowledgeInspectorControllerJs, /buildKnowledgeInspectorSummary/);
  assert.match(knowledgeInspectorControllerJs, /clearKnowledgeInspector/);
  assert.match(knowledgeInspectorControllerJs, /setKnowledgeInspectorVisibility/);
  assert.match(knowledgeInspectorControllerJs, /renderKnowledgeInspectorPanel/);
  assert.match(knowledgeInspectorControllerJs, /renderKnowledgeInspector/);
  assert.match(knowledgeInspectorControllerJs, /renderKnowledgeFrontendDetail/);
  assert.match(knowledgeInspectorControllerJs, /knowledgeSelectedStageId/);
  assert.match(toolsInspectorControllerJs, /export function createToolsInspectorController/);
  assert.match(toolsInspectorControllerJs, /normalizeToolsInspectorPayload/);
  assert.match(toolsInspectorControllerJs, /buildToolsInspectorSummary/);
  assert.match(toolsInspectorControllerJs, /clearToolsInspector/);
  assert.match(toolsInspectorControllerJs, /setToolsInspectorVisibility/);
  assert.match(toolsInspectorControllerJs, /renderToolsInspectorPanel/);
  assert.match(toolsInspectorControllerJs, /renderToolsInspector/);
  assert.match(memoryInspectorControllerJs, /export function createMemoryInspectorController/);
  assert.match(memoryInspectorControllerJs, /normalizeMemoryInspectorPayload/);
  assert.match(memoryInspectorControllerJs, /buildMemoryInspectorSummary/);
  assert.match(memoryInspectorControllerJs, /clearMemoryInspector/);
  assert.match(memoryInspectorControllerJs, /setMemoryInspectorVisibility/);
  assert.match(memoryInspectorControllerJs, /renderMemoryInspectorPanel/);
  assert.match(memoryInspectorControllerJs, /renderMemoryInspector/);
  assert.match(memoryInspectorControllerJs, /linked_artifacts/);
  assert.match(wikiInspectorControllerJs, /export function createWikiInspectorController/);
  assert.match(wikiInspectorControllerJs, /setWikiStatus/);
  assert.match(wikiInspectorControllerJs, /renderWikiLists/);
  assert.match(wikiInspectorControllerJs, /applyWikiEntry/);
  assert.match(wikiInspectorControllerJs, /applyWikiProposal/);
  assert.match(wikiInspectorControllerJs, /loadWikiCatalog/);
  assert.match(wikiInspectorControllerJs, /loadWikiEntry/);
  assert.match(wikiInspectorControllerJs, /loadWikiProposal/);
  assert.match(wikiInspectorControllerJs, /refreshWikiHistory/);
  assert.match(wikiInspectorControllerJs, /submitWikiProposal/);
  assert.match(wikiInspectorControllerJs, /importWikiMarkdown/);
  assert.match(wikiInspectorControllerJs, /reviewWikiProposal/);
  assert.match(wikiInspectorControllerJs, /rollbackWikiEntry/);
  assert.match(wikiInspectorControllerJs, /bindWikiInspectorEvents/);
  assert.match(wikiInspectorControllerJs, /\/api\/wiki\/proposals/);
  assert.match(wikiInspectorControllerJs, /\/api\/wiki\/history/);
  assert.match(wikiInspectorControllerJs, /\/api\/wiki\/rollback/);
  assert.match(wikiInspectorControllerJs, /\/api\/wiki\/import-markdown/);
  assert.match(taskTraceControllerJs, /export function createTaskTraceController/);
  assert.match(taskTraceControllerJs, /renderTimeline/);
  assert.match(taskTraceControllerJs, /renderTaskSummary/);
  assert.match(taskTraceControllerJs, /hydrateTask/);
  assert.match(taskTraceControllerJs, /disconnectStream/);
  assert.match(taskTraceControllerJs, /connectStream/);
  assert.match(taskTraceControllerJs, /replayCurrentTask/);
  assert.match(taskTraceControllerJs, /exportTraceBundleCurrentTask/);
  assert.match(taskTraceControllerJs, /exportAuditSnapshotCurrentTask/);
  assert.match(taskTraceControllerJs, /loadCurrentTask/);
  assert.match(taskTraceControllerJs, /\/api\/stream/);
  assert.match(taskTraceControllerJs, /\/api\/replay/);
  assert.match(taskTraceControllerJs, /download=1/);
  assert.match(deliveryInspectorControllerJs, /buildDeliveriesEndpoint/);
  assert.match(deliveryInspectorControllerJs, /deliveryRefreshButton/);
  assert.match(deliveryInspectorControllerJs, /deliverySortOrder/);
  assert.match(consoleShellControllerJs, /exportTraceBundleButton/);
  assert.match(consoleShellControllerJs, /exportAuditSnapshotButton/);
  assert.match(approvalInspectorControllerJs, /approvalSelectedId/);
  assert.doesNotMatch(appJs, /\/api\/wiki\/import-markdown-batch/);
  assert.match(modelInspectorControllerJs, /fallback_chain/);
  assert.match(taskTraceControllerJs, /download=1/);
  assert.match(consoleShellControllerJs, /export function createConsoleShellController/);
  assert.match(consoleShellControllerJs, /loadRecentTasks/);
  assert.match(consoleShellControllerJs, /saveRecentTasks/);
  assert.match(consoleShellControllerJs, /rememberTask/);
  assert.match(consoleShellControllerJs, /renderPersonaSwitcher/);
  assert.match(consoleShellControllerJs, /setPersona/);
  assert.match(consoleShellControllerJs, /loadPersonaCatalog/);
  assert.match(consoleShellControllerJs, /renderInspectorTabs/);
  assert.match(consoleShellControllerJs, /renderRecentTasks/);
  assert.match(consoleShellControllerJs, /bindConsoleShellEvents/);
  assert.match(consoleShellControllerJs, /bootstrapConsoleShell/);
  assert.match(consoleShellControllerJs, /\/api\/personas/);
  assert.match(sharedRenderersJs, /export function createSharedRenderers/);
  assert.match(sharedRenderersJs, /renderValueSummary/);
  assert.match(sharedRenderersJs, /appendDraftKv/);
  assert.match(sharedRenderersJs, /appendDraftListSection/);
  assert.match(sharedRenderersJs, /appendDraftJsonSection/);
  assert.match(sharedRenderersJs, /renderKnowledgeFrontendDetail/);
  assert.match(sharedRenderersJs, /appendDraftTableSection/);
  assert.match(sharedRenderersJs, /createCompareValue/);
  assert.match(sharedRenderersJs, /appendCompareChecklistSection/);
  assert.match(sharedRenderersJs, /appendCompareFieldSummarySection/);
  assert.match(sharedRenderersJs, /appendCompareFieldDiffGroup/);
  assert.match(sharedRenderersJs, /appendSuiteComparisonSection/);
  assert.match(sharedRenderersJs, /appendWikiSuiteComparisonSection/);
  assert.match(sharedRenderersJs, /renderTextDetail/);
  assert.match(inspectorShellControllerJs, /export function createInspectorShellController/);
  assert.match(inspectorShellControllerJs, /setInspectorSummary/);
  assert.match(inspectorShellControllerJs, /renderSpecializedInspectorPanels/);
  assert.match(inspectorShellControllerJs, /normalizeInspectorPayload/);
  assert.match(inspectorShellControllerJs, /renderInspectorData/);
  assert.match(inspectorShellControllerJs, /loadInspector/);
  assert.match(inspectorShellControllerJs, /\/api\/tools/);
  assert.match(inspectorShellControllerJs, /\/api\/tasks\?/);
  assert.match(inspectorShellControllerJs, /\/api\/traces\/bundle/);
  assert.match(inspectorShellControllerJs, /\/api\/knowledge/);
  assert.match(inspectorShellControllerJs, /\/api\/memory/);
  assert.match(inspectorShellControllerJs, /\/api\/evaluations/);
  assert.match(inspectorShellControllerJs, /\/api\/reviews/);
  assert.match(inspectorShellControllerJs, /\/api\/approvals\?/);
  assert.match(inspectorShellControllerJs, /\/api\/multi-agent/);
  assert.match(inspectorShellControllerJs, /\/api\/context\/budget/);
  assert.match(inspectorShellControllerJs, /\/api\/rl/);
  assert.match(inspectorShellControllerJs, /\/api\/governance/);
  assert.match(taskActionsControllerJs, /export function createTaskActionsController/);
  assert.match(taskActionsControllerJs, /sendMessage/);
  assert.match(taskActionsControllerJs, /recoverCurrentTask/);
  assert.match(taskActionsControllerJs, /approveCurrentTask/);
  assert.match(taskActionsControllerJs, /takeoverCurrentTask/);
  assert.match(taskActionsControllerJs, /\/api\/messages/);
  assert.match(taskActionsControllerJs, /\/api\/tasks\/recover/);
  assert.match(taskActionsControllerJs, /\/api\/approvals\?/);
  assert.match(taskActionsControllerJs, /\/api\/approvals\/resolve/);
  assert.match(taskActionsControllerJs, /\/api\/tasks\/resume/);
  assert.match(taskActionsControllerJs, /\/api\/tasks\/takeover/);
});

test('server promotes durable memory for stable user instructions', async () => {
  const store = createStreamStore();
  await processInboundMessage({
    message_id: 'msg_test_memory_1',
    source_platform: 'web',
    source_message_id: 'raw_test_memory_1',
    workspace_id: 'ws_test',
    channel_id: 'console',
    conversation_id: 'conv_test_memory',
    sender: { id: 'user_1', role: 'user' },
    recipient: { id: 'agent_1', role: 'agent' },
    content: [{ type: 'text', text: '以后请始终用中文回答，并记住我喜欢简洁输出。' }],
    trace_id: 'trace_memory_test',
    persona_hint: 'researcher',
  }, store);

  const search = searchMemory('简洁输出');
  assert.ok(search.length > 0);
  assert.ok(search.some((entry) => entry.title.includes('中文回答')));
});

test('server memory retrieval honors workspace and persona scope', async () => {
  const store = createStreamStore();
  await processInboundMessage({
    message_id: 'msg_test_memory_scope_1',
    source_platform: 'web',
    source_message_id: 'raw_test_memory_scope_1',
    workspace_id: 'ws_scope_a',
    channel_id: 'console',
    conversation_id: 'conv_test_memory_scope',
    sender: { id: 'user_1', role: 'user' },
    recipient: { id: 'agent_1', role: 'agent' },
    content: [{ type: 'text', text: '以后请记住 AlphaMemoryScope 偏好，并始终保持简洁输出。' }],
    trace_id: 'trace_memory_scope_a',
    persona_hint: 'researcher',
  }, store);

  const scoped = searchMemory('AlphaMemoryScope', 4, {
    workspaceId: 'ws_scope_a',
    personaId: 'researcher',
    excludeStale: true,
  });
  const wrongWorkspace = searchMemory('AlphaMemoryScope', 4, {
    workspaceId: 'ws_scope_b',
    personaId: 'researcher',
    excludeStale: true,
  });
  const wrongPersona = searchMemory('AlphaMemoryScope', 4, {
    workspaceId: 'ws_scope_a',
    personaId: 'retriever',
    excludeStale: true,
  });
  const snapshot = getMemorySnapshot('trace_memory_scope_a');

  assert.ok(scoped.length > 0);
  assert.equal(scoped[0].workspace_id, 'ws_scope_a');
  assert.equal(scoped[0].persona_id, 'researcher');
  assert.equal(scoped[0].stale, false);
  assert.equal(wrongWorkspace.length, 0);
  assert.equal(wrongPersona.length, 0);
  assert.equal(snapshot.workspace_id, 'ws_scope_a');
  assert.equal(snapshot.persona_id, 'researcher');
  assert.ok(snapshot.requested_provider);
  assert.ok(snapshot.effective_provider);
  assert.ok(snapshot.runtime_summary);
  assert.equal(snapshot.runtime_summary.provider_mode, snapshot.effective_provider);
  assert.equal(snapshot.runtime_summary.short_term_count, snapshot.counts.short_term);
  assert.equal(snapshot.runtime_summary.long_term_count, snapshot.counts.long_term);
  assert.equal(snapshot.runtime_summary.short_term_persistence, 'markdown_archive');
  assert.ok(snapshot.linked_artifacts);
  assert.ok(Object.prototype.hasOwnProperty.call(snapshot.linked_artifacts, 'latest_handoff'));
  assert.ok(Object.prototype.hasOwnProperty.call(snapshot.linked_artifacts, 'latest_compression'));
  assert.ok(Object.prototype.hasOwnProperty.call(snapshot.linked_artifacts, 'short_term_archive'));
});

test('server queues manual review when quality gate blocks unsafe output', async () => {
  const store = createStreamStore();
  const result = await processInboundMessage({
    message_id: 'msg_test_review_1',
    source_platform: 'web',
    source_message_id: 'raw_test_review_1',
    workspace_id: 'ws_test',
    channel_id: 'console',
    conversation_id: 'conv_test_review',
    sender: { id: 'user_1', role: 'user' },
    recipient: { id: 'agent_1', role: 'agent' },
    content: [{ type: 'text', text: '请保留这个 sk-1234567890abcdef1234567890abcdef token 用于测试。' }],
    trace_id: 'trace_review_test',
    persona_hint: 'researcher',
  }, store);

  assert.equal(result.quality_gate.status, 'review_required');
  assert.equal(result.quality_gate.review_required, true);
  assert.match(result.review_url, /\/api\/reviews\?task_id=trace_review_test/);
  assert.match(result.run_state.output.final_text, /\[REDACTED:api_key\]/);
  assert.ok(!result.run_state.output.final_text.includes('sk-1234567890abcdef1234567890abcdef'));

  const evaluations = getEvaluationSnapshot('trace_review_test');
  assert.equal(evaluations.at(-1).decision, 'review');

  const reviews = getReviewSnapshot('trace_review_test');
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].review_status, 'pending');
  assert.equal(reviews[0].gate_status, 'review_required');

  const task = getTaskSnapshot('trace_review_test');
  assert.equal(task.metadata.quality_gate_status, 'review_required');
  assert.equal(task.metadata.review_required, true);
  assert.equal(task.metadata.review_id, reviews[0].review_id);
  assert.match(task.message.content_preview, /\[REDACTED:api_key\]/);
  assert.ok(!JSON.stringify(task).includes('sk-1234567890abcdef1234567890abcdef'));

  const governance = getGovernanceSnapshot('trace_review_test');
  assert.equal(governance.metrics.status, 'breached');
  assert.ok(governance.alerts.some((alert) => alert.code === 'quality_gate_breach'));
  assert.equal(governance.tool_governance.task_context.persona_id, 'researcher');
  assert.equal(governance.tool_governance.task_context.active_toolset_id, 'analysis_toolset');
  assert.ok(governance.tool_governance.catalog.total_tools >= 4);
  assert.ok(governance.tool_governance.alerts.by_category.slo >= 1);
  assert.ok(getAlertSnapshot('trace_review_test').length > 0);

  const traceEntries = getTraceEntries('trace_review_test');
  assert.ok(traceEntries.some((entry) => entry.kind === 'quality.gate_applied'));
  assert.ok(traceEntries.some((entry) => entry.kind === 'review.created'));
});

test('server can run an evaluation harness batch and persist the run', async () => {
  const run = await runEvaluationHarness([
    {
      case_id: 'harness_case_1',
      input: {
        message_id: 'msg_harness_1',
        source_platform: 'web',
        source_message_id: 'raw_harness_1',
        workspace_id: 'ws_harness',
        channel_id: 'console',
        conversation_id: 'conv_harness_1',
        sender: { id: 'user_1', role: 'user' },
        recipient: { id: 'agent_1', role: 'agent' },
        content: [{ type: 'text', text: 'hello world' }],
        trace_id: 'trace_harness_1',
        persona_hint: 'researcher',
      },
    },
    {
      case_id: 'harness_case_2',
      input: {
        message_id: 'msg_harness_2',
        source_platform: 'web',
        source_message_id: 'raw_harness_2',
        workspace_id: 'ws_harness',
        channel_id: 'console',
        conversation_id: 'conv_harness_2',
        sender: { id: 'user_1', role: 'user' },
        recipient: { id: 'agent_1', role: 'agent' },
        content: [{ type: 'text', text: '请告诉我最新版本和价格状态' }],
        trace_id: 'trace_harness_2',
        persona_hint: 'researcher',
      },
    },
  ], { suite: 'server-test' });

  const persisted = getHarnessRun(run.run_id);
  assert.equal(run.summary.case_count, 2);
  assert.equal(persisted.summary.case_count, 2);
  assert.equal(persisted.metadata.suite, 'server-test');
  assert.equal(run.case_results.length, 2);
  assert.ok(run.case_results.every((item) => item.trace_bundle.exists));
});

test('server can run a memory harness batch and persist the run', async () => {
  const run = await runMemoryHarness({
    preset: 'default_memory_suite',
    metadata: { suite: 'server-memory-test' },
  });

  const persisted = getHarnessRun(run.run_id);
  assert.equal(run.harness_type, 'memory');
  assert.equal(run.summary.case_count, 4);
  assert.equal(persisted.harness_type, 'memory');
  assert.equal(persisted.metadata.suite, 'server-memory-test');
  assert.ok(persisted.artifacts.review_json);
  assert.match(persisted.artifacts.review_markdown, /Memory Harness Review/);
  assert.ok(persisted.cases[0].reviewer_summary);
});

test('server can run a wiki harness batch and persist the run', async () => {
  const run = await runWikiHarness({
    preset: 'default_wiki_suite',
    metadata: { suite: 'server-wiki-test' },
  });

  const persisted = getHarnessRun(run.run_id);
  assert.equal(run.harness_type, 'wiki');
  assert.equal(run.summary.case_count, 14);
  assert.equal(persisted.harness_type, 'wiki');
  assert.equal(persisted.metadata.suite, 'server-wiki-test');
  assert.ok(persisted.artifacts.review_json);
  assert.match(persisted.artifacts.review_markdown, /Wiki Harness Review/);
  assert.ok(persisted.cases[0].query_frontend);
  assert.ok(persisted.cases[0].reviewer_summary);
});

test('server can run a knowledge harness batch and persist the run', async () => {
  const run = await runKnowledgeHarness({
    preset: 'default_knowledge_suite',
    metadata: { suite: 'server-knowledge-test' },
  });

  const persisted = getHarnessRun(run.run_id);
  assert.equal(run.harness_type, 'knowledge');
  assert.equal(run.summary.suite_count, 3);
  assert.equal(run.summary.case_count, 29);
  assert.equal(run.summary.generation_case_count, 11);
  assert.equal(run.summary.wiki_case_count, 14);
  assert.equal(run.summary.memory_case_count, 4);
  assert.equal(run.summary.generation_summary.expected_outcome_rate, 1);
  assert.equal(run.summary.generation_summary.expected_non_pass_guardrail_rate, 1);
  assert.equal(persisted.harness_type, 'knowledge');
  assert.equal(persisted.metadata.suite, 'server-knowledge-test');
  assert.ok(persisted.artifacts.review_json);
  assert.match(persisted.artifacts.review_markdown, /Knowledge Harness Review/);
  assert.ok(persisted.cases.find((item) => item.suite === 'generation')?.query_frontend);
  assert.ok(persisted.cases.find((item) => item.suite === 'wiki')?.reviewer_summary);
});

test('server can save a trace-derived wiki draft artifact', async () => {
  const store = createStreamStore();
  await processInboundMessage({
    message_id: 'msg_test_wiki_draft_1',
    source_platform: 'web',
    source_message_id: 'raw_test_wiki_draft_1',
    workspace_id: 'ws_test',
    channel_id: 'console',
    conversation_id: 'conv_test_wiki_draft',
    sender: { id: 'user_1', role: 'user' },
    recipient: { id: 'agent_1', role: 'agent' },
    content: [{ type: 'text', text: '请告诉我当前 DeepSeek 的版本和价格状态。' }],
    trace_id: 'trace_test_wiki_draft_1',
    persona_hint: 'researcher',
  }, store);

  const draftDir = mkdtempSync(join(tmpdir(), 'toukeagent-server-wiki-draft-'));
  try {
    const saved = await saveWikiHarnessDraftArtifact('trace_test_wiki_draft_1', {
      caseId: 'trace_test_wiki_draft_1_trace_wiki_case',
      outputPath: `${draftDir}/trace_test_wiki_draft_1_trace_wiki_case.json`,
    });

    assert.match(saved.file_path, /trace_test_wiki_draft_1_trace_wiki_case\.json$/);
    const artifact = JSON.parse(readFileSync(saved.file_path, 'utf8'));
    assert.equal(artifact.artifact_type, 'wiki_harness_case_draft');
    assert.equal(artifact.summary.selected_case_count, 1);
    assert.equal(artifact.cases[0].metadata.domain, 'wiki');
  } finally {
    rmSync(draftDir, { recursive: true, force: true });
  }
});

test('server can promote and inspect wiki candidate suites', async () => {
  const store = createStreamStore();
  await processInboundMessage({
    message_id: 'msg_test_wiki_candidate_1',
    source_platform: 'web',
    source_message_id: 'raw_test_wiki_candidate_1',
    workspace_id: 'ws_test',
    channel_id: 'console',
    conversation_id: 'conv_test_wiki_candidate',
    sender: { id: 'user_1', role: 'user' },
    recipient: { id: 'agent_1', role: 'agent' },
    content: [{ type: 'text', text: '请告诉我当前 DeepSeek 的价格状态和主数据源。' }],
    trace_id: 'trace_test_wiki_candidate_1',
    persona_hint: 'researcher',
  }, store);

  const promoteDir = mkdtempSync(join(tmpdir(), 'toukeagent-wiki-draft-promote-'));
  try {
    const promoted = await promoteWikiHarnessDraftArtifactToSuite('trace_test_wiki_candidate_1', {
      caseId: 'trace_test_wiki_candidate_1_trace_wiki_case',
      suitePath: `${promoteDir}/wiki-candidate-suite.json`,
      suiteName: 'wiki-candidate-suite',
    });

    assert.match(promoted.file_path, /wiki-candidate-suite\.json$/);
    assert.equal(promoted.summary.promoted_case_count, 1);
    assert.deepEqual(promoted.summary.added_case_ids, ['trace_test_wiki_candidate_1_trace_wiki_case']);

    const listedSuites = listWikiCandidateSuites({
      rootPath: promoteDir.replace(`${process.cwd()}/`, ''),
    });
    assert.ok(listedSuites.some((item) => item.relative_path === promoted.relative_path));

    const detail = await getWikiCandidateSuite(promoted.relative_path);
    assert.equal(detail.suite_id, 'wiki-candidate-suite');
    assert.ok(detail.cases.some((item) => item.case_id === 'trace_test_wiki_candidate_1_trace_wiki_case'));

    const run = await runWikiHarness({
      casePath: promoted.relative_path,
      metadata: { suite: 'wiki-candidate-suite-run' },
    });
    assert.equal(run.harness_type, 'wiki');
    assert.equal(run.summary.case_count, 1);

    const compareCase = await compareWikiCandidateSuiteWithObservedRun(promoted.relative_path, {
      caseId: 'trace_test_wiki_candidate_1_trace_wiki_case',
    });
    assert.equal(compareCase.comparison.case_id, 'trace_test_wiki_candidate_1_trace_wiki_case');
    assert.equal(compareCase.comparison.observed_exists, true);
    assert.ok(compareCase.comparison.field_diff_summary.reference.total >= 1);

    const compareSuite = await compareWikiCandidateSuiteWithObservedRun(promoted.relative_path);
    assert.equal(compareSuite.comparison.case_count, 1);
    assert.ok(compareSuite.comparison.comparisons[0].field_diff_summary.reference.total >= 1);
  } finally {
    rmSync(promoteDir, { recursive: true, force: true });
  }
});

test('server replay and recovery interfaces persist drill records', async () => {
  const store = createStreamStore();
  await processInboundMessage({
    message_id: 'msg_test_recover_1',
    source_platform: 'web',
    source_message_id: 'raw_test_recover_1',
    workspace_id: 'ws_test',
    channel_id: 'console',
    conversation_id: 'conv_test_recover',
    sender: { id: 'user_1', role: 'user' },
    recipient: { id: 'agent_1', role: 'agent' },
    content: [{ type: 'text', text: '请回放并恢复这个任务。' }],
    trace_id: 'trace_recover_test',
    persona_hint: 'researcher',
  }, store);

  const replay = replayTaskExecution('trace_recover_test');
  assert.ok(replay.stream_events.length > 0);

  const recovered = await recoverTaskExecution({
    taskId: 'trace_recover_test',
    mode: 'restart',
    reviewerId: 'operator_1',
    notes: 'recovery drill',
  });

  assert.ok(recovered.recovery_drill);
  assert.ok(getRecoveryDrillSnapshot('trace_recover_test').length > 0);
  assert.equal(getDeadLetterSnapshot('trace_recover_test').length, 0);
});

test('server recovers dead-letter task from latest checkpoint', async () => {
  const store = createStreamStore();
  registerPlatformWorkerHandler('test.worker.recover.once', async ({ query }) => ({
    call_id: 'call_recover_once',
    status: 'success',
    summary: `retrieved ${query}`,
    result: {
      hits: [{ id: 'doc_1', title: `Doc for ${query}` }],
    },
    metrics: { latency_ms: 2 },
  }));

  const message = {
    message_id: 'msg_recover_dead_letter_1',
    source_platform: 'web',
    source_message_id: 'raw_recover_dead_letter_1',
    workspace_id: 'ws_recover_dead_letter',
    channel_id: 'console',
    conversation_id: 'conv_recover_dead_letter_1',
    sender: { id: 'user_1', role: 'user' },
    recipient: { id: 'agent_1', role: 'agent' },
    content: [{ type: 'text', text: 'Please recover this dead-letter task from checkpoint.' }],
    trace_id: 'trace_recover_dead_letter_1',
    persona_hint: 'researcher',
  };

  const taskId = message.trace_id;
  const task = getTaskSnapshot(taskId);
  task.message_snapshot = message;
  task.plan = {
    plan_id: 'plan_recover_dead_letter_1',
    goal: 'Recover task',
    summary: 'Recover task',
    steps: [
      {
        step_id: 'step_1',
        title: 'Retrieve docs',
        objective: 'Retrieve docs',
        kind: 'tool',
        tool_name: 'hybrid_retrieve',
        status: 'pending',
      },
      {
        step_id: 'step_2',
        title: 'Respond',
        objective: 'Compose response',
        kind: 'respond',
        status: 'pending',
      },
    ],
  };
  task.persona_id = 'researcher';
  task.run_state = {
    run_id: `run_${taskId}`,
    task_id: taskId,
    trace_id: taskId,
    persona_id: 'researcher',
    plan_id: task.plan.plan_id,
    status: 'running',
    current_step_id: 'step_1',
    completed_steps: 0,
    total_steps: 2,
    step_results: [],
    output: null,
  };

  const deadLetter = {
    dead_letter_id: 'dlq_recover_dead_letter_1',
    task_id: taskId,
    trace_id: taskId,
    status: 'open',
    reason: 'worker_tool_failed',
    replayable: true,
    payload: {
      task,
      error: { message: 'worker tool failed previously' },
    },
    metadata: {
      task_status: 'running',
      task_phase: 'step_start',
      current_step_id: 'step_1',
    },
  };

  const { server } = createPlatformServer();
  const handler = server.listeners('request')[0];

  async function invoke({ method, url, body = null, headers = {} }) {
    const response = {
      statusCode: 0,
      headers: {},
      chunks: [],
      writeHead(statusCode, responseHeaders) {
        this.statusCode = statusCode;
        this.headers = responseHeaders ?? {};
      },
      write(chunk) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return true;
      },
      end(chunk) {
        if (chunk !== undefined) {
          this.write(chunk);
        }
        this.finished = true;
      },
    };

    const request = {
      method,
      url,
      headers,
      on() {},
      async *[Symbol.asyncIterator]() {
        if (body !== null) {
          yield Buffer.from(JSON.stringify(body));
        }
      },
    };

    await handler(request, response);
    return {
      statusCode: response.statusCode,
      body: Buffer.concat(response.chunks).toString('utf8'),
      headers: response.headers,
    };
  }

  await invoke({
    method: 'POST',
    url: '/api/dead-letters',
    body: deadLetter,
    headers: { 'content-type': 'application/json' },
  });

  const recoverResponse = await invoke({
    method: 'POST',
    url: '/api/tasks/recover',
    body: {
      task_id: taskId,
      mode: 'resume',
      reviewer_id: 'operator_recover',
      notes: 'recover from dead-letter checkpoint',
    },
    headers: { 'content-type': 'application/json' },
  });

  assert.equal(recoverResponse.statusCode, 200);
  const recovered = JSON.parse(recoverResponse.body);
  assert.equal(recovered.recovered_from_dead_letter, true);
  assert.equal(recovered.run_state.status, 'completed');
  assert.ok(recovered.run_state.output.final_text);
  assert.equal(recovered.dead_letter.status, 'replayed');
  assert.equal(recovered.dead_letter.metadata.task_recovery_status, 'completed');
  assert.ok(getRecoveryDrillSnapshot(taskId).length > 0);
});

test('server recovers dead-letter task into approval checkpoint when resumed step still needs approval', async () => {
  const taskId = 'trace_recover_dead_letter_approval_1';
  const message = {
    message_id: 'msg_recover_dead_letter_approval_1',
    source_platform: 'web',
    source_message_id: 'raw_recover_dead_letter_approval_1',
    workspace_id: 'ws_recover_dead_letter_approval',
    channel_id: 'console',
    conversation_id: 'conv_recover_dead_letter_approval_1',
    sender: { id: 'user_1', role: 'user' },
    recipient: { id: 'agent_1', role: 'agent' },
    content: [{ type: 'text', text: 'Please recover approval-gated dead-letter task.' }],
    trace_id: taskId,
    persona_hint: 'researcher',
  };

  const task = getTaskSnapshot(taskId);
  task.message_snapshot = message;
  task.plan = {
    plan_id: 'plan_recover_dead_letter_approval_1',
    goal: 'Recover approval task',
    summary: 'Recover approval task',
    steps: [
      {
        step_id: 'step_1',
        title: 'Approve risky action',
        objective: 'Run approval sensitive tool',
        kind: 'tool',
        tool_name: 'approval_sensitive_tool',
        status: 'pending',
      },
      {
        step_id: 'step_2',
        title: 'Respond',
        objective: 'Compose response',
        kind: 'respond',
        status: 'pending',
      },
    ],
  };
  task.persona_id = 'researcher';
  task.run_state = {
    run_id: `run_${taskId}`,
    task_id: taskId,
    trace_id: taskId,
    persona_id: 'researcher',
    plan_id: task.plan.plan_id,
    status: 'running',
    current_step_id: 'step_1',
    completed_steps: 0,
    total_steps: 2,
    step_results: [],
    output: null,
  };

  const deadLetter = {
    dead_letter_id: 'dlq_recover_dead_letter_approval_1',
    task_id: taskId,
    trace_id: taskId,
    status: 'open',
    reason: 'worker_tool_failed',
    replayable: true,
    payload: {
      task,
      error: { message: 'approval sensitive worker failed previously' },
    },
    metadata: {
      task_status: 'running',
      task_phase: 'step_start',
      current_step_id: 'step_1',
    },
  };

  const { server } = createPlatformServer();
  const handler = server.listeners('request')[0];

  async function invoke({ method, url, body = null, headers = {} }) {
    const response = {
      statusCode: 0,
      headers: {},
      chunks: [],
      writeHead(statusCode, responseHeaders) {
        this.statusCode = statusCode;
        this.headers = responseHeaders ?? {};
      },
      write(chunk) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return true;
      },
      end(chunk) {
        if (chunk !== undefined) {
          this.write(chunk);
        }
        this.finished = true;
      },
    };

    const request = {
      method,
      url,
      headers,
      on() {},
      async *[Symbol.asyncIterator]() {
        if (body !== null) {
          yield Buffer.from(JSON.stringify(body));
        }
      },
    };

    await handler(request, response);
    return {
      statusCode: response.statusCode,
      body: Buffer.concat(response.chunks).toString('utf8'),
      headers: response.headers,
    };
  }

  await invoke({
    method: 'POST',
    url: '/api/dead-letters',
    body: deadLetter,
    headers: { 'content-type': 'application/json' },
  });

  const recoverResponse = await invoke({
    method: 'POST',
    url: '/api/tasks/recover',
    body: {
      task_id: taskId,
      mode: 'resume',
      reviewer_id: 'operator_approval',
      notes: 'recover into approval checkpoint',
    },
    headers: { 'content-type': 'application/json' },
  });

  assert.equal(recoverResponse.statusCode, 200);
  const recovered = JSON.parse(recoverResponse.body);
  assert.equal(recovered.recovered_from_dead_letter, true);
  assert.equal(recovered.approval_required, true);
  assert.ok(recovered.approval_review);
  assert.equal(recovered.dead_letter.status, 'replayed');
  assert.equal(recovered.dead_letter.metadata.task_recovery_status, 'paused');
});

test('server pauses for approval, supports takeover, and resumes execution', async () => {
  const store = createStreamStore();
  const result = await processInboundMessage({
    message_id: 'msg_test_approval_1',
    source_platform: 'web',
    source_message_id: 'raw_test_approval_1',
    workspace_id: 'ws_test',
    channel_id: 'console',
    conversation_id: 'conv_test_approval',
    sender: { id: 'user_1', role: 'user' },
    recipient: { id: 'agent_1', role: 'agent' },
    content: [{ type: 'text', text: '请先审批这个高风险操作，然后继续执行。' }],
    trace_id: 'trace_approval_test',
    persona_hint: 'researcher',
  }, store);

  assert.equal(result.approval_required, true);
  assert.equal(result.run_state.status, 'waiting_approval');
  assert.equal(result.plan.steps.length, 4);
  assert.equal(result.plan.steps[1].tool_name, 'approval_sensitive_tool');
  assert.match(result.resume_url, /\/api\/tasks\/resume\?task_id=trace_approval_test/);

  const approvalQueue = getApprovalSnapshot('trace_approval_test');
  assert.equal(approvalQueue.length, 1);
  assert.equal(approvalQueue[0].queue_name, 'approval');
  assert.equal(approvalQueue[0].review_status, 'pending');
  assert.ok(approvalQueue[0].preview);
  assert.equal(approvalQueue[0].preview.paused_step.tool_name, 'approval_sensitive_tool');
  assert.ok(approvalQueue[0].preview.changes.some((change) => change.field === 'task.control_state'));

  const taskBeforeResume = getTaskSnapshot('trace_approval_test');
  assert.equal(taskBeforeResume.status, 'waiting_approval');
  assert.equal(taskBeforeResume.metadata.control_state, 'waiting_approval');
  assert.equal(taskBeforeResume.metadata.approval_review_id, approvalQueue[0].review_id);

  const { server } = createPlatformServer();
  const handler = server.listeners('request')[0];
  const approvalResponse = await (async () => {
    const response = {
      statusCode: 0,
      headers: {},
      chunks: [],
      writeHead(statusCode, responseHeaders) {
        this.statusCode = statusCode;
        this.headers = responseHeaders ?? {};
      },
      write(chunk) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return true;
      },
      end(chunk) {
        if (chunk !== undefined) {
          this.write(chunk);
        }
        this.finished = true;
      },
    };

    const request = {
      method: 'GET',
      url: '/api/approvals?task_id=trace_approval_test',
      headers: {},
      on() {},
      async *[Symbol.asyncIterator]() {},
    };

    await handler(request, response);
    return {
      statusCode: response.statusCode,
      body: Buffer.concat(response.chunks).toString('utf8'),
      headers: response.headers,
    };
  })();
  assert.equal(approvalResponse.statusCode, 200);
  const approvalPayload = JSON.parse(approvalResponse.body);
  assert.equal(approvalPayload.items.length, 1);
  assert.equal(approvalPayload.preview.paused_step.tool_name, 'approval_sensitive_tool');
  assert.equal(approvalPayload.items[0].preview.review_id, approvalPayload.items[0].review_id);

  const takeover = await takeoverTaskExecution({
    taskId: 'trace_approval_test',
    reviewerId: 'operator_1',
    notes: 'Human takeover before resuming',
  });
  assert.equal(takeover.task.status, 'taken_over');

  const resumed = await resumeTaskExecution({
    taskId: 'trace_approval_test',
    reviewerId: 'operator_1',
    notes: 'Approved after takeover',
  });

  assert.equal(resumed.run_state.status, 'completed');
  assert.equal(resumed.quality_gate.status, 'passed');
  assert.match(resumed.run_state.output.final_text, /Retrieval route:/);

  const approvalQueueAfter = getApprovalSnapshot('trace_approval_test');
  assert.equal(approvalQueueAfter[0].review_status, 'approved');

  const taskAfterResume = getTaskSnapshot('trace_approval_test');
  assert.equal(taskAfterResume.status, 'completed');
  assert.equal(taskAfterResume.metadata.control_state, 'automated');
  assert.equal(taskAfterResume.metadata.approval_required, false);

  const governance = getGovernanceSnapshot('trace_approval_test');
  assert.equal(governance.metrics.status, 'ok');
  assert.equal(governance.alerts.length, 0);
  assert.equal(governance.tool_governance.task_context.persona_id, 'researcher');
  assert.equal(governance.tool_governance.task_context.active_toolset_id, 'analysis_toolset');
  assert.equal(governance.tool_governance.runtime.blocked_tool_result_count, 1);
  assert.equal(governance.tool_governance.runtime.blocked_tool_error_codes.approval_required, 1);
  assert.equal(governance.tool_governance.runtime.sandbox_blocked_tool_result_count, 1);
  assert.equal(governance.tool_governance.sandbox.blocked_count, 1);
  assert.equal(governance.tool_governance.sandbox.filesystem_scope, 'none');
  assert.ok(governance.tool_governance.enforcement.projected.allowed_tool_count >= 1);
});
