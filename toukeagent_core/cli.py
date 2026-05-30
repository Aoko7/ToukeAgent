from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Callable

from .composer import draft_response
from .context_budget import inspect_context_budget, recover_context_snapshot
from .embedding import describe_embedding_strategy, embed_texts
from .evaluator import evaluate_output
from .generation_eval import evaluate_generation_suite
from .graph_orchestrator import run_orchestrator_graph
from .knowledge_eval import evaluate_knowledge_suite
from .governance import evaluate_task_governance, evaluate_worker_governance, normalize_governance_policy
from .memory_eval import evaluate_memory_suite
from .memory_policy import judge_durable_memory_write, rank_memory_recall
from .memory_provider import describe_memory_provider_strategy, resolve_memory_provider_runtime
from .model_router import build_model_policy, route_model
from .orchestration import aggregate_handoffs, describe_coordination, suggest_specialists
from .personas import describe_persona_catalog, list_persona_packs, list_personas, resolve_persona
from .planner import create_plan
from .quality_gate import evaluate_quality_gate
from .retrieval import batch_index_chunk_files, build_retrieval_result, choose_retrieval_route, index_chunk_file, search_indexed_chunks
from .review_policy import build_approval_preview, draft_approval_review, draft_quality_review
from .runtime_policy import build_plan_summary, prepare_runtime_step
from .tool_policy import build_tool_policy, evaluate_tool_access, evaluate_tool_attempt
from .vector_store import describe_vector_backend
from .wiki_eval import evaluate_wiki_suite


def dispatch(action: str, payload: dict[str, Any]) -> Any:
    handlers: dict[str, Callable[[dict[str, Any]], Any]] = {
        "create_plan": lambda data: create_plan(data),
        "choose_retrieval_route": lambda data: choose_retrieval_route(data.get("query")),
        "retrieve": lambda data: build_retrieval_result(data),
        "index_chunk_file": lambda data: index_chunk_file(data),
        "batch_index_chunk_files": lambda data: batch_index_chunk_files(data),
        "search_indexed_chunks": lambda data: search_indexed_chunks(data),
        "embed_texts": lambda data: embed_texts(data),
        "describe_embedding_strategy": lambda data: describe_embedding_strategy(data.get("config") or {}),
        "describe_vector_backend": lambda data: describe_vector_backend(data.get("config") or {}),
        "compose_draft": lambda data: draft_response(data),
        "evaluate": lambda data: evaluate_output(data),
        "evaluate_generation_suite": lambda data: evaluate_generation_suite(data),
        "evaluate_knowledge_suite": lambda data: evaluate_knowledge_suite(data),
        "evaluate_memory_suite": lambda data: evaluate_memory_suite(data),
        "evaluate_wiki_suite": lambda data: evaluate_wiki_suite(data),
        "rank_memory_recall": lambda data: rank_memory_recall(data),
        "judge_durable_memory_write": lambda data: judge_durable_memory_write(data),
        "describe_memory_provider_strategy": lambda data: describe_memory_provider_strategy(
            data.get("config") or {},
            data.get("runtime") or {},
        ),
        "resolve_memory_provider_runtime": lambda data: resolve_memory_provider_runtime(
            data.get("config") or {},
            data.get("runtime") or {},
        ),
        "build_model_policy": lambda data: build_model_policy(data),
        "route_model": lambda data: route_model(data),
        "build_tool_policy": lambda data: build_tool_policy(data.get("definition") or {}),
        "evaluate_tool_access": lambda data: evaluate_tool_access(data),
        "evaluate_tool_attempt": lambda data: evaluate_tool_attempt(data),
        "build_plan_summary": lambda data: build_plan_summary(data.get("plan") or {}),
        "prepare_runtime_step": lambda data: prepare_runtime_step(data),
        "list_personas": lambda data: list_personas(data),
        "list_persona_packs": lambda data: list_persona_packs(data),
        "describe_persona_catalog": lambda data: describe_persona_catalog(data),
        "resolve_persona": lambda data: resolve_persona(data),
        "suggest_specialists": lambda data: suggest_specialists(data),
        "describe_coordination": lambda data: describe_coordination(data),
        "aggregate_handoffs": lambda data: aggregate_handoffs(data),
        "inspect_context_budget": lambda data: inspect_context_budget(data),
        "recover_context_snapshot": lambda data: recover_context_snapshot(data),
        "evaluate_quality_gate": lambda data: evaluate_quality_gate(data),
        "build_approval_preview": lambda data: build_approval_preview(data),
        "draft_approval_review": lambda data: draft_approval_review(data),
        "draft_quality_review": lambda data: draft_quality_review(data),
        "normalize_governance_policy": lambda data: normalize_governance_policy(data),
        "evaluate_worker_governance": lambda data: evaluate_worker_governance(data),
        "evaluate_task_governance": lambda data: evaluate_task_governance(data),
        "run_orchestrator_graph": lambda data: run_orchestrator_graph(data),
    }
    if action not in handlers:
        raise ValueError(f"Unsupported core action: {action}")
    return handlers[action](payload or {})


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--action", required=False)
    parser.add_argument("--payload", required=False)
    args = parser.parse_args()

    try:
        if args.action:
            payload = json.loads(args.payload or "{}")
            action = args.action
        else:
            envelope = json.load(sys.stdin)
            action = envelope["action"]
            payload = envelope.get("payload") or {}
        result = dispatch(action, payload)
        json.dump({"ok": True, "result": result, "error": None, "meta": {"runtime": "python"}}, sys.stdout, ensure_ascii=False)
        return 0
    except Exception as exc:  # pragma: no cover - surfaced to Node bridge
        error = {
            "code": exc.__class__.__name__,
            "message": str(exc),
            "details": {},
        }
        json.dump({"ok": False, "result": None, "error": error, "meta": {"runtime": "python"}}, sys.stdout, ensure_ascii=False)
        return 1
