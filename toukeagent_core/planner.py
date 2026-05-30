from __future__ import annotations

from typing import Any

from .shared import extract_user_text, normalize_identifier, summarize_goal


def needs_human_approval(message: dict[str, Any] | None, text: str, persona: dict[str, Any] | None) -> bool:
    normalized = str(text or "").lower()
    risk_flags = [str(item).lower() for item in (message or {}).get("risk_flags", []) if item is not None]
    approval_markers = ["approval", "approve", "human approval", "高风险", "审批", "外部副作用", "人工接管"]
    requires_side_effect_approval = bool((persona or {}).get("approval_policy", {}).get("required_for_side_effects"))

    return requires_side_effect_approval and (
        "requires_approval" in risk_flags or any(marker in normalized for marker in approval_markers)
    )


def create_plan(payload: dict[str, Any]) -> dict[str, Any]:
    message = payload.get("message") or {}
    persona = payload.get("persona") or {}
    text = extract_user_text(message) or "Handle the inbound request"
    trace_id = str(message.get("trace_id") or message.get("message_id") or "trace")
    step_prefix = normalize_identifier(trace_id)
    retrieval_objective = (
        "Route retrieval across stable docs and dynamic wiki context"
        if persona.get("retrieval_policy", {}).get("prefer_hybrid_rag")
        else "Retrieve supporting context"
    )
    require_approval = needs_human_approval(message, text, persona)
    steps = [
        {
            "step_id": f"{step_prefix}_understand",
            "title": "Understand request",
            "objective": f"Interpret the user request: {summarize_goal(text)}",
            "kind": "reason",
            "acceptance": ["Request intent is clear"],
        }
    ]

    if require_approval:
        steps.append(
            {
                "step_id": f"{step_prefix}_approve",
                "title": "Approve risky action",
                "objective": "Obtain human approval before executing the risky action",
                "kind": "tool",
                "tool_name": "approval_sensitive_tool",
                "acceptance": ["Human approval is recorded before the action continues"],
            }
        )

    steps.extend(
        [
            {
                "step_id": f"{step_prefix}_retrieve",
                "title": "Route knowledge retrieval",
                "objective": retrieval_objective,
                "kind": "tool",
                "tool_name": "hybrid_retrieve",
                "acceptance": ["At least one relevant source is retrieved from the appropriate path"],
            },
            {
                "step_id": f"{step_prefix}_respond",
                "title": "Compose response",
                "objective": "Generate a concise, actionable response aligned with the active persona",
                "kind": "respond",
                "acceptance": ["Response references the plan and retrieved context"],
            },
        ]
    )

    summary = (
        f"Plan the request, pause for human approval, route context retrieval, then respond as {persona.get('name')}."
        if require_approval
        else f"Plan the request, route context retrieval, then respond as {persona.get('name')}."
    )

    return {
        "plan_id": f"plan_{step_prefix}",
        "task_id": trace_id,
        "trace_id": trace_id,
        "persona_id": str(persona.get("persona_id") or ""),
        "goal": summarize_goal(text),
        "summary": summary,
        "steps": steps,
        "metadata": payload.get("metadata") or {},
    }
