#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import Counter
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_ROOT = ROOT / "data" / "evals" / "generation"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from toukeagent_core.generation_eval import evaluate_generation_suite


def format_metric(value: Any) -> str:
    try:
        return f"{float(value):.4f}"
    except (TypeError, ValueError):
        return "n/a"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate generation quality across curated RAG/wiki cases.")
    parser.add_argument("--case-path", action="append", default=[], help="JSON or JSONL case file")
    parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT_ROOT))
    parser.add_argument("--benchmark-name", default="generation-quality")
    return parser.parse_args(argv)


def read_json_or_jsonl(path: Path) -> list[dict[str, Any]]:
    if path.suffix == ".jsonl":
        rows: list[dict[str, Any]] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                rows.append(json.loads(line))
        return rows
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        return [dict(item) for item in list(payload.get("cases") or [])]
    if isinstance(payload, list):
        return [dict(item) for item in payload]
    raise ValueError(f"Unsupported case format: {path}")


def render_review_markdown(result: dict[str, Any]) -> str:
    summary = result["summary"]
    cases = list(result.get("cases") or [])
    frontend_modes = Counter(str((case.get("query_frontend") or {}).get("query_mode") or "unknown") for case in cases)
    decomposition_strategies = Counter(str((case.get("query_frontend") or {}).get("decomposition_strategy") or "unknown") for case in cases)
    rewrite_strategies = Counter(str((case.get("query_frontend") or {}).get("rewrite_strategy") or "unknown") for case in cases)
    preferred_sources = Counter(
        source
        for case in cases
        for source in list((case.get("query_frontend") or {}).get("preferred_sources") or [])
        if str(source).strip()
    )
    attention_cases = [
        case
        for case in cases
        if case["judge"]["decision"] != "pass" or not case["judge"].get("decision_matches_expected", True)
    ]
    lines = [
        f"# Generation Quality Review: {result['metadata'].get('suite_name') or 'generation-quality'}",
        "",
        "## Summary",
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
        "",
        "## Reviewer Summary",
        "",
        f"- Pass / review / fail: {summary['decision_breakdown']['pass']} / {summary['decision_breakdown']['review']} / {summary['decision_breakdown']['fail']}",
        f"- Expected pass success rate: {format_metric(summary.get('expected_pass_success_rate'))}",
        f"- Expected non-pass guardrail rate: {format_metric(summary.get('expected_non_pass_guardrail_rate'))}",
        f"- Cases needing attention: {len(attention_cases)}",
        "",
    ]

    if attention_cases:
        for case in attention_cases[:6]:
            reviewer = case.get("reviewer_summary") or {}
            lines.append(
                f"- `{case['case_id']}`: {reviewer.get('headline') or 'review'} · expected={case['judge'].get('expected_decision')} · actual={case['judge'].get('decision')}"
            )
        lines.append("")

    lines.extend(
        [
            "## Query Frontend Signals",
            "",
            f"- Query modes: {', '.join(f'{key}={value}' for key, value in frontend_modes.most_common()) or 'n/a'}",
            f"- Decomposition: {', '.join(f'{key}={value}' for key, value in decomposition_strategies.most_common()) or 'n/a'}",
            f"- Rewrite: {', '.join(f'{key}={value}' for key, value in rewrite_strategies.most_common()) or 'n/a'}",
            f"- Preferred sources: {', '.join(f'{key}={value}' for key, value in preferred_sources.most_common()) or 'n/a'}",
            "",
        ]
    )

    breakdowns = dict(summary.get("metadata_breakdowns") or {})
    if breakdowns:
        lines.extend(
            [
                "## Breakdown",
                "",
            ]
        )
        for key, label_map in breakdowns.items():
            lines.append(f"### {key}")
            lines.append("")
            for label, group_summary in label_map.items():
                lines.append(
                    f"- `{label}`: cases={group_summary['case_count']}, "
                    f"pass_rate={group_summary['judge_pass_rate']:.4f}, "
                    f"decision_match={group_summary['decision_match_rate']:.4f}, "
                    f"expected_pass_success={format_metric(group_summary.get('expected_pass_success_rate'))}, "
                    f"guardrail_capture={format_metric(group_summary.get('expected_non_pass_guardrail_rate'))}, "
                    f"route_match={group_summary['route_match_rate']:.4f}, "
                    f"ctx_recall={group_summary['mean_context_recall']:.4f}, "
                    f"ctx_precision={group_summary['mean_context_precision']:.4f}"
                )
            lines.append("")

    lines.extend(
        [
            "## Per Case",
            "",
        ]
    )

    for case in result["cases"]:
        judge = case["judge"]
        frontend = case.get("query_frontend") or {}
        reviewer = case.get("reviewer_summary") or {}
        lines.extend(
            [
                f"### {case['case_id']}",
                "",
                f"- Headline: `{reviewer.get('headline') or 'n/a'}`",
                f"- Query: `{case['query']}`",
                f"- Judge decision: `{judge['decision']}` (expected `{judge['expected_decision']}`)",
                f"- Judge score: `{judge['score']:.4f}`",
                f"- Route: `{judge['route']['actual_route_mode']}` -> `{judge['route']['actual_effective_mode']}`",
                f"- Behavior: `{judge['behavior']['actual_behavior']}` (expected `{judge['behavior']['expected_behavior']}`)",
                f"- Query frontend: `mode={frontend.get('query_mode', 'n/a')}, boundary={frontend.get('boundary_action', 'n/a')}, clarify={frontend.get('clarification_required', False)}, decompose={frontend.get('decomposition_strategy', 'n/a')}, rewrite={frontend.get('rewrite_strategy', 'n/a')}`",
                f"- Preferred sources: `{', '.join(frontend.get('preferred_sources') or []) or 'n/a'}`",
                f"- Faithfulness: `{judge['dimensions']['faithfulness']:.4f}`",
                f"- Answer relevancy: `{judge['dimensions']['answer_relevancy']:.4f}`",
                f"- Context recall: `{judge['dimensions']['context_recall']:.4f}`",
                f"- Context precision: `{judge['dimensions']['context_precision']:.4f}`",
                f"- Citation match rate: `{judge['dimensions']['citation_match_rate']:.4f}`",
                "",
            ]
        )

    return "\n".join(lines).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    case_paths = [Path(path).expanduser() if Path(path).is_absolute() else (ROOT / path) for path in args.case_path]
    if not case_paths:
        raise SystemExit("At least one --case-path is required.")

    cases: list[dict[str, Any]] = []
    for case_path in case_paths:
        cases.extend(read_json_or_jsonl(case_path))

    benchmark_dir = Path(args.output_root).expanduser() / args.benchmark_name
    benchmark_dir.mkdir(parents=True, exist_ok=True)

    result = evaluate_generation_suite(
        {
            "cases": cases,
            "metadata": {
                "suite_name": args.benchmark_name,
                "case_paths": [str(path) for path in case_paths],
            },
        }
    )

    summary_path = benchmark_dir / "summary.json"
    review_json_path = benchmark_dir / "review.json"
    review_md_path = benchmark_dir / "review.md"

    summary_payload = {
        "run_id": result["run_id"],
        "metadata": result["metadata"],
        "summary": result["summary"],
        "review_json_path": str(review_json_path),
        "review_md_path": str(review_md_path),
    }
    summary_path.write_text(json.dumps(summary_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    review_json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    review_md_path.write_text(render_review_markdown(result), encoding="utf-8")
    json.dump(summary_payload, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
