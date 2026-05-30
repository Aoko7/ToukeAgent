import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { callPythonCore } from '../apps/platform/src/python-core-bridge.mjs';
import { createPlanner } from '../apps/platform/src/planner.mjs';
import { createPersonaRegistry } from '../apps/platform/src/persona-registry.mjs';
import { createResponseComposer } from '../apps/platform/src/response-composer.mjs';

test('python core exposes packaging metadata and direct module entrypoint', () => {
  const pyprojectPath = resolve(process.cwd(), 'pyproject.toml');

  assert.equal(existsSync(pyprojectPath), true);
  const pyproject = readFileSync(pyprojectPath, 'utf8');
  assert.match(pyproject, /\[project\]/);
  assert.match(pyproject, /name = "toukeagent-core"/);
  assert.match(pyproject, /requires-python = ">=3\.11"/);
  assert.match(pyproject, /\[project\.scripts\]/);
  assert.match(pyproject, /toukeagent-core = "toukeagent_core\.cli:main"/);

  const result = spawnSync('python3', ['-m', 'toukeagent_core', '--action', 'create_plan', '--payload', '{}'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.meta.runtime, 'python');
  assert.ok(envelope.result.plan_id);
});

test('python core bridge returns route decisions', () => {
  const route = callPythonCore('choose_retrieval_route', {
    query: '请告诉我最新版本和价格',
  });
  const stableRoute = callPythonCore('choose_retrieval_route', {
    query: '请介绍当前的多Agent协调策略与RAG路线',
  });

  assert.equal(route.mode, 'wiki-first');
  assert.ok(route.matched_hints.includes('最新'));
  assert.equal(stableRoute.mode, 'rag-first');
  assert.ok(stableRoute.matched_stable_hints.includes('策略'));
});

test('python core retrieval result exposes hybrid rag skeleton fields', () => {
  const result = callPythonCore('retrieve', {
    query: '请告诉我最新版本和价格状态',
    persona_id: 'researcher',
    filters: {
      conference_id: ['acl'],
    },
    filter_policy: {
      mode: 'soft_prefer',
    },
    stable_items: [{
      doc_id: 'doc_1',
      chunk_id: 'chunk_1',
      title: 'Architecture overview',
      source_type: 'rag',
      freshness: 'stable',
      text: 'Architecture excerpt',
      metadata: {
        conference_id: 'acl',
      },
    }],
    dynamic_items: [{
      entry_id: 'wiki_1',
      title: 'DeepSeek provider profile',
      source_type: 'wiki',
      freshness: 'dynamic',
      metadata: {
        conference_id: 'acl',
      },
    }],
  });

  assert.equal(result.route.mode, 'wiki-first');
  assert.equal(result.query_analysis.filter_hints.freshness, 'dynamic');
  assert.ok(result.query_analysis.filter_hints.entity_tags.includes('pricing'));
  assert.equal(result.retrieval_plan.implementation_status, 'scaffolded');
  assert.ok(result.retrieval_plan.rag.channels.some((item) => item.name === 'semantic'));
  assert.ok(result.retrieval_plan.rag.channels.some((item) => item.name === 'bm25'));
  assert.equal(result.retrieval_plan.filter_plan.mode, 'hard_enforce');
  assert.deepEqual(result.requested_filters, { conference_id: ['acl'] });
  assert.deepEqual(result.effective_filters, { conference_id: ['acl'] });
  assert.equal(result.filter_policy.mode, 'hard_enforce');
  assert.equal(result.filter_policy.hard_enforce_reason, 'explicit_filters');
  assert.equal(result.retrieval_plan.embedding_strategy.same_space_required, true);
  assert.equal(result.retrieval_plan.embedding_strategy.primary_model, 'intfloat/multilingual-e5-base');
  assert.equal(result.retrieval_plan.embedding_strategy.vector_backend.kind, 'qdrant_local');
  assert.ok(Array.isArray(result.doc_aggregates));
  assert.ok(Array.isArray(result.supporting_chunks));
  assert.ok(result.items[0].supporting_chunks.length >= 1);
  assert.equal(result.citations[0].knowledge_contract.contract_source, 'default_injected');
  assert.ok(Array.isArray(result.citations[0].required_context));
});

test('python core retrieval surfaces hard_filter_empty when explicit filters eliminate all candidates', () => {
  const result = callPythonCore('retrieve', {
    query: '只看 ACL 2024 的版本状态',
    persona_id: 'researcher',
    stable_items: [
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
    dynamic_items: [],
  });

  assert.equal(result.filter_policy.hard_filter_empty, true);
  assert.equal(result.filter_policy.hard_filter_empty_reason, 'scope_candidate_empty');
  assert.equal(result.filter_policy.recovered_soft_prefer, true);
  assert.equal(result.filter_policy.mode, 'soft_prefer');
  assert.equal(result.filter_policy.fallback_reason, 'hard_filter_empty_soft_prefer_recovery');
  assert.equal(result.route.fallback_applied, false);
  assert.equal(result.route.fallback_reason, null);
  assert.equal(result.raw_items.length, 1);
  assert.equal(result.quality.recommended_action, 'supplement_wiki');
});

test('python core retrieval upgrades query-inferred explicit scope into hard enforce', () => {
  const result = callPythonCore('retrieve', {
    query: '只看 ACL 2024 的版本状态',
    persona_id: 'researcher',
    stable_items: [
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
    dynamic_items: [],
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

test('python core retrieval recommends clarify when hard-filter recovery still lacks explicit subject reference', () => {
  const result = callPythonCore('retrieve', {
    query: '这个只看 ACL 2024 的版本状态',
    persona_id: 'researcher',
    stable_items: [
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
    dynamic_items: [],
  });

  assert.equal(result.filter_policy.hard_filter_empty, true);
  assert.equal(result.filter_policy.hard_filter_empty_reason, 'scope_candidate_empty');
  assert.equal(result.filter_policy.recovered_soft_prefer, true);
  assert.equal(result.query_analysis.clarification.required, true);
  assert.equal(result.query_analysis.boundary.action, 'clarify');
  assert.equal(result.quality.recommended_action, 'clarify');
});

test('python core retrieval decomposes comparison queries into source-aware subqueries', () => {
  const result = callPythonCore('retrieve', {
    query: 'compare fine tuning and retrieval for injecting new factual knowledge into llms',
    persona_id: 'researcher',
    stable_items: [
      {
        doc_id: 'doc_compare_1',
        chunk_id: 'chunk_compare_1',
        title: 'Fine-Tuning or Retrieval?',
        source_type: 'rag',
        freshness: 'stable',
        text: 'Compare fine tuning and retrieval for knowledge injection.',
      },
    ],
    dynamic_items: [],
  });

  assert.equal(result.query_analysis.query_mode, 'compare');
  assert.equal(result.query_analysis.decomposition.strategy, 'comparison_split');
  assert.equal(result.query_analysis.boundary.action, 'decompose');
  assert.equal(result.query_analysis.decomposition.subqueries.length, 2);
  assert.equal(result.query_analysis.decomposition.subqueries[0].preferred_source, 'rag');
  assert.equal(result.query_analysis.decomposition.subqueries[1].preferred_source, 'rag');
  assert.equal(result.query_analysis.rewrites.variants.length, 2);
  assert.match(result.query_analysis.rewrites.variants[0].text, /injecting new factual knowledge into llms/i);
  assert.equal(result.retrieval_plan.query_frontend.query_mode, 'compare');
  assert.equal(result.retrieval_plan.query_frontend.subquery_count, 2);
  assert.equal(result.retrieval_plan.query_frontend.rewrite_count, 2);
});

test('python core retrieval decomposes procedure queries into anchored action steps', () => {
  const result = callPythonCore('retrieve', {
    query: 'how does MAGE detect machine-generated deepfake text in the wild and explain ppl cue',
    persona_id: 'researcher',
    stable_items: [
      {
        doc_id: 'doc_mage_1',
        chunk_id: 'chunk_mage_1',
        title: 'MAGE: Machine-generated Text Detection in the Wild',
        source_type: 'rag',
        freshness: 'stable',
        text: 'MAGE detects machine-generated deepfake text and explains perplexity cues.',
      },
    ],
    dynamic_items: [],
  });

  assert.equal(result.query_analysis.query_mode, 'procedure');
  assert.equal(result.query_analysis.decomposition.strategy, 'procedure_split');
  assert.equal(result.query_analysis.decomposition.subqueries.length, 2);
  assert.match(result.query_analysis.decomposition.subqueries[0].query_text, /^how does MAGE detect/i);
  assert.match(result.query_analysis.decomposition.subqueries[1].query_text, /^how does MAGE explain/i);
  assert.ok(result.query_analysis.rewrites.variants.every((item) => /workflow steps/i.test(item.text)));
  assert.equal(result.retrieval_plan.query_frontend.boundary_action, 'decompose');
});

test('python core graph orchestrator returns graph state and node events', () => {
  const result = callPythonCore('run_orchestrator_graph', {
    message: {
      trace_id: 'trace_graph_1',
      content: [{ type: 'text', text: '请告诉我最新版本和价格状态' }],
    },
    persona: {
      persona_id: 'researcher',
      name: 'Researcher',
      purpose: 'Design careful systems',
    },
    plan: {
      plan_id: 'plan_graph_1',
      goal: 'Answer with grounded evidence',
      steps: [{ title: 'Route retrieval' }, { title: 'Compose response' }],
    },
    stable_items: [{ doc_id: 'doc_1', chunk_id: 'chunk_1', title: 'Architecture overview', source_type: 'rag', freshness: 'stable', text: 'Architecture excerpt' }],
    dynamic_items: [{ entry_id: 'wiki_1', title: 'DeepSeek provider profile', source_type: 'wiki', freshness: 'dynamic' }],
    filters: {
      conference_id: ['acl'],
    },
    filter_policy: {
      mode: 'soft_prefer',
    },
  });

  assert.equal(result.executor_backend, 'compat_graph_runner');
  assert.equal(result.graph_state.runtime.executor_backend, 'compat_graph_runner');
  assert.equal(result.graph_state.retrieval.filter_policy.hard_enforce_reason, 'explicit_filters');
  assert.equal(result.graph_state.retrieval.filter_policy.mode, 'soft_prefer');
  assert.deepEqual(result.graph_state.retrieval.requested_filters, { conference_id: ['acl'] });
  assert.ok(Array.isArray(result.node_events));
  assert.ok(result.node_events.some((event) => event.node_name === 'prepare_request' && event.event_type === 'node_started'));
  assert.ok(result.node_events.some((event) => event.node_name === 'evaluate_quality_gate' && event.event_type === 'node_completed'));
  assert.equal(typeof result.result.answer, 'string');
});

test('python core exposes wiki evaluation suite entrypoint', () => {
  const result = callPythonCore('evaluate_wiki_suite', {
    cases: [
      {
        case_id: 'wiki_core_bridge_case',
        payload: {
          query: '请告诉我当前版本和价格状态',
          persona_id: 'researcher',
          dynamic_items: [{ entry_id: 'wiki_1', title: 'DeepSeek provider profile', source_type: 'wiki', freshness: 'dynamic' }],
        },
        reference: {
          expected_route_mode: 'wiki-first',
          expected_effective_mode: 'wiki-first',
          expected_fallback_applied: false,
          min_retrieval_score: 0.5,
        },
        metadata: {
          domain: 'wiki',
          route_family: 'wiki-first',
        },
      },
    ],
    metadata: {
      suite_name: 'python-core-wiki-bridge',
    },
  });

  assert.equal(result.metadata.suite_name, 'python-core-wiki-bridge');
  assert.equal(result.summary.case_count, 1);
  assert.equal(result.cases[0].case_id, 'wiki_core_bridge_case');
  assert.equal(result.cases[0].judge.route.actual_route_mode, 'wiki-first');
});

test('python core compose_draft packs supporting evidence, quality hints, and clarification signals', () => {
  const draft = callPythonCore('compose_draft', {
    persona: {
      name: 'Researcher',
      purpose: 'Design careful systems',
    },
    message: {
      content: [{ type: 'text', text: '这个现在是什么版本？' }],
    },
    plan: {
      goal: 'Answer with grounded evidence',
      steps: [
        { title: 'Analyze request' },
        { title: 'Route retrieval' },
        { title: 'Compose response' },
      ],
    },
    retrievalResult: {
      route: {
        mode: 'wiki-first',
        effective_mode: 'wiki-first',
        fallback_applied: false,
      },
      query_analysis: {
        query_mode: 'status_lookup',
        boundary: { action: 'clarify' },
        clarification: {
          required: true,
          questions: ['你具体指的是哪个产品或平台？'],
        },
      },
      retrieval_plan: {
        response_policy: {
          max_parent_items: 1,
          max_supporting_chunks_per_item: 1,
          max_supporting_chunks_total: 1,
          max_snippet_chars: 72,
          max_evidence_chars: 220,
        },
      },
      items: [
        {
          title: 'DeepSeek release notes',
          source_type: 'wiki',
          freshness: 'dynamic',
          aggregate_score: 0.97,
          supporting_chunks: [
            {
              chunk_id: 'wiki_chunk_1',
              section_path: ['Release notes'],
              score: 0.96,
              snippet: 'DeepSeek V4 is now the default production model and pricing was refreshed for API traffic. TAIL_NEVER_SHOULD_APPEAR',
            },
          ],
        },
        {
          title: 'Architecture overview',
          source_type: 'rag',
          freshness: 'stable',
          aggregate_score: 0.85,
          supporting_chunks: [
            {
              chunk_id: 'rag_chunk_1',
              section_path: ['Overview'],
              score: 0.84,
              snippet: 'Plan-to-Act coordinates retrieval before composition.',
            },
          ],
        },
      ],
      citations: [
        {
          title: 'DeepSeek release notes',
          source_type: 'wiki',
          freshness: 'dynamic',
          score: 0.96,
        },
      ],
      quality: {
        retrieval_score: 0.66,
        citation_score: 0.74,
        route_alignment_score: 0.81,
        recommended_action: 'supplement_wiki',
      },
    },
    memorySnapshot: {
      short_term: [{ summary: 'user asked about version status' }],
      long_term: [{ title: 'DeepSeek provider profile' }],
    },
  });

  assert.match(draft.content, /Boundary action: clarify/);
  assert.match(draft.content, /Clarification questions: 你具体指的是哪个产品或平台/);
  assert.match(draft.content, /Evidence pack:/);
  assert.match(draft.content, /DeepSeek release notes/);
  assert.match(draft.messages[1].content, /Recommended action: supplement_wiki/);
  assert.match(draft.messages[1].content, /Grounding mode: compact_evidence_pack/);
  assert.doesNotMatch(draft.messages[1].content, /TAIL_NEVER_SHOULD_APPEAR/);
  assert.doesNotMatch(draft.messages[1].content, /Architecture overview/);
});

test('python core resolves persona packs and specialist suggestions', () => {
  const registry = createPersonaRegistry();
  const plannerPersona = registry.get('planner');
  const retrieverPersona = registry.get('retriever');
  const writerPersona = registry.get('writer');
  const fallbackPersona = registry.get('missing-persona');
  const packs = callPythonCore('list_persona_packs', {});
  const suggestions = callPythonCore('suggest_specialists', {
    plan: {
      goal: 'Delegate and review',
      steps: [
        { step_id: 'step_1', title: 'Route knowledge retrieval', tool_name: 'hybrid_retrieve' },
        { step_id: 'step_2', title: 'Compose response', kind: 'respond' },
      ],
    },
    message_text: 'please review this delegated task',
  });

  assert.equal(plannerPersona.persona_id, 'planner');
  assert.equal(retrieverPersona.metadata.pack_id, 'analysis_pack');
  assert.equal(writerPersona.persona_id, 'writer');
  assert.equal(fallbackPersona.persona_id, 'researcher');
  assert.equal(Array.isArray(registry.list()), true);
  assert.ok(packs.some((pack) => pack.pack_id === 'analysis_pack'));
  assert.ok(registry.list().some((persona) => persona.persona_id === 'planner'));
  assert.ok(registry.list().some((persona) => persona.persona_id === 'retriever'));
  assert.ok(suggestions.some((item) => item.role === 'retriever' && item.persona_id === 'retriever'));
  assert.ok(suggestions.some((item) => item.role === 'reviewer'));
  assert.ok(suggestions.every((item) => item.persona_pack_id));
});

test('python core builds approval review payloads and handoff aggregates', () => {
  const approvalPreview = callPythonCore('build_approval_preview', {
    task: {
      task_id: 'task_approval_bridge',
      trace_id: 'task_approval_bridge',
      status: 'waiting_approval',
      phase: 'waiting_approval',
      persona_id: 'researcher',
      plan_id: 'plan_bridge_1',
      current_step_id: 'step_2',
      completed_steps: 1,
      total_steps: 3,
      metadata: {
        control_state: 'waiting_approval',
        approval_required: true,
        paused_step_id: 'step_2',
        paused_tool_name: 'approval_sensitive_tool',
      },
      plan: {
        steps: [
          { step_id: 'step_1', title: 'Understand request', kind: 'analysis' },
          { step_id: 'step_2', title: 'Approve write', kind: 'tool', tool_name: 'approval_sensitive_tool' },
          { step_id: 'step_3', title: 'Respond', kind: 'respond' },
        ],
      },
    },
    review: {
      review_id: 'review_bridge_1',
      reason: 'approval_required',
      summary: 'Awaiting approval',
      gate_status: 'approval_required',
      review_status: 'pending',
      priority: 'high',
      recommended_actions: ['approve', 'takeover'],
      metadata: {
        step_id: 'step_2',
      },
    },
  });
  const approvalDraft = callPythonCore('draft_approval_review', {
    message: { trace_id: 'task_approval_bridge' },
    persona: { persona_id: 'researcher' },
    plan: { plan_id: 'plan_bridge_1' },
    run_state: { status: 'waiting_approval' },
    paused_step: { step_id: 'step_2', title: 'Approve write', tool_name: 'approval_sensitive_tool' },
  });
  const qualityDraft = callPythonCore('draft_quality_review', {
    message: { trace_id: 'task_quality_bridge' },
    persona: { persona_id: 'reviewer' },
    evaluation: { evaluation_id: 'eval_bridge_2' },
    gate: {
      gate_id: 'gate_bridge_2',
      status: 'review_required',
      reason: 'unsafe_output',
      priority: 'high',
      sampled: false,
      score: 0.42,
      recommended_actions: ['human_review'],
    },
  });
  const aggregate = callPythonCore('aggregate_handoffs', {
    task_id: 'task_multi_bridge',
    handoffs: [
      {
        handoff_id: 'handoff_1',
        role: 'retriever',
        target_agent_id: 'agent_retriever_1',
        status: 'completed',
        result_summary: 'retrieval done',
        result: { citations: ['doc_1'] },
        adopted: true,
        context_snapshot_id: 'snap_1',
      },
      {
        handoff_id: 'handoff_2',
        role: 'reviewer',
        target_agent_id: 'agent_reviewer_1',
        status: 'failed',
        context_snapshot_id: 'snap_1',
      },
    ],
  });
  const coordination = callPythonCore('describe_coordination', {
    task_id: 'task_multi_bridge',
    plan: {
      goal: 'Delegate and review',
      steps: [
        { step_id: 'step_1', title: 'Route knowledge retrieval', tool_name: 'hybrid_retrieve' },
        { step_id: 'step_2', title: 'Review findings', kind: 'analysis' },
      ],
    },
    message_text: 'please review this delegated task',
    handoffs: [
      {
        handoff_id: 'handoff_1',
        role: 'retriever',
        status: 'completed',
      },
      {
        handoff_id: 'handoff_2',
        role: 'reviewer',
        status: 'failed',
      },
    ],
  });

  assert.equal(approvalPreview.paused_step.tool_name, 'approval_sensitive_tool');
  assert.ok(approvalPreview.changes.some((change) => change.field === 'task.control_state'));
  assert.equal(approvalDraft.queue_name, 'approval');
  assert.equal(approvalDraft.metadata.tool_name, 'approval_sensitive_tool');
  assert.equal(qualityDraft.gate_status, 'review_required');
  assert.equal(qualityDraft.metadata.score, 0.42);
  assert.equal(aggregate.total_handoffs, 2);
  assert.equal(aggregate.failed_count, 1);
  assert.equal(aggregate.fallback.strategy, 'best_effort_join');
  assert.equal(aggregate.results[0].result.citations[0], 'doc_1');
  assert.equal(coordination.recommended_mode, 'parallel_specialists');
  assert.equal(coordination.join_strategy.mode, 'best_effort_join');
  assert.equal(coordination.next_action.type, 'merge_partial_results');
  assert.ok(coordination.active_roles.includes('retriever'));
});

test('python core handles governance, quality gate, and context budget decisions', () => {
  const gate = callPythonCore('evaluate_quality_gate', {
    evaluation: {
      evaluation_id: 'eval_bridge_1',
      task_id: 'task_bridge_1',
      trace_id: 'trace_bridge_1',
      decision: 'review',
      overall_score: 0.64,
      recommended_actions: ['human_review'],
    },
    sample_rate: 0,
  });
  const governancePolicy = callPythonCore('normalize_governance_policy', {
    policy: {
      online: { max_task_duration_ms: 100 },
      async: { max_queue_depth: 1 },
    },
  });
  const workerGovernance = callPythonCore('evaluate_worker_governance', {
    policy: governancePolicy,
    worker_snapshot: {
      queued: 3,
      active: 1,
    },
  });
  const contextInspection = callPythonCore('inspect_context_budget', {
    task_id: 'task_bridge_1',
    trace_id: 'trace_bridge_1',
    task: {
      task_id: 'task_bridge_1',
      status: 'waiting_approval',
      current_step_id: 'step_1',
      message: { content_preview: 'Please compress this context.' },
      plan: {
        goal: 'Stay within budget',
        steps: [{ step_id: 'step_1', title: 'Analyze request' }],
      },
      metadata: {
        control_state: 'waiting_approval',
        approval_required: true,
      },
      step_results: [{ step_id: 'step_0', status: 'failed' }],
    },
    stream_events: [
      {
        seq: 1,
        event_type: 'tool_result',
        payload: { call_id: 'call_ctx_1', summary: 'tool ok' },
      },
    ],
    audit_entries: [{ kind: 'plan.created', timestamp: '2026-05-11T10:00:00.000Z' }],
    memory: {
      short_term: [{ memory_id: 'mem_s_1', summary: 'short summary' }],
      long_term: [{ memory_id: 'mem_l_1', title: 'durable fact' }],
    },
    handoffs: [{ handoff_id: 'handoff_1', role: 'reviewer', status: 'completed' }],
    token_budget: 10,
  });

  assert.equal(gate.status, 'review_required');
  assert.equal(gate.review_required, true);
  assert.equal(governancePolicy.online.max_task_duration_ms, 100);
  assert.equal(workerGovernance.status, 'breached');
  assert.ok(workerGovernance.alerts.some((alert) => alert.code === 'async_queue_backlog'));
  assert.equal(contextInspection.over_budget, true);
  assert.ok(contextInspection.must_keep.includes('control_state:waiting_approval'));
});

test('planner delegates to python core and returns a normalized plan', () => {
  const planner = createPlanner();
  const plan = planner.createPlan({
    message: {
      trace_id: 'trace_python_core',
      content: [{ type: 'text', text: '请帮我规划一个开发方案' }],
    },
    persona: {
      persona_id: 'researcher',
      name: 'Researcher',
      retrieval_policy: {
        prefer_hybrid_rag: true,
      },
      approval_policy: {
        required_for_side_effects: true,
      },
    },
  });

  assert.equal(plan.plan_id, 'plan_trace_python_core');
  assert.equal(plan.steps[0].title, 'Understand request');
  assert.equal(plan.steps[1].tool_name, 'hybrid_retrieve');
  assert.equal(plan.steps.at(-1).kind, 'respond');
});

test('python core builds model routing policy and runtime step directives', () => {
  const policy = callPythonCore('build_model_policy', {
    provider: 'deepseek',
    primaryModel: 'deepseek-v4-flash',
    defaultReasoningEffort: 'medium',
    isPrimaryConfigured: true,
    fallback: {
      provider: 'local',
      strategy: 'local-compose',
    },
  });
  const route = callPythonCore('route_model', {
    policy,
    message: {
      content: [{ type: 'text', text: 'Quick summary please' }],
      metadata: { budget_tier: 'low' },
      risk_flags: [],
    },
    plan: {
      goal: 'Summarize quickly',
      steps: [{}, {}],
    },
    memorySnapshot: {
      short_term: [],
      long_term: [],
    },
    retrievalResult: {
      items: [],
    },
  });
  const directive = callPythonCore('prepare_runtime_step', {
    message: {
      trace_id: 'trace_runtime_directive',
      content: [{ type: 'text', text: 'hello runtime' }],
    },
    persona: {
      persona_id: 'researcher',
    },
    plan: {
      goal: 'Handle runtime step',
    },
    step: {
      step_id: 'step_tool_1',
      title: 'Route knowledge retrieval',
      objective: 'Fetch support',
      kind: 'tool',
      tool_name: 'hybrid_retrieve',
    },
    runState: {
      task_id: 'trace_runtime_directive',
      trace_id: 'trace_runtime_directive',
    },
    approvalContext: {
      approved: false,
    },
  });

  assert.equal(policy.providers.local.mode, 'local-compose');
  assert.equal(route.profile, 'fast');
  assert.equal(route.reasoning_effort, 'low');
  assert.equal(directive.tool_request.tool_name, 'hybrid_retrieve');
  assert.equal(directive.tool_request.arguments.query, 'hello runtime');
});

test('python core describes memory provider strategy and fallback metadata', () => {
  const strategy = callPythonCore('describe_memory_provider_strategy', {
    config: {
      provider: 'mem0_compatible',
      fallbackChain: [{ provider: 'local_builtin', reason: 'local_recovery' }],
      providers: {
        mem0_compatible: {
          label: 'Mem0 bridge',
          available: true,
          enabled: true,
          workspaceIsolated: true,
        },
      },
      retrievalPolicy: {
        defaultTopK: 5,
      },
    },
  });

  assert.equal(strategy.provider, 'mem0_compatible');
  assert.equal(strategy.provider_label, 'Mem0 bridge');
  assert.equal(strategy.capabilities.durable_persistence, true);
  assert.equal(strategy.fallback_chain[0].provider, 'local_builtin');
  assert.equal(strategy.retrieval_policy.default_top_k, 5);
});

test('python core resolves effective memory provider runtime fallback', () => {
  const strategy = callPythonCore('resolve_memory_provider_runtime', {
    config: {
      provider: 'mem0_compatible',
      fallbackChain: [{ provider: 'local_builtin', reason: 'local_recovery' }],
      providers: {
        mem0_compatible: {
          label: 'Mem0 bridge',
          available: true,
          enabled: true,
        },
      },
    },
    runtime: {
      durable_backend_available: false,
      durable_backend_reason: 'durable_backend_init_failed:test_unavailable',
    },
  });

  assert.equal(strategy.requested_provider, 'mem0_compatible');
  assert.equal(strategy.effective_provider, 'local_builtin');
  assert.equal(strategy.fallback_applied, true);
  assert.equal(strategy.fallback_reason, 'durable_backend_init_failed:test_unavailable');
  assert.equal(strategy.effective_capabilities.durable_persistence, false);
  assert.match(strategy.summary, /mem0_compatible -> local_builtin/);
});

test('python core ranks memory recall with semantic and stale-aware signals', () => {
  const result = callPythonCore('rank_memory_recall', {
    query: '中文 简洁 输出',
    strategy: {
      retrieval_policy: {
        stale_after_hours: 24,
      },
      effective_capabilities: {
        semantic_recall: true,
      },
    },
    runtime: {
      semantic_recall: true,
      stale_penalty: 0.2,
    },
    now: Date.parse('2026-05-14T12:00:00.000Z'),
    entries: [
      {
        memory_id: 'mem_fresh_cn',
        title: '以后始终用中文回答',
        summary: '用户偏好中文且简洁输出',
        facts: ['喜欢简洁输出'],
        importance: 0.9,
        updated_at: '2026-05-14T11:00:00.000Z',
      },
      {
        memory_id: 'mem_stale_price',
        title: '旧价格偏好',
        summary: '过期的定价上下文',
        facts: ['简洁价格输出'],
        importance: 0.8,
        updated_at: '2026-05-10T08:00:00.000Z',
      },
    ],
  });

  assert.equal(result.strategy.mode, 'python_ranked_recall');
  assert.equal(result.items[0].memory_id, 'mem_fresh_cn');
  assert.equal(result.items[0].stale, false);
  assert.equal(result.items.at(-1).memory_id, 'mem_stale_price');
  assert.equal(result.items.at(-1).stale, true);
  assert.ok(result.items[0].score > result.items.at(-1).score);
  assert.ok(result.items[0].lexical_score > 0);
});

test('python core treats expired memory entries as stale even when recently updated', () => {
  const result = callPythonCore('rank_memory_recall', {
    query: 'ExpirySignal preference',
    strategy: {
      retrieval_policy: {
        stale_after_hours: 168,
      },
      effective_capabilities: {
        semantic_recall: false,
      },
    },
    runtime: {
      semantic_recall: false,
      stale_penalty: 0.2,
    },
    now: Date.parse('2026-05-14T12:00:00.000Z'),
    entries: [
      {
        memory_id: 'mem_expired_recent',
        title: 'ExpirySignal expired preference',
        summary: 'recent but expired',
        facts: ['ExpirySignal preference'],
        importance: 0.9,
        updated_at: '2026-05-14T11:55:00.000Z',
        expires_at: '2026-05-14T11:00:00.000Z',
      },
      {
        memory_id: 'mem_live_recent',
        title: 'ExpirySignal active preference',
        summary: 'recent and live',
        facts: ['ExpirySignal preference'],
        importance: 0.8,
        updated_at: '2026-05-14T11:50:00.000Z',
        expires_at: '2026-05-15T11:00:00.000Z',
      },
    ],
  });

  assert.equal(result.items[0].memory_id, 'mem_live_recent');
  assert.equal(result.items[0].stale, false);
  assert.equal(result.items[1].memory_id, 'mem_expired_recent');
  assert.equal(result.items[1].stale, true);
  assert.ok(result.items[0].score > result.items[1].score);
});

test('python core judges durable memory promotion and rejects temporary reminders', () => {
  const stable = callPythonCore('judge_durable_memory_write', {
    strategy: {
      write_policy: {
        allow_auto_promote: true,
        durable_write_threshold: 0.85,
      },
    },
    task_id: 'task_mem_policy_1',
    trace_id: 'trace_mem_policy_1',
    workspace_id: 'ws_policy',
    persona_id: 'researcher',
    plan_id: 'plan_policy_1',
    message_text: '以后请始终用中文回答，并记住我喜欢简洁输出。',
    response_text: '好的，我会保持中文并尽量简洁。',
  });
  const temporary = callPythonCore('judge_durable_memory_write', {
    strategy: {
      write_policy: {
        allow_auto_promote: true,
        durable_write_threshold: 0.85,
      },
    },
    task_id: 'task_mem_policy_2',
    trace_id: 'trace_mem_policy_2',
    workspace_id: 'ws_policy',
    persona_id: 'researcher',
    message_text: '明天早上十点提醒我交周报。',
    response_text: '好的，我明天提醒你。',
  });

  assert.equal(stable.should_promote, true);
  assert.ok(stable.confidence >= stable.threshold);
  assert.equal(stable.normalized_entry.workspace_id, 'ws_policy');
  assert.equal(stable.normalized_entry.persona_id, 'researcher');
  assert.match(stable.normalized_entry.metadata.durable_key, /ws_policy::researcher/);

  assert.equal(temporary.should_promote, false);
  assert.equal(temporary.normalized_entry, null);
  assert.ok(temporary.reasons.some((reason) => reason.includes('temporary') || reason.includes('time_bound')));
});

test('python core evaluates tool policy decisions', () => {
  const policy = callPythonCore('build_tool_policy', {
    definition: {
      risk_level: 'low',
      idempotent: true,
      timeout_ms: 100,
      retry_policy: {
        max_attempts: 2,
        retry_on: ['error', 'timeout'],
      },
    },
  });
  const decision = callPythonCore('evaluate_tool_attempt', {
    definition: {
      risk_level: 'low',
      idempotent: true,
      timeout_ms: 100,
    },
    policy,
    attempt: 1,
    status: 'error',
    extra: {
      cache_hit: false,
    },
  });

  assert.equal(policy.max_attempts, 2);
  assert.equal(decision.should_retry, true);
  assert.equal(decision.metrics.retry_count, 0);
  assert.equal(decision.metrics.timeout_ms, 100);
});

test('python core evaluates persona-scoped tool access policies', () => {
  const decision = callPythonCore('evaluate_tool_access', {
    definition: {
      tool_name: 'approval_sensitive_tool',
      permissions: ['write_state'],
      side_effect_scope: 'external_state',
    },
    request: {
      tool_name: 'approval_sensitive_tool',
      access_policy: {
        toolset_id: 'analysis_toolset',
        allowed_permissions: ['read_docs', 'read_wiki'],
        allow_side_effects: false,
        allow_unlisted_tools: true,
        disallowed_tools: [],
      },
    },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'permission_denied');
  assert.deepEqual(decision.missing_permissions, ['write_state']);
  assert.equal(decision.policy.toolset_id, 'analysis_toolset');
});

test('python core carries tool access policy into runtime tool requests', () => {
  const registry = createPersonaRegistry();
  const reviewerPersona = registry.get('reviewer');
  const runtimeStep = callPythonCore('prepare_runtime_step', {
    message: {
      trace_id: 'trace_tool_access_runtime',
      content: [{ type: 'text', text: 'please review this task' }],
    },
    persona: reviewerPersona,
    plan: {
      goal: 'Review the request',
    },
    step: {
      step_id: 'step_tool_access_runtime',
      title: 'Review docs',
      objective: 'Inspect the docs',
      kind: 'tool',
      tool_name: 'search_docs',
      arguments: {
        host: 'api.deepseek.com',
        provider: 'deepseek',
      },
    },
    run_state: {
      task_id: 'task_tool_access_runtime',
      trace_id: 'trace_tool_access_runtime',
    },
  });

  assert.equal(runtimeStep.tool_request.access_policy.toolset_id, 'review_toolset');
  assert.deepEqual(runtimeStep.tool_request.access_policy.allowed_permissions, ['read_docs', 'read_wiki']);
  assert.equal(runtimeStep.tool_request.access_policy.allow_side_effects, false);
  assert.equal(runtimeStep.tool_request.arguments.host, 'api.deepseek.com');
  assert.equal(runtimeStep.tool_request.arguments.provider, 'deepseek');
  assert.deepEqual(runtimeStep.tool_request.access_policy.egress_allowlist, {
    hosts: [],
    providers: [],
    provider_host_bindings: [],
  });
});

test('python core merges toolset egress defaults into persona tool access policy', () => {
  const catalog = callPythonCore('describe_persona_catalog', {
    personas: [
      {
        persona_id: 'egress_reviewer',
        pack_id: 'review_pack',
        name: 'Egress Reviewer',
        tool_access_policy: {
          allowed_permissions: ['read_docs'],
          allow_side_effects: false,
        },
      },
    ],
    toolsets: [
      {
        toolset_id: 'review_toolset',
        label: 'Review Toolset',
        allowed_permissions: ['read_docs'],
        required_capabilities: ['retrieval'],
        allowed_release_channels: ['stable'],
        allow_side_effects: false,
        egress_allowlist: {
          hosts: ['api.deepseek.com'],
          providers: ['deepseek'],
          provider_host_bindings: [
            {
              provider: 'deepseek',
              hosts: ['api.deepseek.com'],
            },
          ],
        },
      },
    ],
  });

  const persona = catalog.personas.find((item) => item.persona_id === 'egress_reviewer');
  assert.ok(persona);
  assert.deepEqual(persona.tool_access_policy.egress_allowlist, {
    hosts: ['api.deepseek.com'],
    providers: ['deepseek'],
    provider_host_bindings: [
      {
        provider: 'deepseek',
        hosts: ['api.deepseek.com'],
      },
    ],
  });
});

test('python core exposes toolset catalog through persona catalog metadata', () => {
  const catalog = callPythonCore('describe_persona_catalog', {});

  assert.ok(Array.isArray(catalog.toolsets));
  assert.ok(catalog.toolsets.some((item) => item.toolset_id === 'analysis_toolset'));
  const reviewToolset = catalog.toolsets.find((item) => item.toolset_id === 'review_toolset');
  assert.ok(reviewToolset);
  assert.ok(reviewToolset.capabilities.includes('retrieval'));
  assert.equal(reviewToolset.release_channel, 'stable');
  assert.equal(reviewToolset.enabled, true);
});

test('response composer uses python draft when the model client is unavailable', async () => {
  const composer = createResponseComposer({
    client: {
      isConfigured: false,
    },
  });

  const result = await composer.compose({
    persona: {
      name: 'Researcher',
      purpose: 'Design careful systems',
    },
    message: {
      content: [{ type: 'text', text: '请把计划说清楚' }],
    },
    plan: {
      goal: 'Build a Python core',
      steps: [
        { title: 'Understand request' },
        { title: 'Route knowledge retrieval' },
        { title: 'Compose response' },
      ],
    },
    retrievalResult: {
      result: {
        route: { mode: 'rag-first' },
        query_analysis: {
          query_mode: 'explanation',
          boundary: { action: 'answer' },
          clarification: { required: false, questions: [] },
        },
        retrieval_plan: {
          response_policy: {
            max_parent_items: 1,
            max_supporting_chunks_per_item: 1,
            max_supporting_chunks_total: 1,
            max_snippet_chars: 96,
            max_evidence_chars: 240,
          },
        },
        items: [
          {
            title: 'Architecture overview',
            source_type: 'rag',
            freshness: 'stable',
            supporting_chunks: [
              {
                chunk_id: 'chunk_arch_1',
                section_path: ['Overview'],
                score: 0.93,
                snippet: 'The platform uses a Python core for planning, retrieval, and response drafting.',
              },
            ],
          },
        ],
        citations: [
          { title: 'Architecture overview', source_type: 'rag', freshness: 'stable', score: 0.93 },
        ],
        quality: {
          retrieval_score: 0.91,
          citation_score: 0.94,
          route_alignment_score: 0.93,
          recommended_action: 'accept',
        },
      },
    },
    memorySnapshot: {
      short_term: [{ summary: 'user wants Python core' }],
      long_term: [{ title: 'Python core migration' }],
    },
  });

  assert.equal(result.fallback.applied, true);
  assert.match(result.content, /Retrieval route: rag-first/);
  assert.match(result.content, /Evidence pack:/);
  assert.match(result.content, /Python core for planning, retrieval, and response drafting/);
  assert.match(result.content, /Python core migration/);
});
