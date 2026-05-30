from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFESTS_DIR = ROOT / "data" / "papers" / "manifests"
DEFAULT_OUTPUT_ROOT = ROOT / "data" / "papers" / "builds"
DEFAULT_REPORTS_DIRNAME = "reports"
DEFAULT_PATTERN = "*.jsonl"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Rebuild ToukeAgent paper chunks from manifest batches and emit quality reports.")
    parser.add_argument("--manifests-dir", default=str(DEFAULT_MANIFESTS_DIR))
    parser.add_argument("--manifest-path", action="append", default=[])
    parser.add_argument("--pattern", default=DEFAULT_PATTERN)
    parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT_ROOT))
    parser.add_argument("--build-name", default="full-rebuild")
    parser.add_argument("--limit-manifests", type=int, default=0)
    parser.add_argument("--chunk-max-chars", type=int, default=1400)
    parser.add_argument("--chunk-overlap-chars", type=int, default=180)
    parser.add_argument("--quality-min-text-length", type=int, default=40)
    parser.add_argument("--manifest-record-limit", type=int, default=0)
    parser.add_argument("--skip-quality", action="store_true")
    parser.add_argument("--build-index", action="store_true")
    parser.add_argument("--qdrant-path", default="")
    parser.add_argument("--collection-name", default="toukeagent-papers")
    parser.add_argument("--primary-model", default="")
    parser.add_argument("--fallback-model", default="")
    parser.add_argument("--force-backend", default="")
    parser.add_argument("--index-batch-size", type=int, default=256)
    return parser.parse_args(argv)


def discover_manifest_paths(manifests_dir: Path, pattern: str, explicit_paths: list[str], limit_manifests: int) -> list[Path]:
    paths: list[Path] = []
    seen: set[str] = set()
    for raw_path in explicit_paths:
        path = Path(raw_path).expanduser()
        resolved = path if path.is_absolute() else (ROOT / path)
        key = str(resolved.resolve())
        if resolved.exists() and key not in seen and resolved.suffix == ".jsonl":
            seen.add(key)
            paths.append(resolved)

    if not paths and manifests_dir.exists():
        for path in sorted(manifests_dir.glob(pattern)):
            if path.name == "last-run-summary.json":
                continue
            key = str(path.resolve())
            if key in seen:
                continue
            seen.add(key)
            paths.append(path)
            if limit_manifests > 0 and len(paths) >= limit_manifests:
                break

    if limit_manifests > 0:
        return paths[:limit_manifests]
    return paths


def read_jsonl_records(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
    return records


def summarize_manifest(path: Path) -> dict[str, Any]:
    records = read_jsonl_records(path)
    conference_id = str(records[0].get("conference_id") or "unknown") if records else "unknown"
    publication_year = int(records[0].get("publication_year") or 0) if records else 0
    existing_pdf_paths: set[str] = set()
    for record in records:
        local_pdf_path = str(record.get("local_pdf_path") or "").strip()
        if not local_pdf_path:
            continue
        pdf_path = Path(local_pdf_path).expanduser()
        if pdf_path.exists():
            existing_pdf_paths.add(str(pdf_path))
    return {
        "path": path,
        "conference_id": conference_id,
        "publication_year": publication_year,
        "record_count": len(records),
        "existing_pdf_paths": existing_pdf_paths,
    }


def choose_manifests(manifest_paths: list[Path], *, explicit: bool) -> list[dict[str, Any]]:
    entries = [summarize_manifest(path) for path in manifest_paths]
    if explicit:
        return [entry for entry in entries if entry["existing_pdf_paths"]]

    grouped: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        if not entry["existing_pdf_paths"]:
            continue
        grouped[(entry["conference_id"], entry["publication_year"])].append(entry)

    selected: list[dict[str, Any]] = []
    for group_entries in grouped.values():
        union_paths: set[str] = set()
        for entry in group_entries:
            union_paths.update(entry["existing_pdf_paths"])
        if not union_paths:
            continue

        covering = [
            entry
            for entry in group_entries
            if entry["existing_pdf_paths"] == union_paths
        ]
        if covering:
            covering.sort(
                key=lambda entry: (
                    "-offset" not in entry["path"].stem,
                    len(entry["existing_pdf_paths"]),
                    -entry["record_count"],
                ),
                reverse=True,
            )
            selected.append(covering[0])
            continue

        remaining = set(union_paths)
        greedy = sorted(
            group_entries,
            key=lambda entry: (
                len(entry["existing_pdf_paths"]),
                -entry["record_count"],
            ),
            reverse=True,
        )
        for entry in greedy:
            gain = remaining.intersection(entry["existing_pdf_paths"])
            if not gain:
                continue
            selected.append(entry)
            remaining.difference_update(gain)
            if not remaining:
                break

    selected.sort(key=lambda entry: str(entry["path"]))
    return selected


def run_json_command(cmd: list[str], *, cwd: Path) -> dict[str, Any]:
    result = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"Command failed: {' '.join(cmd)}")
    return json.loads(result.stdout)


def build_quality_rollup(qualities: list[dict[str, Any]]) -> dict[str, Any]:
    if not qualities:
        return {
            "reports": 0,
            "total_chunks": 0,
            "total_documents": 0,
            "total_tiny_chunks": 0,
            "total_duplicate_text_records": 0,
            "worst_text_min": None,
            "best_text_min": None,
        }
    text_mins = [quality.get("text_length", {}).get("min") for quality in qualities if quality.get("text_length", {}).get("min") is not None]
    return {
        "reports": len(qualities),
        "total_chunks": sum(int(quality.get("chunks") or 0) for quality in qualities),
        "total_documents": sum(int(quality.get("documents") or 0) for quality in qualities),
        "total_tiny_chunks": sum(int((quality.get("quality_flags") or {}).get("tiny_chunk_count") or 0) for quality in qualities),
        "total_duplicate_text_records": sum(int((quality.get("quality_flags") or {}).get("duplicate_text_records") or 0) for quality in qualities),
        "worst_text_min": min(text_mins) if text_mins else None,
        "best_text_min": max(text_mins) if text_mins else None,
    }


def build_manifest_payload(
    *,
    args: argparse.Namespace,
    manifests_dir: Path,
    output_root: Path,
    build_dir: Path,
    reports_dir: Path,
    discovered_manifest_paths: list[Path],
    selected_manifest_entries: list[dict[str, Any]],
    chunk_paths: list[str],
    ingests: list[dict[str, Any]],
    qualities: list[dict[str, Any]],
    index_summary: dict[str, Any] | None,
) -> dict[str, Any]:
    total_chunks = sum(int(ingest.get("rag_chunks") or 0) for ingest in ingests)
    total_documents = sum(int(ingest.get("rag_documents") or 0) for ingest in ingests)
    quality_rollup = build_quality_rollup(qualities)
    return {
        "build_name": args.build_name,
        "manifests_dir": str(manifests_dir),
        "discovered_manifest_paths": [str(path) for path in discovered_manifest_paths],
        "manifest_paths": [str(entry["path"]) for entry in selected_manifest_entries],
        "chunk_paths": chunk_paths,
        "output_root": str(output_root),
        "build_dir": str(build_dir),
        "chunk_max_chars": args.chunk_max_chars,
        "chunk_overlap_chars": args.chunk_overlap_chars,
        "quality_min_text_length": args.quality_min_text_length,
        "manifest_record_limit": args.manifest_record_limit,
        "reports_dir": str(reports_dir),
        "summary": {
            "manifests": len(selected_manifest_entries),
            "documents": total_documents,
            "chunks": total_chunks,
            "quality_reports": len(qualities),
        },
        "quality_rollup": quality_rollup,
        "selection": [
            {
                "manifest_path": str(entry["path"]),
                "conference_id": entry["conference_id"],
                "publication_year": entry["publication_year"],
                "record_count": entry["record_count"],
                "existing_pdf_count": len(entry["existing_pdf_paths"]),
            }
            for entry in selected_manifest_entries
        ],
        "ingests": ingests,
        "qualities": [
            {
                "chunk_path": quality["inputs"]["chunk_paths"][0] if quality.get("inputs", {}).get("chunk_paths") else None,
                "tiny_chunk_count": quality.get("quality_flags", {}).get("tiny_chunk_count"),
                "duplicate_text_records": quality.get("quality_flags", {}).get("duplicate_text_records"),
                "section_depth_p50": quality.get("section_depth", {}).get("p50"),
                "text_length_min": quality.get("text_length", {}).get("min"),
            }
            for quality in qualities
        ],
        "index": index_summary,
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    manifests_dir = Path(args.manifests_dir).expanduser()
    output_root = Path(args.output_root).expanduser()
    build_dir = output_root / args.build_name
    rebuild_dir = build_dir / "rebuild"
    reports_dir = build_dir / DEFAULT_REPORTS_DIRNAME
    rebuild_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)

    discovered_manifest_paths = discover_manifest_paths(manifests_dir, args.pattern, args.manifest_path, args.limit_manifests)
    if not discovered_manifest_paths:
        raise SystemExit("No manifest files found.")
    selected_manifest_entries = choose_manifests(discovered_manifest_paths, explicit=bool(args.manifest_path))
    if not selected_manifest_entries:
        raise SystemExit("No manifest files with existing local PDFs were selected.")

    ingests: list[dict[str, Any]] = []
    qualities: list[dict[str, Any]] = []
    chunk_paths: list[str] = []
    rebuild_manifest_path = build_dir / "rebuild-manifest.json"

    for manifest_entry in selected_manifest_entries:
        source_manifest_path = manifest_entry["path"]
        manifest_output_dir = rebuild_dir / source_manifest_path.stem
        ingest_cmd = [
            "python3",
            "scripts/ingest_papers.py",
            "--manifest-path",
            str(source_manifest_path),
            "--output-dir",
            str(manifest_output_dir),
            "--chunk-max-chars",
            str(args.chunk_max_chars),
            "--chunk-overlap-chars",
            str(args.chunk_overlap_chars),
        ]
        if args.manifest_record_limit > 0:
            ingest_cmd.extend(["--limit", str(args.manifest_record_limit)])

        ingest_summary = run_json_command(ingest_cmd, cwd=ROOT)
        ingests.append(ingest_summary)
        chunk_path = str((ingest_summary.get("outputs") or {}).get("rag_chunks_path") or "")
        if chunk_path:
            chunk_paths.append(chunk_path)

        if args.skip_quality or not chunk_path:
            continue

        quality_cmd = [
            "python3",
            "scripts/inspect_chunk_quality.py",
            "--chunk-path",
            chunk_path,
            "--min-text-length",
            str(args.quality_min_text_length),
        ]
        quality_summary = run_json_command(quality_cmd, cwd=ROOT)
        qualities.append(quality_summary)
        report_path = reports_dir / f"{source_manifest_path.stem}.quality.json"
        report_path.write_text(json.dumps(quality_summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    manifest_payload = build_manifest_payload(
        args=args,
        manifests_dir=manifests_dir,
        output_root=output_root,
        build_dir=build_dir,
        reports_dir=reports_dir,
        discovered_manifest_paths=discovered_manifest_paths,
        selected_manifest_entries=selected_manifest_entries,
        chunk_paths=chunk_paths,
        ingests=ingests,
        qualities=qualities,
        index_summary=None,
    )
    rebuild_manifest_path.write_text(json.dumps(manifest_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    index_summary = None
    if args.build_index and chunk_paths:
        qdrant_path = Path(args.qdrant_path).expanduser() if args.qdrant_path else (build_dir / "qdrant")
        index_manifest_path = build_dir / "index-manifest.json"
        index_cmd = [
            "python3",
            "scripts/build_paper_index.py",
            "--qdrant-path",
            str(qdrant_path),
            "--collection-name",
            args.collection_name,
            "--index-manifest-path",
            str(index_manifest_path),
            "--index-batch-size",
            str(args.index_batch_size),
        ]
        for chunk_path in chunk_paths:
            index_cmd.extend(["--chunk-path", chunk_path])
        if args.primary_model:
            index_cmd.extend(["--primary-model", args.primary_model])
        if args.fallback_model:
            index_cmd.extend(["--fallback-model", args.fallback_model])
        if args.force_backend:
            index_cmd.extend(["--force-backend", args.force_backend])
        index_summary = run_json_command(index_cmd, cwd=ROOT)

    manifest = build_manifest_payload(
        args=args,
        manifests_dir=manifests_dir,
        output_root=output_root,
        build_dir=build_dir,
        reports_dir=reports_dir,
        discovered_manifest_paths=discovered_manifest_paths,
        selected_manifest_entries=selected_manifest_entries,
        chunk_paths=chunk_paths,
        ingests=ingests,
        qualities=qualities,
        index_summary=index_summary,
    )
    rebuild_manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    json.dump(manifest, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
