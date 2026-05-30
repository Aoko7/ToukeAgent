from __future__ import annotations

import json
from typing import Any


def _clone(value: Any) -> Any:
    return json.loads(json.dumps(value))


def _normalize_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _truncate(value: Any, limit: int = 220) -> str:
    text = _normalize_text(value)
    return f"{text[: limit - 3]}..." if len(text) > limit else text


def _estimate_tokens(value: Any) -> int:
    serialized = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return max(1, (len(serialized) + 3) // 4)


def _compact_stream(events: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    compacted = []
    for event in (events or [])[-6:]:
        payload = event.get("payload") if isinstance(event, dict) else {}
        compacted.append({
            "seq": event.get("seq"),
            "type": event.get("event_type"),
            "step_id": event.get("step_id"),
            "summary": _truncate(
                (payload or {}).get("summary")
                or (payload or {}).get("message")
                or (payload or {}).get("text")
                or event.get("event_type"),
                120,
            ),
        })
    return compacted


def _compact_audit(entries: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    return [
        {
            "kind": entry.get("kind"),
            "timestamp": entry.get("timestamp"),
        }
        for entry in (entries or [])[-6:]
    ]


def _build_must_keep(task: dict[str, Any] | None) -> list[str]:
    must_keep = [
        "current step objective",
        "latest tool result",
        "safety boundaries",
    ]
    task = task or {}
    if task.get("status"):
        must_keep.append(f"status:{task['status']}")
    if task.get("current_step_id"):
        must_keep.append(f"current_step:{task['current_step_id']}")
    if isinstance(task.get("metadata"), dict) and task["metadata"].get("control_state"):
        must_keep.append(f"control_state:{task['metadata']['control_state']}")
    return must_keep


def _build_unresolved_items(task: dict[str, Any] | None) -> list[str]:
    task = task or {}
    items: list[str] = []
    metadata = task.get("metadata") if isinstance(task.get("metadata"), dict) else {}

    if task.get("status") == "waiting_approval" or metadata.get("approval_required"):
        items.append("Resolve pending human approval")

    for result in task.get("step_results") or []:
        if not isinstance(result, dict):
            continue
        if result.get("status") == "failed":
            items.append(f"Review failed step {result.get('step_id')}")
        if result.get("status") == "waiting_approval":
            items.append(f"Resume step {result.get('step_id')} after approval")

    return items


def inspect_context_budget(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or {}
    task_id = str(data.get("task_id") or "")
    trace_id = str(data.get("trace_id") or task_id)
    task = data.get("task") if isinstance(data.get("task"), dict) else {}
    stream_events = data.get("stream_events") if isinstance(data.get("stream_events"), list) else []
    audit_entries = data.get("audit_entries") if isinstance(data.get("audit_entries"), list) else []
    memory = data.get("memory") if isinstance(data.get("memory"), dict) else {"short_term": [], "long_term": []}
    handoffs = data.get("handoffs") if isinstance(data.get("handoffs"), list) else []
    scope = str(data.get("scope") or "task")
    model_name = str(data.get("model_name") or "deepseek-chat")
    compression_strategy = str(data.get("compression_strategy") or "hybrid")
    token_budget = int(data.get("token_budget") or 12000)

    short_term = memory.get("short_term") if isinstance(memory.get("short_term"), list) else []
    long_term = memory.get("long_term") if isinstance(memory.get("long_term"), list) else []

    summary_lines = [
        f"Goal: {_truncate(((task.get('plan') or {}).get('goal') if isinstance(task.get('plan'), dict) else None) or (task.get('message') or {}).get('content_preview') or task_id, 160)}",
        (
            "Plan: " + " | ".join(
                f"{index + 1}.{_truncate(step.get('title'), 48)}"
                for index, step in enumerate((task.get("plan") or {}).get("steps") or [])
                if isinstance(step, dict)
            )
        ) if isinstance(task.get("plan"), dict) and (task.get("plan") or {}).get("steps") else None,
        f"Current step: {task.get('current_step_id')}" if task.get("current_step_id") else None,
        f"Latest output: {_truncate(((task.get('output') or {}).get('final_text')), 180)}"
        if isinstance(task.get("output"), dict) and (task.get("output") or {}).get("final_text")
        else None,
        (
            "Recent memory: " + " | ".join(
                _truncate(entry.get("summary") or entry.get("title"), 64)
                for entry in short_term[-3:]
                if isinstance(entry, dict)
            )
        ) if short_term else None,
        (
            "Durable memory: " + " | ".join(
                _truncate(entry.get("title"), 64)
                for entry in long_term[:2]
                if isinstance(entry, dict)
            )
        ) if long_term else None,
        (
            "Handoffs: " + " | ".join(
                f"{item.get('role')}:{item.get('status')}"
                for item in handoffs
                if isinstance(item, dict)
            )
        ) if handoffs else None,
        (
            "Recent audit: " + " | ".join(
                entry.get("kind") or "audit"
                for entry in _compact_audit(audit_entries)
            )
        ) if audit_entries else None,
    ]
    summary = "\n".join(line for line in summary_lines if line)
    must_keep = _build_must_keep(task)
    unresolved_items = _build_unresolved_items(task)
    evidence_refs = [
        *[
            (event.get("payload") or {}).get("call_id")
            for event in stream_events
            if isinstance(event, dict) and event.get("event_type") == "tool_result" and isinstance(event.get("payload"), dict)
        ][-3:],
        *[
            item.get("handoff_id")
            for item in handoffs[-2:]
            if isinstance(item, dict) and item.get("handoff_id")
        ],
    ]
    memory_refs = [
        *[
            entry.get("memory_id")
            for entry in short_term[-3:]
            if isinstance(entry, dict) and entry.get("memory_id")
        ],
        *[
            entry.get("memory_id")
            for entry in long_term[:3]
            if isinstance(entry, dict) and entry.get("memory_id")
        ],
    ]
    source_ranges = [
        f"stream:1-{len(stream_events)}" if stream_events else None,
        f"audit:1-{len(audit_entries)}" if audit_entries else None,
        f"memory:stm:1-{len(short_term)}" if short_term else None,
        f"memory:ltm:1-{len(long_term)}" if long_term else None,
        f"handoff:1-{len(handoffs)}" if handoffs else None,
    ]
    source_ranges = [item for item in source_ranges if item]

    compact_stream = _compact_stream(stream_events)
    compact_audit = _compact_audit(audit_entries)
    token_estimate = _estimate_tokens({
        "summary": summary,
        "mustKeep": must_keep,
        "unresolvedItems": unresolved_items,
        "compact_stream": compact_stream,
        "compact_audit": compact_audit,
    })

    over_budget = token_estimate > token_budget
    return {
        "task_id": task_id,
        "trace_id": trace_id,
        "scope": scope,
        "model_name": model_name,
        "compression_strategy": compression_strategy,
        "source_ranges": source_ranges,
        "token_budget": token_budget,
        "token_estimate": token_estimate,
        "must_keep": must_keep,
        "summary": summary,
        "unresolved_items": unresolved_items,
        "evidence_refs": [item for item in evidence_refs if item],
        "memory_refs": [item for item in memory_refs if item],
        "metadata": {
            "compact_stream": compact_stream,
            "compact_audit": compact_audit,
            "handoff_count": len(handoffs),
            "event_count": len(stream_events),
        },
        "over_budget": over_budget,
        "recommended_action": "compress" if over_budget else "pass_through",
    }


def recover_context_snapshot(payload: dict[str, Any] | None = None) -> dict[str, Any] | None:
    data = payload or {}
    snapshot = data.get("snapshot") if isinstance(data.get("snapshot"), dict) else None
    task = data.get("task") if isinstance(data.get("task"), dict) else None
    if not snapshot:
        return None

    prompt_lines = [
        f"Summary: {snapshot.get('summary')}",
        f"Must keep: {' | '.join(snapshot.get('must_keep') or [])}" if snapshot.get("must_keep") else None,
        f"Unresolved: {' | '.join(snapshot.get('unresolved_items') or [])}" if snapshot.get("unresolved_items") else None,
    ]

    return {
        "snapshot_id": snapshot.get("snapshot_id"),
        "task_id": snapshot.get("task_id"),
        "trace_id": snapshot.get("trace_id"),
        "prompt": "\n".join(line for line in prompt_lines if line),
        "must_keep": _clone(snapshot.get("must_keep") or []),
        "unresolved_items": _clone(snapshot.get("unresolved_items") or []),
        "evidence_refs": _clone(snapshot.get("evidence_refs") or []),
        "memory_refs": _clone(snapshot.get("memory_refs") or []),
        "task_preview": {
            "status": task.get("status"),
            "current_step_id": task.get("current_step_id"),
            "completed_steps": task.get("completed_steps"),
            "total_steps": task.get("total_steps"),
        } if task else None,
    }
