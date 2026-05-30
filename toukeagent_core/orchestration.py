from __future__ import annotations

from typing import Any

from .personas import resolve_persona
from .shared import clone


def _normalize_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip().lower()


def _has_step(plan: dict[str, Any], *, tool_name: str | None = None, kind: str | None = None) -> bool:
    steps = plan.get("steps") if isinstance(plan, dict) else []
    if not isinstance(steps, list):
        return False
    for step in steps:
        if not isinstance(step, dict):
            continue
        if tool_name and step.get("tool_name") == tool_name:
            return True
        if kind and step.get("kind") == kind:
            return True
    return False


def _build_specialist(
    *,
    persona_id: str,
    target_agent_id: str,
    objective: str,
    required: list[str],
    message_text: str,
) -> dict[str, Any]:
    persona = resolve_persona({"persona_id": persona_id})
    metadata = persona.get("metadata") if isinstance(persona.get("metadata"), dict) else {}
    toolset_id = metadata.get("default_toolset_id") or "analysis_toolset"
    return {
        "role": metadata.get("default_handoff_role") or persona_id,
        "persona_id": persona["persona_id"],
        "persona_name": persona["name"],
        "persona_pack_id": metadata.get("pack_id"),
        "specialist_profile": metadata.get("specialist_profile"),
        "target_agent_id": target_agent_id,
        "objective": objective,
        "scope": {
            "toolset_id": toolset_id,
            "side_effects_allowed": False,
            "preferred_tools": clone(persona.get("preferred_tools") if isinstance(persona.get("preferred_tools"), list) else []),
            "boundaries": clone(persona.get("boundaries") if isinstance(persona.get("boundaries"), list) else []),
        },
        "output_schema": {
            "type": "object",
            "required": required,
        },
        "routing_hint": {
            "message_text": message_text,
            "model_tier": (persona.get("model_policy") or {}).get("tier"),
            "focus": metadata.get("focus"),
        },
    }


def suggest_specialists(payload: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    data = payload or {}
    plan = data.get("plan") if isinstance(data.get("plan"), dict) else {}
    normalized = _normalize_text(data.get("message_text"))
    step_count = len(plan.get("steps") or []) if isinstance(plan.get("steps"), list) else 0
    suggestions: list[dict[str, Any]] = []

    if _has_step(plan, tool_name="hybrid_retrieve"):
        suggestions.append(_build_specialist(
            persona_id="retriever",
            target_agent_id="agent_retriever_1",
            objective="Collect stable and dynamic evidence for the active task",
            required=["summary", "citations"],
            message_text=normalized,
        ))

    if ("review" in normalized or "审校" in normalized or "评估" in normalized or step_count >= 3):
        suggestions.append(_build_specialist(
            persona_id="reviewer",
            target_agent_id="agent_reviewer_1",
            objective="Check evidence quality, risk, and missing constraints",
            required=["findings", "decision"],
            message_text=normalized,
        ))

    if _has_step(plan, tool_name="approval_sensitive_tool"):
        suggestions.append(_build_specialist(
            persona_id="operator",
            target_agent_id="agent_operator_1",
            objective="Prepare operator-facing execution notes and approval checkpoints",
            required=["checkpoints", "status"],
            message_text=normalized,
        ))

    if not suggestions and ("plan" in normalized or "规划" in normalized or "拆解" in normalized):
        suggestions.append(_build_specialist(
            persona_id="planner",
            target_agent_id="agent_planner_1",
            objective="Break the task into execution checkpoints and dependency order",
            required=["summary", "milestones"],
            message_text=normalized,
        ))

    if not suggestions and _has_step(plan, kind="respond") and ("write" in normalized or "draft" in normalized or "撰写" in normalized or "生成" in normalized):
        suggestions.append(_build_specialist(
            persona_id="writer",
            target_agent_id="agent_writer_1",
            objective="Draft the final response from approved evidence and plan context",
            required=["summary", "draft"],
            message_text=normalized,
        ))

    return suggestions


def describe_coordination(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or {}
    task_id = data.get("task_id")
    plan = data.get("plan") if isinstance(data.get("plan"), dict) else {}
    message_text = str(data.get("message_text") or "")
    handoffs = data.get("handoffs") if isinstance(data.get("handoffs"), list) else []
    suggestions = suggest_specialists({
        "plan": plan,
        "message_text": message_text,
    })

    created = [item for item in handoffs if isinstance(item, dict) and item.get("status") == "created"]
    running = [item for item in handoffs if isinstance(item, dict) and item.get("status") == "running"]
    completed = [item for item in handoffs if isinstance(item, dict) and item.get("status") == "completed"]
    failed = [item for item in handoffs if isinstance(item, dict) and item.get("status") in {"failed", "cancelled"}]

    if not suggestions:
        recommended_mode = "single_agent"
    elif len(suggestions) == 1:
        recommended_mode = "targeted_specialist"
    else:
        recommended_mode = "parallel_specialists"

    if not handoffs and suggestions:
        join_strategy = {
            "mode": "awaiting_dispatch",
            "reason": "specialists suggested but no handoffs have been created",
        }
        next_action = {
            "type": "dispatch_specialists",
            "reason": "coordination can begin by issuing suggested handoffs",
        }
    elif running or created:
        join_strategy = {
            "mode": "wait_for_specialists",
            "reason": "one or more specialist handoffs are still active",
        }
        next_action = {
            "type": "await_results",
            "reason": "wait for in-flight handoffs before joining",
        }
    elif failed and not completed:
        join_strategy = {
            "mode": "single_agent_recovery",
            "reason": "all completed specialist outputs are unavailable",
        }
        next_action = {
            "type": "fallback_recovery",
            "reason": "switch back to coordinator or operator recovery path",
        }
    elif failed:
        join_strategy = {
            "mode": "best_effort_join",
            "reason": "some specialists failed, but usable results exist",
        }
        next_action = {
            "type": "merge_partial_results",
            "reason": "combine completed outputs and surface missing coverage",
        }
    elif completed:
        join_strategy = {
            "mode": "merge_completed_results" if len(completed) > 1 else "adopt_single_result",
            "reason": "all recorded specialist outputs are complete",
        }
        next_action = {
            "type": "finalize_join",
            "reason": "merge completed specialist outputs back into the coordinator flow",
        }
    else:
        join_strategy = {
            "mode": "normal_join",
            "reason": "no active or failed handoffs require intervention",
        }
        next_action = {
            "type": "continue_single_agent",
            "reason": "no delegation action is currently required",
        }

    active_roles = sorted({
        str(item.get("role"))
        for item in handoffs
        if isinstance(item, dict) and item.get("role")
    } | {
        str(item.get("role"))
        for item in suggestions
        if isinstance(item, dict) and item.get("role")
    })

    return {
        "task_id": task_id,
        "recommended_mode": recommended_mode,
        "suggestions": suggestions,
        "join_strategy": join_strategy,
        "next_action": next_action,
        "active_roles": active_roles,
        "metrics": {
            "suggested_count": len(suggestions),
            "handoff_count": len(handoffs),
            "created_count": len(created),
            "running_count": len(running),
            "completed_count": len(completed),
            "failed_count": len(failed),
        },
    }


def aggregate_handoffs(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or {}
    task_id = data.get("task_id")
    handoffs = data.get("handoffs") if isinstance(data.get("handoffs"), list) else []
    completed = [item for item in handoffs if isinstance(item, dict) and item.get("status") == "completed"]
    failed = [
        item for item in handoffs
        if isinstance(item, dict) and item.get("status") in {"failed", "cancelled"}
    ]
    adopted = [item for item in completed if item.get("adopted")]

    if failed and not completed:
        fallback = {
            "required": True,
            "strategy": "single_agent_recovery",
            "reason": "all specialist handoffs failed",
        }
    elif failed:
        fallback = {
            "required": True,
            "strategy": "best_effort_join",
            "reason": "partial specialist failure",
        }
    else:
        fallback = {
            "required": False,
            "strategy": "normal_join",
            "reason": None,
        }

    return {
        "task_id": task_id,
        "total_handoffs": len(handoffs),
        "completed_count": len(completed),
        "failed_count": len(failed),
        "adopted_count": len(adopted),
        "results": [
            {
                "handoff_id": item.get("handoff_id"),
                "role": item.get("role"),
                "target_agent_id": item.get("target_agent_id"),
                "result_summary": item.get("result_summary"),
                "result": clone(item.get("result")),
                "adopted": item.get("adopted"),
            }
            for item in completed
        ],
        "fallback": fallback,
        "audit_chain": [
            {
                "handoff_id": item.get("handoff_id"),
                "role": item.get("role"),
                "status": item.get("status"),
                "target_agent_id": item.get("target_agent_id"),
                "context_snapshot_id": item.get("context_snapshot_id"),
            }
            for item in handoffs
            if isinstance(item, dict)
        ],
    }
