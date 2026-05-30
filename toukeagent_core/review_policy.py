from __future__ import annotations

from typing import Any

from .shared import clone


def _summarize_plan_step(step: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(step, dict):
        return None
    return {
        "step_id": step.get("step_id"),
        "title": step.get("title"),
        "objective": step.get("objective"),
        "kind": step.get("kind"),
        "tool_name": step.get("tool_name"),
        "acceptance": clone(step.get("acceptance") if isinstance(step.get("acceptance"), list) else []),
    }


def build_approval_preview(payload: dict[str, Any] | None = None) -> dict[str, Any] | None:
    data = payload or {}
    task = data.get("task") if isinstance(data.get("task"), dict) else None
    review = data.get("review") if isinstance(data.get("review"), dict) else None
    if not task or not review:
        return None

    plan = task.get("plan") if isinstance(task.get("plan"), dict) else {}
    steps = plan.get("steps") if isinstance(plan.get("steps"), list) else []
    step_id = (review.get("metadata") or {}).get("step_id") if isinstance(review.get("metadata"), dict) else None
    step_index = next((index for index, step in enumerate(steps) if isinstance(step, dict) and step.get("step_id") == step_id), -1)
    paused_step = steps[step_index] if step_index >= 0 else None
    previous_step = steps[step_index - 1] if step_index > 0 else None
    next_step = steps[step_index + 1] if step_index >= 0 and step_index < len(steps) - 1 else None

    task_snapshot = {
        "task_id": task.get("task_id"),
        "trace_id": task.get("trace_id"),
        "status": task.get("status"),
        "phase": task.get("phase"),
        "persona_id": task.get("persona_id"),
        "plan_id": task.get("plan_id"),
        "current_step_id": task.get("current_step_id"),
        "completed_steps": task.get("completed_steps") or 0,
        "total_steps": task.get("total_steps") or len(steps),
        "control_state": (task.get("metadata") or {}).get("control_state") if isinstance(task.get("metadata"), dict) else None,
        "approval_required": bool((task.get("metadata") or {}).get("approval_required")) if isinstance(task.get("metadata"), dict) else False,
        "paused_step_id": (task.get("metadata") or {}).get("paused_step_id") if isinstance(task.get("metadata"), dict) else None,
        "paused_tool_name": (task.get("metadata") or {}).get("paused_tool_name") if isinstance(task.get("metadata"), dict) else None,
    }

    return {
        "review_id": review.get("review_id"),
        "task_id": task.get("task_id"),
        "trace_id": task.get("trace_id"),
        "reason": review.get("reason"),
        "summary": review.get("summary"),
        "gate_status": review.get("gate_status"),
        "review_status": review.get("review_status"),
        "priority": review.get("priority"),
        "recommended_actions": clone(review.get("recommended_actions") if isinstance(review.get("recommended_actions"), list) else []),
        "task_snapshot": task_snapshot,
        "paused_step": _summarize_plan_step(paused_step),
        "previous_step": _summarize_plan_step(previous_step),
        "next_step": _summarize_plan_step(next_step),
        "changes": [
            {
                "field": "task.control_state",
                "before": task_snapshot.get("control_state") or task.get("status"),
                "after": "automated",
                "rationale": "Approval clears the manual control gate.",
            },
            {
                "field": "task.status",
                "before": task.get("status"),
                "after": "running",
                "rationale": "Approving resumes execution from the blocked step.",
            },
            {
                "field": "paused_step",
                "before": None,
                "after": _summarize_plan_step(paused_step),
                "rationale": "This is the step that will be unlocked by approval.",
            },
        ],
        "action_matrix": [
            {
                "action": "approve",
                "outcome": "Resume the blocked step under automation.",
                "risk": "medium",
            },
            {
                "action": "takeover",
                "outcome": "Transfer the task to a human operator.",
                "risk": "operator-controlled",
            },
        ],
    }


def draft_approval_review(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or {}
    message = data.get("message") if isinstance(data.get("message"), dict) else {}
    persona = data.get("persona") if isinstance(data.get("persona"), dict) else {}
    plan = data.get("plan") if isinstance(data.get("plan"), dict) else {}
    run_state = data.get("run_state") if isinstance(data.get("run_state"), dict) else {}
    paused_step = data.get("paused_step") if isinstance(data.get("paused_step"), dict) else {}
    reason = data.get("reason") or "approval_required"

    trace_id = message.get("trace_id")
    return {
        "queue_name": "approval",
        "task_id": trace_id,
        "trace_id": trace_id,
        "evaluation_id": None,
        "gate_id": None,
        "gate_status": "approval_required",
        "review_status": "pending",
        "reason": reason,
        "priority": "high",
        "sampled": False,
        "summary": f"Awaiting human approval for {paused_step.get('title') or 'the current step'}",
        "recommended_actions": ["approve", "takeover"],
        "metadata": {
            "persona_id": persona.get("persona_id"),
            "plan_id": plan.get("plan_id"),
            "step_id": paused_step.get("step_id"),
            "tool_name": paused_step.get("tool_name"),
            "status": run_state.get("status"),
        },
    }


def draft_quality_review(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or {}
    message = data.get("message") if isinstance(data.get("message"), dict) else {}
    persona = data.get("persona") if isinstance(data.get("persona"), dict) else {}
    evaluation = data.get("evaluation") if isinstance(data.get("evaluation"), dict) else {}
    gate = data.get("gate") if isinstance(data.get("gate"), dict) else {}

    return {
        "task_id": message.get("trace_id"),
        "trace_id": message.get("trace_id"),
        "evaluation_id": evaluation.get("evaluation_id"),
        "gate_id": gate.get("gate_id"),
        "gate_status": gate.get("status"),
        "reason": gate.get("reason"),
        "priority": gate.get("priority"),
        "sampled": bool(gate.get("sampled")),
        "summary": "Sampled output for online review"
        if gate.get("sampled")
        else f"Review required because gate status is {gate.get('status')}",
        "recommended_actions": clone(gate.get("recommended_actions") if isinstance(gate.get("recommended_actions"), list) else []),
        "metadata": {
            "score": gate.get("score"),
            "persona_id": persona.get("persona_id"),
        },
    }
