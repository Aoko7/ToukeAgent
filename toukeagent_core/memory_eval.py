from __future__ import annotations

import re
import uuid
from typing import Any

from .memory_provider import describe_memory_provider_strategy
from .shared import average, clone


TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_.-]+|[\u4e00-\u9fff]{1,8}")
BREAKDOWN_KEYS = ("case_type", "provider", "language", "tags")
CASE_TYPES = {"durable_write", "memory_recall", "compression_fidelity", "handoff_sufficiency"}


def round_metric(value: Any) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        numeric = 0.0
    return round(max(0.0, min(1.0, numeric)), 4)


def normalize_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip().casefold()


def phrase_matches(reference_text: str, candidate_text: str) -> bool:
    normalized_reference = normalize_text(reference_text)
    normalized_candidate = normalize_text(candidate_text)
    if not normalized_reference or not normalized_candidate:
        return False
    if normalized_reference in normalized_candidate:
        return True
    reference_terms = [match.group(0).casefold() for match in TOKEN_PATTERN.finditer(reference_text)]
    candidate_terms = {match.group(0).casefold() for match in TOKEN_PATTERN.finditer(candidate_text)}
    if not reference_terms:
        return False
    matched = sum(1 for term in reference_terms if term in candidate_terms)
    required = 1 if len(reference_terms) <= 2 else max(2, len(reference_terms) // 2)
    return matched >= required


def judge_decision(score: float) -> str:
    if score >= 0.8:
        return "pass"
    if score >= 0.6:
        return "review"
    return "fail"


def _memory_units(memories: list[dict[str, Any]] | None) -> list[str]:
    units: list[str] = []
    for memory in memories or []:
        if not isinstance(memory, dict):
            continue
        values = [
            memory.get("title"),
            memory.get("summary"),
            memory.get("content"),
            *list(memory.get("facts") or []),
            *list(memory.get("tags") or []),
        ]
        for value in values:
            text = str(value or "").strip()
            if text:
                units.append(text)
    return units


def _case_metric_average(case_results: list[dict[str, Any]], metric_name: str) -> float:
    values = [
        float(case["judge"]["dimensions"][metric_name])
        for case in case_results
        if metric_name in case["judge"]["dimensions"]
    ]
    return round_metric(average(values))


def _build_breakdowns(case_results: list[dict[str, Any]]) -> dict[str, dict[str, dict[str, Any]]]:
    grouped: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for case in case_results:
        metadata = dict(case.get("metadata") or {})
        for key in BREAKDOWN_KEYS:
            raw = metadata.get(key)
            values = raw if isinstance(raw, list) else [raw]
            for value in values:
                label = str(value or "").strip()
                if not label:
                    continue
                grouped.setdefault(key, {}).setdefault(label, []).append(case)

    return {
        key: {
            label: {
                "case_count": len(items),
                "pass_rate": round_metric(average([1.0 if item["judge"]["decision"] == "pass" else 0.0 for item in items])),
                "mean_overall_score": round_metric(average([item["judge"]["score"] for item in items])),
            }
            for label, items in labels.items()
        }
        for key, labels in grouped.items()
    }


def _evaluate_durable_write(reference: dict[str, Any], observed: dict[str, Any]) -> tuple[dict[str, float], dict[str, Any]]:
    promoted_memories = observed.get("promoted_memories") or observed.get("promotedMemories") or []
    memory_text = "\n".join(_memory_units(promoted_memories))
    expected_phrases = [str(value) for value in list(reference.get("expected_phrases") or []) if str(value).strip()]
    disallowed_phrases = [str(value) for value in list(reference.get("disallowed_phrases") or []) if str(value).strip()]
    expected_hits = [phrase for phrase in expected_phrases if phrase_matches(phrase, memory_text)]
    disallowed_hits = [phrase for phrase in disallowed_phrases if phrase_matches(phrase, memory_text)]

    recall = round_metric(len(expected_hits) / len(expected_phrases)) if expected_phrases else 1.0
    precision_denominator = len(expected_hits) + len(disallowed_hits)
    precision = round_metric(len(expected_hits) / precision_denominator) if precision_denominator else 1.0
    return (
        {
            "durable_write_precision": precision,
            "durable_write_recall": recall,
        },
        {
            "promoted_count": len(promoted_memories),
            "expected_hits": expected_hits,
            "disallowed_hits": disallowed_hits,
        },
    )


def _evaluate_memory_recall(reference: dict[str, Any], observed: dict[str, Any]) -> tuple[dict[str, float], dict[str, Any]]:
    retrieved = list(observed.get("retrieved_memories") or observed.get("retrievedMemories") or [])
    top_k = int(reference.get("top_k") or len(retrieved) or 1)
    expected_ids = [str(value) for value in list(reference.get("expected_memory_ids") or []) if str(value).strip()]
    stale_ids = {str(value) for value in list(reference.get("stale_memory_ids") or []) if str(value).strip()}
    top_items = retrieved[:top_k]
    found_ids = {
        str(item.get("memory_id"))
        for item in top_items
        if isinstance(item, dict) and item.get("memory_id")
    }
    recall_at_k = round_metric(sum(1 for item in expected_ids if item in found_ids) / len(expected_ids)) if expected_ids else 1.0
    stale_hits = [
        str(item.get("memory_id"))
        for item in top_items
        if isinstance(item, dict)
        and (
            item.get("stale") is True
            or str(item.get("memory_id") or "") in stale_ids
        )
    ]
    stale_rate = round_metric(len(stale_hits) / len(top_items)) if top_items else 0.0
    return (
        {
            "memory_recall_at_k": recall_at_k,
            "stale_memory_rate": stale_rate,
            "stale_memory_cleanliness": round_metric(1 - stale_rate),
        },
        {
            "top_k": top_k,
            "expected_memory_ids": expected_ids,
            "retrieved_memory_ids": sorted(found_ids),
            "stale_hits": stale_hits,
        },
    )


def _evaluate_compression_fidelity(reference: dict[str, Any], observed: dict[str, Any]) -> tuple[dict[str, float], dict[str, Any]]:
    snapshot = dict(observed.get("snapshot") or {})
    must_keep = [str(value) for value in list(snapshot.get("must_keep") or []) if str(value).strip()]
    unresolved_items = [str(value) for value in list(snapshot.get("unresolved_items") or []) if str(value).strip()]
    memory_refs = [str(value) for value in list(snapshot.get("memory_refs") or []) if str(value).strip()]
    expected_must_keep = [str(value) for value in list(reference.get("expected_must_keep") or []) if str(value).strip()]
    expected_unresolved = [str(value) for value in list(reference.get("expected_unresolved_items") or []) if str(value).strip()]
    expected_memory_refs = [str(value) for value in list(reference.get("expected_memory_refs") or []) if str(value).strip()]

    must_keep_retention = round_metric(sum(1 for item in expected_must_keep if item in must_keep) / len(expected_must_keep)) if expected_must_keep else 1.0
    unresolved_retention = round_metric(sum(1 for item in expected_unresolved if item in unresolved_items) / len(expected_unresolved)) if expected_unresolved else 1.0
    memory_ref_retention = round_metric(sum(1 for item in expected_memory_refs if item in memory_refs) / len(expected_memory_refs)) if expected_memory_refs else 1.0
    return (
        {
            "compression_must_keep_retention": must_keep_retention,
            "compression_unresolved_retention": unresolved_retention,
            "compression_memory_ref_retention": memory_ref_retention,
        },
        {
            "must_keep": must_keep,
            "unresolved_items": unresolved_items,
            "memory_refs": memory_refs,
        },
    )


def _evaluate_handoff_sufficiency(reference: dict[str, Any], observed: dict[str, Any]) -> tuple[dict[str, float], dict[str, Any]]:
    handoff = dict(observed.get("handoff") or {})
    required_fields = [str(value) for value in list(reference.get("required_fields") or []) if str(value).strip()]
    present_fields: list[str] = []
    missing_fields: list[str] = []
    for field in required_fields:
        value = handoff.get(field)
        if isinstance(value, list):
            ok = len(value) > 0
        elif isinstance(value, dict):
            ok = bool(value)
        else:
            ok = str(value or "").strip() != ""
        if ok:
            present_fields.append(field)
        else:
            missing_fields.append(field)
    sufficiency = round_metric(len(present_fields) / len(required_fields)) if required_fields else 1.0
    return (
        {
            "handoff_sufficiency_rate": sufficiency,
        },
        {
            "present_fields": present_fields,
            "missing_fields": missing_fields,
        },
    )


def _normalize_case(case_item: dict[str, Any], index: int) -> dict[str, Any]:
    case_type = str(case_item.get("case_type") or case_item.get("type") or "").strip()
    if case_type not in CASE_TYPES:
        raise ValueError(f"Unsupported memory case type: {case_type or '<missing>'}")
    provider = str(case_item.get("provider") or (case_item.get("metadata") or {}).get("provider") or "local_builtin")
    metadata = clone(case_item.get("metadata") or {})
    metadata.setdefault("case_type", case_type)
    metadata.setdefault("provider", provider)
    return {
        "case_id": str(case_item.get("case_id") or f"memory_case_{index + 1}"),
        "case_type": case_type,
        "provider": provider,
        "provider_config": clone(case_item.get("provider_config") or {"provider": provider}),
        "reference": clone(case_item.get("reference") or {}),
        "observed": clone(case_item.get("observed") or {}),
        "metadata": metadata,
    }


def evaluate_memory_suite(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or {}
    raw_cases = list(data.get("cases") or [])
    normalized_cases = [_normalize_case(case_item, index) for index, case_item in enumerate(raw_cases)]
    case_results: list[dict[str, Any]] = []

    evaluators = {
        "durable_write": _evaluate_durable_write,
        "memory_recall": _evaluate_memory_recall,
        "compression_fidelity": _evaluate_compression_fidelity,
        "handoff_sufficiency": _evaluate_handoff_sufficiency,
    }

    for case in normalized_cases:
        dimensions, details = evaluators[case["case_type"]](case["reference"], case["observed"])
        score_dimensions = [
            value
            for key, value in dimensions.items()
            if key not in {"stale_memory_rate"}
        ]
        score = round_metric(average(score_dimensions))
        case_results.append(
            {
                "case_id": case["case_id"],
                "case_type": case["case_type"],
                "provider": case["provider"],
                "provider_strategy": describe_memory_provider_strategy(case["provider_config"]),
                "reference": case["reference"],
                "observed": case["observed"],
                "metadata": case["metadata"],
                "reviewer_summary": {
                    "headline": f"{case['case_type']} · {judge_decision(score)}",
                    "decision": judge_decision(score),
                    "score": score,
                    "case_type": case["case_type"],
                    "provider": case["provider"],
                    "top_dimension": max(dimensions, key=lambda key: dimensions[key]) if dimensions else None,
                    "weakest_dimension": min(dimensions, key=lambda key: dimensions[key]) if dimensions else None,
                },
                "judge": {
                    "decision": judge_decision(score),
                    "score": score,
                    "dimensions": dimensions,
                    "details": details,
                },
            }
        )

    summary = {
        "case_count": len(case_results),
        "pass_rate": round_metric(average([1.0 if case["judge"]["decision"] == "pass" else 0.0 for case in case_results])),
        "review_rate": round_metric(average([1.0 if case["judge"]["decision"] == "review" else 0.0 for case in case_results])),
        "fail_rate": round_metric(average([1.0 if case["judge"]["decision"] == "fail" else 0.0 for case in case_results])),
        "mean_overall_score": round_metric(average([case["judge"]["score"] for case in case_results])),
        "mean_durable_write_precision": _case_metric_average(case_results, "durable_write_precision"),
        "mean_durable_write_recall": _case_metric_average(case_results, "durable_write_recall"),
        "mean_memory_recall_at_k": _case_metric_average(case_results, "memory_recall_at_k"),
        "mean_stale_memory_rate": _case_metric_average(case_results, "stale_memory_rate"),
        "mean_compression_must_keep_retention": _case_metric_average(case_results, "compression_must_keep_retention"),
        "mean_handoff_sufficiency_rate": _case_metric_average(case_results, "handoff_sufficiency_rate"),
        "decision_breakdown": {
            "pass": sum(1 for case in case_results if case["judge"]["decision"] == "pass"),
            "review": sum(1 for case in case_results if case["judge"]["decision"] == "review"),
            "fail": sum(1 for case in case_results if case["judge"]["decision"] == "fail"),
        },
        "metadata_breakdowns": _build_breakdowns(case_results),
    }

    return {
        "run_id": f"memory_eval_{uuid.uuid4().hex[:12]}",
        "metadata": clone(data.get("metadata") or {}),
        "summary": summary,
        "cases": case_results,
    }
