from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from time import perf_counter
from typing import Any, Callable

from .composer import draft_response
from .quality_gate import evaluate_quality_gate
from .retrieval import build_retrieval_result


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _message_text(message: dict[str, Any] | None) -> str:
    message = message or {}
    parts = [
        str(part.get("text", ""))
        for part in (message.get("content") or [])
        if isinstance(part, dict) and part.get("type") == "text"
    ]
    return "\n".join(part for part in parts if part).strip()


def _normalize_filter_policy(payload: dict[str, Any] | None, query_analysis: dict[str, Any] | None = None) -> dict[str, Any]:
    source = dict(payload or {})
    mode = str(source.get("mode") or "soft_prefer").strip() or "soft_prefer"
    if mode not in {"soft_prefer", "hard_enforce"}:
        mode = "soft_prefer"

    hard_reason = source.get("hard_enforce_reason")
    if hard_reason is not None:
        hard_reason = str(hard_reason).strip() or None

    query_analysis = query_analysis or {}
    explicit_filters = dict(source.get("requested_filters") or {})
    if mode == "soft_prefer" and explicit_filters:
        boundary = query_analysis.get("boundary") or {}
        query_mode = str(query_analysis.get("query_mode") or "")
        explicit_scope = bool(boundary.get("explicit_scope_required"))
        if explicit_scope or query_mode == "lookup":
            mode = "hard_enforce"
            hard_reason = hard_reason or "user_explicit"

    return {
        "mode": mode,
        "hard_enforce_reason": hard_reason,
    }


def _node_event(event_type: str, node_name: str, state: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {
        "event_type": event_type,
        "node_name": node_name,
        "trace_id": state.get("trace_id"),
        "task_id": state.get("task_id"),
        "timestamp": _utc_now(),
        **extra,
    }


@dataclass
class GraphNode:
    name: str
    handler: Callable[[dict[str, Any]], dict[str, Any]]


class CompatGraphRunner:
    def __init__(self, nodes: list[GraphNode]):
        self.nodes = nodes

    def run(self, state: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        events: list[dict[str, Any]] = []
        current = dict(state)
        for node in self.nodes:
            started = perf_counter()
            events.append(_node_event("node_started", node.name, current))
            try:
                current = node.handler(current)
                duration_ms = round((perf_counter() - started) * 1000, 3)
                events.append(
                    _node_event(
                        "node_completed",
                        node.name,
                        current,
                        duration_ms=duration_ms,
                    )
                )
                if current.get("_graph_next") == "fallback_or_review" and node.name != "fallback_or_review":
                    continue
            except Exception as exc:  # pragma: no cover - surfaced via bridge tests/runtime
                duration_ms = round((perf_counter() - started) * 1000, 3)
                current = {
                    **current,
                    "errors": {
                        "failed_node": node.name,
                        "recoverable": True,
                        "error_code": exc.__class__.__name__,
                        "error_message": str(exc),
                    },
                }
                events.append(
                    _node_event(
                        "node_failed",
                        node.name,
                        current,
                        duration_ms=duration_ms,
                        error_code=exc.__class__.__name__,
                        summary={"message": str(exc)},
                    )
                )
                raise
        return current, events


class LangGraphRunner(CompatGraphRunner):
    def run(self, state: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        try:
            from langgraph.graph import END, START, StateGraph  # type: ignore
        except Exception:
            state = {
                **state,
                "runtime": {
                    **dict(state.get("runtime") or {}),
                    "executor_backend": "compat_graph_runner",
                },
            }
            return super().run(state)

        nodes_by_name = {node.name: node.handler for node in self.nodes}
        workflow = StateGraph(dict)

        for node in self.nodes:
            def make_handler(node_name: str, handler: Callable[[dict[str, Any]], dict[str, Any]]) -> Callable[[dict[str, Any]], dict[str, Any]]:
                def wrapped(current: dict[str, Any]) -> dict[str, Any]:
                    started = perf_counter()
                    events = list(current.get("_node_events") or [])
                    events.append(_node_event("node_started", node_name, current))
                    try:
                        updated = handler(current)
                        duration_ms = round((perf_counter() - started) * 1000, 3)
                        events.append(_node_event("node_completed", node_name, updated, duration_ms=duration_ms))
                        return {
                            **updated,
                            "_node_events": events,
                        }
                    except Exception as exc:  # pragma: no cover
                        duration_ms = round((perf_counter() - started) * 1000, 3)
                        failed = {
                            **current,
                            "errors": {
                                "failed_node": node_name,
                                "recoverable": True,
                                "error_code": exc.__class__.__name__,
                                "error_message": str(exc),
                            },
                        }
                        events.append(
                            _node_event(
                                "node_failed",
                                node_name,
                                failed,
                                duration_ms=duration_ms,
                                error_code=exc.__class__.__name__,
                                summary={"message": str(exc)},
                            )
                        )
                        raise
                return wrapped

            workflow.add_node(node.name, make_handler(node.name, node.handler))

        workflow.add_edge(START, self.nodes[0].name)
        for current, nxt in zip(self.nodes, self.nodes[1:]):
            workflow.add_edge(current.name, nxt.name)
        workflow.add_edge(self.nodes[-1].name, END)
        graph = workflow.compile()
        result = graph.invoke({
            **state,
            "_node_events": [],
        })
        return dict(result), list(result.get("_node_events") or [])


def _prepare_request(state: dict[str, Any]) -> dict[str, Any]:
    message = dict(state.get("message") or {})
    persona = dict(state.get("persona") or {})
    query = _message_text(message) or str((state.get("plan") or {}).get("goal") or "")
    runtime = dict(state.get("runtime") or {})
    return {
        **state,
        "query": query,
        "persona_id": str(persona.get("persona_id") or state.get("persona_id") or "default"),
        "runtime": {
            **runtime,
            "started_at": runtime.get("started_at") or _utc_now(),
            "executor_backend": runtime.get("executor_backend") or state.get("executor_backend") or "compat_graph_runner",
        },
        "request": {
            "message_text": query,
            "workspace_id": state.get("workspace_id"),
        },
    }


def _analyze_query_frontend(state: dict[str, Any]) -> dict[str, Any]:
    retrieval = build_retrieval_result({
        "query": state.get("query"),
        "persona_id": state.get("persona_id"),
        "stable_items": [],
        "dynamic_items": [],
    })
    return {
        **state,
        "query_frontend": retrieval.get("query_analysis") or {},
        "_retrieval_probe": retrieval,
    }


def _plan_retrieval(state: dict[str, Any]) -> dict[str, Any]:
    query_analysis = dict(state.get("query_frontend") or {})
    filters = dict(state.get("filters") or {})
    requested_filters = dict(filters)
    filter_policy_input = {
        **dict(state.get("filter_policy") or {}),
        "requested_filters": requested_filters,
    }
    filter_policy = _normalize_filter_policy(filter_policy_input, query_analysis=query_analysis)
    route_probe = dict(state.get("_retrieval_probe") or {})
    route = dict(route_probe.get("route") or {})
    retrieval_state = dict(state.get("retrieval") or {})
    return {
        **state,
        "retrieval": {
            **retrieval_state,
            "requested_route_mode": route.get("requested_mode") or route.get("mode"),
            "effective_route_mode": route.get("effective_mode") or route.get("mode"),
            "route_reason": route.get("fallback_reason"),
            "requested_filters": requested_filters,
            "effective_filters": requested_filters,
            "filter_policy": filter_policy,
        },
    }


def _retrieve_evidence(state: dict[str, Any]) -> dict[str, Any]:
    retrieval_state = dict(state.get("retrieval") or {})
    result = build_retrieval_result({
        "query": state.get("query"),
        "persona_id": state.get("persona_id"),
        "stable_items": list(state.get("stable_items") or []),
        "dynamic_items": list(state.get("dynamic_items") or []),
        "filters": retrieval_state.get("requested_filters") or {},
        "filter_policy": retrieval_state.get("filter_policy") or {},
    })
    quality = dict(result.get("quality") or {})
    retrieval_state = {
        **retrieval_state,
        "requested_route_mode": result.get("route", {}).get("requested_mode") or result.get("route", {}).get("mode"),
        "effective_route_mode": result.get("route", {}).get("effective_mode") or result.get("route", {}).get("mode"),
        "requested_filters": result.get("filter_policy", {}).get("requested_filters") or retrieval_state.get("requested_filters") or {},
        "effective_filters": result.get("filter_policy", {}).get("effective_filters") or result.get("filters") or {},
        "filter_policy": result.get("filter_policy") or retrieval_state.get("filter_policy") or {},
        "channel_hits": result.get("channel_hits") or {},
        "items": result.get("items") or [],
        "supporting_chunks": result.get("supporting_chunks") or [],
        "diagnostics": {
            **dict(result.get("diagnostics") or {}),
            "recommended_action": quality.get("recommended_action"),
        },
    }
    return {
        **state,
        "retrieval_result": result,
        "retrieval": retrieval_state,
    }


def _compose_grounded_draft(state: dict[str, Any]) -> dict[str, Any]:
    retrieval_result = dict(state.get("retrieval_result") or {})
    draft = draft_response({
        "persona": state.get("persona") or {},
        "message": state.get("message") or {},
        "plan": state.get("plan") or {},
        "retrieval_result": retrieval_result,
        "memory_snapshot": state.get("memory_snapshot"),
    })
    return {
        **state,
        "draft": draft,
    }


def _evaluate_quality_gate_node(state: dict[str, Any]) -> dict[str, Any]:
    retrieval_result = dict(state.get("retrieval_result") or {})
    quality = dict(retrieval_result.get("quality") or {})
    gate = evaluate_quality_gate({
        "evaluation": {
            "trace_id": state.get("trace_id"),
            "retrieval_score": quality.get("retrieval_score"),
            "citation_score": quality.get("citation_score"),
            "route_alignment_score": quality.get("route_alignment_score"),
            "recommended_action": quality.get("recommended_action"),
            "clarification_required": bool((retrieval_result.get("query_analysis") or {}).get("clarification", {}).get("required")),
        }
    })
    next_node = "finalize_response" if gate.get("decision") == "pass" else "fallback_or_review"
    return {
        **state,
        "quality_gate": gate,
        "_graph_next": next_node,
    }


def _finalize_response(state: dict[str, Any]) -> dict[str, Any]:
    draft = dict(state.get("draft") or {})
    content = draft.get("content") if isinstance(draft, dict) else None
    if content is None:
        content = str(draft or "")
    return {
        **state,
        "result": {
            "status": "completed",
            "answer": content,
            "review_required": False,
            "fallback_reason": None,
        },
    }


def _fallback_or_review(state: dict[str, Any]) -> dict[str, Any]:
    draft = dict(state.get("draft") or {})
    gate = dict(state.get("quality_gate") or {})
    fallback_reason = str(gate.get("decision") or gate.get("reasons") or "quality_gate_blocked")
    content = draft.get("content") if isinstance(draft, dict) else None
    if content is None:
        content = str(draft or "")
    return {
        **state,
        "result": {
            "status": "completed",
            "answer": content,
            "review_required": True,
            "fallback_reason": fallback_reason,
        },
    }


def _build_initial_state(payload: dict[str, Any]) -> dict[str, Any]:
    orchestrator_mode = str(payload.get("orchestrator_mode") or "langgraph_mvp")
    backend_preference = str(payload.get("executor_backend_preference") or "").strip() or None
    stable_items = list(payload.get("stable_items") or [])
    dynamic_items = list(payload.get("dynamic_items") or [])
    retrieval_result = payload.get("retrieval_result") if isinstance(payload.get("retrieval_result"), dict) else None
    if retrieval_result:
        stable_items = list(retrieval_result.get("stable_items") or stable_items)
        dynamic_items = list(retrieval_result.get("dynamic_items") or dynamic_items)
    return {
        "trace_id": payload.get("trace_id") or (payload.get("message") or {}).get("trace_id"),
        "task_id": payload.get("task_id") or (payload.get("message") or {}).get("trace_id"),
        "message": dict(payload.get("message") or {}),
        "persona": dict(payload.get("persona") or {}),
        "plan": dict(payload.get("plan") or {}),
        "stable_items": stable_items,
        "dynamic_items": dynamic_items,
        "filters": dict(payload.get("filters") or {}),
        "filter_policy": dict(payload.get("filter_policy") or {}),
        "memory_snapshot": payload.get("memory_snapshot"),
        "orchestrator_mode": orchestrator_mode,
        "executor_backend": backend_preference or "langgraph",
        "runtime": {
            "orchestrator_mode": orchestrator_mode,
            "executor_backend": backend_preference or "langgraph",
        },
    }


def run_orchestrator_graph(payload: dict[str, Any]) -> dict[str, Any]:
    state = _build_initial_state(payload)
    nodes = [
        GraphNode("prepare_request", _prepare_request),
        GraphNode("analyze_query_frontend", _analyze_query_frontend),
        GraphNode("plan_retrieval", _plan_retrieval),
        GraphNode("retrieve_evidence", _retrieve_evidence),
        GraphNode("compose_grounded_draft", _compose_grounded_draft),
        GraphNode("evaluate_quality_gate", _evaluate_quality_gate_node),
    ]
    backend = str(state.get("runtime", {}).get("executor_backend") or "langgraph")
    runner = LangGraphRunner(nodes) if backend == "langgraph" else CompatGraphRunner(nodes)
    state, events = runner.run(state)
    if state.get("_graph_next") == "fallback_or_review":
        state = _fallback_or_review(state)
        events.append(_node_event("node_completed", "fallback_or_review", state, duration_ms=0.0))
    else:
        state = _finalize_response(state)
        events.append(_node_event("node_completed", "finalize_response", state, duration_ms=0.0))

    return {
        "executor_backend": state.get("runtime", {}).get("executor_backend") or "compat_graph_runner",
        "graph_state": state,
        "node_events": events,
        "result": state.get("result") or {},
        "retrieval_result": state.get("retrieval_result") or {},
        "draft": state.get("draft") or {},
        "quality_gate": state.get("quality_gate") or {},
    }
