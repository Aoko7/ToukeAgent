#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import Counter
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_ROOT = ROOT / "data" / "evals" / "wiki"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from toukeagent_core.wiki_eval import evaluate_wiki_suite


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate wiki freshness, fallback, and route consistency across curated cases.")
    parser.add_argument("--case-path", action="append", default=[], help="JSON or JSONL case file")
    parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT_ROOT))
    parser.add_argument("--benchmark-name", default="wiki-quality")
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
        if case["judge"]["decision"] != "pass"
        or case["judge"]["route"].get("fallback_applied")
        or case["judge"]["quality"].get("recommended_action") != "accept"
    ]
    lines = [
        f"# Wiki Quality Review: {result['metadata'].get('suite_name') or 'wiki-quality'}",
        "",
        "## Summary",
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
        "",
        "## Reviewer Summary",
        "",
        f"- Pass / review / fail: {summary['decision_breakdown']['pass']} / {summary['decision_breakdown']['review']} / {summary['decision_breakdown']['fail']}",
        f"- Fallback cases: {sum(1 for case in cases if case['judge']['route'].get('fallback_applied'))}",
        f"- Non-accept recommendations: {sum(1 for case in cases if case['judge']['quality'].get('recommended_action') != 'accept')}",
        f"- Cases needing attention: {len(attention_cases)}",
        "",
    ]

    if attention_cases:
        for case in attention_cases[:8]:
            reviewer = case.get("reviewer_summary") or {}
            lines.append(
                f"- `{case['case_id']}`: {reviewer.get('headline') or 'review'} · fallback={case['judge']['route'].get('fallback_applied')} · action={case['judge']['quality'].get('recommended_action')}"
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
        lines.extend(["## Breakdown", ""])
        for key, label_map in breakdowns.items():
            lines.append(f"### {key}")
            lines.append("")
            for label, group_summary in label_map.items():
                lines.append(
                    f"- `{label}`: cases={group_summary['case_count']}, "
                    f"pass_rate={group_summary['judge_pass_rate']:.4f}, "
                    f"route_match={group_summary['route_match_rate']:.4f}, "
                    f"fallback_match={group_summary['fallback_match_rate']:.4f}, "
                    f"freshness={group_summary['mean_freshness_score']:.4f}"
                )
            lines.append("")

    lines.extend(["## Per Case", ""])
    for case in result["cases"]:
        judge = case["judge"]
        frontend = case.get("query_frontend") or {}
        reviewer = case.get("reviewer_summary") or {}
        lines.extend(
            [
                f"### {case['case_id']}",
                "",
                f"- Headline: `{reviewer.get('headline') or 'n/a'}`",
                f"- Decision: `{judge['decision']}`",
                f"- Score: `{judge['score']:.4f}`",
                f"- Route: `{judge['route']['actual_route_mode']}` -> `{judge['route']['actual_effective_mode']}`",
                f"- Fallback applied: `{judge['route']['fallback_applied']}`",
                f"- Recommended action: `{judge['quality']['recommended_action']}`",
                f"- Query frontend: `mode={frontend.get('query_mode', 'n/a')}, boundary={frontend.get('boundary_action', 'n/a')}, clarify={frontend.get('clarification_required', False)}, decompose={frontend.get('decomposition_strategy', 'n/a')}, rewrite={frontend.get('rewrite_strategy', 'n/a')}`",
                f"- Preferred sources: `{', '.join(frontend.get('preferred_sources') or []) or 'n/a'}`",
                f"- Retrieval score: `{judge['quality']['retrieval_score']:.4f}`",
                f"- Freshness score: `{judge['quality']['freshness_score']:.4f}`",
                f"- Contract coverage score: `{judge['quality']['contract_coverage_score']:.4f}`",
                f"- Citation titles: `{', '.join(judge['citation_titles'])}`",
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

    result = evaluate_wiki_suite(
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
