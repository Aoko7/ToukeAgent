from __future__ import annotations

import uuid
from typing import Any

from .shared import average, clone, round_score


def detect_unsafe_markers(text: str | None) -> list[str]:
    normalized = str(text or "")
    patterns = [
        ("api_key", r"\bsk-[A-Za-z0-9]{16,}\b"),
        ("token", r"\b(?:access[_ -]?token|refresh[_ -]?token)\b"),
        ("password", r"\bpassword\b"),
    ]
    markers = []
    for label, pattern in patterns:
        if __import__("re").search(pattern, normalized, flags=__import__("re").IGNORECASE):
            markers.append(label)
    return markers


def count_redaction_markers(text: str | None) -> int:
    return len(__import__("re").findall(r"\[REDACTED:[^\]]+\]", str(text or "")))


def extract_retrieval_result(run_state: dict[str, Any] | None) -> dict[str, Any] | None:
    step_results = (run_state or {}).get("step_results") or []
    for entry in step_results:
        output = (entry or {}).get("output") or {}
        if output.get("route") or output.get("citations") or output.get("items"):
            return output
    return None


def evaluate_output(payload: dict[str, Any]) -> dict[str, Any]:
    message = payload.get("message") or {}
    persona = payload.get("persona") or {}
    plan = payload.get("plan") or {}
    run_state = payload.get("runState") or payload.get("run_state") or {}
    final_text = str((run_state.get("output") or {}).get("final_text") or "")
    retrieval_result = extract_retrieval_result(run_state)
    citations = list((retrieval_result or {}).get("citations") or [])
    retrieval_quality = (retrieval_result or {}).get("quality") or None
    route_mode = (retrieval_result or {}).get("route", {}).get("mode")
    total_steps = float(run_state.get("total_steps") or 0)
    completed_steps = float(run_state.get("completed_steps") or 0)
    step_ratio = (completed_steps / total_steps) if total_steps > 0 else 0
    unsafe_markers = detect_unsafe_markers(final_text)
    redaction_marker_count = count_redaction_markers(final_text)
    lower_text = final_text.lower()
    cited_title_count = sum(
        1
        for citation in citations
        if str(citation.get("title") or "").strip() and str(citation.get("title") or "").lower() in lower_text
    )
    has_output = bool(final_text.strip())
    legacy_factuality = 0.86 if citations else (0.58 if has_output else 0.2)
    legacy_citation_consistency = 0.45 if not citations else (0.84 if (cited_title_count > 0 or route_mode) else 0.72)

    dimensions = {
        "factuality": round_score(
            average([legacy_factuality, retrieval_quality.get("retrieval_score")])
            if retrieval_quality and retrieval_quality.get("retrieval_score") is not None
            else legacy_factuality
        ),
        "citation_consistency": round_score(
            average(
                [
                    legacy_citation_consistency,
                    retrieval_quality.get("citation_score"),
                    retrieval_quality.get("route_alignment_score") if retrieval_quality else legacy_citation_consistency,
                ]
            )
            if retrieval_quality and retrieval_quality.get("citation_score") is not None
            else legacy_citation_consistency
        ),
        "task_completion": min(1.0, step_ratio * 0.75 + (0.25 if has_output else 0)),
        "format_compliance": 0.2 if not has_output else (0.92 if len(final_text) <= 4000 else 0.72),
        "safety": 0.1 if unsafe_markers else (0.4 if redaction_marker_count > 0 else 0.94),
    }

    overall_score = round_score(average(list(dimensions.values())))
    decision = "pass" if overall_score >= 0.82 else "review" if overall_score >= 0.6 else "fail"
    if redaction_marker_count > 0 and decision == "pass":
        decision = "review"
    recommended_actions = [] if decision == "pass" else (["supplement_retrieval", "human_review"] if decision == "review" else ["retry", "degrade", "human_review"])
    if retrieval_quality and retrieval_quality.get("recommended_action") and retrieval_quality.get("recommended_action") != "accept":
        recommended_actions.insert(0, retrieval_quality.get("recommended_action"))

    return {
        "evaluation_id": f"eval_{uuid.uuid4()}",
        "task_id": run_state.get("task_id") or message.get("trace_id") or None,
        "trace_id": run_state.get("trace_id") or message.get("trace_id") or None,
        "persona_id": persona.get("persona_id") or run_state.get("persona_id") or None,
        "plan_id": plan.get("plan_id") or run_state.get("plan_id") or None,
        "message_id": message.get("message_id") or None,
        "overall_score": overall_score,
        "decision": decision,
        "dimensions": {key: round_score(value) for key, value in dimensions.items()},
        "evidence": {
            "route_mode": route_mode,
            "citation_count": len(citations),
            "cited_title_count": cited_title_count,
            "retrieval_score": retrieval_quality.get("retrieval_score") if retrieval_quality else None,
            "citation_score": retrieval_quality.get("citation_score") if retrieval_quality else None,
            "retrieval_recommended_action": retrieval_quality.get("recommended_action") if retrieval_quality else None,
            "step_completion_ratio": round_score(step_ratio),
            "output_length": len(final_text),
            "unsafe_markers": unsafe_markers,
            "redaction_marker_count": redaction_marker_count,
        },
        "recommended_actions": recommended_actions,
        "created_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    }
