from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


DEFAULT_GOVERNANCE_POLICY = {
    "online": {
        "max_task_duration_ms": 30000,
        "max_stream_events": 128,
        "max_review_count": 2,
        "min_quality_score": 0.6,
    },
    "async": {
        "max_queue_depth": 8,
        "max_active_workers": 4,
    },
    "budget": {
        "max_tool_calls": 4,
        "max_audit_entries": 48,
        "max_estimated_cost_units": 40,
    },
}


def _clone(value: Any) -> Any:
    import json
    return json.loads(json.dumps(value))


def _round(value: Any) -> float:
    return round((float(value or 0)) * 100) / 100


def normalize_governance_policy(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    overrides = (payload or {}).get("policy") if isinstance((payload or {}).get("policy"), dict) else (payload or {})
    base = _clone(DEFAULT_GOVERNANCE_POLICY)
    for key in ("online", "async", "budget"):
        if isinstance(overrides.get(key), dict):
            base[key].update(overrides[key])
    return base


def _parse_time(value: Any) -> int | None:
    try:
        text = str(value or "")
        if not text:
            return None
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return int(dt.timestamp() * 1000)
    except Exception:
        return None


def _compute_task_duration_ms(task: dict[str, Any] | None, stream_events: list[dict[str, Any]] | None = None) -> int:
    event_times = [value for value in (_parse_time((event or {}).get("timestamp")) for event in (stream_events or [])) if value is not None]
    if len(event_times) >= 2:
        return max(0, event_times[-1] - event_times[0])

    created_at = _parse_time((task or {}).get("created_at"))
    updated_at = _parse_time((task or {}).get("updated_at"))
    if created_at is not None and updated_at is not None:
        return max(0, updated_at - created_at)
    return 0


def _estimate_cost_units(duration_ms: Any = 0, event_count: Any = 0, audit_count: Any = 0, tool_call_count: Any = 0, review_count: Any = 0) -> float:
    return _round(
        (float(duration_ms or 0) / 1000.0) * 0.25
        + float(event_count or 0) * 0.15
        + float(audit_count or 0) * 0.1
        + float(tool_call_count or 0) * 4
        + float(review_count or 0) * 8
    )


def _severity_for_ratio(observed: Any, threshold: Any) -> str:
    try:
        observed_value = float(observed)
        threshold_value = float(threshold)
    except (TypeError, ValueError):
        return "medium"
    if threshold_value <= 0:
        return "medium"
    return "high" if observed_value >= threshold_value * 2 else "medium"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def evaluate_worker_governance(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or {}
    policy = normalize_governance_policy({"policy": data.get("policy") or {}})
    worker_snapshot = data.get("worker_snapshot") if isinstance(data.get("worker_snapshot"), dict) else {}
    metrics = {
        "queue_depth": int(worker_snapshot.get("queued") or 0),
        "active_workers": int(worker_snapshot.get("active") or 0),
    }
    alerts: list[dict[str, Any]] = []

    if metrics["queue_depth"] > policy["async"]["max_queue_depth"]:
        alerts.append({
            "dedupe_key": "system:async_queue_backlog",
            "scope": "system",
            "category": "slo",
            "code": "async_queue_backlog",
            "severity": _severity_for_ratio(metrics["queue_depth"], policy["async"]["max_queue_depth"]),
            "message": f"Async queue depth {metrics['queue_depth']} exceeded threshold {policy['async']['max_queue_depth']}",
            "observed": metrics["queue_depth"],
            "threshold": policy["async"]["max_queue_depth"],
            "metadata": {"worker_snapshot": _clone(worker_snapshot)},
        })

    if metrics["active_workers"] > policy["async"]["max_active_workers"]:
        alerts.append({
            "dedupe_key": "system:async_worker_saturation",
            "scope": "system",
            "category": "slo",
            "code": "async_worker_saturation",
            "severity": _severity_for_ratio(metrics["active_workers"], policy["async"]["max_active_workers"]),
            "message": f"Active worker count {metrics['active_workers']} exceeded threshold {policy['async']['max_active_workers']}",
            "observed": metrics["active_workers"],
            "threshold": policy["async"]["max_active_workers"],
            "metadata": {"worker_snapshot": _clone(worker_snapshot)},
        })

    return {
        "scope": "system",
        "status": "breached" if alerts else "ok",
        "policy": _clone(policy["async"]),
        "metrics": metrics,
        "alerts": alerts,
        "created_at": _now(),
    }


def evaluate_task_governance(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or {}
    policy = normalize_governance_policy({"policy": data.get("policy") or {}})
    task = data.get("task") if isinstance(data.get("task"), dict) else {}
    trace_bundle = data.get("trace_bundle") if isinstance(data.get("trace_bundle"), dict) else {}
    worker_snapshot = data.get("worker_snapshot") if isinstance(data.get("worker_snapshot"), dict) else {}
    trace_metrics = trace_bundle.get("metrics") if isinstance(trace_bundle.get("metrics"), dict) else {}
    metrics = {
        "task_duration_ms": _compute_task_duration_ms(task, trace_bundle.get("stream_events") if isinstance(trace_bundle.get("stream_events"), list) else []),
        "event_count": int(trace_metrics.get("event_count") or 0),
        "audit_count": int(trace_metrics.get("audit_count") or 0),
        "tool_call_count": int(trace_metrics.get("tool_call_count") or 0),
        "review_count": int(trace_metrics.get("review_count") or 0),
        "quality_score": trace_metrics.get("quality_score"),
        "quality_decision": trace_metrics.get("quality_decision"),
        "queue_depth": int(worker_snapshot.get("queued") or 0),
        "active_workers": int(worker_snapshot.get("active") or 0),
    }
    metrics["estimated_cost_units"] = _estimate_cost_units(
        duration_ms=metrics["task_duration_ms"],
        event_count=metrics["event_count"],
        audit_count=metrics["audit_count"],
        tool_call_count=metrics["tool_call_count"],
        review_count=metrics["review_count"],
    )

    task_id = task.get("task_id") or trace_bundle.get("task_id")
    trace_id = task.get("trace_id") or trace_bundle.get("trace_id") or task_id
    alerts: list[dict[str, Any]] = []

    def add_alert(code: str, *, category: str, severity: str, message: str, observed: Any, threshold: Any):
        alerts.append({
            "dedupe_key": f"{task_id}:{code}",
            "scope": "task",
            "category": category,
            "code": code,
            "task_id": task_id,
            "trace_id": trace_id,
            "severity": severity,
            "message": message,
            "observed": observed,
            "threshold": threshold,
        })

    if metrics["task_duration_ms"] > policy["online"]["max_task_duration_ms"]:
        add_alert(
            "task_latency_breach",
            category="slo",
            severity=_severity_for_ratio(metrics["task_duration_ms"], policy["online"]["max_task_duration_ms"]),
            message=f"Task duration {metrics['task_duration_ms']}ms exceeded threshold {policy['online']['max_task_duration_ms']}ms",
            observed=metrics["task_duration_ms"],
            threshold=policy["online"]["max_task_duration_ms"],
        )
    if metrics["event_count"] > policy["online"]["max_stream_events"]:
        add_alert(
            "stream_budget_breach",
            category="budget",
            severity=_severity_for_ratio(metrics["event_count"], policy["online"]["max_stream_events"]),
            message=f"Stream event count {metrics['event_count']} exceeded threshold {policy['online']['max_stream_events']}",
            observed=metrics["event_count"],
            threshold=policy["online"]["max_stream_events"],
        )
    if metrics["tool_call_count"] > policy["budget"]["max_tool_calls"]:
        add_alert(
            "tool_budget_breach",
            category="budget",
            severity=_severity_for_ratio(metrics["tool_call_count"], policy["budget"]["max_tool_calls"]),
            message=f"Tool call count {metrics['tool_call_count']} exceeded threshold {policy['budget']['max_tool_calls']}",
            observed=metrics["tool_call_count"],
            threshold=policy["budget"]["max_tool_calls"],
        )
    if metrics["audit_count"] > policy["budget"]["max_audit_entries"]:
        add_alert(
            "audit_budget_breach",
            category="budget",
            severity=_severity_for_ratio(metrics["audit_count"], policy["budget"]["max_audit_entries"]),
            message=f"Audit entry count {metrics['audit_count']} exceeded threshold {policy['budget']['max_audit_entries']}",
            observed=metrics["audit_count"],
            threshold=policy["budget"]["max_audit_entries"],
        )
    if metrics["review_count"] > policy["online"]["max_review_count"]:
        add_alert(
            "review_backlog_breach",
            category="slo",
            severity=_severity_for_ratio(metrics["review_count"], policy["online"]["max_review_count"]),
            message=f"Review count {metrics['review_count']} exceeded threshold {policy['online']['max_review_count']}",
            observed=metrics["review_count"],
            threshold=policy["online"]["max_review_count"],
        )
    quality_score = metrics.get("quality_score")
    if quality_score is not None and float(quality_score) < float(policy["online"]["min_quality_score"]):
        add_alert(
            "quality_slo_breach",
            category="slo",
            severity=_severity_for_ratio(policy["online"]["min_quality_score"], max(float(quality_score), 0.01)),
            message=f"Quality score {quality_score} fell below threshold {policy['online']['min_quality_score']}",
            observed=quality_score,
            threshold=policy["online"]["min_quality_score"],
        )

    gate_status = trace_metrics.get("gate_status")
    if gate_status in {"review_required", "blocked"} or metrics.get("quality_decision") in {"review", "fail"}:
        add_alert(
            "quality_gate_breach",
            category="slo",
            severity="high" if gate_status == "blocked" or metrics.get("quality_decision") == "fail" else "medium",
            message=f"Quality gate requires attention: {gate_status or metrics.get('quality_decision')}",
            observed=gate_status or metrics.get("quality_decision"),
            threshold="passed",
        )
    if metrics["estimated_cost_units"] > policy["budget"]["max_estimated_cost_units"]:
        add_alert(
            "cost_budget_breach",
            category="budget",
            severity=_severity_for_ratio(metrics["estimated_cost_units"], policy["budget"]["max_estimated_cost_units"]),
            message=f"Estimated cost units {metrics['estimated_cost_units']} exceeded threshold {policy['budget']['max_estimated_cost_units']}",
            observed=metrics["estimated_cost_units"],
            threshold=policy["budget"]["max_estimated_cost_units"],
        )

    async_result = evaluate_worker_governance({
        "policy": policy,
        "worker_snapshot": worker_snapshot,
    })
    task_alerts = alerts + async_result["alerts"]
    return {
        "scope": "task",
        "task_id": task_id,
        "trace_id": trace_id,
        "status": "breached" if task_alerts else "ok",
        "metrics": metrics,
        "alerts": task_alerts,
        "policy": _clone(policy),
        "created_at": _now(),
    }
