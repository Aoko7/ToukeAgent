from __future__ import annotations

import re
import uuid
from typing import Any

from .evaluator import evaluate_output, extract_retrieval_result
from .shared import average, clone, extract_user_text


TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_.-]+|[\u4e00-\u9fff]{1,8}")
SENTENCE_SPLIT_PATTERN = re.compile(r"(?<=[.!?。！？])\s+|\n+")
STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "how",
    "in",
    "into",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "what",
    "with",
    "请",
    "告诉",
    "最新",
    "当前",
    "一下",
    "一下子",
    "如何",
    "什么",
}
BREAKDOWN_KEYS = ("domain", "route_family", "topic", "language", "expected_bucket", "tags")
CLARIFY_HINTS = (
    "请补充",
    "请确认",
    "请说明",
    "请提供",
    "需要更多信息",
    "what specific",
    "please provide",
    "please clarify",
)
ABSTAIN_HINTS = (
    "超出我的处理范围",
    "无法根据当前资料",
    "没有足够证据",
    "需要人工处理",
    "不能直接",
    "不应直接",
    "人工复核",
    "补充 rag",
    "out of scope",
    "insufficient evidence",
    "cannot determine",
    "need human review",
)


def round_metric(value: Any) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        numeric = 0.0
    return round(max(0.0, min(1.0, numeric)), 4)


def normalize_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip().casefold()


def tokenize(value: Any) -> list[str]:
    return [match.group(0).casefold() for match in TOKEN_PATTERN.finditer(str(value or ""))]


def extract_terms(value: Any, *, limit: int = 12) -> list[str]:
    terms: list[str] = []
    seen: set[str] = set()
    for token in tokenize(value):
        if token in STOPWORDS or token in seen:
            continue
        seen.add(token)
        terms.append(token)
        if len(terms) >= limit:
            break
    return terms


def reference_phrase_matches(reference_text: str, candidate_text: str) -> bool:
    normalized_reference = normalize_text(reference_text)
    normalized_candidate = normalize_text(candidate_text)
    if not normalized_reference or not normalized_candidate:
        return False
    if normalized_reference in normalized_candidate:
        return True
    reference_terms = extract_terms(reference_text, limit=16)
    if not reference_terms:
        return False
    candidate_terms = set(extract_terms(candidate_text, limit=64))
    matched = sum(1 for term in reference_terms if term in candidate_terms)
    required = 1 if len(reference_terms) <= 2 else max(2, len(reference_terms) // 2)
    return matched >= required


def coverage_ratio(reference_points: list[str], candidate_text: str) -> float:
    if not reference_points:
        return 1.0
    matched = sum(1 for point in reference_points if reference_phrase_matches(point, candidate_text))
    return round_metric(matched / len(reference_points))


def sentence_units(text: str) -> list[str]:
    units = [segment.strip() for segment in SENTENCE_SPLIT_PATTERN.split(str(text or "")) if segment.strip()]
    return units or ([str(text or "").strip()] if str(text or "").strip() else [])


def evidence_units(retrieval_result: dict[str, Any] | None) -> list[str]:
    if not retrieval_result:
        return []
    units: list[str] = []
    for chunk in list(retrieval_result.get("supporting_chunks") or []):
        units.append(str(chunk.get("snippet") or chunk.get("text") or ""))
    for item in list(retrieval_result.get("items") or []):
        units.append(str(item.get("summary") or item.get("text") or ""))
        for fact in list(item.get("facts") or []):
            units.append(str(fact))
        for chunk in list(item.get("supporting_chunks") or []):
            units.append(str(chunk.get("snippet") or chunk.get("text") or ""))
    deduped: list[str] = []
    seen: set[str] = set()
    for unit in units:
        normalized = normalize_text(unit)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(unit.strip())
    return deduped


def citation_match_rate(required_citations: list[str], retrieval_result: dict[str, Any] | None, final_text: str) -> float:
    if not required_citations:
        return 1.0
    normalized_final = normalize_text(final_text)
    citation_titles = [normalize_text(citation.get("title")) for citation in list((retrieval_result or {}).get("citations") or [])]
    matched = 0
    for title in required_citations:
        normalized_title = normalize_text(title)
        if not normalized_title:
            continue
        if normalized_title in normalized_final or normalized_title in citation_titles:
            matched += 1
    return round_metric(matched / len(required_citations))


def query_answer_relevancy(query_text: str, answer_text: str) -> float:
    query_terms = extract_terms(query_text, limit=10)
    if not query_terms:
        return 1.0
    answer_terms = set(extract_terms(answer_text, limit=64))
    matched = sum(1 for term in query_terms if term in answer_terms)
    return round_metric(matched / len(query_terms))


def detect_behavior(answer_text: str) -> str:
    lowered = normalize_text(answer_text)
    if any(hint in lowered for hint in ABSTAIN_HINTS):
        return "abstain"
    if any(hint in lowered for hint in CLARIFY_HINTS) or ("?" in answer_text and len(extract_terms(answer_text, limit=32)) <= 20):
        return "clarify"
    return "answer"


def evidence_precision(reference_points: list[str], evidence: list[str]) -> float:
    if not evidence:
        return 0.0
    if not reference_points:
        return 1.0
    matched_units = 0
    for unit in evidence:
        if any(reference_phrase_matches(point, unit) for point in reference_points):
            matched_units += 1
    return round_metric(matched_units / len(evidence))


def route_consistency(reference: dict[str, Any], retrieval_result: dict[str, Any] | None) -> tuple[float, dict[str, Any]]:
    route = dict((retrieval_result or {}).get("route") or {})
    comparisons: list[float] = []
    expected_route_mode = reference.get("expected_route_mode")
    expected_effective_mode = reference.get("expected_effective_mode")
    if expected_route_mode:
        comparisons.append(1.0 if route.get("mode") == expected_route_mode else 0.0)
    if expected_effective_mode:
        comparisons.append(1.0 if route.get("effective_mode") == expected_effective_mode else 0.0)
    return (
        round_metric(average(comparisons) if comparisons else 1.0),
        {
            "expected_route_mode": expected_route_mode,
            "expected_effective_mode": expected_effective_mode,
            "actual_route_mode": route.get("mode"),
            "actual_effective_mode": route.get("effective_mode"),
            "fallback_applied": route.get("fallback_applied"),
        },
    )


def judge_decision(score: float) -> str:
    if score >= 0.8:
        return "pass"
    if score >= 0.6:
        return "review"
    return "fail"


def _query_frontend_from_retrieval_result(retrieval_result: dict[str, Any] | None) -> dict[str, Any]:
    retrieval_result = dict(retrieval_result or {})
    query_analysis = dict(retrieval_result.get("query_analysis") or {})
    retrieval_plan = dict(retrieval_result.get("retrieval_plan") or {})
    plan_frontend = dict(retrieval_plan.get("query_frontend") or {})
    decomposition = dict(query_analysis.get("decomposition") or {})
    rewrites = dict(query_analysis.get("rewrites") or {})
    clarification = dict(query_analysis.get("clarification") or {})
    boundary = dict(query_analysis.get("boundary") or {})
    filter_hints = dict(query_analysis.get("filter_hints") or {})
    subqueries = list(decomposition.get("subqueries") or [])
    rewrite_variants = list(rewrites.get("variants") or [])
    preferred_sources = []
    for subquery in subqueries:
        source = str((subquery or {}).get("preferred_source") or "").strip()
        if source and source not in preferred_sources:
            preferred_sources.append(source)
    if not preferred_sources:
        preferred_sources = [str(item).strip() for item in list(filter_hints.get("source_scope") or []) if str(item).strip()]
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


def _build_generation_reviewer_summary(
    *,
    query_text: str,
    retrieval_result: dict[str, Any] | None,
    judge: dict[str, Any],
    runtime_evaluation: dict[str, Any],
) -> dict[str, Any]:
    route = dict((retrieval_result or {}).get("route") or {})
    quality = dict((retrieval_result or {}).get("quality") or {})
    query_frontend = _query_frontend_from_retrieval_result(retrieval_result)
    return {
        "headline": f"{query_frontend.get('query_mode') or 'unknown'} · {judge.get('decision') or 'unknown'}",
        "query": query_text,
        "decision": judge.get("decision"),
        "score": judge.get("score"),
        "expected_decision": judge.get("expected_decision"),
        "route_mode": route.get("mode"),
        "effective_mode": route.get("effective_mode"),
        "fallback_applied": bool(route.get("fallback_applied")),
        "recommended_action": quality.get("recommended_action") or runtime_evaluation.get("decision"),
        "behavior": clone(judge.get("behavior") or {}),
        "query_frontend": query_frontend,
    }


def _cases_with_expected_decision(case_results: list[dict[str, Any]], decision: str) -> list[dict[str, Any]]:
    return [case for case in case_results if str((case.get("reference") or {}).get("expected_decision") or "").strip() == decision]


def _optional_rate(case_results: list[dict[str, Any]], predicate) -> float | None:
    if not case_results:
        return None
    return round_metric(average([1.0 if predicate(case) else 0.0 for case in case_results]))


def summarize_generation_cases(case_results: list[dict[str, Any]]) -> dict[str, Any]:
    expected_pass_cases = _cases_with_expected_decision(case_results, "pass")
    expected_review_cases = _cases_with_expected_decision(case_results, "review")
    expected_fail_cases = _cases_with_expected_decision(case_results, "fail")
    expected_non_pass_cases = [*expected_review_cases, *expected_fail_cases]

    return {
        "case_count": len(case_results),
        "judge_pass_rate": round_metric(average([1.0 if case["judge"]["decision"] == "pass" else 0.0 for case in case_results])),
        "decision_match_rate": round_metric(average([1.0 if case["judge"]["decision_matches_expected"] else 0.0 for case in case_results])),
        "expected_outcome_rate": round_metric(average([1.0 if case["judge"]["decision_matches_expected"] else 0.0 for case in case_results])),
        "route_match_rate": round_metric(average([case["judge"]["dimensions"]["route_consistency"] for case in case_results])),
        "mean_behavior_alignment": round_metric(average([case["judge"]["dimensions"]["behavior_alignment"] for case in case_results])),
        "mean_faithfulness": round_metric(average([case["judge"]["dimensions"]["faithfulness"] for case in case_results])),
        "mean_answer_relevancy": round_metric(average([case["judge"]["dimensions"]["answer_relevancy"] for case in case_results])),
        "mean_context_recall": round_metric(average([case["judge"]["dimensions"]["context_recall"] for case in case_results])),
        "mean_context_precision": round_metric(average([case["judge"]["dimensions"]["context_precision"] for case in case_results])),
        "mean_citation_match_rate": round_metric(average([case["judge"]["dimensions"]["citation_match_rate"] for case in case_results])),
        "mean_runtime_score": round_metric(average([float(case["runtime_evaluation"].get("overall_score") or 0.0) for case in case_results])),
        "expected_decision_breakdown": {
            "pass": len(expected_pass_cases),
            "review": len(expected_review_cases),
            "fail": len(expected_fail_cases),
        },
        "expected_pass_case_count": len(expected_pass_cases),
        "expected_non_pass_case_count": len(expected_non_pass_cases),
        "expected_pass_success_rate": _optional_rate(expected_pass_cases, lambda case: case["judge"]["decision"] == "pass"),
        "expected_review_match_rate": _optional_rate(expected_review_cases, lambda case: case["judge"]["decision"] == "review"),
        "expected_fail_match_rate": _optional_rate(expected_fail_cases, lambda case: case["judge"]["decision"] == "fail"),
        "expected_non_pass_guardrail_rate": _optional_rate(expected_non_pass_cases, lambda case: case["judge"]["decision"] != "pass"),
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
                **summarize_generation_cases(grouped_cases),
                "case_ids": [case["case_id"] for case in grouped_cases],
            }
    return breakdowns


def normalize_case(case: dict[str, Any], index: int) -> dict[str, Any]:
    payload = dict(case.get("payload") or {})
    message = dict(payload.get("message") or {})
    trace_id = str((payload.get("runState") or payload.get("run_state") or {}).get("trace_id") or message.get("trace_id") or f"trace_generation_eval_{index + 1}")
    if "trace_id" not in message:
        message["trace_id"] = trace_id
    payload["message"] = message
    return {
        "case_id": str(case.get("case_id") or f"case_{index + 1}"),
        "payload": payload,
        "reference": dict(case.get("reference") or {}),
        "metadata": dict(case.get("metadata") or {}),
    }


def evaluate_generation_case(case: dict[str, Any], *, index: int = 0) -> dict[str, Any]:
    normalized = normalize_case(case, index)
    payload = normalized["payload"]
    reference = normalized["reference"]
    runtime_evaluation = evaluate_output(payload)
    run_state = payload.get("runState") or payload.get("run_state") or {}
    final_text = str((run_state.get("output") or {}).get("final_text") or "")
    retrieval_result = extract_retrieval_result(run_state)
    query_text = str(reference.get("query") or extract_user_text(payload.get("message") or {}))
    reference_points = [str(point) for point in list(reference.get("reference_points") or []) if str(point).strip()]
    required_citations = [str(title) for title in list(reference.get("required_citations") or []) if str(title).strip()]
    expected_behavior = str(reference.get("expected_behavior") or "answer")
    evidence = evidence_units(retrieval_result)
    evidence_text = "\n".join(evidence)
    actual_behavior = detect_behavior(final_text)

    reference_in_answer = coverage_ratio(reference_points, final_text)
    reference_in_context = coverage_ratio(reference_points, evidence_text)
    citation_rate = citation_match_rate(required_citations, retrieval_result, final_text)
    answer_relevancy = round_metric(average([query_answer_relevancy(query_text, final_text), reference_in_answer]))
    context_precision = evidence_precision(reference_points, evidence)
    route_score, route_detail = route_consistency(reference, retrieval_result)
    behavior_alignment = round_metric(1.0 if actual_behavior == expected_behavior else 0.0)
    faithfulness = round_metric(
        average(
            [
                float((runtime_evaluation.get("dimensions") or {}).get("factuality") or 0.0),
                float((runtime_evaluation.get("dimensions") or {}).get("citation_consistency") or 0.0),
                min(reference_in_answer, reference_in_context) if reference_points else 1.0,
                citation_rate,
            ]
        )
    )
    judge_score = round_metric(average([faithfulness, answer_relevancy, reference_in_context, context_precision, route_score, behavior_alignment]))
    expected_decision = reference.get("expected_decision")
    derived_decision = judge_decision(judge_score)

    judge = {
        "score": judge_score,
        "decision": derived_decision,
        "decision_matches_expected": expected_decision == derived_decision if expected_decision else True,
        "expected_decision": expected_decision,
        "dimensions": {
            "faithfulness": faithfulness,
            "answer_relevancy": answer_relevancy,
            "context_recall": reference_in_context,
            "context_precision": context_precision,
            "route_consistency": route_score,
            "citation_match_rate": citation_rate,
            "behavior_alignment": behavior_alignment,
        },
        "route": route_detail,
        "behavior": {
            "expected_behavior": expected_behavior,
            "actual_behavior": actual_behavior,
        },
        "evidence_unit_count": len(evidence),
    }

    return {
        "case_id": normalized["case_id"],
        "metadata": normalized["metadata"],
        "reference": reference,
        "query": query_text,
        "retrieval_result": retrieval_result,
        "runtime_evaluation": runtime_evaluation,
        "query_frontend": _query_frontend_from_retrieval_result(retrieval_result),
        "reviewer_summary": _build_generation_reviewer_summary(
            query_text=query_text,
            retrieval_result=retrieval_result,
            judge=judge,
            runtime_evaluation=runtime_evaluation,
        ),
        "judge": judge,
    }


def evaluate_generation_suite(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or {}
    normalized_cases = [normalize_case(case, index) for index, case in enumerate(list(data.get("cases") or []))]
    case_results = [evaluate_generation_case(case, index=index) for index, case in enumerate(normalized_cases)]
    summary = summarize_generation_cases(case_results)
    summary["metadata_breakdowns"] = build_metadata_breakdowns(case_results)

    return {
        "run_id": f"gen_eval_{uuid.uuid4()}",
        "metadata": dict(data.get("metadata") or {}),
        "summary": summary,
        "cases": case_results,
    }
