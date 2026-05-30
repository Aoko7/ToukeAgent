from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any


def _round_score(value: Any) -> float:
    return round(max(0.0, min(1.0, float(value or 0))) * 10000) / 10000


def _stable_fraction(seed: Any) -> float:
    text = str(seed or "")
    hash_value = 2166136261
    for char in text:
        hash_value ^= ord(char)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return hash_value / 4294967296


def evaluate_quality_gate(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or {}
    evaluation = data.get("evaluation") if isinstance(data.get("evaluation"), dict) else data
    sample_rate = float(data.get("sample_rate") if "sample_rate" in data else 0)
    sample_seed = (
        evaluation.get("trace_id")
        or evaluation.get("task_id")
        or evaluation.get("evaluation_id")
        or f"gate_{uuid.uuid4()}"
    )
    sampled = (
        evaluation.get("decision") == "pass"
        and sample_rate > 0
        and _stable_fraction(sample_seed) < sample_rate
    )
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    if evaluation.get("decision") == "fail":
        return {
            "gate_id": f"gate_{uuid.uuid4()}",
            "task_id": evaluation.get("task_id"),
            "trace_id": evaluation.get("trace_id"),
            "evaluation_id": evaluation.get("evaluation_id"),
            "status": "blocked",
            "review_required": True,
            "sampled": False,
            "reason": "quality_gate_failed",
            "priority": "high",
            "recommended_actions": list(evaluation.get("recommended_actions") or []),
            "score": _round_score(evaluation.get("overall_score")),
            "created_at": now,
        }

    if evaluation.get("decision") == "review":
        return {
            "gate_id": f"gate_{uuid.uuid4()}",
            "task_id": evaluation.get("task_id"),
            "trace_id": evaluation.get("trace_id"),
            "evaluation_id": evaluation.get("evaluation_id"),
            "status": "review_required",
            "review_required": True,
            "sampled": False,
            "reason": "quality_gate_review",
            "priority": "medium",
            "recommended_actions": list(evaluation.get("recommended_actions") or []),
            "score": _round_score(evaluation.get("overall_score")),
            "created_at": now,
        }

    return {
        "gate_id": f"gate_{uuid.uuid4()}",
        "task_id": evaluation.get("task_id"),
        "trace_id": evaluation.get("trace_id"),
        "evaluation_id": evaluation.get("evaluation_id"),
        "status": "passed",
        "review_required": sampled,
        "sampled": sampled,
        "reason": "online_sampled_review" if sampled else "quality_gate_passed",
        "priority": "low" if sampled else "none",
        "recommended_actions": ["human_review"] if sampled else [],
        "score": _round_score(evaluation.get("overall_score")),
        "created_at": now,
    }
