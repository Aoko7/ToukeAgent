from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


DEFAULT_CHUNKS_ROOT = ROOT / "data" / "papers" / "chunks"
DEFAULT_QDRANT_PATH = ROOT / "data" / "qdrant" / "papers"
DEFAULT_COLLECTION_NAME = "toukeagent-papers"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Batch index paper chunk files into the local ToukeAgent vector store.")
    parser.add_argument("--chunks-root", default=str(DEFAULT_CHUNKS_ROOT))
    parser.add_argument("--chunk-path", action="append", default=[])
    parser.add_argument("--pattern", default="**/*.rag_chunks.jsonl")
    parser.add_argument("--limit-files", type=int, default=0)
    parser.add_argument("--qdrant-path", default=str(DEFAULT_QDRANT_PATH))
    parser.add_argument("--collection-name", default=DEFAULT_COLLECTION_NAME)
    parser.add_argument("--primary-model", default="")
    parser.add_argument("--fallback-model", default="")
    parser.add_argument("--force-backend", default="")
    parser.add_argument("--index-manifest-path", default="")
    parser.add_argument("--index-batch-size", type=int, default=256)
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


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    chunks_root = Path(args.chunks_root).expanduser()
    chunk_paths = discover_chunk_paths(chunks_root, args.pattern, args.chunk_path, args.limit_files)
    if not chunk_paths:
        raise SystemExit("No chunk files found to index.")

    from toukeagent_core.retrieval import batch_index_chunk_files

    config: dict[str, str] = {
        "path": str(Path(args.qdrant_path).expanduser()),
        "collection_name": args.collection_name,
        "index_batch_size": str(args.index_batch_size),
    }
    if args.primary_model:
        config["primary_model"] = args.primary_model
    if args.fallback_model:
        config["fallback_model"] = args.fallback_model
    if args.force_backend:
        config["force_backend"] = args.force_backend

    summary = batch_index_chunk_files(
        {
            "chunk_paths": [str(path) for path in chunk_paths],
            "config": config,
        }
    )
    summary["chunks_root"] = str(chunks_root)
    summary["pattern"] = args.pattern
    if args.index_manifest_path:
        manifest_path = Path(args.index_manifest_path).expanduser()
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest = {
            **summary,
            "config": config,
        }
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        summary["index_manifest_path"] = str(manifest_path)
    json.dump(summary, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
