#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_ROOT = ROOT / "data" / "evals" / "knowledge"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from toukeagent_core.knowledge_eval import evaluate_knowledge_suite, render_knowledge_review_markdown


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate joint RAG and LLM wiki quality across curated suites.")
    parser.add_argument("--generation-case-path", action="append", default=[], help="JSON or JSONL generation case file")
    parser.add_argument("--wiki-case-path", action="append", default=[], help="JSON or JSONL wiki case file")
    parser.add_argument("--memory-case-path", action="append", default=[], help="JSON or JSONL memory case file")
    parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT_ROOT))
    parser.add_argument("--benchmark-name", default="knowledge-quality")
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
    return render_knowledge_review_markdown(result)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    generation_case_paths = [Path(path).expanduser() if Path(path).is_absolute() else (ROOT / path) for path in args.generation_case_path]
    wiki_case_paths = [Path(path).expanduser() if Path(path).is_absolute() else (ROOT / path) for path in args.wiki_case_path]
    memory_case_paths = [Path(path).expanduser() if Path(path).is_absolute() else (ROOT / path) for path in args.memory_case_path]
    if not generation_case_paths and not wiki_case_paths and not memory_case_paths:
        raise SystemExit("At least one --generation-case-path, --wiki-case-path or --memory-case-path is required.")

    benchmark_dir = Path(args.output_root).expanduser() / args.benchmark_name
    benchmark_dir.mkdir(parents=True, exist_ok=True)

    generation_cases: list[dict[str, Any]] = []
    for case_path in generation_case_paths:
        generation_cases.extend(read_json_or_jsonl(case_path))

    wiki_cases: list[dict[str, Any]] = []
    for case_path in wiki_case_paths:
        wiki_cases.extend(read_json_or_jsonl(case_path))

    memory_cases: list[dict[str, Any]] = []
    for case_path in memory_case_paths:
        memory_cases.extend(read_json_or_jsonl(case_path))

    review_payload = evaluate_knowledge_suite(
        {
            "generation": {
                "cases": generation_cases,
                "metadata": {
                    "suite_name": f"{args.benchmark_name}-generation",
                    "case_paths": [str(path) for path in generation_case_paths],
                },
            },
            "wiki": {
                "cases": wiki_cases,
                "metadata": {
                    "suite_name": f"{args.benchmark_name}-wiki",
                    "case_paths": [str(path) for path in wiki_case_paths],
                },
            },
            "memory": {
                "cases": memory_cases,
                "metadata": {
                    "suite_name": f"{args.benchmark_name}-memory",
                    "case_paths": [str(path) for path in memory_case_paths],
                },
            },
            "metadata": {
                "suite_name": args.benchmark_name,
                "generation_case_paths": [str(path) for path in generation_case_paths],
                "wiki_case_paths": [str(path) for path in wiki_case_paths],
                "memory_case_paths": [str(path) for path in memory_case_paths],
            },
        }
    )

    summary = review_payload["summary"]

    summary_path = benchmark_dir / "summary.json"
    review_json_path = benchmark_dir / "review.json"
    review_md_path = benchmark_dir / "review.md"
    summary_payload = {
        "run_id": review_payload["run_id"],
        "metadata": review_payload["metadata"],
        "summary": summary,
        "review_json_path": str(review_json_path),
        "review_md_path": str(review_md_path),
    }
    summary_path.write_text(json.dumps(summary_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    review_json_path.write_text(json.dumps(review_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    review_md_path.write_text(render_review_markdown(review_payload), encoding="utf-8")
    json.dump(summary_payload, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
