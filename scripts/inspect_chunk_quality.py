from __future__ import annotations

import argparse
import hashlib
import json
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
import sys

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from toukeagent_core.embedding import create_embedder, describe_embedding_strategy
from toukeagent_core.retrieval import load_chunk_records


DEFAULT_CHUNKS_ROOT = Path("/tmp/toukeagent-full-chunks")
DEFAULT_PATTERN = "*/chunks/*.rag_chunks.jsonl"
REQUIRED_TOP_LEVEL = [
    "chunk_id",
    "doc_id",
    "title",
    "section_path",
    "text",
    "embedding_model",
    "embedding_dim",
    "vector_backend",
    "freshness",
    "entity_refs",
    "metadata",
]
REQUIRED_METADATA = [
    "conference_id",
    "publication_year",
    "paper_title",
    "language",
    "source_manifest",
    "local_pdf_path",
    "needs_ocr",
]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inspect ToukeAgent paper chunk quality and embedding readiness.")
    parser.add_argument("--chunks-root", default=str(DEFAULT_CHUNKS_ROOT))
    parser.add_argument("--chunk-path", action="append", default=[])
    parser.add_argument("--pattern", default=DEFAULT_PATTERN)
    parser.add_argument("--limit-files", type=int, default=0)
    parser.add_argument("--sample-docs", type=int, default=24)
    parser.add_argument("--sample-chunks-per-doc", type=int, default=3)
    parser.add_argument("--query-docs", type=int, default=20)
    parser.add_argument("--min-text-length", type=int, default=40)
    parser.add_argument("--primary-model", default="")
    parser.add_argument("--fallback-model", default="")
    parser.add_argument("--force-backend", default="")
    return parser.parse_args(argv)


def discover_chunk_paths(chunks_root: Path, pattern: str, explicit_paths: list[str], limit_files: int) -> list[Path]:
    paths: list[Path] = []
    seen: set[str] = set()

    for raw_path in explicit_paths:
        path = Path(raw_path).expanduser()
        resolved = path if path.is_absolute() else (ROOT / path)
        key = str(resolved.resolve())
        if resolved.exists() and key not in seen:
            seen.add(key)
            paths.append(resolved)

    if paths:
        if limit_files > 0:
            return paths[:limit_files]
        return paths

    if chunks_root.exists():
        for path in sorted(chunks_root.glob(pattern)):
            key = str(path.resolve())
            if key in seen:
                continue
            seen.add(key)
            paths.append(path)
            if limit_files > 0 and len(paths) >= limit_files:
                break

    if limit_files > 0:
        return paths[:limit_files]
    return paths


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, list):
        return len(value) == 0
    return False


def _percentile(values: list[int], ratio: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(len(ordered) * ratio) - 1))
    return int(ordered[index])


def _cosine(left: list[float], right: list[float]) -> float:
    size = min(len(left), len(right))
    return float(sum(left[index] * right[index] for index in range(size)))


def build_quality_report(
    chunk_paths: list[Path],
    *,
    config: dict[str, Any],
    sample_docs: int,
    sample_chunks_per_doc: int,
    query_docs: int,
    min_text_length: int,
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for path in chunk_paths:
        chunk_rows = load_chunk_records(path)
        for row in chunk_rows:
            rows.append({**row, "_path": str(path)})

    if not rows:
        raise ValueError("No chunk rows loaded.")

    text_lengths = [len(str(row.get("text") or "")) for row in rows]
    section_depths = [len(row.get("section_path") or []) for row in rows]
    missing_top_level = Counter()
    missing_metadata = Counter()
    embedding_models = Counter()
    embedding_dims = Counter()
    vector_backends = Counter()
    languages = Counter()
    needs_ocr = Counter()
    conferences = Counter()
    doc_chunk_counts = Counter()
    duplicate_buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    tiny_chunks: list[dict[str, Any]] = []

    per_doc: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        metadata = row.get("metadata") or {}
        for key in REQUIRED_TOP_LEVEL:
            if _is_missing(row.get(key)):
                missing_top_level[key] += 1
        for key in REQUIRED_METADATA:
            if _is_missing(metadata.get(key)):
                missing_metadata[key] += 1

        embedding_models[str(row.get("embedding_model"))] += 1
        embedding_dims[str(row.get("embedding_dim"))] += 1
        vector_backends[str(row.get("vector_backend"))] += 1
        languages[str(metadata.get("language"))] += 1
        needs_ocr[str(metadata.get("needs_ocr"))] += 1
        conferences[str(metadata.get("conference_id"))] += 1
        doc_id = str(row.get("doc_id"))
        doc_chunk_counts[doc_id] += 1
        per_doc[doc_id].append(row)

        text = str(row.get("text") or "")
        if len(text) < min_text_length:
            tiny_chunks.append(
                {
                    "chunk_id": row.get("chunk_id"),
                    "doc_id": row.get("doc_id"),
                    "title": row.get("title"),
                    "text_length": len(text),
                    "text_preview": text[:180],
                    "path": row["_path"],
                }
            )
        duplicate_buckets[hashlib.sha1(text.encode("utf-8")).hexdigest()].append(row)

    duplicate_groups = [items for items in duplicate_buckets.values() if len(items) > 1]
    duplicate_groups.sort(key=len, reverse=True)
    duplicate_records = sum(len(items) - 1 for items in duplicate_groups)
    doc_sizes = list(doc_chunk_counts.values())

    doc_ids = sorted(per_doc.keys())
    selected_doc_ids = doc_ids[:sample_docs]
    sample_rows: list[dict[str, Any]] = []
    for doc_id in selected_doc_ids:
        sample_rows.extend(per_doc[doc_id][:sample_chunks_per_doc])

    embedding_strategy = describe_embedding_strategy(config)
    embedder = create_embedder(config)
    vectors = embedder.encode([str(row.get("text") or "") for row in sample_rows], input_type="passage").vectors
    norms = [sum(value * value for value in vector) ** 0.5 for vector in vectors]

    same_doc_scores: list[float] = []
    diff_doc_scores: list[float] = []
    for left_index in range(len(sample_rows)):
        for right_index in range(left_index + 1, len(sample_rows)):
            score = _cosine(vectors[left_index], vectors[right_index])
            if sample_rows[left_index].get("doc_id") == sample_rows[right_index].get("doc_id"):
                same_doc_scores.append(score)
            else:
                diff_doc_scores.append(score)

    title_top1_hits = 0
    title_queries = 0
    for doc_id in doc_ids[:query_docs]:
        doc_rows = per_doc[doc_id]
        title = str((doc_rows[0].get("metadata") or {}).get("paper_title") or doc_rows[0].get("title") or "").strip()
        if not title:
            continue
        title_queries += 1
        query_vector = embedder.encode([title], input_type="query").vectors[0]
        best_score = None
        best_doc_id = None
        for row, vector in zip(sample_rows, vectors):
            score = _cosine(query_vector, vector)
            if best_score is None or score > best_score:
                best_score = score
                best_doc_id = row.get("doc_id")
        if best_doc_id == doc_id:
            title_top1_hits += 1

    report = {
        "files": len(chunk_paths),
        "chunks": len(rows),
        "documents": len(doc_chunk_counts),
        "embedding_strategy": embedding_strategy,
        "declared_runtime_alignment": {
            "runtime_model": embedding_strategy.get("active_model"),
            "runtime_dimensions": embedding_strategy.get("dimensions"),
            "declared_model_matches_runtime": sum(
                1 for row in rows if row.get("embedding_model") == embedding_strategy.get("active_model")
            ),
            "declared_dimension_matches_runtime": sum(
                1 for row in rows if int(row.get("embedding_dim") or 0) == int(embedding_strategy.get("dimensions") or 0)
            ),
        },
        "distribution": {
            "embedding_models": dict(embedding_models),
            "embedding_dims": dict(embedding_dims),
            "vector_backends": dict(vector_backends),
            "languages": dict(languages),
            "needs_ocr": dict(needs_ocr),
            "conferences": dict(conferences),
        },
        "completeness": {
            "missing_top_level": dict(missing_top_level),
            "missing_metadata": dict(missing_metadata),
        },
        "text_length": {
            "min": min(text_lengths),
            "p50": statistics.median(text_lengths),
            "p95": _percentile(text_lengths, 0.95),
            "max": max(text_lengths),
            "mean": round(statistics.mean(text_lengths), 2),
        },
        "doc_chunk_count": {
            "min": min(doc_sizes),
            "p50": statistics.median(doc_sizes),
            "p95": _percentile(doc_sizes, 0.95),
            "max": max(doc_sizes),
            "mean": round(statistics.mean(doc_sizes), 2),
        },
        "section_depth": {
            "min": min(section_depths),
            "p50": statistics.median(section_depths),
            "p95": _percentile(section_depths, 0.95),
            "max": max(section_depths),
            "mean": round(statistics.mean(section_depths), 2),
        },
        "quality_flags": {
            "tiny_chunk_count": len(tiny_chunks),
            "tiny_chunk_examples": tiny_chunks[:12],
            "duplicate_text_records": duplicate_records,
            "duplicate_examples": [
                {
                    "count": len(items),
                    "text_length": len(str(items[0].get("text") or "")),
                    "text_preview": str(items[0].get("text") or "")[:180],
                    "sample_chunk_ids": [item.get("chunk_id") for item in items[:4]],
                }
                for items in duplicate_groups[:8]
            ],
        },
        "vector_sample": {
            "sample_chunks": len(sample_rows),
            "norm_min": round(min(norms), 6) if norms else None,
            "norm_mean": round(statistics.mean(norms), 6) if norms else None,
            "norm_max": round(max(norms), 6) if norms else None,
            "same_doc_pairs": len(same_doc_scores),
            "same_doc_cosine_mean": round(statistics.mean(same_doc_scores), 6) if same_doc_scores else None,
            "diff_doc_pairs": len(diff_doc_scores),
            "diff_doc_cosine_mean": round(statistics.mean(diff_doc_scores), 6) if diff_doc_scores else None,
            "title_to_chunk_top1_hits": title_top1_hits,
            "title_to_chunk_queries": title_queries,
        },
        "inputs": {
            "chunk_paths": [str(path) for path in chunk_paths],
            "sample_docs": sample_docs,
            "sample_chunks_per_doc": sample_chunks_per_doc,
            "query_docs": query_docs,
            "min_text_length": min_text_length,
        },
    }
    return report


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    chunks_root = Path(args.chunks_root).expanduser()
    chunk_paths = discover_chunk_paths(chunks_root, args.pattern, args.chunk_path, args.limit_files)
    if not chunk_paths:
        raise SystemExit("No chunk files found.")

    config: dict[str, Any] = {}
    if args.primary_model:
        config["primary_model"] = args.primary_model
    if args.fallback_model:
        config["fallback_model"] = args.fallback_model
    if args.force_backend:
        config["force_backend"] = args.force_backend

    report = build_quality_report(
        chunk_paths,
        config=config,
        sample_docs=args.sample_docs,
        sample_chunks_per_doc=args.sample_chunks_per_doc,
        query_docs=args.query_docs,
        min_text_length=args.min_text_length,
    )
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
