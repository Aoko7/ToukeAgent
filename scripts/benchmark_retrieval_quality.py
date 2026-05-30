from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASELINE_ROOT = Path("/tmp/toukeagent-full-chunks")
DEFAULT_CANDIDATE_ROOT = ROOT / "data" / "papers" / "builds" / "2026-05-13-full-rebuild-v1" / "rebuild"
DEFAULT_OUTPUT_ROOT = ROOT / "data" / "papers" / "benchmarks"
UNICODE_GLYPH_PATTERN = re.compile(r"(?:/uni[0-9a-fA-F]{8}\s*){4,}")
DECIMAL_AXIS_PATTERN = re.compile(r"\b\d+(?:\.\d+){2,}\b")
METRIC_TOKEN_PATTERN = re.compile(r"\b(?:TPR|TNR|FPR|FNR|FPP|FNP|AUC|ROC)\b", re.IGNORECASE)
PAREN_LABEL_PATTERN = re.compile(r"\([a-z]\)", re.IGNORECASE)
AXIS_LABEL_SERIES_PATTERN = re.compile(r"(?:\b\d+(?:\.\d+)?\s*[A-Za-z]{1,16}s?\b[\s,:;]*){3,}", re.IGNORECASE)
FIGURE_OR_TABLE_PATTERN = re.compile(r"\b(?:figure|fig\.?|table)\s*\d+\b", re.IGNORECASE)
RESULT_METRIC_PATTERN = re.compile(
    r"\b(?:accuracy|latency|throughput|memory|overhead|similarity|score|threshold|precision|recall)\b",
    re.IGNORECASE,
)
PROTOCOL_DIAGRAM_PATTERN = re.compile(r"\b(?:syn-ack|ack|seq=|3whs|switch agent)\b", re.IGNORECASE)
TOKEN_PATTERN = re.compile(r"[a-z0-9]+")
GENERIC_LLM_TERMS = {
    "ai",
    "language",
    "large",
    "llm",
    "lm",
    "model",
}
STOPWORDS = {
    "a",
    "an",
    "and",
    "approach",
    "approaches",
    "are",
    "as",
    "at",
    "be",
    "by",
    "common",
    "compare",
    "comparing",
    "do",
    "does",
    "for",
    "from",
    "how",
    "in",
    "into",
    "is",
    "it",
    "new",
    "of",
    "on",
    "or",
    "our",
    "paper",
    "question",
    "study",
    "task",
    "that",
    "the",
    "their",
    "this",
    "to",
    "under",
    "use",
    "using",
    "via",
    "what",
    "when",
    "where",
    "which",
    "why",
    "with",
}
TOPIC_FAMILY_TERMS = {
    "benchmark_family": {"benchmark", "bench", "evaluate", "evaluating", "evaluation", "robustness"},
    "prompting_family": {"debiasing", "instruction", "prompt", "prompting", "structured"},
    "rag_family": {"augmented", "generation", "rag", "retrieval"},
    "finetune_family": {"fine", "finetuning", "train", "training", "tuning"},
    "knowledge_family": {"fact", "factual", "injection", "knowledge"},
    "tool_family": {"tool", "tools", "learning"},
    "privacy_family": {"privacy", "private"},
    "bias_fairness_family": {"bias", "debiasing", "fair", "fairness"},
}
NOISY_TAXONOMY_TERMS = {
    "corpus_breadcrumb": {"corpus", "dataset", "datasets"},
    "education_language": {"romanian", "nli", "inference", "cartography", "curriculum"},
    "speech_audio": {"acoustic", "audio", "speech", "wavelet"},
}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark retrieval quality between baseline and cleaned paper corpora.")
    parser.add_argument("--manifest-path", action="append", default=[])
    parser.add_argument("--query-case-path", action="append", default=[])
    parser.add_argument("--gold-case-path", action="append", default=[])
    parser.add_argument("--baseline-chunk-root", default=str(DEFAULT_BASELINE_ROOT))
    parser.add_argument("--candidate-chunk-root", default=str(DEFAULT_CANDIDATE_ROOT))
    parser.add_argument("--baseline-index-path", default="")
    parser.add_argument("--baseline-collection-name", default="")
    parser.add_argument("--candidate-index-path", default="")
    parser.add_argument("--candidate-collection-name", default="")
    parser.add_argument("--baseline-index-manifest-path", default="")
    parser.add_argument("--candidate-index-manifest-path", default="")
    parser.add_argument("--baseline-recall-mode", default="hybrid", choices=["hybrid", "semantic", "bm25"])
    parser.add_argument("--candidate-recall-mode", default="hybrid", choices=["hybrid", "semantic", "bm25"])
    parser.add_argument("--baseline-rrf-weights", default="")
    parser.add_argument("--candidate-rrf-weights", default="")
    parser.add_argument("--baseline-query-ablation", default="none", choices=["none", "no_rewrites", "no_decomposition", "single_query"])
    parser.add_argument("--candidate-query-ablation", default="none", choices=["none", "no_rewrites", "no_decomposition", "single_query"])
    parser.add_argument("--baseline-evidence-ablation", default="none", choices=["none", "no_rerank_adjustment", "simple_support"])
    parser.add_argument("--candidate-evidence-ablation", default="none", choices=["none", "no_rerank_adjustment", "simple_support"])
    parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT_ROOT))
    parser.add_argument("--benchmark-name", default="retrieval-quality")
    parser.add_argument("--queries-per-manifest", type=int, default=3)
    parser.add_argument("--top-k", type=int, default=3)
    parser.add_argument("--force-backend", default="")
    parser.add_argument("--index-batch-size", type=int, default=256)
    return parser.parse_args(argv)


def parse_rrf_weights(raw: str) -> dict[str, float]:
    text = str(raw or "").strip()
    if not text:
        return {}
    if text.startswith("{"):
        payload = json.loads(text)
        if not isinstance(payload, dict):
            raise ValueError("--*-rrf-weights JSON value must be an object")
        pairs = payload.items()
    else:
        pairs = []
        for part in text.split(","):
            if not part.strip():
                continue
            if "=" not in part:
                raise ValueError("--*-rrf-weights must use semantic=0.65,bm25=0.35 format")
            key, value = part.split("=", 1)
            pairs.append((key, value))
    weights: dict[str, float] = {}
    for key, value in pairs:
        channel = str(key or "").strip()
        if channel not in {"semantic", "bm25"}:
            raise ValueError("--*-rrf-weights only supports semantic and bm25")
        weight = float(value)
        if weight < 0:
            raise ValueError("--*-rrf-weights values must be non-negative")
        weights[channel] = weight
    return weights


def read_jsonl_records(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def read_json_or_jsonl(path: Path) -> list[dict[str, Any]]:
    if path.suffix == ".jsonl":
        return read_jsonl_records(path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        cases = payload.get("cases") or []
        if not isinstance(cases, list):
            raise ValueError(f"Expected 'cases' list in {path}")
        return [dict(case) for case in cases]
    if isinstance(payload, list):
        return [dict(case) for case in payload]
    raise ValueError(f"Unsupported query-case format in {path}")


def slugify(text: str) -> str:
    import re

    lowered = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower())
    return lowered.strip("-") or "paper"


def doc_id_for_record(record: dict[str, Any]) -> str:
    return f"paper::{record.get('conference_id')}::{record.get('publication_year')}::{slugify(str(record.get('title') or 'paper'))}"


def normalize_text(text: str | None) -> str:
    return " ".join(str(text or "").split()).strip().casefold()


def canonicalize_token(token: str) -> str:
    lowered = token.strip().casefold()
    if lowered in {"llms", "lms"}:
        return "llm"
    if lowered.endswith("s") and len(lowered) > 4 and not lowered.endswith("ss"):
        lowered = lowered[:-1]
    return lowered


def extract_tokens(text: str | None) -> list[str]:
    return [canonicalize_token(token) for token in TOKEN_PATTERN.findall(normalize_text(text))]


def informative_tokens(text: str | None) -> set[str]:
    return {token for token in extract_tokens(text) if token and token not in STOPWORDS}


def detect_topic_families(tokens: set[str]) -> list[str]:
    families: list[str] = []
    for family, keywords in TOPIC_FAMILY_TERMS.items():
        if tokens & keywords:
            families.append(family)
    return sorted(families)


def detect_noisy_taxonomy_terms(tokens: set[str]) -> list[str]:
    labels: list[str] = []
    for family, keywords in NOISY_TAXONOMY_TERMS.items():
        if tokens & keywords:
            labels.append(family)
    return sorted(labels)


def build_queries(records: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    selected = records[:limit]
    queries: list[dict[str, Any]] = []
    for record in selected:
        title = str(record.get("title") or "").strip()
        abstract = str(record.get("abstract") or "").strip()
        if not title:
            continue
        title_terms = title.split()[:10]
        query_text = " ".join(title_terms)
        if abstract:
            abstract_terms = " ".join(abstract.split()[:18])
            query_text = f"{query_text} {abstract_terms}".strip()
        queries.append(
            {
                "case_id": record.get("paper_id") or doc_id_for_record(record),
                "query": query_text,
                "expected_doc_id": doc_id_for_record(record),
                "expected_title": title,
                "conference_id": record.get("conference_id"),
                "publication_year": record.get("publication_year"),
                "manifest_path": record.get("_manifest_path"),
                "query_source": "generated",
            }
        )
    return queries


def manifest_to_chunk_name(path: Path) -> str:
    return f"{path.stem}.rag_chunks.jsonl"


def resolve_chunk_paths(manifest_paths: list[Path], root: Path) -> list[Path]:
    chunk_paths: list[Path] = []
    for manifest_path in manifest_paths:
        matches = sorted(root.glob(f"**/{manifest_to_chunk_name(manifest_path)}"))
        if not matches:
            raise FileNotFoundError(f"Chunk file not found for manifest {manifest_path} under {root}")
        chunk_paths.append(matches[0])
    return chunk_paths


def resolve_manifest_path(raw_path: str) -> str:
    path = Path(raw_path).expanduser()
    resolved = path if path.is_absolute() else (ROOT / path)
    return str(resolved.resolve())


def build_record_index(records: list[dict[str, Any]]) -> dict[tuple[str, str], dict[str, Any]]:
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for record in records:
        manifest_path = str(record.get("_manifest_path") or "")
        title = normalize_text(str(record.get("title") or ""))
        if title and manifest_path:
            index[(manifest_path, title)] = record
    return index


def build_title_index(records: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    index: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        title = normalize_text(str(record.get("title") or ""))
        if not title:
            continue
        index.setdefault(title, []).append(record)
    return index


def resolve_doc_ids_by_title(
    titles: list[str],
    *,
    record_index_by_title: dict[str, list[dict[str, Any]]],
    case_path: Path,
    query_text: str,
) -> list[str]:
    resolved_doc_ids: list[str] = []
    seen: set[str] = set()
    for raw_title in titles:
        normalized_title = normalize_text(raw_title)
        if not normalized_title:
            continue
        matches = list(record_index_by_title.get(normalized_title) or [])
        if not matches:
            raise ValueError(f"Could not resolve title '{raw_title}' for case '{query_text}' in {case_path}")
        if len(matches) > 1:
            raise ValueError(f"Ambiguous title '{raw_title}' for case '{query_text}' in {case_path}")
        doc_id = doc_id_for_record(matches[0])
        if doc_id in seen:
            continue
        seen.add(doc_id)
        resolved_doc_ids.append(doc_id)
    return resolved_doc_ids


def resolve_query_cases(case_paths: list[Path], manifest_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    record_index = build_record_index(manifest_records)
    title_index = build_title_index(manifest_records)
    manifest_scope = {str(record.get("_manifest_path") or "") for record in manifest_records}
    queries: list[dict[str, Any]] = []
    for case_path in case_paths:
        for raw_case in read_json_or_jsonl(case_path):
            query_text = str(raw_case.get("query") or "").strip()
            if not query_text:
                raise ValueError(f"Missing query text in {case_path}")

            manifest_path = raw_case.get("manifest_path")
            resolved_manifest_path = resolve_manifest_path(str(manifest_path)) if manifest_path else ""
            expected_title = str(raw_case.get("expected_title") or "").strip()
            expected_doc_id = str(raw_case.get("expected_doc_id") or "").strip()
            matched_record: dict[str, Any] | None = None

            if expected_title:
                if not resolved_manifest_path:
                    raise ValueError(f"Case '{query_text}' in {case_path} must provide manifest_path when using expected_title")
                if resolved_manifest_path not in manifest_scope:
                    raise ValueError(f"Case '{query_text}' in {case_path} targets manifest outside current benchmark scope: {resolved_manifest_path}")
                matched_record = record_index.get((resolved_manifest_path, normalize_text(expected_title)))
                if matched_record is None:
                    raise ValueError(f"Could not resolve expected_title '{expected_title}' in {resolved_manifest_path}")
                expected_doc_id = expected_doc_id or doc_id_for_record(matched_record)
            elif not expected_doc_id:
                raise ValueError(f"Case '{query_text}' in {case_path} must provide expected_doc_id or expected_title")

            if matched_record is None and expected_doc_id:
                matched_record = next((record for record in manifest_records if doc_id_for_record(record) == expected_doc_id), None)

            hard_negative_titles = [str(value).strip() for value in list(raw_case.get("hard_negative_titles") or []) if str(value).strip()]
            hard_negative_doc_ids = [str(value).strip() for value in list(raw_case.get("hard_negative_doc_ids") or []) if str(value).strip()]
            if hard_negative_titles:
                hard_negative_doc_ids.extend(
                    resolve_doc_ids_by_title(
                        hard_negative_titles,
                        record_index_by_title=title_index,
                        case_path=case_path,
                        query_text=query_text,
                    )
                )
            hard_negative_doc_ids = [
                doc_id
                for index, doc_id in enumerate(hard_negative_doc_ids)
                if doc_id and doc_id != expected_doc_id and doc_id not in hard_negative_doc_ids[:index]
            ]

            queries.append(
                {
                    "case_id": raw_case.get("case_id") or slugify(query_text),
                    "query": query_text,
                    "expected_doc_id": expected_doc_id,
                    "expected_title": expected_title or str((matched_record or {}).get("title") or ""),
                    "conference_id": raw_case.get("conference_id") or (matched_record or {}).get("conference_id"),
                    "publication_year": raw_case.get("publication_year") or (matched_record or {}).get("publication_year"),
                    "manifest_path": resolved_manifest_path or str((matched_record or {}).get("_manifest_path") or ""),
                    "query_source": "curated",
                    "tags": list(raw_case.get("tags") or []),
                    "note": raw_case.get("note") or "",
                    "difficulty": str(raw_case.get("difficulty") or "").strip(),
                    "filters": dict(raw_case.get("filters") or {}),
                    "filter_policy": dict(raw_case.get("filter_policy") or {}),
                    "hard_negative_titles": hard_negative_titles,
                    "hard_negative_doc_ids": hard_negative_doc_ids,
                }
            )
    return queries


def normalize_gold_cases(case_paths: list[Path]) -> dict[str, dict[str, Any]]:
    gold_cases: dict[str, dict[str, Any]] = {}
    for case_path in case_paths:
        for raw_case in read_json_or_jsonl(case_path):
            case_id = str(raw_case.get("case_id") or "").strip()
            if not case_id:
                raise ValueError(f"Gold case in {case_path} is missing case_id")
            requirements = []
            for index, raw_requirement in enumerate(list(raw_case.get("required_supports") or [])):
                section_any_of = [normalize_text(value) for value in list(raw_requirement.get("section_any_of") or []) if normalize_text(value)]
                snippet_any_of = [normalize_text(value) for value in list(raw_requirement.get("snippet_any_of") or []) if normalize_text(value)]
                snippet_all_of = [normalize_text(value) for value in list(raw_requirement.get("snippet_all_of") or []) if normalize_text(value)]
                snippet_none_of = [normalize_text(value) for value in list(raw_requirement.get("snippet_none_of") or []) if normalize_text(value)]
                requirements.append(
                    {
                        "label": str(raw_requirement.get("label") or f"support_{index + 1}"),
                        "section_any_of": section_any_of,
                        "snippet_any_of": snippet_any_of,
                        "snippet_all_of": snippet_all_of,
                        "snippet_none_of": snippet_none_of,
                        "selector_level": "snippet" if (snippet_any_of or snippet_all_of) else "section",
                    }
                )

            gold_cases[case_id] = {
                "case_id": case_id,
                "expected_doc_id": str(raw_case.get("expected_doc_id") or "").strip(),
                "required_supports": requirements,
            }
    return gold_cases


def run_json_command(cmd: list[str]) -> dict[str, Any]:
    result = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"Command failed: {' '.join(cmd)}")
    return json.loads(result.stdout)


def read_optional_json(path: str) -> dict[str, Any] | None:
    if not path:
        return None
    resolved = Path(path).expanduser()
    resolved = resolved if resolved.is_absolute() else (ROOT / resolved)
    if not resolved.exists():
        raise FileNotFoundError(f"Index manifest not found: {resolved}")
    return json.loads(resolved.read_text(encoding="utf-8"))


def build_index(chunk_paths: list[Path], *, qdrant_path: Path, collection_name: str, force_backend: str, index_batch_size: int) -> dict[str, Any]:
    cmd = [
        "python3",
        "scripts/build_paper_index.py",
        "--qdrant-path",
        str(qdrant_path),
        "--collection-name",
        collection_name,
        "--force-backend",
        force_backend,
        "--index-batch-size",
        str(index_batch_size),
    ]
    for chunk_path in chunk_paths:
        cmd.extend(["--chunk-path", str(chunk_path)])
    return run_json_command(cmd)


def resolve_index_source(
    *,
    kind: str,
    chunk_paths: list[Path],
    explicit_index_path: str,
    explicit_collection_name: str,
    explicit_manifest_path: str,
    benchmark_dir: Path,
    default_collection_name: str,
    force_backend: str,
    index_batch_size: int,
) -> tuple[Path, str, dict[str, Any]]:
    if explicit_index_path:
        qdrant_path = Path(explicit_index_path).expanduser()
        qdrant_path = qdrant_path if qdrant_path.is_absolute() else (ROOT / qdrant_path)
        collection_name = explicit_collection_name or default_collection_name
        summary = read_optional_json(explicit_manifest_path) or {
            "reused_index": True,
            "vector_backend": {
                "kind": "qdrant_local",
                "path": str(qdrant_path),
                "collection_name": collection_name,
            },
        }
        summary = {
            **summary,
            "reused_index": True,
        }
        return qdrant_path, collection_name, summary

    qdrant_path = benchmark_dir / f"{kind}-qdrant"
    collection_name = default_collection_name
    summary = build_index(
        chunk_paths,
        qdrant_path=qdrant_path,
        collection_name=collection_name,
        force_backend=force_backend,
        index_batch_size=index_batch_size,
    )
    return qdrant_path, collection_name, summary


def run_search(
    query: str,
    *,
    qdrant_path: Path,
    collection_name: str,
    force_backend: str,
    top_k: int,
    recall_mode: str = "hybrid",
    rrf_weights: dict[str, float] | None = None,
    query_ablation: str = "none",
    evidence_ablation: str = "none",
    filters: dict[str, Any] | None = None,
    filter_policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "query": query,
        "limit": top_k,
        "filters": dict(filters or {}),
        "filter_policy": dict(filter_policy or {}),
        "recall_mode": recall_mode,
        "rrf_channel_weights": dict(rrf_weights or {}),
        "query_ablation": query_ablation,
        "evidence_ablation": evidence_ablation,
        "config": {
            "path": str(qdrant_path),
            "collection_name": collection_name,
            "force_backend": force_backend,
            "recall_mode": recall_mode,
            "rrf_channel_weights": dict(rrf_weights or {}),
            "query_ablation": query_ablation,
            "evidence_ablation": evidence_ablation,
        },
    }
    cmd = [
        "python3",
        "-m",
        "toukeagent_core",
        "--action",
        "search_indexed_chunks",
        "--payload",
        json.dumps(payload, ensure_ascii=False),
    ]
    envelope = run_json_command(cmd)
    if not envelope.get("ok"):
        raise RuntimeError(str((envelope.get("error") or {}).get("message") or "search failed"))
    return envelope["result"]


def citation_proxy(item: dict[str, Any]) -> float:
    supporting_chunks = item.get("supporting_chunks") or []
    if not supporting_chunks:
        return 0.0
    scores = [float(chunk.get("score") or 0.0) for chunk in supporting_chunks]
    mean_score = sum(scores) / len(scores) if scores else 0.0
    return round(mean_score, 4)


def support_chunk_text(chunk: dict[str, Any]) -> str:
    return str(chunk.get("snippet") or chunk.get("text") or "")


def is_low_signal_support_text(text: str) -> bool:
    normalized = " ".join(str(text or "").split())
    if not normalized:
        return True
    if UNICODE_GLYPH_PATTERN.search(normalized):
        return True
    if AXIS_LABEL_SERIES_PATTERN.search(normalized[:220]):
        return True
    if normalized.count("−") >= 6 or normalized.count("—") >= 6:
        return True
    if DECIMAL_AXIS_PATTERN.search(normalized) and len(PAREN_LABEL_PATTERN.findall(normalized)) >= 2:
        return True
    if METRIC_TOKEN_PATTERN.search(normalized) and DECIMAL_AXIS_PATTERN.search(normalized):
        return True
    tokens = normalized.split()
    numeric_tokens = [token for token in tokens if any(char.isdigit() for char in token)]
    alpha_tokens = [token for token in tokens if any(char.isalpha() for char in token)]
    if FIGURE_OR_TABLE_PATTERN.search(normalized) and RESULT_METRIC_PATTERN.search(normalized):
        return True
    if PROTOCOL_DIAGRAM_PATTERN.search(normalized) and len(numeric_tokens) >= 3 and len(alpha_tokens) <= 24:
        return True
    if len(normalized) < 40 and len(alpha_tokens) <= 2 and len(numeric_tokens) >= 2:
        return True
    if normalized.count("/") >= 3 and len(alpha_tokens) <= 3:
        return True
    return False


def support_low_signal_ratio(item: dict[str, Any]) -> float:
    supporting_chunks = item.get("supporting_chunks") or []
    if not supporting_chunks:
        return 0.0
    low_signal = sum(1 for chunk in supporting_chunks if is_low_signal_support_text(support_chunk_text(chunk)))
    return round(low_signal / len(supporting_chunks), 4)


def compact_chunk_review(chunk: dict[str, Any]) -> dict[str, Any]:
    metadata = dict(chunk.get("metadata") or {})
    return {
        "chunk_id": chunk.get("chunk_id"),
        "doc_id": chunk.get("doc_id"),
        "title": chunk.get("title"),
        "section": chunk.get("section") or (list(chunk.get("section_path") or [])[-1:] or [None])[0],
        "section_path": list(chunk.get("section_path") or []),
        "score": float(chunk.get("score") or 0.0),
        "source_type": chunk.get("source_type"),
        "freshness": chunk.get("freshness"),
        "conference_id": metadata.get("conference_id"),
        "publication_year": metadata.get("publication_year"),
        "paper_title": metadata.get("paper_title"),
        "low_signal": is_low_signal_support_text(support_chunk_text(chunk)),
        "snippet": support_chunk_text(chunk),
    }


def compact_item_review(item: dict[str, Any]) -> dict[str, Any]:
    metadata = dict(item.get("metadata") or {})
    supporting_chunks = [compact_chunk_review(chunk) for chunk in item.get("supporting_chunks") or []]
    return {
        "doc_id": item.get("doc_id"),
        "title": item.get("title"),
        "aggregate_score": float(item.get("aggregate_score") or 0.0),
        "low_signal": bool(item.get("low_signal")),
        "section_role": item.get("section_role"),
        "rerank_adjustment": float(item.get("rerank_adjustment") or 0.0),
        "supporting_chunk_count": int(item.get("supporting_chunk_count") or len(supporting_chunks)),
        "conference_id": metadata.get("conference_id"),
        "publication_year": metadata.get("publication_year"),
        "paper_title": metadata.get("paper_title") or item.get("title"),
        "support_low_signal_ratio": support_low_signal_ratio(item),
        "owner": item.get("owner"),
        "version": item.get("version"),
        "required_context": list(item.get("required_context") or []),
        "retrieval_hints": list(item.get("retrieval_hints") or []),
        "supporting_chunks": supporting_chunks,
    }


def distractor_support_text(item: dict[str, Any], *, max_chunks: int = 2) -> str:
    snippets = [support_chunk_text(chunk) for chunk in list(item.get("supporting_chunks") or [])[:max_chunks]]
    return " ".join(snippets)


def analyze_distractor(case: dict[str, Any], distractor_item_review: dict[str, Any], *, rank: int) -> dict[str, Any]:
    top_doc_id = str(distractor_item_review.get("doc_id") or "").strip()
    expected_doc_id = str(case.get("expected_doc_id") or "").strip()
    if not top_doc_id or top_doc_id == expected_doc_id:
        return {
            "top_distractor_present": False,
            "top_distractor_doc_id": None,
            "top_distractor_title": None,
            "top_distractor_rank": None,
            "top_distractor_taxonomy": None,
            "top_distractor_taxonomy_reason": None,
            "top_distractor_query_overlap": [],
            "top_distractor_expected_overlap": [],
            "top_distractor_generic_overlap": [],
            "top_distractor_shared_families": [],
            "top_distractor_noise_terms": [],
            "top_distractor_same_conference": False,
            "top_distractor_same_year": False,
            "top_distractor": {},
        }

    top_title = str(distractor_item_review.get("title") or "").strip()
    top_support_text = distractor_support_text(distractor_item_review)
    query_tokens = informative_tokens(case.get("query"))
    expected_tokens = informative_tokens(case.get("expected_title"))
    query_plus_tag_tokens = set(query_tokens)
    for tag in list(case.get("tags") or []):
        query_plus_tag_tokens.update(informative_tokens(str(tag)))
    distractor_tokens = informative_tokens(f"{top_title} {top_support_text}")
    distractor_all_tokens = set(extract_tokens(f"{top_title} {top_support_text}"))
    query_all_tokens = set(extract_tokens(case.get("query")))
    expected_all_tokens = set(extract_tokens(case.get("expected_title")))

    query_overlap = sorted((query_tokens & distractor_tokens) - GENERIC_LLM_TERMS)
    expected_overlap = sorted((expected_tokens & distractor_tokens) - GENERIC_LLM_TERMS)
    query_generic_terms = (query_all_tokens | expected_all_tokens) & GENERIC_LLM_TERMS
    distractor_generic_terms = distractor_all_tokens & GENERIC_LLM_TERMS
    generic_overlap = sorted(query_generic_terms | distractor_generic_terms) if query_generic_terms and distractor_generic_terms else []
    query_families = detect_topic_families(query_plus_tag_tokens | expected_tokens)
    distractor_families = detect_topic_families(distractor_tokens)
    shared_families = sorted(set(query_families) & set(distractor_families))
    distractor_noise_terms = detect_noisy_taxonomy_terms(distractor_tokens)
    same_conference = bool(case.get("conference_id")) and distractor_item_review.get("conference_id") == case.get("conference_id")
    same_year = bool(case.get("publication_year")) and distractor_item_review.get("publication_year") == case.get("publication_year")
    hard_negative_doc_ids = {str(value).strip() for value in list(case.get("hard_negative_doc_ids") or []) if str(value).strip()}

    if top_doc_id in hard_negative_doc_ids:
        taxonomy = "known_hard_negative"
        reason = "retrieved top1 matches a configured hard-negative document"
    elif (
        query_overlap
        and shared_families
        and distractor_noise_terms
        and not any(family in shared_families for family in ("rag_family", "knowledge_family", "privacy_family"))
    ):
        taxonomy = "surface_overlap_noise"
        reason = "distractor shares benchmark-like surface terms but also carries off-topic markers: " + ", ".join(distractor_noise_terms)
    elif query_overlap or expected_overlap:
        taxonomy = "specific_topic_neighbor"
        reason = (
            "distractor shares specific query/title terms: "
            + ", ".join(query_overlap or expected_overlap)
        )
    elif "benchmark_family" in shared_families:
        taxonomy = "benchmark_family_neighbor"
        reason = "distractor shares benchmark/evaluation surface without matching the target paper"
    elif shared_families:
        taxonomy = "topical_family_neighbor"
        reason = "distractor shares higher-level topic family: " + ", ".join(shared_families)
    elif generic_overlap:
        taxonomy = "generic_llm_neighbor"
        reason = "overlap is limited to generic LLM/model terms: " + ", ".join(generic_overlap)
    elif same_conference or same_year:
        taxonomy = "same_conference_noise"
        reason = "distractor comes from the same venue/time slice but shows weak lexical overlap"
    else:
        taxonomy = "unknown_neighbor"
        reason = "no strong lexical or family overlap was detected"

    return {
        "top_distractor_present": True,
        "top_distractor_doc_id": top_doc_id,
        "top_distractor_title": top_title or None,
        "top_distractor_rank": rank,
        "top_distractor_taxonomy": taxonomy,
        "top_distractor_taxonomy_reason": reason,
        "top_distractor_query_overlap": query_overlap,
        "top_distractor_expected_overlap": expected_overlap,
        "top_distractor_generic_overlap": generic_overlap,
        "top_distractor_shared_families": shared_families,
        "top_distractor_noise_terms": distractor_noise_terms,
        "top_distractor_same_conference": same_conference,
        "top_distractor_same_year": same_year,
        "top_distractor": distractor_item_review,
    }


def analyze_top_distractor(case: dict[str, Any], top_item_review: dict[str, Any]) -> dict[str, Any]:
    return analyze_distractor(case, top_item_review, rank=1)


def find_expected_item(case: dict[str, Any], items: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, int | None]:
    expected_doc_id = str(case.get("expected_doc_id") or "")
    for index, item in enumerate(items):
        if item.get("doc_id") == expected_doc_id:
            return item, index + 1
    return None, None


def gold_requirement_matches_chunk(chunk: dict[str, Any], requirement: dict[str, Any]) -> bool:
    section_text = normalize_text(" ".join(chunk.get("section_path") or ([chunk.get("section")] if chunk.get("section") else [])))
    snippet_text = normalize_text(support_chunk_text(chunk))
    section_any_of = list(requirement.get("section_any_of") or [])
    snippet_any_of = list(requirement.get("snippet_any_of") or [])
    snippet_all_of = list(requirement.get("snippet_all_of") or [])
    snippet_none_of = list(requirement.get("snippet_none_of") or [])
    has_selector = bool(section_any_of or snippet_any_of or snippet_all_of or snippet_none_of)
    if not has_selector:
        return False
    if section_any_of and not any(term in section_text for term in section_any_of):
        return False
    if snippet_none_of and any(term in snippet_text for term in snippet_none_of):
        return False
    if snippet_any_of and not any(term in snippet_text for term in snippet_any_of):
        return False
    if snippet_all_of and not all(term in snippet_text for term in snippet_all_of):
        return False
    return True


def gold_requirement_selector_level(requirement: dict[str, Any]) -> str:
    if requirement.get("snippet_any_of") or requirement.get("snippet_all_of"):
        return "snippet"
    if requirement.get("section_any_of"):
        return "section"
    return "unknown"


def gold_requirement_section_match(chunk: dict[str, Any], requirement: dict[str, Any]) -> bool:
    section_any_of = list(requirement.get("section_any_of") or [])
    if not section_any_of:
        return True
    section_text = normalize_text(" ".join(chunk.get("section_path") or ([chunk.get("section")] if chunk.get("section") else [])))
    return any(term in section_text for term in section_any_of)


def evaluate_gold_support(case: dict[str, Any], expected_item: dict[str, Any] | None, gold_case: dict[str, Any] | None) -> dict[str, Any]:
    if not gold_case:
        return {
            "annotated": False,
            "context_recall": None,
            "context_precision": None,
            "snippet_annotated": False,
            "snippet_context_recall": None,
            "snippet_context_precision": None,
            "citation_span_match_rate": None,
            "matched_requirement_count": 0,
            "total_requirements": 0,
            "matched_chunk_count": 0,
            "matched_snippet_requirement_count": 0,
            "total_snippet_requirements": 0,
            "matched_snippet_chunk_count": 0,
            "total_supporting_chunks": 0,
            "expected_doc_found": expected_item is not None,
            "matched_labels": [],
            "requirements": [],
        }

    requirements = list(gold_case.get("required_supports") or [])
    supporting_chunks = [compact_chunk_review(chunk) for chunk in list((expected_item or {}).get("supporting_chunks") or [])]
    matched_labels: list[str] = []
    matched_chunk_ids: set[str] = set()
    matched_snippet_labels: list[str] = []
    matched_snippet_chunk_ids: set[str] = set()
    section_candidate_chunk_ids: set[str] = set()
    snippet_requirements = [requirement for requirement in requirements if gold_requirement_selector_level(requirement) == "snippet"]
    requirement_reviews = []

    for requirement in requirements:
        section_candidate_chunks = [chunk for chunk in supporting_chunks if gold_requirement_section_match(chunk, requirement)]
        matched_chunks = [chunk for chunk in supporting_chunks if gold_requirement_matches_chunk(chunk, requirement)]
        matched = bool(matched_chunks)
        if matched:
            matched_labels.append(requirement["label"])
            matched_chunk_ids.update(str(chunk.get("chunk_id") or "") for chunk in matched_chunks if chunk.get("chunk_id"))
            if gold_requirement_selector_level(requirement) == "snippet":
                matched_snippet_labels.append(requirement["label"])
                matched_snippet_chunk_ids.update(str(chunk.get("chunk_id") or "") for chunk in matched_chunks if chunk.get("chunk_id"))
        if gold_requirement_selector_level(requirement) == "snippet":
            section_candidate_chunk_ids.update(str(chunk.get("chunk_id") or "") for chunk in section_candidate_chunks if chunk.get("chunk_id"))
        requirement_reviews.append(
            {
                "label": requirement["label"],
                "matched": matched,
                "selector_level": gold_requirement_selector_level(requirement),
                "section_any_of": list(requirement.get("section_any_of") or []),
                "snippet_any_of": list(requirement.get("snippet_any_of") or []),
                "snippet_all_of": list(requirement.get("snippet_all_of") or []),
                "snippet_none_of": list(requirement.get("snippet_none_of") or []),
                "section_candidate_chunk_ids": [chunk.get("chunk_id") for chunk in section_candidate_chunks],
                "matched_chunk_ids": [chunk.get("chunk_id") for chunk in matched_chunks],
            }
        )

    recall = round(len(matched_labels) / len(requirements), 4) if requirements else 0.0
    precision = round(len(matched_chunk_ids) / len(supporting_chunks), 4) if supporting_chunks else 0.0
    snippet_annotated = bool(snippet_requirements)
    snippet_recall = round(len(matched_snippet_labels) / len(snippet_requirements), 4) if snippet_requirements else None
    snippet_precision = round(len(matched_snippet_chunk_ids) / len(supporting_chunks), 4) if snippet_requirements and supporting_chunks else 0.0 if snippet_requirements else None
    citation_span_match_rate = (
        round(len(matched_snippet_chunk_ids) / len(section_candidate_chunk_ids), 4)
        if snippet_requirements and section_candidate_chunk_ids
        else 0.0
        if snippet_requirements
        else None
    )
    return {
        "annotated": True,
        "context_recall": recall,
        "context_precision": precision,
        "snippet_annotated": snippet_annotated,
        "snippet_context_recall": snippet_recall,
        "snippet_context_precision": snippet_precision,
        "citation_span_match_rate": citation_span_match_rate,
        "matched_requirement_count": len(matched_labels),
        "total_requirements": len(requirements),
        "matched_chunk_count": len(matched_chunk_ids),
        "matched_snippet_requirement_count": len(matched_snippet_labels),
        "total_snippet_requirements": len(snippet_requirements),
        "matched_snippet_chunk_count": len(matched_snippet_chunk_ids),
        "section_candidate_snippet_chunk_count": len(section_candidate_chunk_ids),
        "total_supporting_chunks": len(supporting_chunks),
        "expected_doc_found": expected_item is not None,
        "matched_labels": matched_labels,
        "requirements": requirement_reviews,
    }


def review_entry_for_case(case: dict[str, Any], result: dict[str, Any], *, top_k: int, gold_case: dict[str, Any] | None = None) -> dict[str, Any]:
    items = result.get("items") or []
    top_item = items[0] if items else {}
    expected_item, expected_rank = find_expected_item(case, items)
    retrieved_doc_ids = [item.get("doc_id") for item in items]
    expected_doc_id = case["expected_doc_id"]
    top1_hit = bool(retrieved_doc_ids[:1] and retrieved_doc_ids[0] == expected_doc_id)
    topk_hit = expected_doc_id in retrieved_doc_ids[:top_k]
    top_supporting_chunks = [compact_chunk_review(chunk) for chunk in top_item.get("supporting_chunks") or []]
    top_item_review = compact_item_review(top_item) if top_item else {}
    expected_item_review = compact_item_review(expected_item) if expected_item else {}
    retrieved_items = [compact_item_review(item) for item in items]
    gold_metrics = evaluate_gold_support(case, expected_item, gold_case)
    query_analysis = dict(result.get("query_analysis") or {})
    retrieval_plan = dict(result.get("retrieval_plan") or {})
    route = dict(result.get("route") or {})
    quality = dict(result.get("quality") or {})
    filter_policy = dict(result.get("filter_policy") or {})
    filter_plan = dict(retrieval_plan.get("filter_plan") or {})
    requested_filters = dict(result.get("requested_filters") or {})
    effective_filters = dict(result.get("effective_filters") or {})
    filter_plan_mode = filter_plan.get("mode")
    filter_policy_mode = filter_policy.get("mode")
    filter_mode_drift = bool(filter_plan_mode and filter_policy_mode and filter_plan_mode != filter_policy_mode)
    hard_negative = evaluate_hard_negative_collisions(case, items, top_k=top_k, expected_rank=expected_rank)
    top_distractor = analyze_top_distractor(case, top_item_review)

    return {
        **case,
        "top1_hit": top1_hit,
        f"top{top_k}_hit": topk_hit,
        "expected_rank": expected_rank,
        "retrieved_doc_ids": retrieved_doc_ids,
        "retrieved_titles": [item.get("title") for item in items],
        "citation_proxy": citation_proxy(top_item) if top_item else 0.0,
        "support_low_signal_ratio": support_low_signal_ratio(top_item) if top_item else 0.0,
        "retrieval_score": round(1.0 / expected_rank, 4) if expected_rank else 0.0,
        "route_mode": retrieval_plan.get("router", {}).get("effective_mode"),
        "requested_route_mode": route.get("mode"),
        "fallback_applied": bool(route.get("fallback_applied")),
        "filter_plan_mode": filter_plan_mode,
        "filter_policy_mode": filter_policy_mode,
        "filter_hard_empty": bool(filter_policy.get("hard_filter_empty")),
        "filter_fallback_reason": filter_policy.get("fallback_reason"),
        "filter_recovered_soft_prefer": bool(filter_policy.get("recovered_soft_prefer")),
        "filtered_candidate_count": filter_policy.get("filtered_candidate_count"),
        "filter_mode_drift": filter_mode_drift,
        "requested_filters": requested_filters,
        "effective_filters": effective_filters,
        "requested_filter_count": len(requested_filters),
        "effective_filter_count": len(effective_filters),
        "query_analysis": query_analysis,
        "query_mode": query_analysis.get("query_mode"),
        "intent_tags": list(query_analysis.get("intent_tags") or []),
        "boundary_action": (query_analysis.get("boundary") or {}).get("action"),
        "clarification_required": bool((query_analysis.get("clarification") or {}).get("required")),
        "decomposition_strategy": (query_analysis.get("decomposition") or {}).get("strategy"),
        "rewrite_strategy": (query_analysis.get("rewrites") or {}).get("strategy"),
        "subquery_count": len((query_analysis.get("decomposition") or {}).get("subqueries") or []),
        "rewrite_count": len((query_analysis.get("rewrites") or {}).get("variants") or []),
        "preferred_sources": sorted({
            str(item.get("preferred_source") or "").strip()
            for item in list((query_analysis.get("decomposition") or {}).get("subqueries") or [])
            if str(item.get("preferred_source") or "").strip()
        }),
        "query_frontend": dict(retrieval_plan.get("query_frontend") or {}),
        "retrieval_quality": quality,
        **hard_negative,
        **top_distractor,
        "top_result": top_item_review,
        "expected_result": expected_item_review,
        "top_supporting_chunks": top_supporting_chunks,
        "retrieved_items": retrieved_items,
        "gold_metrics": gold_metrics,
        "context_recall": gold_metrics["context_recall"],
        "context_precision": gold_metrics["context_precision"],
        "snippet_context_recall": gold_metrics["snippet_context_recall"],
        "snippet_context_precision": gold_metrics["snippet_context_precision"],
        "citation_span_match_rate": gold_metrics["citation_span_match_rate"],
    }


def evaluate_hard_negative_collisions(
    case: dict[str, Any],
    items: list[dict[str, Any]],
    *,
    top_k: int,
    expected_rank: int | None,
) -> dict[str, Any]:
    hard_negative_doc_ids = [str(value).strip() for value in list(case.get("hard_negative_doc_ids") or []) if str(value).strip()]
    hard_negative_titles = [str(value).strip() for value in list(case.get("hard_negative_titles") or []) if str(value).strip()]
    if not hard_negative_doc_ids:
        return {
            "hard_negative_case_count": 0,
            "hard_negative_doc_ids": [],
            "hard_negative_titles": hard_negative_titles,
            "hard_negative_hits": [],
            "hard_negative_best_rank": None,
            "hard_negative_top1_collision": False,
            f"hard_negative_top{top_k}_collision": False,
            "hard_negative_outranked_expected": False,
        }

    hits: list[dict[str, Any]] = []
    for rank, item in enumerate(items, start=1):
        doc_id = str(item.get("doc_id") or "").strip()
        if doc_id not in hard_negative_doc_ids:
            continue
        hits.append(
            {
                "doc_id": doc_id,
                "title": item.get("title"),
                "rank": rank,
            }
        )

    best_rank = min((int(hit["rank"]) for hit in hits), default=None)
    top1_collision = best_rank == 1
    topk_collision = any(int(hit["rank"]) <= top_k for hit in hits)
    outranked_expected = False
    if best_rank is not None:
        outranked_expected = expected_rank is None or best_rank < int(expected_rank)

    return {
        "hard_negative_case_count": 1,
        "hard_negative_doc_ids": hard_negative_doc_ids,
        "hard_negative_titles": hard_negative_titles,
        "hard_negative_hits": hits,
        "hard_negative_best_rank": best_rank,
        "hard_negative_top1_collision": top1_collision,
        f"hard_negative_top{top_k}_collision": topk_collision,
        "hard_negative_outranked_expected": outranked_expected,
    }


def summarize_top_distractor_taxonomy(entries: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    taxonomy: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if not entry.get("top_distractor_present"):
            continue
        label = str(entry.get("top_distractor_taxonomy") or "").strip()
        if not label:
            continue
        bucket = taxonomy.setdefault(
            label,
            {
                "count": 0,
                "case_ids": [],
                "titles": [],
            },
        )
        bucket["count"] += 1
        case_id = str(entry.get("case_id") or "").strip()
        title = str(entry.get("top_distractor_title") or "").strip()
        if case_id and case_id not in bucket["case_ids"]:
            bucket["case_ids"].append(case_id)
        if title and title not in bucket["titles"]:
            bucket["titles"].append(title)
    return taxonomy


def format_taxonomy_counts(taxonomy: dict[str, dict[str, Any]]) -> str:
    if not taxonomy:
        return ""
    parts: list[str] = []
    for label, payload in sorted(taxonomy.items()):
        parts.append(f"{label}={int(payload.get('count') or 0)}")
    return ", ".join(parts)


def render_review_markdown(review: dict[str, Any], *, top_k: int) -> str:
    lines: list[str] = []
    lines.append(f"# Retrieval Benchmark Review: {review['benchmark_name']}")
    lines.append("")
    lines.append(f"- Queries: {review['queries']}")
    lines.append(f"- Query mode: {review['query_mode']}")
    lines.append(f"- Top-{top_k} cutoff: {top_k}")
    recall_modes = dict(review.get("recall_modes") or {})
    if recall_modes:
        lines.append(f"- Recall modes: baseline={recall_modes.get('baseline', 'hybrid')}, candidate={recall_modes.get('candidate', 'hybrid')}")
    rrf_weights = dict(review.get("rrf_channel_weights") or {})
    if rrf_weights:
        lines.append(f"- RRF weights: baseline={rrf_weights.get('baseline') or 'default'}, candidate={rrf_weights.get('candidate') or 'default'}")
    ablations = dict(review.get("ablations") or {})
    if ablations:
        lines.append(f"- Ablations: baseline={ablations.get('baseline') or 'none'}, candidate={ablations.get('candidate') or 'none'}")
    fidelity = dict(review.get("evaluation_fidelity") or {})
    if fidelity:
        lines.append(f"- Evaluation fidelity: {fidelity.get('label', 'unknown')} ({fidelity.get('level', 'unknown')})")
        if fidelity.get("warning"):
            lines.append(f"- Note: {fidelity['warning']}")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    for suite_name in ("baseline", "candidate"):
        suite = review[suite_name]
        summary_line = (
            f"- {suite_name}: hit@1={suite['hit_at_1']:.4f}, "
            f"hit@{top_k}={suite[f'hit_at_{top_k}']:.4f}, "
            f"mrr={suite['mrr']:.4f}, "
            f"citation={suite['mean_citation_proxy']:.4f}, "
            f"low-signal={suite['mean_support_low_signal_ratio']:.4f}, "
            f"plan_hard={suite['filter_plan_hard_enforce_rate']:.4f}, "
            f"result_hard={suite['filter_result_hard_enforce_rate']:.4f}, "
            f"hard_empty={suite['filter_hard_empty_rate']:.4f}, "
            f"recovered={suite['filter_recovered_soft_prefer_rate']:.4f}"
        )
        if suite.get("annotated_case_count", 0):
            summary_line += (
                f", ctx_recall={suite['mean_context_recall']:.4f}, "
                f"ctx_precision={suite['mean_context_precision']:.4f}"
            )
        if suite.get("snippet_annotated_case_count", 0):
            summary_line += (
                f", snippet_ctx_recall={suite['mean_snippet_context_recall']:.4f}, "
                f"snippet_ctx_precision={suite['mean_snippet_context_precision']:.4f}, "
                f"span_match={suite['mean_citation_span_match_rate']:.4f}"
            )
        lines.append(summary_line)
        taxonomy_summary = format_taxonomy_counts(dict(suite.get("top_distractor_taxonomy") or {}))
        if taxonomy_summary:
            lines.append(f"  top1 miss taxonomy: {taxonomy_summary}")
    lines.append("")
    baseline_groups = dict((review.get("baseline") or {}).get("group_breakdowns") or {})
    candidate_groups = dict((review.get("candidate") or {}).get("group_breakdowns") or {})
    if baseline_groups or candidate_groups:
        lines.append("## Group Breakdown")
        lines.append("")
        for group_key in sorted(set(baseline_groups) | set(candidate_groups)):
            lines.append(f"### {group_key}")
            lines.append("")
            baseline_map = dict(baseline_groups.get(group_key) or {})
            candidate_map = dict(candidate_groups.get(group_key) or {})
            for label in sorted(set(baseline_map) | set(candidate_map)):
                baseline_group = baseline_map.get(label) or {}
                candidate_group = candidate_map.get(label) or {}
                lines.append(
                    f"- `{label}`: "
                    f"baseline cases={baseline_group.get('case_count', 0)}, hit@1={float(baseline_group.get('hit_at_1') or 0.0):.4f}, "
                    f"candidate cases={candidate_group.get('case_count', 0)}, hit@1={float(candidate_group.get('hit_at_1') or 0.0):.4f}, "
                    f"candidate ctx_recall={float(candidate_group.get('mean_context_recall') or 0.0):.4f}, "
                    f"candidate ctx_precision={float(candidate_group.get('mean_context_precision') or 0.0):.4f}"
                )
            lines.append("")
    lines.append("## Per Query")
    lines.append("")

    baseline_entries = {entry["case_id"]: entry for entry in review["baseline"]["review_entries"]}
    candidate_entries = {entry["case_id"]: entry for entry in review["candidate"]["review_entries"]}

    for case in review["resolved_queries"]:
        case_id = case["case_id"]
        baseline = baseline_entries[case_id]
        candidate = candidate_entries[case_id]
        lines.append(f"### {case_id}")
        lines.append("")
        lines.append(f"- Query: `{case['query']}`")
        lines.append(f"- Expected: `{case['expected_title']}`")
        lines.append(
            f"- Query frontend: mode=`{candidate.get('query_mode') or 'unknown'}` "
            f"boundary=`{candidate.get('boundary_action') or 'answer'}` "
            f"decomposition=`{candidate.get('decomposition_strategy') or 'single_pass'}` "
            f"rewrite=`{candidate.get('rewrite_strategy') or 'identity'}` "
            f"subqueries=`{candidate.get('subquery_count') or 0}` "
            f"clarify=`{candidate.get('clarification_required')}` "
            f"preferred_sources=`{','.join(candidate.get('preferred_sources') or []) or 'n/a'}`"
        )
        lines.append(
            f"- Filter governance: planned=`{candidate.get('filter_plan_mode') or 'n/a'}` "
            f"result=`{candidate.get('filter_policy_mode') or 'n/a'}` "
            f"hard_empty=`{candidate.get('filter_hard_empty')}` "
            f"recovered=`{candidate.get('filter_recovered_soft_prefer')}` "
            f"drift=`{candidate.get('filter_mode_drift')}`"
        )
        if candidate.get("hard_negative_case_count", 0):
            lines.append(
                f"- Hard negatives: top1_collision=`{candidate.get('hard_negative_top1_collision')}` "
                f"top{top_k}_collision=`{candidate.get(f'hard_negative_top{top_k}_collision')}` "
                f"outranked_expected=`{candidate.get('hard_negative_outranked_expected')}`"
            )
        if candidate.get("top_distractor_present"):
            lines.append(
                f"- Candidate top distractor: `{candidate.get('top_distractor_title') or 'unknown'}` "
                f"class=`{candidate.get('top_distractor_taxonomy') or 'unknown'}` "
                f"shared_families=`{', '.join(candidate.get('top_distractor_shared_families') or []) or 'none'}` "
                f"specific_overlap=`{', '.join(candidate.get('top_distractor_query_overlap') or []) or 'none'}` "
                f"generic_overlap=`{', '.join(candidate.get('top_distractor_generic_overlap') or []) or 'none'}`"
            )
        lines.append(f"- Baseline top1/top{top_k}: `{baseline['top1_hit']}` / `{baseline[f'top{top_k}_hit']}`")
        lines.append(f"- Candidate top1/top{top_k}: `{candidate['top1_hit']}` / `{candidate[f'top{top_k}_hit']}`")
        lines.append(
            f"- Low-signal ratio baseline -> candidate: "
            f"`{baseline['support_low_signal_ratio']:.4f}` -> `{candidate['support_low_signal_ratio']:.4f}`"
        )
        if baseline.get("context_recall") is not None or candidate.get("context_recall") is not None:
            lines.append(
                f"- Context recall baseline -> candidate: "
                f"`{(baseline.get('context_recall') if baseline.get('context_recall') is not None else 0.0):.4f}` -> "
                f"`{(candidate.get('context_recall') if candidate.get('context_recall') is not None else 0.0):.4f}`"
            )
            lines.append(
                f"- Context precision baseline -> candidate: "
                f"`{(baseline.get('context_precision') if baseline.get('context_precision') is not None else 0.0):.4f}` -> "
                f"`{(candidate.get('context_precision') if candidate.get('context_precision') is not None else 0.0):.4f}`"
            )
        if baseline.get("snippet_context_recall") is not None or candidate.get("snippet_context_recall") is not None:
            lines.append(
                f"- Snippet context recall baseline -> candidate: "
                f"`{(baseline.get('snippet_context_recall') if baseline.get('snippet_context_recall') is not None else 0.0):.4f}` -> "
                f"`{(candidate.get('snippet_context_recall') if candidate.get('snippet_context_recall') is not None else 0.0):.4f}`"
            )
            lines.append(
                f"- Snippet context precision baseline -> candidate: "
                f"`{(baseline.get('snippet_context_precision') if baseline.get('snippet_context_precision') is not None else 0.0):.4f}` -> "
                f"`{(candidate.get('snippet_context_precision') if candidate.get('snippet_context_precision') is not None else 0.0):.4f}`"
            )
            lines.append(
                f"- Citation span match baseline -> candidate: "
                f"`{(baseline.get('citation_span_match_rate') if baseline.get('citation_span_match_rate') is not None else 0.0):.4f}` -> "
                f"`{(candidate.get('citation_span_match_rate') if candidate.get('citation_span_match_rate') is not None else 0.0):.4f}`"
            )
        candidate_requirements = list((candidate.get("gold_metrics") or {}).get("requirements") or [])
        if candidate_requirements:
            lines.append("- Candidate gold requirement matches:")
            for requirement in candidate_requirements:
                lines.append(
                    f"  - `{requirement['label']}` ({requirement.get('selector_level','unknown')}): "
                    f"matched=`{requirement.get('matched')}` candidates={len(requirement.get('section_candidate_chunk_ids') or [])} "
                    f"hits={len(requirement.get('matched_chunk_ids') or [])}"
                )
        lines.append(
            f"- Top result baseline -> candidate: "
            f"`{(baseline.get('top_result') or {}).get('title') or 'N/A'}` -> "
            f"`{(candidate.get('top_result') or {}).get('title') or 'N/A'}`"
        )
        if (candidate.get("expected_result") or {}).get("title"):
            lines.append(f"- Expected doc review target: `{candidate['expected_result'].get('title')}` rank `{candidate.get('expected_rank')}`")
        lines.append("")
        lines.append("Baseline supporting chunks:")
        baseline_chunks = baseline.get("top_supporting_chunks") or []
        if baseline_chunks:
            for chunk in baseline_chunks:
                section = chunk.get("section") or "unknown"
                lines.append(
                    f"- [{ 'low' if chunk['low_signal'] else 'ok' }] "
                    f"`{section}` score={chunk['score']:.4f}: {chunk['snippet'][:220]}"
                )
        else:
            lines.append("- none")
        lines.append("")
        lines.append("Candidate supporting chunks:")
        candidate_chunks = candidate.get("top_supporting_chunks") or []
        if candidate_chunks:
            for chunk in candidate_chunks:
                section = chunk.get("section") or "unknown"
                lines.append(
                    f"- [{ 'low' if chunk['low_signal'] else 'ok' }] "
                    f"`{section}` score={chunk['score']:.4f}: {chunk['snippet'][:220]}"
                )
        else:
            lines.append("- none")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def summarize_query_group(entries: list[dict[str, Any]], *, top_k: int) -> dict[str, Any]:
    case_count = len(entries)
    context_recalls = [float(entry["context_recall"]) for entry in entries if entry.get("context_recall") is not None]
    context_precisions = [float(entry["context_precision"]) for entry in entries if entry.get("context_precision") is not None]
    snippet_context_recalls = [float(entry["snippet_context_recall"]) for entry in entries if entry.get("snippet_context_recall") is not None]
    snippet_context_precisions = [float(entry["snippet_context_precision"]) for entry in entries if entry.get("snippet_context_precision") is not None]
    citation_span_match_rates = [float(entry["citation_span_match_rate"]) for entry in entries if entry.get("citation_span_match_rate") is not None]
    hard_negative_entries = [entry for entry in entries if int(entry.get("hard_negative_case_count") or 0) > 0]
    top1_miss_entries = [entry for entry in entries if entry.get("top_distractor_present")]
    planned_hard_enforce_entries = [entry for entry in entries if entry.get("filter_plan_mode") == "hard_enforce"]
    result_hard_enforce_entries = [entry for entry in entries if entry.get("filter_policy_mode") == "hard_enforce"]
    hard_empty_entries = [entry for entry in entries if entry.get("filter_hard_empty")]
    recovered_entries = [entry for entry in entries if entry.get("filter_recovered_soft_prefer")]
    mode_drift_entries = [entry for entry in entries if entry.get("filter_mode_drift")]
    requested_filter_entries = [entry for entry in entries if int(entry.get("requested_filter_count") or 0) > 0]
    effective_filter_entries = [entry for entry in entries if int(entry.get("effective_filter_count") or 0) > 0]
    return {
        "case_count": case_count,
        "annotated_case_count": len(context_recalls),
        "snippet_annotated_case_count": len(snippet_context_recalls),
        "hard_negative_case_count": len(hard_negative_entries),
        "top1_miss_count": len(top1_miss_entries),
        "top1_accuracy": round(sum(1 for entry in entries if entry.get("top1_hit")) / case_count, 4) if case_count else 0.0,
        f"top{top_k}_accuracy": round(sum(1 for entry in entries if entry.get(f"top{top_k}_hit")) / case_count, 4) if case_count else 0.0,
        "hit_at_1": round(sum(1 for entry in entries if entry.get("top1_hit")) / case_count, 4) if case_count else 0.0,
        f"hit_at_{top_k}": round(sum(1 for entry in entries if entry.get(f"top{top_k}_hit")) / case_count, 4) if case_count else 0.0,
        "mean_citation_proxy": round(sum(float(entry.get("citation_proxy") or 0.0) for entry in entries) / case_count, 4) if case_count else 0.0,
        "mean_support_low_signal_ratio": round(sum(float(entry.get("support_low_signal_ratio") or 0.0) for entry in entries) / case_count, 4) if case_count else 0.0,
        "filter_plan_hard_enforce_rate": round(len(planned_hard_enforce_entries) / case_count, 4) if case_count else 0.0,
        "filter_result_hard_enforce_rate": round(len(result_hard_enforce_entries) / case_count, 4) if case_count else 0.0,
        "filter_hard_empty_rate": round(len(hard_empty_entries) / case_count, 4) if case_count else 0.0,
        "filter_recovered_soft_prefer_rate": round(len(recovered_entries) / case_count, 4) if case_count else 0.0,
        "filter_mode_drift_rate": round(len(mode_drift_entries) / case_count, 4) if case_count else 0.0,
        "requested_filter_case_rate": round(len(requested_filter_entries) / case_count, 4) if case_count else 0.0,
        "effective_filter_case_rate": round(len(effective_filter_entries) / case_count, 4) if case_count else 0.0,
        "mean_context_recall": round(sum(context_recalls) / len(context_recalls), 4) if context_recalls else 0.0,
        "mean_context_precision": round(sum(context_precisions) / len(context_precisions), 4) if context_precisions else 0.0,
        "mean_snippet_context_recall": round(sum(snippet_context_recalls) / len(snippet_context_recalls), 4) if snippet_context_recalls else 0.0,
        "mean_snippet_context_precision": round(sum(snippet_context_precisions) / len(snippet_context_precisions), 4) if snippet_context_precisions else 0.0,
        "mean_citation_span_match_rate": round(sum(citation_span_match_rates) / len(citation_span_match_rates), 4) if citation_span_match_rates else 0.0,
        "hard_negative_top1_collision_rate": (
            round(sum(1 for entry in hard_negative_entries if entry.get("hard_negative_top1_collision")) / len(hard_negative_entries), 4)
            if hard_negative_entries
            else 0.0
        ),
        f"hard_negative_top{top_k}_collision_rate": (
            round(sum(1 for entry in hard_negative_entries if entry.get(f"hard_negative_top{top_k}_collision")) / len(hard_negative_entries), 4)
            if hard_negative_entries
            else 0.0
        ),
        "hard_negative_outranked_expected_rate": (
            round(sum(1 for entry in hard_negative_entries if entry.get("hard_negative_outranked_expected")) / len(hard_negative_entries), 4)
            if hard_negative_entries
            else 0.0
        ),
        "mrr": round(sum(float(entry.get("reciprocal_rank") or 0.0) for entry in entries) / case_count, 4) if case_count else 0.0,
        "top_distractor_taxonomy": summarize_top_distractor_taxonomy(top1_miss_entries),
        "case_ids": [str(entry.get("case_id") or "") for entry in entries],
    }


def build_query_group_breakdowns(entries: list[dict[str, Any]], *, top_k: int) -> dict[str, dict[str, dict[str, Any]]]:
    grouped: dict[str, dict[str, list[dict[str, Any]]]] = {
        "conference_id": {},
        "difficulty": {},
        "tags": {},
        "query_mode": {},
        "boundary_action": {},
        "route_mode": {},
        "filter_plan_mode": {},
        "filter_result_mode": {},
        "filter_hard_empty": {},
        "filter_recovered_soft_prefer": {},
    }
    for entry in entries:
        conference_id = str(entry.get("conference_id") or "").strip()
        if conference_id:
            grouped["conference_id"].setdefault(conference_id, []).append(entry)
        difficulty = str(entry.get("difficulty") or "").strip()
        if difficulty:
            grouped["difficulty"].setdefault(difficulty, []).append(entry)
        query_mode = str(entry.get("query_mode") or "").strip()
        if query_mode:
            grouped["query_mode"].setdefault(query_mode, []).append(entry)
        boundary_action = str(entry.get("boundary_action") or "").strip()
        if boundary_action:
            grouped["boundary_action"].setdefault(boundary_action, []).append(entry)
        route_mode = str(entry.get("route_mode") or "").strip()
        if route_mode:
            grouped["route_mode"].setdefault(route_mode, []).append(entry)
        filter_plan_mode = str(entry.get("filter_plan_mode") or "").strip()
        if filter_plan_mode:
            grouped["filter_plan_mode"].setdefault(filter_plan_mode, []).append(entry)
        filter_result_mode = str(entry.get("filter_policy_mode") or "").strip()
        if filter_result_mode:
            grouped["filter_result_mode"].setdefault(filter_result_mode, []).append(entry)
        grouped["filter_hard_empty"].setdefault(str(bool(entry.get("filter_hard_empty"))).lower(), []).append(entry)
        grouped["filter_recovered_soft_prefer"].setdefault(str(bool(entry.get("filter_recovered_soft_prefer"))).lower(), []).append(entry)
        for tag in list(entry.get("tags") or []):
            label = str(tag or "").strip()
            if label:
                grouped["tags"].setdefault(label, []).append(entry)

    breakdowns: dict[str, dict[str, dict[str, Any]]] = {}
    for key, label_map in grouped.items():
        if not label_map:
            continue
        breakdowns[key] = {}
        for label, grouped_entries in sorted(label_map.items()):
            breakdowns[key][label] = summarize_query_group(grouped_entries, top_k=top_k)
    return breakdowns


def suite_summary_view(suite: dict[str, Any], *, top_k: int) -> dict[str, Any]:
    return {
        "suite": suite["suite"],
        "recall_mode": suite.get("recall_mode", "hybrid"),
        "rrf_channel_weights": suite.get("rrf_channel_weights") or {},
        "query_ablation": suite.get("query_ablation", "none"),
        "evidence_ablation": suite.get("evidence_ablation", "none"),
        "query_count": suite["query_count"],
        "annotated_case_count": suite["annotated_case_count"],
        "snippet_annotated_case_count": suite["snippet_annotated_case_count"],
        "hard_negative_case_count": suite["hard_negative_case_count"],
        "top1_miss_count": suite["top1_miss_count"],
        "top1_accuracy": suite["top1_accuracy"],
        f"top{top_k}_accuracy": suite[f"top{top_k}_accuracy"],
        "hit_at_1": suite["top1_accuracy"],
        f"hit_at_{top_k}": suite[f"top{top_k}_accuracy"],
        "mean_citation_proxy": suite["mean_citation_proxy"],
        "mean_support_low_signal_ratio": suite["mean_support_low_signal_ratio"],
        "filter_plan_hard_enforce_rate": suite["filter_plan_hard_enforce_rate"],
        "filter_result_hard_enforce_rate": suite["filter_result_hard_enforce_rate"],
        "filter_hard_empty_rate": suite["filter_hard_empty_rate"],
        "filter_recovered_soft_prefer_rate": suite["filter_recovered_soft_prefer_rate"],
        "filter_mode_drift_rate": suite["filter_mode_drift_rate"],
        "requested_filter_case_rate": suite["requested_filter_case_rate"],
        "effective_filter_case_rate": suite["effective_filter_case_rate"],
        "mean_context_recall": suite["mean_context_recall"],
        "mean_context_precision": suite["mean_context_precision"],
        "mean_snippet_context_recall": suite["mean_snippet_context_recall"],
        "mean_snippet_context_precision": suite["mean_snippet_context_precision"],
        "mean_citation_span_match_rate": suite["mean_citation_span_match_rate"],
        "hard_negative_top1_collision_rate": suite["hard_negative_top1_collision_rate"],
        f"hard_negative_top{top_k}_collision_rate": suite[f"hard_negative_top{top_k}_collision_rate"],
        "hard_negative_outranked_expected_rate": suite["hard_negative_outranked_expected_rate"],
        "mean_retrieval_score": suite["mean_retrieval_score"],
        "mrr": suite["mean_retrieval_score"],
        "top_distractor_taxonomy": suite["top_distractor_taxonomy"],
        "queries": suite["queries"],
        "group_breakdowns": suite["group_breakdowns"],
    }


def describe_evaluation_fidelity(
    *,
    force_backend: str,
    baseline_summary: dict[str, Any],
    candidate_summary: dict[str, Any],
) -> dict[str, Any]:
    forced_backend = str(force_backend or "").strip()
    baseline_backend = str((baseline_summary.get("embedding_strategy") or {}).get("backend") or "").strip()
    candidate_backend = str((candidate_summary.get("embedding_strategy") or {}).get("backend") or "").strip()
    observed_backends = [backend for backend in [forced_backend, baseline_backend, candidate_backend] if backend]

    if "deterministic_hash" in observed_backends:
        return {
            "label": "hash_smoke_only",
            "level": "low",
            "semantic_backend": "deterministic_hash",
            "recommended_use": "Use for smoke tests, fixture regression, or output-shape checks only.",
            "warning": "deterministic_hash is a synthetic fallback backend. Semantic ranking deltas from this run are not interview-grade quality evidence.",
        }

    if "sentence_transformers" in observed_backends:
        return {
            "label": "local_semantic_eval",
            "level": "high",
            "semantic_backend": "sentence_transformers",
            "recommended_use": "Suitable for retrieval quality benchmarking and iteration evidence when the local embedding model is stable.",
            "warning": "",
        }

    return {
        "label": "unknown_backend",
        "level": "medium",
        "semantic_backend": observed_backends[0] if observed_backends else "unknown",
        "recommended_use": "Verify the active embedding backend before using this run as primary quality evidence.",
        "warning": "Embedding backend could not be confidently classified.",
    }


def evaluate_suite(
    name: str,
    queries: list[dict[str, Any]],
    *,
    qdrant_path: Path,
    collection_name: str,
    force_backend: str,
    top_k: int,
    recall_mode: str = "hybrid",
    rrf_weights: dict[str, float] | None = None,
    query_ablation: str = "none",
    evidence_ablation: str = "none",
    gold_cases: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    per_query: list[dict[str, Any]] = []
    review_entries: list[dict[str, Any]] = []
    top1_hits = 0
    top3_hits = 0
    citation_scores: list[float] = []
    retrieval_scores: list[float] = []
    support_noise_scores: list[float] = []
    context_recalls: list[float] = []
    context_precisions: list[float] = []
    snippet_context_recalls: list[float] = []
    snippet_context_precisions: list[float] = []
    citation_span_match_rates: list[float] = []
    hard_negative_top1_hits = 0
    hard_negative_topk_hits = 0
    hard_negative_outranked_hits = 0
    hard_negative_case_count = 0
    top1_miss_count = 0
    annotated_case_count = 0
    snippet_annotated_case_count = 0

    for case in queries:
        result = run_search(
            case["query"],
            qdrant_path=qdrant_path,
            collection_name=collection_name,
            force_backend=force_backend,
            top_k=top_k,
            recall_mode=recall_mode,
            rrf_weights=rrf_weights,
            query_ablation=query_ablation,
            evidence_ablation=evidence_ablation,
            filters=case.get("filters") or {},
            filter_policy=case.get("filter_policy") or {},
        )
        items = result.get("items") or []
        retrieved_doc_ids = [item.get("doc_id") for item in items]
        top1_hit = bool(retrieved_doc_ids[:1] and retrieved_doc_ids[0] == case["expected_doc_id"])
        topk_hit = case["expected_doc_id"] in retrieved_doc_ids[:top_k]
        if top1_hit:
            top1_hits += 1
        if topk_hit:
            top3_hits += 1

        citation = citation_proxy(items[0]) if items else 0.0
        support_noise = support_low_signal_ratio(items[0]) if items else 0.0
        citation_scores.append(citation)
        support_noise_scores.append(support_noise)
        reciprocal_rank = 0.0
        if case["expected_doc_id"] in retrieved_doc_ids:
            reciprocal_rank = 1.0 / (retrieved_doc_ids.index(case["expected_doc_id"]) + 1)
        retrieval_scores.append(reciprocal_rank)
        review_entry = review_entry_for_case(case, result, top_k=top_k, gold_case=(gold_cases or {}).get(case["case_id"]))
        review_entries.append(review_entry)
        if review_entry.get("gold_metrics", {}).get("annotated"):
            annotated_case_count += 1
            context_recalls.append(float(review_entry.get("context_recall") or 0.0))
            context_precisions.append(float(review_entry.get("context_precision") or 0.0))
        if review_entry.get("gold_metrics", {}).get("snippet_annotated"):
            snippet_annotated_case_count += 1
            snippet_context_recalls.append(float(review_entry.get("snippet_context_recall") or 0.0))
            snippet_context_precisions.append(float(review_entry.get("snippet_context_precision") or 0.0))
            citation_span_match_rates.append(float(review_entry.get("citation_span_match_rate") or 0.0))
        if int(review_entry.get("hard_negative_case_count") or 0) > 0:
            hard_negative_case_count += 1
            if review_entry.get("hard_negative_top1_collision"):
                hard_negative_top1_hits += 1
            if review_entry.get(f"hard_negative_top{top_k}_collision"):
                hard_negative_topk_hits += 1
            if review_entry.get("hard_negative_outranked_expected"):
                hard_negative_outranked_hits += 1
        if review_entry.get("top_distractor_present"):
            top1_miss_count += 1
        per_query.append(
            {
                **case,
                "top1_hit": top1_hit,
                f"top{top_k}_hit": topk_hit,
                "hit_at_1": top1_hit,
                f"hit_at_{top_k}": topk_hit,
                "retrieved_doc_ids": retrieved_doc_ids,
                "citation_proxy": citation,
                "support_low_signal_ratio": support_noise,
                "retrieval_score": round(reciprocal_rank, 4),
                "reciprocal_rank": round(reciprocal_rank, 4),
                "recall_mode": result.get("recall_mode") or recall_mode,
                "rrf_channel_weights": dict(result.get("rrf_channel_weights") or rrf_weights or {}),
                "query_ablation": result.get("query_ablation") or query_ablation,
                "evidence_ablation": result.get("evidence_ablation") or evidence_ablation,
                "route_mode": (result.get("retrieval_plan") or {}).get("router", {}).get("effective_mode"),
                "requested_route_mode": review_entry.get("requested_route_mode"),
                "fallback_applied": review_entry.get("fallback_applied"),
                "filter_plan_mode": review_entry.get("filter_plan_mode"),
                "filter_policy_mode": review_entry.get("filter_policy_mode"),
                "filter_hard_empty": review_entry.get("filter_hard_empty"),
                "filter_recovered_soft_prefer": review_entry.get("filter_recovered_soft_prefer"),
                "filter_mode_drift": review_entry.get("filter_mode_drift"),
                "requested_filters": dict(review_entry.get("requested_filters") or {}),
                "effective_filters": dict(review_entry.get("effective_filters") or {}),
                "requested_filter_count": review_entry.get("requested_filter_count"),
                "effective_filter_count": review_entry.get("effective_filter_count"),
                "query_mode": review_entry.get("query_mode"),
                "intent_tags": list(review_entry.get("intent_tags") or []),
                "boundary_action": review_entry.get("boundary_action"),
                "clarification_required": review_entry.get("clarification_required"),
                "decomposition_strategy": review_entry.get("decomposition_strategy"),
                "rewrite_strategy": review_entry.get("rewrite_strategy"),
                "subquery_count": review_entry.get("subquery_count"),
                "rewrite_count": review_entry.get("rewrite_count"),
                "preferred_sources": list(review_entry.get("preferred_sources") or []),
                "hard_negative_case_count": review_entry.get("hard_negative_case_count"),
                "hard_negative_doc_ids": list(review_entry.get("hard_negative_doc_ids") or []),
                "hard_negative_titles": list(review_entry.get("hard_negative_titles") or []),
                "hard_negative_hits": list(review_entry.get("hard_negative_hits") or []),
                "hard_negative_best_rank": review_entry.get("hard_negative_best_rank"),
                "hard_negative_top1_collision": review_entry.get("hard_negative_top1_collision"),
                f"hard_negative_top{top_k}_collision": review_entry.get(f"hard_negative_top{top_k}_collision"),
                "hard_negative_outranked_expected": review_entry.get("hard_negative_outranked_expected"),
                "top_distractor_present": review_entry.get("top_distractor_present"),
                "top_distractor_doc_id": review_entry.get("top_distractor_doc_id"),
                "top_distractor_title": review_entry.get("top_distractor_title"),
                "top_distractor_rank": review_entry.get("top_distractor_rank"),
                "top_distractor_taxonomy": review_entry.get("top_distractor_taxonomy"),
                "top_distractor_taxonomy_reason": review_entry.get("top_distractor_taxonomy_reason"),
                "top_distractor_query_overlap": list(review_entry.get("top_distractor_query_overlap") or []),
                "top_distractor_expected_overlap": list(review_entry.get("top_distractor_expected_overlap") or []),
                "top_distractor_generic_overlap": list(review_entry.get("top_distractor_generic_overlap") or []),
                "top_distractor_shared_families": list(review_entry.get("top_distractor_shared_families") or []),
                "top_distractor_same_conference": review_entry.get("top_distractor_same_conference"),
                "top_distractor_same_year": review_entry.get("top_distractor_same_year"),
                "context_recall": review_entry.get("context_recall"),
                "context_precision": review_entry.get("context_precision"),
                "snippet_context_recall": review_entry.get("snippet_context_recall"),
                "snippet_context_precision": review_entry.get("snippet_context_precision"),
                "citation_span_match_rate": review_entry.get("citation_span_match_rate"),
            }
        )

    query_count = len(queries) or 1
    return {
        "suite": name,
        "recall_mode": recall_mode,
        "rrf_channel_weights": dict(rrf_weights or {}),
        "query_ablation": query_ablation,
        "evidence_ablation": evidence_ablation,
        "query_count": len(queries),
        "annotated_case_count": annotated_case_count,
        "snippet_annotated_case_count": snippet_annotated_case_count,
        "hard_negative_case_count": hard_negative_case_count,
        "top1_miss_count": top1_miss_count,
        "top1_accuracy": round(top1_hits / query_count, 4),
        f"top{top_k}_accuracy": round(top3_hits / query_count, 4),
        "mean_citation_proxy": round(sum(citation_scores) / query_count, 4) if citation_scores else 0.0,
        "mean_support_low_signal_ratio": round(sum(support_noise_scores) / query_count, 4) if support_noise_scores else 0.0,
        "filter_plan_hard_enforce_rate": round(sum(1 for entry in per_query if entry.get("filter_plan_mode") == "hard_enforce") / query_count, 4) if per_query else 0.0,
        "filter_result_hard_enforce_rate": round(sum(1 for entry in per_query if entry.get("filter_policy_mode") == "hard_enforce") / query_count, 4) if per_query else 0.0,
        "filter_hard_empty_rate": round(sum(1 for entry in per_query if entry.get("filter_hard_empty")) / query_count, 4) if per_query else 0.0,
        "filter_recovered_soft_prefer_rate": round(sum(1 for entry in per_query if entry.get("filter_recovered_soft_prefer")) / query_count, 4) if per_query else 0.0,
        "filter_mode_drift_rate": round(sum(1 for entry in per_query if entry.get("filter_mode_drift")) / query_count, 4) if per_query else 0.0,
        "requested_filter_case_rate": round(sum(1 for entry in per_query if int(entry.get("requested_filter_count") or 0) > 0) / query_count, 4) if per_query else 0.0,
        "effective_filter_case_rate": round(sum(1 for entry in per_query if int(entry.get("effective_filter_count") or 0) > 0) / query_count, 4) if per_query else 0.0,
        "mean_context_recall": round(sum(context_recalls) / len(context_recalls), 4) if context_recalls else 0.0,
        "mean_context_precision": round(sum(context_precisions) / len(context_precisions), 4) if context_precisions else 0.0,
        "mean_snippet_context_recall": round(sum(snippet_context_recalls) / len(snippet_context_recalls), 4) if snippet_context_recalls else 0.0,
        "mean_snippet_context_precision": round(sum(snippet_context_precisions) / len(snippet_context_precisions), 4) if snippet_context_precisions else 0.0,
        "mean_citation_span_match_rate": round(sum(citation_span_match_rates) / len(citation_span_match_rates), 4) if citation_span_match_rates else 0.0,
        "hard_negative_top1_collision_rate": round(hard_negative_top1_hits / hard_negative_case_count, 4) if hard_negative_case_count else 0.0,
        f"hard_negative_top{top_k}_collision_rate": round(hard_negative_topk_hits / hard_negative_case_count, 4) if hard_negative_case_count else 0.0,
        "hard_negative_outranked_expected_rate": round(hard_negative_outranked_hits / hard_negative_case_count, 4) if hard_negative_case_count else 0.0,
        "mean_retrieval_score": round(sum(retrieval_scores) / query_count, 4) if retrieval_scores else 0.0,
        "mrr": round(sum(retrieval_scores) / query_count, 4) if retrieval_scores else 0.0,
        "top_distractor_taxonomy": summarize_top_distractor_taxonomy(review_entries),
        "queries": per_query,
        "review_entries": review_entries,
        "group_breakdowns": build_query_group_breakdowns(per_query, top_k=top_k),
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    baseline_rrf_weights = parse_rrf_weights(args.baseline_rrf_weights)
    candidate_rrf_weights = parse_rrf_weights(args.candidate_rrf_weights)
    manifest_paths = [Path(path).expanduser() if Path(path).is_absolute() else (ROOT / path) for path in args.manifest_path]
    if not manifest_paths:
        raise SystemExit("At least one --manifest-path is required.")
    query_case_paths = [Path(path).expanduser() if Path(path).is_absolute() else (ROOT / path) for path in args.query_case_path]
    gold_case_paths = [Path(path).expanduser() if Path(path).is_absolute() else (ROOT / path) for path in args.gold_case_path]

    benchmark_dir = Path(args.output_root).expanduser() / args.benchmark_name
    benchmark_dir.mkdir(parents=True, exist_ok=True)

    baseline_chunk_paths = resolve_chunk_paths(manifest_paths, Path(args.baseline_chunk_root).expanduser())
    candidate_chunk_paths = resolve_chunk_paths(manifest_paths, Path(args.candidate_chunk_root).expanduser())

    manifest_records: list[dict[str, Any]] = []
    for manifest_path in manifest_paths:
        records = read_jsonl_records(manifest_path)
        for record in records:
            record["_manifest_path"] = str(manifest_path)
        manifest_records.extend(records)

    if query_case_paths:
        queries = resolve_query_cases(query_case_paths, manifest_records)
        query_mode = "curated"
    else:
        queries = []
        for manifest_path in manifest_paths:
            manifest_slice = [record for record in manifest_records if str(record.get("_manifest_path")) == str(manifest_path)]
            queries.extend(build_queries(manifest_slice, args.queries_per_manifest))
        query_mode = "generated"

    if not queries:
        raise SystemExit("No benchmark queries were generated or resolved.")
    gold_cases = normalize_gold_cases(gold_case_paths) if gold_case_paths else {}

    resolved_queries_path = benchmark_dir / "resolved-queries.json"
    resolved_queries_path.write_text(json.dumps(queries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    baseline_qdrant, baseline_collection_name, baseline_summary = resolve_index_source(
        kind="baseline",
        chunk_paths=baseline_chunk_paths,
        explicit_index_path=args.baseline_index_path,
        explicit_collection_name=args.baseline_collection_name,
        explicit_manifest_path=args.baseline_index_manifest_path,
        benchmark_dir=benchmark_dir,
        default_collection_name="baseline-benchmark",
        force_backend=args.force_backend,
        index_batch_size=args.index_batch_size,
    )
    candidate_qdrant, candidate_collection_name, candidate_summary = resolve_index_source(
        kind="candidate",
        chunk_paths=candidate_chunk_paths,
        explicit_index_path=args.candidate_index_path,
        explicit_collection_name=args.candidate_collection_name,
        explicit_manifest_path=args.candidate_index_manifest_path,
        benchmark_dir=benchmark_dir,
        default_collection_name="candidate-benchmark",
        force_backend=args.force_backend,
        index_batch_size=args.index_batch_size,
    )

    baseline_eval = evaluate_suite(
        "baseline",
        queries,
        qdrant_path=baseline_qdrant,
        collection_name=baseline_collection_name,
        force_backend=args.force_backend,
        top_k=args.top_k,
        recall_mode=args.baseline_recall_mode,
        rrf_weights=baseline_rrf_weights,
        query_ablation=args.baseline_query_ablation,
        evidence_ablation=args.baseline_evidence_ablation,
        gold_cases=gold_cases,
    )
    candidate_eval = evaluate_suite(
        "candidate",
        queries,
        qdrant_path=candidate_qdrant,
        collection_name=candidate_collection_name,
        force_backend=args.force_backend,
        top_k=args.top_k,
        recall_mode=args.candidate_recall_mode,
        rrf_weights=candidate_rrf_weights,
        query_ablation=args.candidate_query_ablation,
        evidence_ablation=args.candidate_evidence_ablation,
        gold_cases=gold_cases,
    )
    evaluation_fidelity = describe_evaluation_fidelity(
        force_backend=args.force_backend,
        baseline_summary=baseline_summary,
        candidate_summary=candidate_summary,
    )

    summary = {
        "benchmark_name": args.benchmark_name,
        "manifests": [str(path) for path in manifest_paths],
        "query_mode": query_mode,
        "query_case_paths": [str(path) for path in query_case_paths],
        "gold_case_paths": [str(path) for path in gold_case_paths],
        "queries": len(queries),
        "recall_modes": {
            "baseline": args.baseline_recall_mode,
            "candidate": args.candidate_recall_mode,
        },
        "rrf_channel_weights": {
            "baseline": baseline_rrf_weights,
            "candidate": candidate_rrf_weights,
        },
        "ablations": {
            "baseline": {
                "query": args.baseline_query_ablation,
                "evidence": args.baseline_evidence_ablation,
            },
            "candidate": {
                "query": args.candidate_query_ablation,
                "evidence": args.candidate_evidence_ablation,
            },
        },
        "resolved_queries_path": str(resolved_queries_path),
        "baseline_index": baseline_summary,
        "candidate_index": candidate_summary,
        "evaluation_fidelity": evaluation_fidelity,
        "baseline": suite_summary_view(baseline_eval, top_k=args.top_k),
        "candidate": suite_summary_view(candidate_eval, top_k=args.top_k),
        "delta": {
            "top1_miss_count": candidate_eval["top1_miss_count"] - baseline_eval["top1_miss_count"],
            "top1_accuracy": round(candidate_eval["top1_accuracy"] - baseline_eval["top1_accuracy"], 4),
            f"top{args.top_k}_accuracy": round(candidate_eval[f"top{args.top_k}_accuracy"] - baseline_eval[f"top{args.top_k}_accuracy"], 4),
            "hit_at_1": round(candidate_eval["top1_accuracy"] - baseline_eval["top1_accuracy"], 4),
            f"hit_at_{args.top_k}": round(candidate_eval[f"top{args.top_k}_accuracy"] - baseline_eval[f"top{args.top_k}_accuracy"], 4),
            "mean_citation_proxy": round(candidate_eval["mean_citation_proxy"] - baseline_eval["mean_citation_proxy"], 4),
            "mean_support_low_signal_ratio": round(candidate_eval["mean_support_low_signal_ratio"] - baseline_eval["mean_support_low_signal_ratio"], 4),
            "filter_plan_hard_enforce_rate": round(candidate_eval["filter_plan_hard_enforce_rate"] - baseline_eval["filter_plan_hard_enforce_rate"], 4),
            "filter_result_hard_enforce_rate": round(candidate_eval["filter_result_hard_enforce_rate"] - baseline_eval["filter_result_hard_enforce_rate"], 4),
            "filter_hard_empty_rate": round(candidate_eval["filter_hard_empty_rate"] - baseline_eval["filter_hard_empty_rate"], 4),
            "filter_recovered_soft_prefer_rate": round(candidate_eval["filter_recovered_soft_prefer_rate"] - baseline_eval["filter_recovered_soft_prefer_rate"], 4),
            "filter_mode_drift_rate": round(candidate_eval["filter_mode_drift_rate"] - baseline_eval["filter_mode_drift_rate"], 4),
            "requested_filter_case_rate": round(candidate_eval["requested_filter_case_rate"] - baseline_eval["requested_filter_case_rate"], 4),
            "effective_filter_case_rate": round(candidate_eval["effective_filter_case_rate"] - baseline_eval["effective_filter_case_rate"], 4),
            "mean_context_recall": round(candidate_eval["mean_context_recall"] - baseline_eval["mean_context_recall"], 4),
            "mean_context_precision": round(candidate_eval["mean_context_precision"] - baseline_eval["mean_context_precision"], 4),
            "mean_snippet_context_recall": round(candidate_eval["mean_snippet_context_recall"] - baseline_eval["mean_snippet_context_recall"], 4),
            "mean_snippet_context_precision": round(candidate_eval["mean_snippet_context_precision"] - baseline_eval["mean_snippet_context_precision"], 4),
            "mean_citation_span_match_rate": round(candidate_eval["mean_citation_span_match_rate"] - baseline_eval["mean_citation_span_match_rate"], 4),
            "hard_negative_top1_collision_rate": round(candidate_eval["hard_negative_top1_collision_rate"] - baseline_eval["hard_negative_top1_collision_rate"], 4),
            f"hard_negative_top{args.top_k}_collision_rate": round(candidate_eval[f"hard_negative_top{args.top_k}_collision_rate"] - baseline_eval[f"hard_negative_top{args.top_k}_collision_rate"], 4),
            "hard_negative_outranked_expected_rate": round(candidate_eval["hard_negative_outranked_expected_rate"] - baseline_eval["hard_negative_outranked_expected_rate"], 4),
            "mean_retrieval_score": round(candidate_eval["mean_retrieval_score"] - baseline_eval["mean_retrieval_score"], 4),
            "mrr": round(candidate_eval["mean_retrieval_score"] - baseline_eval["mean_retrieval_score"], 4),
        },
    }

    summary_path = benchmark_dir / "benchmark-summary.json"
    review_payload = {
        "benchmark_name": args.benchmark_name,
        "query_mode": query_mode,
        "queries": len(queries),
        "top_k": args.top_k,
        "recall_modes": {
            "baseline": args.baseline_recall_mode,
            "candidate": args.candidate_recall_mode,
        },
        "rrf_channel_weights": {
            "baseline": baseline_rrf_weights,
            "candidate": candidate_rrf_weights,
        },
        "ablations": {
            "baseline": {
                "query": args.baseline_query_ablation,
                "evidence": args.baseline_evidence_ablation,
            },
            "candidate": {
                "query": args.candidate_query_ablation,
                "evidence": args.candidate_evidence_ablation,
            },
        },
        "resolved_queries": queries,
        "evaluation_fidelity": evaluation_fidelity,
        "baseline": {
            "annotated_case_count": baseline_eval["annotated_case_count"],
            "recall_mode": baseline_eval["recall_mode"],
            "rrf_channel_weights": baseline_eval["rrf_channel_weights"],
            "query_ablation": baseline_eval["query_ablation"],
            "evidence_ablation": baseline_eval["evidence_ablation"],
            "snippet_annotated_case_count": baseline_eval["snippet_annotated_case_count"],
            "hard_negative_case_count": baseline_eval["hard_negative_case_count"],
            "top1_miss_count": baseline_eval["top1_miss_count"],
            "top1_accuracy": baseline_eval["top1_accuracy"],
            f"top{args.top_k}_accuracy": baseline_eval[f"top{args.top_k}_accuracy"],
            "hit_at_1": baseline_eval["top1_accuracy"],
            f"hit_at_{args.top_k}": baseline_eval[f"top{args.top_k}_accuracy"],
            "mean_citation_proxy": baseline_eval["mean_citation_proxy"],
            "mean_support_low_signal_ratio": baseline_eval["mean_support_low_signal_ratio"],
            "filter_plan_hard_enforce_rate": baseline_eval["filter_plan_hard_enforce_rate"],
            "filter_result_hard_enforce_rate": baseline_eval["filter_result_hard_enforce_rate"],
            "filter_hard_empty_rate": baseline_eval["filter_hard_empty_rate"],
            "filter_recovered_soft_prefer_rate": baseline_eval["filter_recovered_soft_prefer_rate"],
            "filter_mode_drift_rate": baseline_eval["filter_mode_drift_rate"],
            "requested_filter_case_rate": baseline_eval["requested_filter_case_rate"],
            "effective_filter_case_rate": baseline_eval["effective_filter_case_rate"],
            "mean_context_recall": baseline_eval["mean_context_recall"],
            "mean_context_precision": baseline_eval["mean_context_precision"],
            "mean_snippet_context_recall": baseline_eval["mean_snippet_context_recall"],
            "mean_snippet_context_precision": baseline_eval["mean_snippet_context_precision"],
            "mean_citation_span_match_rate": baseline_eval["mean_citation_span_match_rate"],
            "hard_negative_top1_collision_rate": baseline_eval["hard_negative_top1_collision_rate"],
            f"hard_negative_top{args.top_k}_collision_rate": baseline_eval[f"hard_negative_top{args.top_k}_collision_rate"],
            "hard_negative_outranked_expected_rate": baseline_eval["hard_negative_outranked_expected_rate"],
            "mrr": baseline_eval["mean_retrieval_score"],
            "top_distractor_taxonomy": baseline_eval["top_distractor_taxonomy"],
            "review_entries": baseline_eval["review_entries"],
            "group_breakdowns": baseline_eval["group_breakdowns"],
        },
        "candidate": {
            "annotated_case_count": candidate_eval["annotated_case_count"],
            "recall_mode": candidate_eval["recall_mode"],
            "rrf_channel_weights": candidate_eval["rrf_channel_weights"],
            "query_ablation": candidate_eval["query_ablation"],
            "evidence_ablation": candidate_eval["evidence_ablation"],
            "snippet_annotated_case_count": candidate_eval["snippet_annotated_case_count"],
            "hard_negative_case_count": candidate_eval["hard_negative_case_count"],
            "top1_miss_count": candidate_eval["top1_miss_count"],
            "top1_accuracy": candidate_eval["top1_accuracy"],
            f"top{args.top_k}_accuracy": candidate_eval[f"top{args.top_k}_accuracy"],
            "hit_at_1": candidate_eval["top1_accuracy"],
            f"hit_at_{args.top_k}": candidate_eval[f"top{args.top_k}_accuracy"],
            "mean_citation_proxy": candidate_eval["mean_citation_proxy"],
            "mean_support_low_signal_ratio": candidate_eval["mean_support_low_signal_ratio"],
            "filter_plan_hard_enforce_rate": candidate_eval["filter_plan_hard_enforce_rate"],
            "filter_result_hard_enforce_rate": candidate_eval["filter_result_hard_enforce_rate"],
            "filter_hard_empty_rate": candidate_eval["filter_hard_empty_rate"],
            "filter_recovered_soft_prefer_rate": candidate_eval["filter_recovered_soft_prefer_rate"],
            "filter_mode_drift_rate": candidate_eval["filter_mode_drift_rate"],
            "requested_filter_case_rate": candidate_eval["requested_filter_case_rate"],
            "effective_filter_case_rate": candidate_eval["effective_filter_case_rate"],
            "mean_context_recall": candidate_eval["mean_context_recall"],
            "mean_context_precision": candidate_eval["mean_context_precision"],
            "mean_snippet_context_recall": candidate_eval["mean_snippet_context_recall"],
            "mean_snippet_context_precision": candidate_eval["mean_snippet_context_precision"],
            "mean_citation_span_match_rate": candidate_eval["mean_citation_span_match_rate"],
            "hard_negative_top1_collision_rate": candidate_eval["hard_negative_top1_collision_rate"],
            f"hard_negative_top{args.top_k}_collision_rate": candidate_eval[f"hard_negative_top{args.top_k}_collision_rate"],
            "hard_negative_outranked_expected_rate": candidate_eval["hard_negative_outranked_expected_rate"],
            "mrr": candidate_eval["mean_retrieval_score"],
            "top_distractor_taxonomy": candidate_eval["top_distractor_taxonomy"],
            "review_entries": candidate_eval["review_entries"],
            "group_breakdowns": candidate_eval["group_breakdowns"],
        },
    }
    review_json_path = benchmark_dir / "review.json"
    review_md_path = benchmark_dir / "review.md"

    summary["review_json_path"] = str(review_json_path)
    summary["review_md_path"] = str(review_md_path)
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    review_json_path.write_text(json.dumps(review_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    review_md_path.write_text(render_review_markdown(review_payload, top_k=args.top_k), encoding="utf-8")
    json.dump(summary, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
