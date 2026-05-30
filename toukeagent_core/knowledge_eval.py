from __future__ import annotations

from collections import Counter
import uuid
from typing import Any

from .generation_eval import evaluate_generation_suite
from .memory_eval import evaluate_memory_suite
from .shared import average
from .wiki_eval import evaluate_wiki_suite


def round_metric(value: Any) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        numeric = 0.0
    return round(max(0.0, min(1.0, numeric)), 4)


def weighted_mean(pairs: list[tuple[float, int]]) -> float:
    valid_pairs = [(float(value), int(weight)) for value, weight in pairs if int(weight) > 0]
    total_weight = sum(weight for _, weight in valid_pairs)
    if not total_weight:
        return 0.0
    return round_metric(sum(value * weight for value, weight in valid_pairs) / total_weight)


def format_metric(value: Any) -> str:
    try:
        return f"{float(value):.4f}"
    except (TypeError, ValueError):
        return "n/a"


def _frontend_signal_counts(cases: list[dict[str, Any]]) -> dict[str, str]:
    query_modes = Counter(str((case.get("query_frontend") or {}).get("query_mode") or "unknown") for case in cases)
    decomposition = Counter(str((case.get("query_frontend") or {}).get("decomposition_strategy") or "unknown") for case in cases)
    rewrite = Counter(str((case.get("query_frontend") or {}).get("rewrite_strategy") or "unknown") for case in cases)
    preferred_sources = Counter(
        source
        for case in cases
        for source in list((case.get("query_frontend") or {}).get("preferred_sources") or [])
        if str(source).strip()
    )
    return {
        "query_modes": ", ".join(f"{key}={value}" for key, value in query_modes.most_common()) or "n/a",
        "decomposition": ", ".join(f"{key}={value}" for key, value in decomposition.most_common()) or "n/a",
        "rewrite": ", ".join(f"{key}={value}" for key, value in rewrite.most_common()) or "n/a",
        "preferred_sources": ", ".join(f"{key}={value}" for key, value in preferred_sources.most_common()) or "n/a",
    }


def _suite_payload(data: dict[str, Any], key: str) -> dict[str, Any] | None:
    suite = data.get(key)
    if isinstance(suite, dict):
        return {
            "cases": list(suite.get("cases") or []),
            "metadata": dict(suite.get("metadata") or {}),
        }

    case_key = f"{key}_cases"
    if case_key not in data:
        return None

    return {
        "cases": list(data.get(case_key) or []),
        "metadata": dict(data.get(f"{key}_metadata") or {}),
    }


def render_generation_review(result: dict[str, Any]) -> list[str]:
    summary = result["summary"]
    cases = list(result.get("cases") or [])
    attention_cases = [
        case
        for case in cases
        if case["judge"]["decision"] != "pass" or not case["judge"].get("decision_matches_expected", True)
    ]
    frontend = _frontend_signal_counts(cases)
    lines = [
        "## Generation Suite",
        "",
        f"- Cases: {summary['case_count']}",
        f"- Decision match rate: {summary['decision_match_rate']:.4f}",
        f"- Expected outcome rate: {format_metric(summary.get('expected_outcome_rate'))}",
        f"- Expected pass success rate: {format_metric(summary.get('expected_pass_success_rate'))}",
        f"- Expected non-pass guardrail rate: {format_metric(summary.get('expected_non_pass_guardrail_rate'))}",
        f"- Route match rate: {summary['route_match_rate']:.4f}",
        f"- Mean behavior alignment: {summary['mean_behavior_alignment']:.4f}",
        f"- Mean faithfulness: {summary['mean_faithfulness']:.4f}",
        f"- Mean answer relevancy: {summary['mean_answer_relevancy']:.4f}",
        f"- Mean context recall: {summary['mean_context_recall']:.4f}",
        f"- Mean context precision: {summary['mean_context_precision']:.4f}",
        f"- Mean citation match rate: {summary['mean_citation_match_rate']:.4f}",
        f"- Attention cases: {len(attention_cases)}",
        f"- Query modes: {frontend['query_modes']}",
        f"- Decomposition: {frontend['decomposition']}",
        f"- Rewrite: {frontend['rewrite']}",
        f"- Preferred sources: {frontend['preferred_sources']}",
        "",
    ]

    breakdowns = dict(summary.get("metadata_breakdowns") or {})
    if breakdowns:
        lines.extend(["### Breakdown", ""])
        for key, label_map in breakdowns.items():
            lines.append(f"#### {key}")
            lines.append("")
            for label, group_summary in label_map.items():
                lines.append(
                    f"- `{label}`: cases={group_summary['case_count']}, "
                    f"decision_match={group_summary['decision_match_rate']:.4f}, "
                    f"expected_pass_success={format_metric(group_summary.get('expected_pass_success_rate'))}, "
                    f"guardrail_capture={format_metric(group_summary.get('expected_non_pass_guardrail_rate'))}, "
                    f"route_match={group_summary['route_match_rate']:.4f}, "
                    f"ctx_precision={group_summary['mean_context_precision']:.4f}"
                )
            lines.append("")

    lines.extend(["### Cases", ""])
    for case in result["cases"]:
        judge = case["judge"]
        frontend = case.get("query_frontend") or {}
        reviewer = case.get("reviewer_summary") or {}
        lines.append(
            f"- `{case['case_id']}`: {reviewer.get('headline') or judge['decision']}, route={judge['route']['actual_route_mode']} -> {judge['route']['actual_effective_mode']}"
        )
        lines.append(
            f"  frontend={frontend.get('query_mode', 'n/a')}/{frontend.get('decomposition_strategy', 'n/a')}/{frontend.get('rewrite_strategy', 'n/a')}, "
            f"preferred={','.join(frontend.get('preferred_sources') or []) or 'n/a'}"
        )
    lines.append("")
    return lines


def render_wiki_review(result: dict[str, Any]) -> list[str]:
    summary = result["summary"]
    cases = list(result.get("cases") or [])
    attention_cases = [
        case
        for case in cases
        if case["judge"]["decision"] != "pass"
        or case["judge"]["route"].get("fallback_applied")
        or case["judge"]["quality"].get("recommended_action") != "accept"
    ]
    frontend = _frontend_signal_counts(cases)
    lines = [
        "## Wiki Suite",
        "",
        f"- Cases: {summary['case_count']}",
        f"- Judge pass rate: {summary['judge_pass_rate']:.4f}",
        f"- Route match rate: {summary['route_match_rate']:.4f}",
        f"- Effective route match rate: {summary['effective_route_match_rate']:.4f}",
        f"- Fallback match rate: {summary['fallback_match_rate']:.4f}",
        f"- Recommended action match rate: {summary['recommended_action_match_rate']:.4f}",
        f"- Mean retrieval score: {summary['mean_retrieval_score']:.4f}",
        f"- Mean freshness score: {summary['mean_freshness_score']:.4f}",
        f"- Mean contract coverage score: {summary['mean_contract_coverage_score']:.4f}",
        f"- Attention cases: {len(attention_cases)}",
        f"- Query modes: {frontend['query_modes']}",
        f"- Decomposition: {frontend['decomposition']}",
        f"- Rewrite: {frontend['rewrite']}",
        f"- Preferred sources: {frontend['preferred_sources']}",
        "",
    ]

    breakdowns = dict(summary.get("metadata_breakdowns") or {})
    if breakdowns:
        lines.extend(["### Breakdown", ""])
        for key, label_map in breakdowns.items():
            lines.append(f"#### {key}")
            lines.append("")
            for label, group_summary in label_map.items():
                lines.append(
                    f"- `{label}`: cases={group_summary['case_count']}, "
                    f"pass_rate={group_summary['judge_pass_rate']:.4f}, "
                    f"route_match={group_summary['route_match_rate']:.4f}, "
                    f"freshness={group_summary['mean_freshness_score']:.4f}"
                )
            lines.append("")

    lines.extend(["### Cases", ""])
    for case in result["cases"]:
        judge = case["judge"]
        frontend = case.get("query_frontend") or {}
        reviewer = case.get("reviewer_summary") or {}
        lines.append(
            f"- `{case['case_id']}`: {reviewer.get('headline') or judge['decision']}, route={judge['route']['actual_route_mode']} -> {judge['route']['actual_effective_mode']}, recommended={judge['quality']['recommended_action']}"
        )
        lines.append(
            f"  frontend={frontend.get('query_mode', 'n/a')}/{frontend.get('decomposition_strategy', 'n/a')}/{frontend.get('rewrite_strategy', 'n/a')}, "
            f"preferred={','.join(frontend.get('preferred_sources') or []) or 'n/a'}"
        )
    lines.append("")
    return lines


def render_memory_review(result: dict[str, Any]) -> list[str]:
    summary = result["summary"]
    cases = list(result.get("cases") or [])
    attention_cases = []
    for case in cases:
        dimensions = dict((case.get("judge") or {}).get("dimensions") or {})
        weakest_metric = min(dimensions.values()) if dimensions else 1.0
        if case["judge"]["decision"] != "pass" or weakest_metric < 0.85:
            attention_cases.append(case)
    lines = [
        "## Memory Suite",
        "",
        f"- Cases: {summary['case_count']}",
        f"- Pass rate: {summary['pass_rate']:.4f}",
        f"- Mean overall score: {summary['mean_overall_score']:.4f}",
        f"- Durable write precision: {summary['mean_durable_write_precision']:.4f}",
        f"- Durable write recall: {summary['mean_durable_write_recall']:.4f}",
        f"- Memory recall@k: {summary['mean_memory_recall_at_k']:.4f}",
        f"- Stale memory rate: {summary['mean_stale_memory_rate']:.4f}",
        f"- Compression must-keep retention: {summary['mean_compression_must_keep_retention']:.4f}",
        f"- Handoff sufficiency rate: {summary['mean_handoff_sufficiency_rate']:.4f}",
        f"- Attention cases: {len(attention_cases)}",
        "",
    ]

    breakdowns = dict(summary.get("metadata_breakdowns") or {})
    if breakdowns:
        lines.extend(["### Breakdown", ""])
        for key, label_map in breakdowns.items():
            lines.append(f"#### {key}")
            lines.append("")
            for label, group_summary in label_map.items():
                lines.append(
                    f"- `{label}`: cases={group_summary['case_count']}, "
                    f"pass_rate={group_summary['pass_rate']:.4f}, "
                    f"mean_overall_score={group_summary['mean_overall_score']:.4f}"
                )
            lines.append("")

    lines.extend(["### Cases", ""])
    for case in result["cases"]:
        reviewer = case.get("reviewer_summary") or {}
        lines.append(
            f"- `{case['case_id']}`: {reviewer.get('headline') or case['judge']['decision']}, provider={case['provider']}, weakest={reviewer.get('weakest_dimension') or 'n/a'}"
        )
    lines.append("")
    return lines


def render_knowledge_review_markdown(result: dict[str, Any]) -> str:
    summary = result["summary"]
    joint_attention = (
        (summary.get("generation_summary") or {}).get("decision_breakdown", {}).get("review", 0)
        + (summary.get("generation_summary") or {}).get("decision_breakdown", {}).get("fail", 0)
        + (summary.get("wiki_summary") or {}).get("decision_breakdown", {}).get("review", 0)
        + (summary.get("wiki_summary") or {}).get("decision_breakdown", {}).get("fail", 0)
        + (summary.get("memory_summary") or {}).get("decision_breakdown", {}).get("review", 0)
        + (summary.get("memory_summary") or {}).get("decision_breakdown", {}).get("fail", 0)
    )
    lines = [
        f"# Knowledge Joint Quality Review: {result['metadata'].get('suite_name') or 'knowledge-quality'}",
        "",
        "## Joint Summary",
        "",
        f"- Suites: {summary['suite_count']}",
        f"- Cases: {summary['case_count']}",
        f"- Joint route match rate: {summary['joint_route_match_rate']:.4f}",
        f"- Joint expected outcome rate: {summary['joint_expected_outcome_rate']:.4f}",
        "",
        "## Joint Reviewer Summary",
        "",
        f"- Attention cases across suites: {joint_attention}",
        f"- Joint contract coverage score: {summary['joint_contract_coverage_score']:.4f}",
        f"- Joint guardrail capture rate: {summary['joint_guardrail_capture_rate']:.4f}",
        f"- Source-of-truth conflict cases: {summary['source_of_truth_conflict_case_count']}",
        f"- Explicit contract rate: {summary['contract_explicit_rate']:.4f}",
        "",
    ]

    if result.get("generation"):
        lines.extend(render_generation_review(result["generation"]))
    if result.get("wiki"):
        lines.extend(render_wiki_review(result["wiki"]))
    if result.get("memory"):
        lines.extend(render_memory_review(result["memory"]))

    return "\n".join(lines).rstrip() + "\n"


def evaluate_knowledge_suite(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or {}

    generation_payload = _suite_payload(data, "generation")
    wiki_payload = _suite_payload(data, "wiki")
    memory_payload = _suite_payload(data, "memory")

    generation_result = evaluate_generation_suite(generation_payload) if generation_payload and generation_payload["cases"] else None
    wiki_result = evaluate_wiki_suite(wiki_payload) if wiki_payload and wiki_payload["cases"] else None
    memory_result = evaluate_memory_suite(memory_payload) if memory_payload and memory_payload["cases"] else None

    generation_case_count = generation_result["summary"]["case_count"] if generation_result else 0
    wiki_case_count = wiki_result["summary"]["case_count"] if wiki_result else 0
    memory_case_count = memory_result["summary"]["case_count"] if memory_result else 0
    source_of_truth_conflict_case_count = (
        sum(
            1
            for case in list((wiki_result or {}).get("cases") or [])
            if float(((case.get("retrieval") or {}).get("quality") or {}).get("source_of_truth_conflict_count") or 0.0) > 0
        )
        if wiki_result
        else 0
    )
    contract_explicit_rate = weighted_mean(
        [
            (
                average(
                    [
                        1.0
                        if any(
                            (citation.get("knowledge_contract") or {}).get("contract_source") == "explicit"
                            for citation in list((case.get("retrieval") or {}).get("citations") or [])
                        )
                        else 0.0
                        for case in list((wiki_result or {}).get("cases") or [])
                    ]
                ),
                wiki_case_count,
            )
            if wiki_result
            else (0.0, 0),
            (
                average(
                    [
                        1.0
                        if any(
                            (citation.get("knowledge_contract") or {}).get("contract_source") == "explicit"
                            for citation in list((case.get("retrieval_result") or {}).get("citations") or [])
                        )
                        else 0.0
                        for case in list((generation_result or {}).get("cases") or [])
                    ]
                ),
                generation_case_count,
            )
            if generation_result
            else (0.0, 0),
        ]
    )

    summary = {
        "suite_count": int(bool(generation_result)) + int(bool(wiki_result)) + int(bool(memory_result)),
        "case_count": generation_case_count + wiki_case_count + memory_case_count,
        "generation_case_count": generation_case_count,
        "wiki_case_count": wiki_case_count,
        "memory_case_count": memory_case_count,
        "joint_route_match_rate": weighted_mean(
            [
                (generation_result["summary"]["route_match_rate"], generation_case_count) if generation_result else (0.0, 0),
                (wiki_result["summary"]["route_match_rate"], wiki_case_count) if wiki_result else (0.0, 0),
            ]
        ),
        "joint_expected_outcome_rate": weighted_mean(
            [
                (generation_result["summary"]["decision_match_rate"], generation_case_count) if generation_result else (0.0, 0),
                (wiki_result["summary"]["judge_pass_rate"], wiki_case_count) if wiki_result else (0.0, 0),
                (memory_result["summary"]["pass_rate"], memory_case_count) if memory_result else (0.0, 0),
            ]
        ),
        "joint_contract_coverage_score": weighted_mean(
            [
                (generation_result["summary"]["mean_context_precision"], generation_case_count) if generation_result else (0.0, 0),
                (wiki_result["summary"]["mean_contract_coverage_score"], wiki_case_count) if wiki_result else (0.0, 0),
            ]
        ),
        "joint_guardrail_capture_rate": weighted_mean(
            [
                (generation_result["summary"]["expected_non_pass_guardrail_rate"], generation_result["summary"]["expected_non_pass_case_count"])
                if generation_result and generation_result["summary"].get("expected_non_pass_guardrail_rate") is not None
                else (0.0, 0),
                (wiki_result["summary"]["recommended_action_match_rate"], wiki_case_count) if wiki_result else (0.0, 0),
            ]
        ),
        "source_of_truth_conflict_case_count": source_of_truth_conflict_case_count,
        "contract_explicit_rate": contract_explicit_rate,
        "generation_summary": generation_result["summary"] if generation_result else None,
        "wiki_summary": wiki_result["summary"] if wiki_result else None,
        "memory_summary": memory_result["summary"] if memory_result else None,
    }

    return {
        "run_id": f"knowledge_eval_{uuid.uuid4()}",
        "metadata": dict(data.get("metadata") or {}),
        "summary": summary,
        "generation": generation_result,
        "wiki": wiki_result,
        "memory": memory_result,
    }
