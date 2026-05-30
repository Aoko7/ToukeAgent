#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import Counter
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_ROOT = ROOT / "data" / "evals" / "memory"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from toukeagent_core.memory_eval import evaluate_memory_suite


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate memory quality across curated durable-write, recall, compression, and handoff cases.")
    parser.add_argument("--case-path", action="append", default=[], help="JSON or JSONL case file")
    parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT_ROOT))
    parser.add_argument("--benchmark-name", default="memory-quality")
    return parser.parse_args(argv)


def read_json_or_jsonl(path: Path) -> list[dict]:
    if path.suffix == ".jsonl":
        rows: list[dict] = []
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


def render_review_markdown(result: dict) -> str:
    summary = result["summary"]
    cases = list(result.get("cases") or [])
    case_types = Counter(str(case.get("case_type") or "unknown") for case in cases)
    providers = Counter(str(case.get("provider") or "unknown") for case in cases)
    attention_cases = []
    for case in cases:
        dimensions = dict((case.get("judge") or {}).get("dimensions") or {})
        weakest_metric = min(dimensions.values()) if dimensions else 1.0
        if case["judge"]["decision"] != "pass" or weakest_metric < 0.85:
            attention_cases.append(case)
    lines = [
        f"# Memory Quality Review: {result['metadata'].get('suite_name') or 'memory-quality'}",
        "",
        "## Summary",
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
        "",
        "## Reviewer Summary",
        "",
        f"- Pass / review / fail: {summary['decision_breakdown']['pass']} / {summary['decision_breakdown']['review']} / {summary['decision_breakdown']['fail']}",
        f"- Case types: {', '.join(f'{key}={value}' for key, value in case_types.most_common()) or 'n/a'}",
        f"- Providers: {', '.join(f'{key}={value}' for key, value in providers.most_common()) or 'n/a'}",
        f"- Cases needing attention: {len(attention_cases)}",
        "",
    ]

    if attention_cases:
        for case in attention_cases[:6]:
            reviewer = case.get("reviewer_summary") or {}
            lines.append(
                f"- `{case['case_id']}`: {reviewer.get('headline') or 'review'} · weakest={reviewer.get('weakest_dimension') or 'n/a'}"
            )
        lines.append("")

    breakdowns = dict(summary.get("metadata_breakdowns") or {})
    if breakdowns:
        lines.extend(["## Breakdown", ""])
        for key, label_map in breakdowns.items():
            lines.append(f"### {key}")
            lines.append("")
            for label, group_summary in label_map.items():
                lines.append(
                    f"- `{label}`: cases={group_summary['case_count']}, "
                    f"pass_rate={group_summary['pass_rate']:.4f}, "
                    f"mean_overall_score={group_summary['mean_overall_score']:.4f}"
                )
            lines.append("")

    lines.extend(["## Per Case", ""])
    for case in result["cases"]:
        reviewer = case.get("reviewer_summary") or {}
        lines.extend(
            [
                f"### {case['case_id']}",
                "",
                f"- Headline: `{reviewer.get('headline') or 'n/a'}`",
                f"- Type: `{case['case_type']}`",
                f"- Provider: `{case['provider']}`",
                f"- Decision: `{case['judge']['decision']}`",
                f"- Score: `{case['judge']['score']:.4f}`",
                f"- Weakest dimension: `{reviewer.get('weakest_dimension') or 'n/a'}`",
                f"- Dimensions: `{json.dumps(case['judge']['dimensions'], ensure_ascii=False)}`",
                "",
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    case_paths = [Path(path).expanduser() if Path(path).is_absolute() else (ROOT / path) for path in args.case_path]
    if not case_paths:
        raise SystemExit("At least one --case-path is required.")

    cases: list[dict] = []
    for case_path in case_paths:
        cases.extend(read_json_or_jsonl(case_path))

    benchmark_dir = Path(args.output_root).expanduser() / args.benchmark_name
    benchmark_dir.mkdir(parents=True, exist_ok=True)

    result = evaluate_memory_suite(
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
