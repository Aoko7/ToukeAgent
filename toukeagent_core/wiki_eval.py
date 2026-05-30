from __future__ import annotations

import uuid
from typing import Any

from .retrieval import build_retrieval_result
from .shared import average, clone


BREAKDOWN_KEYS = ("domain", "route_family", "topic", "language", "expected_bucket", "tags")


def round_metric(value: Any) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        numeric = 0.0
    return round(max(0.0, min(1.0, numeric)), 4)


def judge_decision(score: float) -> str:
    if score >= 0.85:
        return "pass"
    if score >= 0.65:
        return "review"
    return "fail"


def normalize_case(case: dict[str, Any], index: int) -> dict[str, Any]:
    return {
        "case_id": str(case.get("case_id") or f"wiki_case_{index + 1}"),
        "payload": dict(case.get("payload") or {}),
        "reference": dict(case.get("reference") or {}),
        "metadata": dict(case.get("metadata") or {}),
    }


def _matches_expected(actual: Any, expected: Any) -> float:
    if expected is None:
        return 1.0
    return 1.0 if actual == expected else 0.0


def _within_bounds(value: Any, minimum: Any = None, maximum: Any = None) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 0.0
    if minimum is not None and numeric < float(minimum):
        return 0.0
    if maximum is not None and numeric > float(maximum):
        return 0.0
    return 1.0


def _query_frontend_from_retrieval(retrieval: dict[str, Any]) -> dict[str, Any]:
    query_analysis = dict(retrieval.get("query_analysis") or {})
    retrieval_plan = dict(retrieval.get("retrieval_plan") or {})
    plan_frontend = dict(retrieval_plan.get("query_frontend") or {})
    decomposition = dict(query_analysis.get("decomposition") or {})
    rewrites = dict(query_analysis.get("rewrites") or {})
    clarification = dict(query_analysis.get("clarification") or {})
    boundary = dict(query_analysis.get("boundary") or {})
    subqueries = list(decomposition.get("subqueries") or [])
    rewrite_variants = list(rewrites.get("variants") or [])
    preferred_sources = []
    for subquery in subqueries:
        source = str((subquery or {}).get("preferred_source") or "").strip()
        if source and source not in preferred_sources:
            preferred_sources.append(source)
    if not preferred_sources:
        preferred_sources = [str(item).strip() for item in list((query_analysis.get("filter_hints") or {}).get("source_scope") or []) if str(item).strip()]
    return {
        "query_mode": query_analysis.get("query_mode") or plan_frontend.get("query_mode"),
        "boundary_action": boundary.get("action") or plan_frontend.get("boundary_action"),
        "clarification_required": bool(clarification.get("required") or plan_frontend.get("clarification_required")),
        "decomposition_strategy": decomposition.get("strategy") or ("single_pass" if not subqueries else None),
        "rewrite_strategy": rewrites.get("strategy") or ("identity" if not rewrite_variants else None),
        "subquery_count": int(plan_frontend.get("subquery_count") or len(subqueries)),
        "rewrite_count": int(plan_frontend.get("rewrite_count") or len(rewrite_variants)),
        "preferred_sources": preferred_sources,
        "intent_tags": [str(item) for item in list(query_analysis.get("intent_tags") or []) if str(item).strip()],
        "subqueries": clone(subqueries[:4]),
        "rewrite_variants": clone(rewrite_variants[:4]),
        "clarification_questions": [str(item) for item in list(clarification.get("questions") or []) if str(item).strip()],
    }


def summarize_wiki_cases(case_results: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "case_count": len(case_results),
        "judge_pass_rate": round_metric(average([1.0 if case["judge"]["decision"] == "pass" else 0.0 for case in case_results])),
        "route_match_rate": round_metric(average([case["judge"]["dimensions"]["route_match"] for case in case_results])),
        "effective_route_match_rate": round_metric(average([case["judge"]["dimensions"]["effective_route_match"] for case in case_results])),
        "fallback_match_rate": round_metric(average([case["judge"]["dimensions"]["fallback_match"] for case in case_results])),
        "recommended_action_match_rate": round_metric(average([case["judge"]["dimensions"]["recommended_action_match"] for case in case_results])),
        "mean_retrieval_score": round_metric(average([case["retrieval"]["quality"]["retrieval_score"] for case in case_results])),
        "mean_freshness_score": round_metric(average([case["retrieval"]["quality"]["freshness_score"] for case in case_results])),
        "mean_contract_coverage_score": round_metric(average([case["retrieval"]["quality"]["contract_coverage_score"] for case in case_results])),
        "mean_primary_source_count": round_metric(
            average([min(1.0, float(case["retrieval"]["quality"]["primary_source_count"] or 0.0) / 2.0) for case in case_results])
        ),
        "decision_breakdown": {
            "pass": sum(1 for case in case_results if case["judge"]["decision"] == "pass"),
            "review": sum(1 for case in case_results if case["judge"]["decision"] == "review"),
            "fail": sum(1 for case in case_results if case["judge"]["decision"] == "fail"),
        },
    }


def metadata_group_values(case_result: dict[str, Any]) -> list[tuple[str, str]]:
    metadata = dict(case_result.get("metadata") or {})
    groups: list[tuple[str, str]] = []
    for key in BREAKDOWN_KEYS:
        raw_value = metadata.get(key)
        values = raw_value if isinstance(raw_value, list) else [raw_value]
        for value in values:
            label = str(value or "").strip()
            if label:
                groups.append((key, label))
    return groups


def build_metadata_breakdowns(case_results: list[dict[str, Any]]) -> dict[str, dict[str, dict[str, Any]]]:
    grouped: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for case_result in case_results:
        for key, label in metadata_group_values(case_result):
            grouped.setdefault(key, {}).setdefault(label, []).append(case_result)

    breakdowns: dict[str, dict[str, dict[str, Any]]] = {}
    for key, label_map in grouped.items():
        breakdowns[key] = {}
        for label, grouped_cases in sorted(label_map.items()):
            breakdowns[key][label] = {
                **summarize_wiki_cases(grouped_cases),
                "case_ids": [case["case_id"] for case in grouped_cases],
            }
    return breakdowns


def evaluate_wiki_case(case: dict[str, Any], *, index: int = 0) -> dict[str, Any]:
    normalized = normalize_case(case, index)
    reference = normalized["reference"]
    retrieval = build_retrieval_result(dict(normalized["payload"] or {}))
    route = dict(retrieval.get("route") or {})
    quality = dict(retrieval.get("quality") or {})
    citations = [str(item.get("title") or "") for item in list(retrieval.get("citations") or []) if str(item.get("title") or "").strip()]

    dimensions = {
        "route_match": _matches_expected(route.get("mode"), reference.get("expected_route_mode")),
        "effective_route_match": _matches_expected(route.get("effective_mode"), reference.get("expected_effective_mode")),
        "fallback_match": _matches_expected(bool(route.get("fallback_applied")), reference.get("expected_fallback_applied")),
        "recommended_action_match": _matches_expected(quality.get("recommended_action"), reference.get("expected_recommended_action")),
        "retrieval_guard": _within_bounds(
            quality.get("retrieval_score"),
            reference.get("min_retrieval_score"),
            reference.get("max_retrieval_score"),
        ),
        "freshness_guard": _within_bounds(
            quality.get("freshness_score"),
            reference.get("min_freshness_score"),
            reference.get("max_freshness_score"),
        ),
        "contract_guard": _within_bounds(
            quality.get("contract_coverage_score"),
            reference.get("min_contract_coverage_score"),
            reference.get("max_contract_coverage_score"),
        ),
        "primary_source_guard": _within_bounds(
            quality.get("primary_source_count"),
            reference.get("min_primary_source_count"),
            reference.get("max_primary_source_count"),
        ),
        "dynamic_count_guard": _within_bounds(
            len(list(retrieval.get("dynamic_items") or [])),
            reference.get("min_dynamic_count"),
            reference.get("max_dynamic_count"),
        ),
        "citation_guard": 1.0 if not reference.get("required_citation_titles") else round_metric(
            average([1.0 if str(title) in citations else 0.0 for title in list(reference.get("required_citation_titles") or [])])
        ),
    }
    score = round_metric(average(list(dimensions.values())))

    query_frontend = _query_frontend_from_retrieval(retrieval)
    judge = {
        "score": score,
        "decision": judge_decision(score),
        "dimensions": {key: round_metric(value) for key, value in dimensions.items()},
        "route": {
            "actual_route_mode": route.get("mode"),
            "actual_effective_mode": route.get("effective_mode"),
            "fallback_applied": bool(route.get("fallback_applied")),
            "fallback_reason": route.get("fallback_reason"),
        },
        "quality": {
            "retrieval_score": quality.get("retrieval_score"),
            "freshness_score": quality.get("freshness_score"),
            "contract_coverage_score": quality.get("contract_coverage_score"),
            "recommended_action": quality.get("recommended_action"),
            "primary_source_count": quality.get("primary_source_count"),
        },
        "citation_titles": citations,
    }

    return {
        "case_id": normalized["case_id"],
        "metadata": normalized["metadata"],
        "reference": reference,
        "retrieval": retrieval,
        "query_frontend": query_frontend,
        "reviewer_summary": {
            "headline": f"{query_frontend.get('query_mode') or 'unknown'} · {judge.get('decision') or 'unknown'}",
            "decision": judge.get("decision"),
            "score": judge.get("score"),
            "route_mode": route.get("mode"),
            "effective_mode": route.get("effective_mode"),
            "fallback_applied": bool(route.get("fallback_applied")),
            "recommended_action": quality.get("recommended_action"),
            "query_frontend": query_frontend,
        },
        "judge": judge,
    }


def evaluate_wiki_suite(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or {}
    normalized_cases = [normalize_case(case, index) for index, case in enumerate(list(data.get("cases") or []))]
    case_results = [evaluate_wiki_case(case, index=index) for index, case in enumerate(normalized_cases)]
    summary = summarize_wiki_cases(case_results)
    summary["metadata_breakdowns"] = build_metadata_breakdowns(case_results)

    return {
        "run_id": f"wiki_eval_{uuid.uuid4()}",
        "metadata": dict(data.get("metadata") or {}),
        "summary": summary,
        "cases": case_results,
    }
