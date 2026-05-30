from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CHUNK_ROOT = ROOT / "data" / "papers" / "builds" / "2026-05-13-full-rebuild-v1" / "rebuild"


def load_benchmark_module():
    module_path = ROOT / "scripts" / "benchmark_retrieval_quality.py"
    spec = importlib.util.spec_from_file_location("benchmark_retrieval_quality", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load benchmark module from {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Mine confusable near-neighbor negatives from existing retrieval benchmark cases.")
    parser.add_argument("--manifest-path", action="append", default=[])
    parser.add_argument("--query-case-path", action="append", default=[])
    parser.add_argument("--chunk-root", default=str(DEFAULT_CHUNK_ROOT))
    parser.add_argument("--index-path", default="")
    parser.add_argument("--collection-name", default="confusable-negative-mining")
    parser.add_argument("--index-manifest-path", default="")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--force-backend", default="")
    parser.add_argument("--index-batch-size", type=int, default=256)
    parser.add_argument("--output-path", default="")
    return parser.parse_args(argv)


def _resolve_manifest_records(module: Any, manifest_paths: list[Path]) -> list[dict[str, Any]]:
    manifest_records: list[dict[str, Any]] = []
    for manifest_path in manifest_paths:
        for record in module.read_jsonl_records(manifest_path):
            manifest_records.append(
                {
                    **record,
                    "_manifest_path": str(manifest_path.resolve()),
                }
            )
    return manifest_records


def _suggestion_status(*, rank: int | None, already_configured: bool, taxonomy: str | None, same_conference: bool) -> str:
    if rank is None:
        return "no_distractor_in_top_k"
    if already_configured:
        return "already_configured"
    if taxonomy == "surface_overlap_noise":
        return "review_surface_noise"
    if rank == 1:
        return "adopt_immediately"
    if rank <= 3 and (same_conference or taxonomy in {"known_hard_negative", "specific_topic_neighbor", "benchmark_family_neighbor", "topical_family_neighbor"}):
        return "adopt_rank_pressure"
    return "review_candidate"


def _taxonomy_counts(suggestions: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in suggestions:
        label = str(item.get("suggested_hard_negative_taxonomy") or "").strip()
        if not label:
            continue
        counts[label] = counts.get(label, 0) + 1
    return counts


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.manifest_path:
        raise SystemExit("At least one --manifest-path is required.")
    if not args.query_case_path:
        raise SystemExit("At least one --query-case-path is required.")

    module = load_benchmark_module()
    manifest_paths = [Path(path).expanduser() if Path(path).is_absolute() else (ROOT / path) for path in args.manifest_path]
    case_paths = [Path(path).expanduser() if Path(path).is_absolute() else (ROOT / path) for path in args.query_case_path]
    chunk_root = Path(args.chunk_root).expanduser()

    manifest_records = _resolve_manifest_records(module, manifest_paths)
    queries = module.resolve_query_cases(case_paths, manifest_records)
    chunk_paths = module.resolve_chunk_paths(manifest_paths, chunk_root)

    benchmark_dir = Path(args.output_path).expanduser().parent if args.output_path else (ROOT / "data" / "papers" / "benchmarks" / "confusable-negative-mining-tmp")
    benchmark_dir.mkdir(parents=True, exist_ok=True)

    qdrant_path, collection_name, index_summary = module.resolve_index_source(
        kind="confusable-negative",
        chunk_paths=chunk_paths,
        explicit_index_path=args.index_path,
        explicit_collection_name=args.collection_name,
        explicit_manifest_path=args.index_manifest_path,
        benchmark_dir=benchmark_dir,
        default_collection_name=args.collection_name,
        force_backend=args.force_backend,
        index_batch_size=args.index_batch_size,
    )
    evaluation_fidelity = module.describe_evaluation_fidelity(
        force_backend=args.force_backend,
        baseline_summary=index_summary,
        candidate_summary=index_summary,
    )

    suggestions: list[dict[str, Any]] = []
    suggestion_status_counts: dict[str, int] = {}
    adoptable_count = 0

    for case in queries:
        result = module.run_search(
            case["query"],
            qdrant_path=qdrant_path,
            collection_name=collection_name,
            force_backend=args.force_backend,
            top_k=args.top_k,
        )
        items = list(result.get("items") or [])
        expected_item, expected_rank = module.find_expected_item(case, items)
        query_analysis = dict(result.get("query_analysis") or {})
        recommended_item = None
        recommended_rank = None
        for index, item in enumerate(items, start=1):
            if str(item.get("doc_id") or "").strip() == str(case.get("expected_doc_id") or "").strip():
                continue
            recommended_item = item
            recommended_rank = index
            break

        recommended_review = module.compact_item_review(recommended_item) if recommended_item else {}
        distractor_analysis = (
            module.analyze_distractor(case, recommended_review, rank=recommended_rank)
            if recommended_item and recommended_rank is not None
            else module.analyze_distractor(case, {}, rank=0)
        )
        current_hard_negative_doc_ids = {str(value).strip() for value in list(case.get("hard_negative_doc_ids") or []) if str(value).strip()}
        already_configured = bool(distractor_analysis.get("top_distractor_doc_id") in current_hard_negative_doc_ids)
        status = _suggestion_status(
            rank=recommended_rank,
            already_configured=already_configured,
            taxonomy=distractor_analysis.get("top_distractor_taxonomy"),
            same_conference=bool(distractor_analysis.get("top_distractor_same_conference")),
        )
        suggestion_status_counts[status] = suggestion_status_counts.get(status, 0) + 1
        if status in {"adopt_immediately", "adopt_rank_pressure"}:
            adoptable_count += 1

        collisions = module.evaluate_hard_negative_collisions(case, items, top_k=args.top_k, expected_rank=expected_rank)
        suggestions.append(
            {
                "case_id": case["case_id"],
                "query": case["query"],
                "expected_title": case.get("expected_title"),
                "expected_doc_id": case.get("expected_doc_id"),
                "expected_rank": expected_rank,
                "top1_hit": bool(expected_rank == 1),
                "query_mode": query_analysis.get("query_mode"),
                "boundary_action": (query_analysis.get("boundary") or {}).get("action"),
                "rewrite_count": len((query_analysis.get("rewrites") or {}).get("variants") or []),
                "subquery_count": len((query_analysis.get("decomposition") or {}).get("subqueries") or []),
                "current_hard_negative_titles": list(case.get("hard_negative_titles") or []),
                "current_hard_negative_doc_ids": sorted(current_hard_negative_doc_ids),
                "current_hard_negative_hits": list(collisions.get("hard_negative_hits") or []),
                "suggested_hard_negative_title": distractor_analysis.get("top_distractor_title"),
                "suggested_hard_negative_doc_id": distractor_analysis.get("top_distractor_doc_id"),
                "suggested_hard_negative_rank": distractor_analysis.get("top_distractor_rank"),
                "suggested_hard_negative_conference_id": recommended_review.get("conference_id"),
                "suggested_hard_negative_publication_year": recommended_review.get("publication_year"),
                "suggested_hard_negative_taxonomy": distractor_analysis.get("top_distractor_taxonomy"),
                "suggested_hard_negative_reason": distractor_analysis.get("top_distractor_taxonomy_reason"),
                "suggested_query_overlap": list(distractor_analysis.get("top_distractor_query_overlap") or []),
                "suggested_expected_overlap": list(distractor_analysis.get("top_distractor_expected_overlap") or []),
                "suggested_generic_overlap": list(distractor_analysis.get("top_distractor_generic_overlap") or []),
                "suggested_shared_families": list(distractor_analysis.get("top_distractor_shared_families") or []),
                "suggested_noise_terms": list(distractor_analysis.get("top_distractor_noise_terms") or []),
                "suggested_same_conference": distractor_analysis.get("top_distractor_same_conference"),
                "suggested_same_year": distractor_analysis.get("top_distractor_same_year"),
                "already_configured": already_configured,
                "suggestion_status": status,
                "retrieved_titles": [item.get("title") for item in items],
            }
        )

    summary = {
        "manifest_paths": [str(path) for path in manifest_paths],
        "query_case_paths": [str(path) for path in case_paths],
        "queries": len(queries),
        "top_k": args.top_k,
        "collection_name": collection_name,
        "index_path": str(qdrant_path),
        "evaluation_fidelity": evaluation_fidelity,
        "index_summary": index_summary,
        "suggestion_status_counts": suggestion_status_counts,
        "adoptable_suggestion_count": adoptable_count,
        "suggested_taxonomy_counts": _taxonomy_counts(suggestions),
        "suggestions": suggestions,
    }

    if args.output_path:
        output_path = Path(args.output_path).expanduser()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    json.dump(summary, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
