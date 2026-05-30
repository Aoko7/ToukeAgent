from __future__ import annotations

import copy
import json
import math
import re
import uuid
from collections import Counter
from pathlib import Path
from typing import Any

from .embedding import create_embedder, describe_embedding_strategy
from .shared import DYNAMIC_HINT_WEIGHTS, STABLE_HINT_WEIGHTS, average, lower_text, round_score
from .vector_store import DEFAULT_COLLECTION_NAME, DEFAULT_QDRANT_PATH, create_vector_store, describe_vector_backend, qdrant_client_available


QUERY_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_.-]+|[\u4e00-\u9fff]{1,8}")
YEAR_PATTERN = re.compile(r"\b(20\d{2})\b")
RETRIEVAL_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "how",
    "in",
    "into",
    "is",
    "it",
    "of",
    "on",
    "or",
    "please",
    "show",
    "tell",
    "that",
    "the",
    "this",
    "to",
    "what",
    "with",
}
CONFERENCE_ALIASES = {
    "acl": ("acl",),
    "emnlp": ("emnlp",),
    "ndss": ("ndss",),
    "usenix_security": ("usenix security", "usenix"),
    "osdi": ("osdi",),
    "nsdi": ("nsdi",),
    "iclr": ("iclr",),
    "icml": ("icml",),
    "neurips": ("neurips", "nips"),
}
SEMANTIC_TOP_K = 24
BM25_TOP_K = 24
RRF_K = 60
RRF_WEIGHTS = {
    "semantic": 0.65,
    "bm25": 0.35,
}
RRF_WEIGHT_KEYS = frozenset(RRF_WEIGHTS)
QUERY_ABLATION_MODES = {"none", "no_rewrites", "no_decomposition", "single_query"}
EVIDENCE_ABLATION_MODES = {"none", "no_rerank_adjustment", "simple_support"}
BENCHMARK_LIKE_TERMS = {
    "attack",
    "attacks",
    "baseline",
    "benchmark",
    "benchmarks",
    "evaluation",
    "evaluations",
    "evaluate",
    "evaluates",
    "levels",
    "metric",
    "metrics",
    "results",
}
METHOD_SEEKING_QUERY_TERMS = {
    "algorithm",
    "approach",
    "framework",
    "how",
    "mechanism",
    "method",
    "methodology",
    "pipeline",
    "process",
    "procedure",
    "steps",
}
SUMMARY_MARKERS = (
    "in this paper",
    "we propose",
    "we introduce",
    "our work",
    "novel",
    "dual-stage",
)
QUERY_SPLIT_PATTERN = re.compile(r"[?？;；]\s*|\s+(?:and|vs|versus)\s+|(?:以及|并且|同时)")
MISSING_REFERENCE_HINTS = (
    "这个",
    "那个",
    "它",
    "this",
    "it",
)
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
METRIC_SEEKING_QUERY_TERMS = {
    "accuracy",
    "auc",
    "benchmark",
    "figure",
    "latency",
    "memory",
    "metric",
    "metrics",
    "overhead",
    "precision",
    "recall",
    "results",
    "score",
    "table",
    "throughput",
}
COMPARISON_LEAD_PATTERN = re.compile(r"^\s*(?:compare|对比|比较)\s+", re.IGNORECASE)
ENGLISH_COMPARISON_PATTERN = re.compile(
    r"^\s*(?:compare\s+)?(.+?)\s+(?:vs|versus)\s+(.+?)(?:\s+((?:for|in|on|under|about|regarding|when|to)\s+.+))?[?？.。!！]*\s*$",
    re.IGNORECASE,
)
ENGLISH_AND_COMPARISON_PATTERN = re.compile(
    r"^\s*compare\s+(.+?)\s+and\s+(.+?)(?:\s+((?:for|in|on|under|about|regarding|when|to)\s+.+))?[?？.。!！]*\s*$",
    re.IGNORECASE,
)
CHINESE_COMPARISON_PATTERN = re.compile(
    r"^\s*(?:对比|比较)\s*(.+?)\s*(?:和|与|跟|同|vs)\s*(.+?)(?:\s*((?:在|关于).+))?[?？.。!！]*\s*$"
)
PROCEDURE_CONNECTOR_PATTERN = re.compile(r"\s+(?:and then|then)\s+|(?:然后|再)\s*(?=[\u4e00-\u9fffA-Za-z])", re.IGNORECASE)
ENGLISH_ACTION_HEAD_PATTERN = re.compile(
    r"^(?:explain|analyze|analyse|diagnose|debug|inspect|show|find|verify|trace|summarize|compare)\b",
    re.IGNORECASE,
)
CHINESE_ACTION_HEAD_PATTERN = re.compile(r"^(?:解释|分析|排查|定位|检查|验证|说明|比较|总结|确认)")
ENGLISH_SUBJECT_TEMPLATE_PATTERN = re.compile(r"^\s*how\s+do(?:es)?\s+", re.IGNORECASE)


def _contains_missing_reference(query: str | None) -> bool:
    lowered = lower_text(query)
    if not lowered:
        return False
    if "这个" in lowered or "那个" in lowered:
        return True
    if re.search(r"(?:^|[\s,.;:!?()\"'`])(?:this|it)(?:$|[\s,.;:!?()\"'`])", lowered):
        return True
    if re.search(r"(?:^|[，。！？、\s])它(?:[的在是将会已]?|$)", lowered):
        return True
    return False


def _vector_backend_hint(config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or {}
    return {
        "kind": "qdrant_local",
        "collection_name": str(config.get("collection_name") or DEFAULT_COLLECTION_NAME),
        "path": str(config.get("path") or DEFAULT_QDRANT_PATH),
        "vector_size": int(config.get("vector_size") or 768),
        "available": qdrant_client_available(),
        "dependency": "qdrant_client",
        "mode": "local_mode" if qdrant_client_available() else "stub",
    }


def _match_weighted_hints(lowered: str, hints: dict[str, float]) -> list[tuple[str, float]]:
    return [(hint, weight) for hint, weight in hints.items() if hint.lower() in lowered]


def _extract_query_terms(query: str | None) -> list[str]:
    text = str(query or "").strip()
    if not text:
        return []
    terms = [match.group(0) for match in QUERY_TOKEN_PATTERN.finditer(text)]
    deduped: list[str] = []
    seen: set[str] = set()
    for term in terms:
        lowered = term.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(term)
    return deduped[:16]


def _infer_filter_hints(query: str | None, route: dict[str, Any]) -> dict[str, Any]:
    lowered = lower_text(query)
    doc_types: list[str] = []
    entity_tags: list[str] = []
    projects: list[str] = []

    if any(token in lowered for token in ("architecture", "架构", "design", "设计")):
        doc_types.append("architecture")
    if any(token in lowered for token in ("workflow", "流程", "delivery", "交付", "playbook", "manual", "手册", "spec", "规范")):
        doc_types.append("process")
    if any(token in lowered for token in ("price", "pricing", "价格")):
        entity_tags.append("pricing")
    if any(token in lowered for token in ("version", "release", "版本", "发布")):
        entity_tags.append("version")
    if "deepseek" in lowered:
        entity_tags.append("deepseek")
        projects.append("provider")
    language = "zh" if any("\u4e00" <= char <= "\u9fff" for char in lowered) else "en"

    freshness = "dynamic" if route.get("mode") == "wiki-first" else "stable"
    source_scope = ["wiki", "rag"] if route.get("mode") == "wiki-first" else ["rag", "wiki"]
    conference_ids = [
        conference_id
        for conference_id, aliases in CONFERENCE_ALIASES.items()
        if any(alias in lowered for alias in aliases)
    ]
    publication_years = [int(match.group(1)) for match in YEAR_PATTERN.finditer(lowered)]
    explicit_scope = bool(
        conference_ids
        or publication_years
        or re.search(r"(?:只看|仅看|仅限|限定|only\s+(?:look|use|search|show)|restrict(?:ed)?\s+to)", lowered)
    )

    return {
        "freshness": freshness,
        "source_scope": source_scope,
        "doc_types": doc_types,
        "entity_tags": entity_tags,
        "projects": projects,
        "language": language,
        "conference_ids": conference_ids,
        "publication_years": publication_years,
        "explicit_scope": explicit_scope,
    }


def _query_mode(query: str | None, filter_hints: dict[str, Any]) -> str:
    lowered = lower_text(query)
    entity_tags = set(filter_hints.get("entity_tags") or [])
    doc_types = set(filter_hints.get("doc_types") or [])
    if any(token in lowered for token in ("compare", "对比", "difference", "区别", "versus", "vs")):
        return "compare"
    if entity_tags & {"pricing", "version"} or any(token in lowered for token in ("latest", "current", "最新", "当前", "状态")):
        return "status_lookup"
    if any(token in lowered for token in ("how", "步骤", "流程", "how to", "procedure", "process")):
        return "procedure"
    if doc_types & {"architecture", "process"} or any(token in lowered for token in ("architecture", "design", "原理", "架构", "设计")):
        return "explanation"
    return "lookup"


def _infer_intent_tags(query: str | None, route: dict[str, Any], filter_hints: dict[str, Any]) -> list[str]:
    lowered = lower_text(query)
    tags: list[str] = []
    tags.append("dynamic_lookup" if route.get("mode") == "wiki-first" else "stable_lookup")
    if "pricing" in filter_hints.get("entity_tags", []):
        tags.append("pricing_lookup")
    if "version" in filter_hints.get("entity_tags", []):
        tags.append("version_lookup")
    if any(token in lowered for token in ("workflow", "流程", "procedure", "how")):
        tags.append("workflow_lookup")
    if any(token in lowered for token in ("architecture", "架构", "design", "原理")):
        tags.append("architecture_lookup")
    if any(token in lowered for token in ("benchmark", "评测", "evaluation", "metric", "指标")):
        tags.append("benchmark_lookup")
    if any(token in lowered for token in ("policy", "规则", "制度", "规范")):
        tags.append("policy_lookup")
    if any(token in lowered for token in ("compare", "对比", "difference", "区别", "versus", "vs")):
        tags.append("comparison")
    deduped: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        if tag in seen:
            continue
        seen.add(tag)
        deduped.append(tag)
    return deduped


def _ordered_unique_texts(parts: list[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for part in parts:
        normalized = str(part or "").strip()
        lowered = lower_text(normalized)
        if not normalized or lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(normalized)
    return deduped


def _infer_subject_anchor(query: str | None) -> str | None:
    for term in _extract_query_terms(query):
        if re.fullmatch(r"[A-Z][A-Z0-9_.-]{1,}", term):
            return term
    for term in _extract_query_terms(query):
        lowered = lower_text(term)
        if lowered in RETRIEVAL_STOPWORDS or len(term) <= 2:
            continue
        if term.isascii():
            return term
    return None


def _extract_compare_subqueries(query: str | None) -> list[str]:
    text = str(query or "").strip()
    if not text:
        return []

    for pattern in (ENGLISH_AND_COMPARISON_PATTERN, ENGLISH_COMPARISON_PATTERN, CHINESE_COMPARISON_PATTERN):
        matched = pattern.match(text)
        if not matched:
            continue
        left = COMPARISON_LEAD_PATTERN.sub("", str(matched.group(1) or "").strip()).strip()
        right = str(matched.group(2) or "").strip()
        shared_context = str(matched.group(3) or "").strip()
        candidates = [left, right]
        if shared_context:
            candidates = [f"{candidate} {shared_context}".strip() for candidate in candidates]
        return _ordered_unique_texts(candidates)

    if " vs " in lower_text(text) or " versus " in lower_text(text):
        pieces = re.split(r"\s+(?:vs|versus)\s+", text, maxsplit=1, flags=re.IGNORECASE)
        if len(pieces) == 2:
            return _ordered_unique_texts([COMPARISON_LEAD_PATTERN.sub("", pieces[0]).strip(), pieces[1].strip()])
    return []


def _extract_base_split_parts(query: str | None) -> list[str]:
    text = str(query or "").strip()
    if not text:
        return []
    parts = [segment.strip() for segment in QUERY_SPLIT_PATTERN.split(text) if segment.strip()]
    if len(parts) <= 1:
        procedure_parts = [segment.strip() for segment in PROCEDURE_CONNECTOR_PATTERN.split(text) if segment.strip()]
        if len(procedure_parts) > 1:
            parts = procedure_parts
    return _ordered_unique_texts(parts)


def _enrich_part_with_subject_anchor(
    part: str,
    *,
    full_query: str | None,
    subject_anchor: str | None,
    language: str,
) -> str:
    normalized = str(part or "").strip()
    if not normalized or not subject_anchor:
        return normalized
    if lower_text(subject_anchor) in lower_text(normalized):
        return normalized

    query_text = str(full_query or "").strip()
    if language == "en":
        if ENGLISH_SUBJECT_TEMPLATE_PATTERN.match(query_text) and ENGLISH_ACTION_HEAD_PATTERN.match(normalized):
            return f"how does {subject_anchor} {normalized}".strip()
        if ENGLISH_ACTION_HEAD_PATTERN.match(normalized):
            return f"{subject_anchor} {normalized}".strip()
        return normalized

    if CHINESE_ACTION_HEAD_PATTERN.match(normalized):
        return f"{subject_anchor}{normalized}".strip()
    return normalized


def _preferred_source_for_subquery(tags: list[str], route_mode: str) -> str:
    tag_set = set(tags)
    if tag_set & {"pricing_lookup", "version_lookup"}:
        return "wiki"
    if tag_set & {"workflow_lookup", "architecture_lookup", "benchmark_lookup", "policy_lookup"}:
        return "rag"
    return "wiki" if route_mode == "wiki-first" and "dynamic_lookup" in tag_set else "rag"


def _rewrite_focus_suffix(
    *,
    tags: list[str],
    filter_hints: dict[str, Any],
    language: str,
) -> list[str]:
    suffixes: list[str] = []
    tag_set = set(tags)
    doc_types = set(str(item) for item in filter_hints.get("doc_types") or [])
    conference_ids = [str(item).upper() for item in filter_hints.get("conference_ids") or []]
    publication_years = [str(item) for item in filter_hints.get("publication_years") or []]

    if "version_lookup" in tag_set:
        suffixes.append("版本状态" if language == "zh" else "version status")
    if "pricing_lookup" in tag_set:
        suffixes.append("价格状态" if language == "zh" else "pricing status")
    if "workflow_lookup" in tag_set or "process" in doc_types:
        suffixes.append("流程步骤" if language == "zh" else "workflow steps")
    if "architecture_lookup" in tag_set or "architecture" in doc_types:
        suffixes.append("架构设计" if language == "zh" else "architecture design")
    if "benchmark_lookup" in tag_set:
        suffixes.append("评测指标" if language == "zh" else "benchmark metrics")
    if conference_ids:
        suffixes.append(" ".join(conference_ids))
    if publication_years:
        suffixes.append(" ".join(publication_years))
    return _ordered_unique_texts(suffixes)


def _augment_rewrite_text(
    text: str,
    *,
    tags: list[str],
    filter_hints: dict[str, Any],
    language: str,
) -> str:
    normalized = str(text or "").strip()
    if not normalized:
        return normalized
    pieces = [normalized]
    lowered = lower_text(normalized)
    for suffix in _rewrite_focus_suffix(tags=tags, filter_hints=filter_hints, language=language):
        suffix_lower = lower_text(suffix)
        if suffix_lower and suffix_lower not in lowered:
            pieces.append(suffix)
    return " ".join(piece for piece in pieces if piece).strip()


def _build_decomposition(
    query: str | None,
    *,
    route: dict[str, Any],
    filter_hints: dict[str, Any],
    intent_tags: list[str],
    language: str,
) -> dict[str, Any]:
    query_mode = _query_mode(query, filter_hints)
    subject_anchor = _infer_subject_anchor(query)
    strategy = "single_pass"
    parts = _extract_compare_subqueries(query) if query_mode == "compare" else []

    if parts:
        strategy = "comparison_split"
    else:
        parts = _extract_base_split_parts(query)
        if len(parts) > 1 and query_mode == "procedure":
            parts = [
                _enrich_part_with_subject_anchor(
                    part,
                    full_query=query,
                    subject_anchor=subject_anchor,
                    language=language,
                )
                for part in parts
            ]
            strategy = "procedure_split"
        elif len(parts) > 1:
            strategy = "multi_intent_split"

    if len(parts) <= 1 and "version_lookup" in intent_tags and "pricing_lookup" in intent_tags:
        parts = [
            "最新版本状态" if language == "zh" else "latest version status",
            "当前价格状态" if language == "zh" else "current pricing status",
        ]
        strategy = "intent_pair_split"

    subqueries: list[dict[str, Any]] = []
    for index, part in enumerate(parts[:4]):
        tags = _infer_intent_tags(part, route, filter_hints)
        preferred_source = _preferred_source_for_subquery(tags, str(route.get("mode") or "rag-first"))
        subqueries.append(
            {
                "subquery_id": f"sq_{index + 1}",
                "query_text": part,
                "intent_tags": tags,
                "preferred_source": preferred_source,
                "reason": strategy,
            }
        )

    return {
        "enabled": len(subqueries) > 1,
        "strategy": strategy if len(subqueries) > 1 else "single_pass",
        "subqueries": subqueries,
    }


def _build_rewrite_variants(
    query: str | None,
    *,
    filter_hints: dict[str, Any],
    decomposition: dict[str, Any],
) -> dict[str, Any]:
    language = str(filter_hints.get("language") or "en")
    variants: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, subquery in enumerate(list(decomposition.get("subqueries") or [])[:3]):
        text = str(subquery.get("query_text") or "").strip()
        tags = [str(tag) for tag in list(subquery.get("intent_tags") or [])]
        expanded = _augment_rewrite_text(
            text,
            tags=tags,
            filter_hints=filter_hints,
            language=language,
        )
        lowered = lower_text(expanded)
        if not expanded or lowered == lower_text(query) or lowered in seen:
            continue
        seen.add(lowered)
        variants.append(
            {
                "variant_id": f"rewrite_{index + 1}",
                "text": expanded,
                "reason": "subquery_decomposition",
            }
        )

    if not variants:
        primary_scope = str((filter_hints.get("source_scope") or ["rag"])[0])
        focus_tags = _infer_intent_tags(
            query,
            {"mode": "wiki-first" if primary_scope == "wiki" else "rag-first"},
            filter_hints,
        )
        entity_phrase = " ".join(str(tag) for tag in filter_hints.get("entity_tags") or [])
        seed = f"{str(query or '').strip()} {entity_phrase}".strip() if entity_phrase else str(query or "").strip()
        expanded = _augment_rewrite_text(
            seed,
            tags=focus_tags,
            filter_hints=filter_hints,
            language=language,
        )
        if expanded and lower_text(expanded) != lower_text(query):
            variants.append(
                {
                    "variant_id": "rewrite_focus_tags",
                    "text": expanded,
                    "reason": "focus_hint_expansion",
                }
            )

    return {
        "enabled": bool(variants),
        "strategy": "decompose_then_expand" if variants else "identity",
        "variants": variants[:3],
    }


def _build_clarification(
    query: str | None,
    *,
    route: dict[str, Any],
    filter_hints: dict[str, Any],
    intent_tags: list[str],
    language: str,
) -> dict[str, Any]:
    lowered = lower_text(query)
    missing_context: list[str] = []
    questions: list[str] = []

    if _contains_missing_reference(query):
        missing_context.append("explicit_subject_reference")
        questions.append("你说的“这个/它”具体指哪个实体、系统或文档？" if language == "zh" else "What specific entity, system, or document does “it/this” refer to?")

    if "comparison" in intent_tags and not any(token in lowered for token in ("vs", "versus", "和", "与", "对比", "compare")):
        missing_context.append("comparison_target")
        questions.append("请补充你要对比的对象。" if language == "zh" else "Please provide the comparison target.")

    if route.get("mode") == "wiki-first" and any(tag in intent_tags for tag in ("pricing_lookup", "version_lookup")) and not filter_hints.get("projects"):
        questions.append("如果你关心的是某个具体平台或产品，请补充名称，这样我会优先命中对应 wiki 条目。" if language == "zh" else "If you mean a specific product or provider, please name it so I can route to the correct wiki entry.")

    required = bool(missing_context)
    return {
        "required": required,
        "missing_context": missing_context,
        "questions": questions[:3],
        "reason": "查询里缺少明确指代对象" if required and language == "zh" else ("missing explicit subject reference" if required else None),
        "metadata": {
            "explicit_scope_required": bool(filter_hints.get("explicit_scope")),
        },
    }


def _build_boundary_policy(*, decomposition: dict[str, Any], clarification: dict[str, Any]) -> dict[str, Any]:
    explicit_scope_required = bool((clarification.get("metadata") or {}).get("explicit_scope_required"))
    if clarification.get("required"):
        return {
            "action": "clarify",
            "reason": clarification.get("reason") or "missing required context",
            "explicit_scope_required": explicit_scope_required,
        }
    if decomposition.get("enabled"):
        return {
            "action": "decompose",
            "reason": "query contains multiple retrieval intents",
            "explicit_scope_required": explicit_scope_required,
        }
    return {
        "action": "answer",
        "reason": "query is specific enough for direct retrieval",
        "explicit_scope_required": explicit_scope_required,
    }


def build_query_analysis(query: str | None, route: dict[str, Any]) -> dict[str, Any]:
    terms = _extract_query_terms(query)
    filter_hints = _infer_filter_hints(query, route)
    language = str(filter_hints.get("language") or "en")
    intent_tags = _infer_intent_tags(query, route, filter_hints)
    decomposition = _build_decomposition(
        query,
        route=route,
        filter_hints=filter_hints,
        intent_tags=intent_tags,
        language=language,
    )
    rewrites = _build_rewrite_variants(
        query,
        filter_hints=filter_hints,
        decomposition=decomposition,
    )
    clarification = _build_clarification(
        query,
        route=route,
        filter_hints=filter_hints,
        intent_tags=intent_tags,
        language=language,
    )
    boundary = _build_boundary_policy(
        decomposition=decomposition,
        clarification=clarification,
    )
    return {
        "query_text": str(query or ""),
        "terms": terms,
        "term_count": len(terms),
        "query_mode": _query_mode(query, filter_hints),
        "intent_tags": intent_tags,
        "intent": {
            "dynamic": route.get("mode") == "wiki-first",
            "stable": route.get("mode") != "wiki-first",
            "matched_dynamic_hints": list(route.get("matched_hints") or []),
            "matched_stable_hints": list(route.get("matched_stable_hints") or []),
        },
        "filter_hints": filter_hints,
        "decomposition": decomposition,
        "rewrites": rewrites,
        "clarification": clarification,
        "boundary": boundary,
    }


def build_retrieval_plan(
    route: dict[str, Any],
    query_analysis: dict[str, Any],
    *,
    persona_id: str | None = None,
    filter_policy: dict[str, Any] | None = None,
    requested_filters: dict[str, Any] | None = None,
    effective_filters: dict[str, Any] | None = None,
    config: dict[str, Any] | None = None,
    embedding_strategy: dict[str, Any] | None = None,
    vector_backend: dict[str, Any] | None = None,
) -> dict[str, Any]:
    requested_mode = route.get("requested_mode") or route.get("mode") or "rag-first"
    effective_mode = route.get("effective_mode") or requested_mode
    embedding_strategy = dict(embedding_strategy or describe_embedding_strategy(config))
    if vector_backend is None:
        vector_backend = _vector_backend_hint(config)
    filter_policy = dict(filter_policy or {"mode": "soft_prefer", "hard_enforce_reason": None})
    requested_filters = dict(requested_filters or {})
    effective_filters = dict(effective_filters or {})
    return {
        "implementation_status": "scaffolded",
        "active_path": effective_mode,
        "requested_path": requested_mode,
        "query_frontend": {
            "query_mode": query_analysis.get("query_mode"),
            "intent_tags": list(query_analysis.get("intent_tags") or []),
            "rewrite_count": len((query_analysis.get("rewrites") or {}).get("variants") or []),
            "subquery_count": len((query_analysis.get("decomposition") or {}).get("subqueries") or []),
            "clarification_required": bool((query_analysis.get("clarification") or {}).get("required")),
            "boundary_action": (query_analysis.get("boundary") or {}).get("action"),
        },
        "router": {
            "route_mode": route.get("mode"),
            "effective_mode": effective_mode,
            "fallback_applied": route.get("fallback_applied", False),
        },
        "filter_plan": {
            "enabled": True,
            "mode": str(filter_policy.get("mode") or "soft_prefer"),
            "requested_filters": requested_filters,
            "effective_filters": effective_filters,
            "hard_enforce_reason": filter_policy.get("hard_enforce_reason"),
            "hints": query_analysis.get("filter_hints") or {},
        },
        "rag": {
            "enabled": True,
            "channels": [
                {
                    "name": "semantic",
                    "top_k": 8,
                    "status": "scaffolded",
                },
                {
                    "name": "bm25",
                    "top_k": 8,
                    "status": "scaffolded",
                },
            ],
            "merge": {
                "strategy": "weighted_reciprocal_fusion",
                "dedupe_key": ["doc_id", "chunk_id"],
            },
            "rerank": {
                "strategy": "metadata_aware",
                "features": [
                    "semantic_score",
                    "bm25_score",
                    "freshness",
                    "authority",
                    "filter_match",
                    "low_signal_text",
                    "section_role",
                ],
            },
        },
        "wiki": {
            "enabled": requested_mode == "wiki-first",
            "lookup_mode": "entity_page",
            "entity_tags": list((query_analysis.get("filter_hints") or {}).get("entity_tags") or []),
        },
        "embedding_strategy": {
            **embedding_strategy,
            "vector_backend": vector_backend,
            "query_language": (query_analysis.get("filter_hints") or {}).get("language"),
        },
        "response_policy": {
            "citation_required": True,
            "persona_id": persona_id,
            "grounding_mode": "compact_evidence_pack",
            "clarification_first": bool((query_analysis.get("clarification") or {}).get("required")),
            "max_parent_items": 3,
            "max_supporting_chunks_per_item": 2,
            "max_supporting_chunks_total": 4,
            "max_snippet_chars": 280,
            "max_evidence_chars": 1400,
            "include_quality_summary": True,
            "include_clarification_questions": True,
        },
    }


def choose_retrieval_route(query: str | None) -> dict[str, Any]:
    lowered = lower_text(query)
    dynamic_matches = _match_weighted_hints(lowered, DYNAMIC_HINT_WEIGHTS)
    stable_matches = _match_weighted_hints(lowered, STABLE_HINT_WEIGHTS)
    matched_hints = [hint for hint, _ in dynamic_matches]
    matched_stable_hints = [hint for hint, _ in stable_matches]
    dynamic_score = sum(weight for _, weight in dynamic_matches)
    stable_score = sum(weight for _, weight in stable_matches)
    mode = "wiki-first" if dynamic_score >= 1.0 and dynamic_score > (stable_score + 0.15) else "rag-first"

    return {
        "mode": mode,
        "matched_hints": matched_hints,
        "matched_stable_hints": matched_stable_hints,
        "dynamic_score": round(dynamic_score, 2),
        "stable_score": round(stable_score, 2),
        "rationale": (
            f"dynamic structured facts scored higher ({round(dynamic_score, 2)} vs {round(stable_score, 2)}), so prefer the wiki path first"
            if mode == "wiki-first"
            else f"stable reference material scored higher ({round(stable_score, 2)} vs {round(dynamic_score, 2)}), so prefer the RAG path first"
        ),
    }


def score_citation(item: dict[str, Any] | None, route_mode: str, index: int) -> float:
    item = item or {}
    base_score = float(item.get("score", 0.7) or 0.7)
    source_alignment = (
        0.08
        if route_mode == "wiki-first" and item.get("source_type") == "wiki"
        else 0.08
        if route_mode != "wiki-first" and item.get("source_type") == "rag"
        else 0.03
    )
    freshness = item.get("freshness")
    freshness_alignment = (
        0.08
        if route_mode == "wiki-first" and freshness == "dynamic"
        else -0.08
        if route_mode == "wiki-first" and freshness == "historical"
        else 0.08
        if route_mode != "wiki-first" and freshness == "stable"
        else -0.02
        if route_mode != "wiki-first" and freshness == "historical"
        else 0.03
    )
    rank_penalty = index * 0.04
    return round_score(base_score + source_alignment + freshness_alignment - rank_penalty)


def _item_identity(item: dict[str, Any]) -> str:
    return str(
        item.get("chunk_id")
        or item.get("doc_id")
        or item.get("entry_id")
        or item.get("title")
        or "item"
    )


def _supporting_chunk_payload(item: dict[str, Any], route_mode: str, index: int) -> dict[str, Any]:
    section_path = list(item.get("section_path") or [])
    return {
        "id": _item_identity(item),
        "doc_id": item.get("doc_id"),
        "chunk_id": item.get("chunk_id"),
        "entry_id": item.get("entry_id"),
        "title": item.get("title"),
        "section": section_path[-1] if section_path else item.get("title"),
        "section_path": section_path,
        "source_type": item.get("source_type"),
        "snippet": item.get("snippet") or item.get("text"),
        "freshness": item.get("freshness"),
        "score": score_citation(item, route_mode, index),
        "retrieval_score": round_score(item.get("score")),
        "semantic_score": round_score(item.get("semantic_score")),
        "bm25_score": round_score(item.get("bm25_score")),
        "metadata": item.get("metadata") or {},
    }


def _section_selection_adjustment(chunk: dict[str, Any]) -> float:
    section_path = [lower_text(part) for part in list(chunk.get("section_path") or []) if lower_text(part)]
    section_text = " > ".join(section_path)
    if not section_text:
        return 0.0

    adjustment = 0.0
    if "front matter" in section_text:
        adjustment -= 0.35
    if "abstract" in section_text:
        adjustment -= 0.12
    if "conclusion" in section_text:
        adjustment -= 0.03
    if "introduction" in section_text:
        adjustment += 0.04
    if "related work" in section_text:
        adjustment += 0.08
    if any(token in section_text for token in ("method", "methodology", "approach", "framework", "pipeline", "tuning", "extraction")):
        adjustment += 0.06
    if "atomic facts scoring" in section_text:
        adjustment += 0.05
    if any(token in section_text for token in ("analysis", "decomposition", "scoring")):
        adjustment += 0.07
    if "results" in section_text:
        adjustment += 0.01
    if re.search(r"\b\d+(?:\.\d+){2,}\b", section_text):
        adjustment -= 0.08
    return round(adjustment, 2)


def _top_level_section_key(chunk: dict[str, Any]) -> str:
    section_path = [str(part).strip() for part in list(chunk.get("section_path") or []) if str(part).strip()]
    if section_path:
        return lower_text(section_path[0])
    return lower_text(str(chunk.get("section") or chunk.get("title") or "unknown"))


def _section_role(chunk: dict[str, Any]) -> str:
    section_path = [lower_text(part) for part in list(chunk.get("section_path") or []) if lower_text(part)]
    section_text = " > ".join(section_path)
    if not section_text:
        return "generic"
    if any(token in section_text for token in ("front matter", "abstract")):
        return "preface"
    if any(token in section_text for token in ("introduction", "related work", "background")):
        return "background"
    if any(
        token in section_text
        for token in (
            "method",
            "methodology",
            "approach",
            "framework",
            "pipeline",
            "tuning",
            "extraction",
            "atomic facts",
            "scoring",
            "decomposition",
            "granularity",
        )
    ):
        return "method"
    if any(token in section_text for token in ("experiments", "results", "benchmark", "baseline", "dataset", "evaluation")):
        return "evaluation"
    if any(token in section_text for token in ("conclusion", "limitation", "discussion")):
        return "wrapup"
    return "generic"


def _section_text(chunk: dict[str, Any]) -> str:
    return " > ".join(
        lower_text(part)
        for part in list(chunk.get("section_path") or [])
        if lower_text(part)
    )


def _normalized_query_terms(query_terms: list[str] | None = None) -> set[str]:
    return {
        lowered
        for term in query_terms or []
        if (lowered := lower_text(term)) and lowered not in RETRIEVAL_STOPWORDS
    }


def _query_overlap_count(chunk: dict[str, Any], query_terms: list[str] | None = None) -> int:
    terms = _normalized_query_terms(query_terms)
    if not terms:
        return 0
    section_path = " ".join(str(part) for part in list(chunk.get("section_path") or []) if str(part).strip())
    snippet = str(chunk.get("snippet") or "")
    haystack = lower_text(f"{section_path} {snippet}")
    return sum(1 for term in terms if term in haystack)


def _is_benchmark_like_query(query_terms: list[str] | None = None) -> bool:
    return any(term in BENCHMARK_LIKE_TERMS for term in _normalized_query_terms(query_terms))


def _is_method_seeking_query(query_terms: list[str] | None = None) -> bool:
    return any(term in METHOD_SEEKING_QUERY_TERMS for term in _normalized_query_terms(query_terms))


def _has_summary_markers(chunk: dict[str, Any]) -> bool:
    snippet = lower_text(str(chunk.get("snippet") or ""))
    return any(marker in snippet for marker in SUMMARY_MARKERS)


def _query_selection_adjustment(chunk: dict[str, Any], query_terms: list[str] | None = None) -> float:
    query_terms = query_terms or []
    section_path = [lower_text(part) for part in list(chunk.get("section_path") or []) if lower_text(part)]
    section_text = " > ".join(section_path)
    if not section_text:
        return 0.0

    if _is_benchmark_like_query(query_terms) and "conclusion" in section_text:
        return 0.04
    return 0.0


def _support_selection_score(chunk: dict[str, Any], query_terms: list[str] | None = None) -> tuple[float, float, float]:
    retrieval_score = float(chunk.get("retrieval_score") or chunk.get("score") or 0.0)
    citation_score = float(chunk.get("score") or 0.0)
    return (
        retrieval_score + _section_selection_adjustment(chunk) + _query_selection_adjustment(chunk, query_terms),
        retrieval_score,
        citation_score,
    )


def _is_low_signal_text(text: str | None) -> bool:
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


def _is_metric_seeking_query(query_terms: list[str] | None = None) -> bool:
    return any(term in METRIC_SEEKING_QUERY_TERMS for term in _normalized_query_terms(query_terms))


def _candidate_rerank_adjustment(
    payload: dict[str, Any],
    *,
    query_terms: list[str] | None = None,
) -> tuple[float, bool, str]:
    snippet = str(payload.get("text") or "")
    section_role = _section_role(
        {
            "section_path": list(payload.get("section_path") or []),
            "snippet": snippet,
        }
    )
    low_signal = _is_low_signal_text(snippet)
    adjustment = 0.0

    if low_signal:
        adjustment -= 0.18
        if _is_metric_seeking_query(query_terms):
            adjustment += 0.1

    if section_role == "preface":
        adjustment -= 0.05
    elif section_role == "background" and not _is_benchmark_like_query(query_terms):
        adjustment -= 0.02
    elif section_role == "method":
        adjustment += 0.03
    elif section_role == "wrapup":
        adjustment += 0.01

    return round(adjustment, 4), low_signal, section_role


def _replacement_priority(chunk: dict[str, Any], role_counts: Counter[str]) -> tuple[int, int, float]:
    role = _section_role(chunk)
    section_path = [lower_text(part) for part in list(chunk.get("section_path") or []) if lower_text(part)]
    section_text = " > ".join(section_path)
    duplicated = 0 if role_counts.get(role, 0) > 1 else 1
    if role == "background" and "introduction" in section_text:
        section_priority = 0
    elif role == "preface":
        section_priority = 1
    elif role == "generic":
        section_priority = 2
    elif role == "background":
        section_priority = 3
    else:
        section_priority = 4
    return (duplicated, section_priority, _support_selection_score(chunk)[0])


def _drop_priority(chunk: dict[str, Any], query_terms: list[str] | None = None) -> tuple[float, int, float]:
    selection_score, retrieval_score, _ = _support_selection_score(chunk, query_terms)
    return (selection_score, _query_overlap_count(chunk, query_terms), retrieval_score)


def _background_drop_priority(chunk: dict[str, Any], query_terms: list[str] | None = None) -> tuple[int, float, int, float]:
    section_text = _section_text(chunk)
    if "related work" in section_text:
        section_priority = 0
    elif "background" in section_text:
        section_priority = 1
    else:
        section_priority = 2
    selection_score, retrieval_score, _ = _support_selection_score(chunk, query_terms)
    return (section_priority, selection_score, _query_overlap_count(chunk, query_terms), retrieval_score)


def _promote_missing_method_chunk(
    selected: list[dict[str, Any]],
    ranked: list[dict[str, Any]],
    *,
    query_terms: list[str] | None = None,
) -> list[dict[str, Any]]:
    if not selected or any(_section_role(chunk) == "method" for chunk in selected):
        return selected

    selected_roles = [_section_role(chunk) for chunk in selected]
    role_counts = Counter(selected_roles)
    method_candidate = next((chunk for chunk in ranked if chunk not in selected and _section_role(chunk) == "method"), None)
    if not method_candidate:
        return selected

    replacement_candidates: list[tuple[int, dict[str, Any], str]] = []
    for index, chunk in enumerate(selected):
        role = _section_role(chunk)
        if role == "preface" or role == "generic" or role_counts.get(role, 0) > 1:
            replacement_candidates.append((index, chunk, role))
    if not replacement_candidates:
        return selected

    replacement_candidates.sort(key=lambda item: _replacement_priority(item[1], role_counts))
    replace_index, replace_chunk, _ = replacement_candidates[0]
    if _support_selection_score(method_candidate, query_terms)[0] + 0.08 < _support_selection_score(replace_chunk, query_terms)[0]:
        return selected

    updated = list(selected)
    updated[replace_index] = method_candidate
    updated.sort(key=lambda chunk: _support_selection_score(chunk, query_terms), reverse=True)
    return updated


def _compact_summary_wrapup(
    selected: list[dict[str, Any]],
    *,
    query_terms: list[str] | None = None,
) -> list[dict[str, Any]]:
    if len(selected) != 2:
        return selected
    if _is_benchmark_like_query(query_terms) or _is_method_seeking_query(query_terms):
        return selected

    role_map = {_section_role(chunk): chunk for chunk in selected}
    wrapup = role_map.get("wrapup")
    method = role_map.get("method")
    if not wrapup or not method:
        return selected

    if _query_overlap_count(wrapup, query_terms) < 4:
        return selected
    if float(wrapup.get("score") or 0.0) < 0.45:
        return selected
    if not _has_summary_markers(wrapup):
        return selected

    return [wrapup]


def _compact_supporting_chunks(
    selected: list[dict[str, Any]],
    *,
    query_terms: list[str] | None = None,
) -> list[dict[str, Any]]:
    if len(selected) <= 1:
        return selected

    working = list(selected)
    benchmark_like = _is_benchmark_like_query(query_terms)
    while len(working) > 2:
        role_counts = Counter(_section_role(chunk) for chunk in working)
        role_set = set(role_counts)
        drop_roles: set[str] | None = None

        if role_counts.get("background", 0) > 1:
            drop_roles = {"background"}
        elif role_counts.get("preface", 0) > 1:
            drop_roles = {"preface"}
        elif {"background", "method", "wrapup"}.issubset(role_set):
            wrapup_overlap = max(
                (_query_overlap_count(chunk, query_terms) for chunk in working if _section_role(chunk) == "wrapup"),
                default=0,
            )
            background_overlap = max(
                (_query_overlap_count(chunk, query_terms) for chunk in working if _section_role(chunk) == "background"),
                default=0,
            )
            if background_overlap <= wrapup_overlap + 2:
                drop_roles = {"background"}
        elif {"background", "wrapup", "generic"}.issubset(role_set):
            drop_roles = {"generic"}
        elif not benchmark_like and {"background", "method", "evaluation"}.issubset(role_set):
            drop_roles = {"evaluation"}

        if not drop_roles:
            break

        drop_candidates = [chunk for chunk in working if _section_role(chunk) in drop_roles]
        if not drop_candidates:
            break

        if drop_roles == {"background"}:
            drop_chunk = min(drop_candidates, key=lambda chunk: _background_drop_priority(chunk, query_terms))
        else:
            drop_chunk = min(drop_candidates, key=lambda chunk: _drop_priority(chunk, query_terms))
        working.remove(drop_chunk)

    working = _compact_summary_wrapup(working, query_terms=query_terms)
    working.sort(key=lambda chunk: _support_selection_score(chunk, query_terms), reverse=True)
    return working


def select_supporting_chunks(
    chunks: list[dict[str, Any]],
    *,
    max_chunks: int = 3,
    query_terms: list[str] | None = None,
) -> list[dict[str, Any]]:
    ranked = sorted(chunks, key=lambda chunk: _support_selection_score(chunk, query_terms), reverse=True)

    selected: list[dict[str, Any]] = []
    seen_sections: set[str] = set()
    for chunk in ranked:
        section_key = _top_level_section_key(chunk)
        if section_key in seen_sections:
            continue
        selected.append(chunk)
        seen_sections.add(section_key)
        if len(selected) >= max_chunks:
            break

    if len(selected) < max_chunks:
        for chunk in ranked:
            if chunk in selected:
                continue
            selected.append(chunk)
            if len(selected) >= max_chunks:
                break

    selected = _promote_missing_method_chunk(selected, ranked, query_terms=query_terms)
    selected = _compact_supporting_chunks(selected, query_terms=query_terms)
    selected.sort(key=lambda chunk: _support_selection_score(chunk, query_terms), reverse=True)
    return selected[:max_chunks]


def build_parent_child_aggregates(
    items: list[dict[str, Any]],
    route_mode: str,
    *,
    query_terms: list[str] | None = None,
    evidence_ablation: str = "none",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    doc_groups: dict[str, dict[str, Any]] = {}
    supporting_chunks: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        support = _supporting_chunk_payload(item, route_mode, index)
        supporting_chunks.append(support)
        if item.get("source_type") != "rag":
            continue
        doc_id = str(item.get("doc_id") or _item_identity(item))
        group = doc_groups.setdefault(
            doc_id,
            {
                "doc_id": doc_id,
                "title": item.get("title"),
                "source_type": "rag",
                "freshness": item.get("freshness"),
                "metadata": item.get("metadata") or {},
                "supporting_chunks": [],
                "chunk_ids": [],
                "scores": [],
            },
        )
        group["supporting_chunks"].append(support)
        if support.get("chunk_id"):
            group["chunk_ids"].append(support.get("chunk_id"))
        group["scores"].append(support["score"])

    doc_aggregates: list[dict[str, Any]] = []
    for doc_id, group in doc_groups.items():
        scores = list(group["scores"])
        if evidence_ablation == "simple_support":
            top_support = sorted(
                list(group["supporting_chunks"]),
                key=lambda chunk: (float(chunk.get("retrieval_score") or chunk.get("score") or 0.0), float(chunk.get("score") or 0.0)),
                reverse=True,
            )[:3]
        else:
            top_support = select_supporting_chunks(list(group["supporting_chunks"]), max_chunks=3, query_terms=query_terms)
        top_support_scores = [float(chunk.get("retrieval_score") or chunk.get("score") or 0.0) for chunk in top_support]
        top_support_mean = average(top_support_scores) if top_support_scores else 0.0
        aggregate_score = round_score(
            average(
                [
                    max(scores) if scores else 0,
                    top_support_mean,
                    min(1.0, len(top_support) / 3) * 0.35,
                ]
            )
        )
        doc_aggregates.append(
            {
                "doc_id": doc_id,
                "title": group["title"],
                "source_type": "rag",
                "freshness": group["freshness"],
                "aggregate_score": aggregate_score,
                "supporting_chunks": top_support,
                "chunk_ids": group["chunk_ids"],
                "supporting_chunk_count": len(group["supporting_chunks"]),
                "metadata": group["metadata"],
            }
        )
    doc_aggregates.sort(key=lambda item: item.get("aggregate_score", 0), reverse=True)

    parent_items = list(doc_aggregates)
    seen_rag_docs = {item["doc_id"] for item in doc_aggregates}
    for index, item in enumerate(items):
        if item.get("source_type") == "rag":
            doc_id = str(item.get("doc_id") or _item_identity(item))
            if doc_id in seen_rag_docs:
                continue
        parent_items.append(
            {
                "doc_id": item.get("doc_id"),
                "entry_id": item.get("entry_id"),
                "chunk_id": item.get("chunk_id"),
                "title": item.get("title"),
                "source_type": item.get("source_type"),
                "freshness": item.get("freshness"),
                "aggregate_score": score_citation(item, route_mode, index),
                "supporting_chunks": [_supporting_chunk_payload(item, route_mode, index)],
                "supporting_chunk_count": 1,
                "metadata": item.get("metadata") or {},
            }
        )
    preferred_source_type = "wiki" if route_mode == "wiki-first" else "rag"
    parent_items.sort(
        key=lambda item: (
            1 if item.get("source_type") == preferred_source_type else 0,
            item.get("aggregate_score", 0),
        ),
        reverse=True,
    )
    return doc_aggregates, supporting_chunks, parent_items


def load_chunk_records(path: str | Path) -> list[dict[str, Any]]:
    chunk_path = Path(path)
    rows: list[dict[str, Any]] = []
    with chunk_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def _payload_from_chunk_record(record: dict[str, Any]) -> dict[str, Any]:
    metadata = dict(record.get("metadata") or {})
    return {
        "doc_id": record.get("doc_id"),
        "chunk_id": record.get("chunk_id"),
        "title": record.get("title"),
        "paper_title": metadata.get("paper_title") or record.get("title"),
        "conference_id": metadata.get("conference_id"),
        "publication_year": metadata.get("publication_year"),
        "language": metadata.get("language"),
        "needs_ocr": metadata.get("needs_ocr"),
        "section_path": record.get("section_path") or [],
        "text": record.get("text"),
        "source_type": "rag",
        "freshness": record.get("freshness") or "stable",
        "metadata": metadata,
        "embedding_model": record.get("embedding_model"),
        "embedding_dim": record.get("embedding_dim"),
    }


def _payload_value(payload: dict[str, Any], key: str) -> Any:
    if key in payload:
        return payload.get(key)
    metadata = payload.get("metadata")
    if isinstance(metadata, dict):
        return metadata.get(key)
    return None


def _payload_matches_filters(payload: dict[str, Any], filters: dict[str, Any]) -> bool:
    if not filters:
        return True
    for key, expected in filters.items():
        actual = _payload_value(payload, key)
        if isinstance(expected, list):
            if isinstance(actual, list):
                if not any(value in expected for value in actual):
                    return False
            elif actual not in expected:
                return False
        elif actual != expected:
            return False
    return True


def _normalize_query_terms(query_analysis: dict[str, Any]) -> list[str]:
    normalized_terms: list[str] = []
    seen: set[str] = set()
    raw_terms: list[str] = list(query_analysis.get("terms") or [])
    for subquery in list((query_analysis.get("decomposition") or {}).get("subqueries") or []):
        raw_terms.extend(_extract_query_terms(subquery.get("query_text")))
    for rewrite in list((query_analysis.get("rewrites") or {}).get("variants") or []):
        raw_terms.extend(_extract_query_terms(rewrite.get("text")))

    for term in raw_terms:
        lowered = lower_text(term).strip()
        if not lowered:
            continue
        if lowered in RETRIEVAL_STOPWORDS:
            continue
        if lowered.isascii() and len(lowered) <= 1:
            continue
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized_terms.append(lowered)
    return normalized_terms


def _default_required_context(item: dict[str, Any]) -> list[str]:
    source_type = str(item.get("source_type") or "")
    freshness = str(item.get("freshness") or "")
    required: list[str] = ["entity_scope" if source_type == "wiki" else "document_scope"]
    required.append("freshness_scope" if source_type == "wiki" else "section_scope")
    if freshness == "dynamic":
        required.append("update_window")
    if str(item.get("doc_type") or "").strip():
        required.append("doc_type")
    return required


def _default_retrieval_hints(item: dict[str, Any]) -> list[str]:
    hints: list[str] = []
    for field in ("title", "doc_type", "project", "authority"):
        value = str(item.get(field) or "").strip()
        if value:
            hints.append(value)
    hints.extend(str(tag).strip() for tag in list(item.get("tags") or []) if str(tag).strip())
    metadata = dict(item.get("metadata") or {})
    hints.extend(str(tag).strip() for tag in list(metadata.get("tags") or []) if str(tag).strip())
    deduped: list[str] = []
    seen: set[str] = set()
    for hint in hints:
        lowered = lower_text(hint)
        if lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(hint)
    return deduped[:8]


def _build_knowledge_contract(item: dict[str, Any]) -> dict[str, Any]:
    metadata = dict(item.get("metadata") or {})
    explicit_required_context = item.get("required_context") or metadata.get("required_context")
    explicit_retrieval_hints = item.get("retrieval_hints") or metadata.get("retrieval_hints")
    required_context = list(explicit_required_context or _default_required_context(item))
    retrieval_hints = list(explicit_retrieval_hints or _default_retrieval_hints(item))
    source_type = str(item.get("source_type") or "rag")
    title = str(item.get("title") or item.get("doc_id") or item.get("entry_id") or "source")
    owner = item.get("owner") or metadata.get("owner") or ("wiki_curator" if source_type == "wiki" else "docs_corpus")
    ttl_seconds = int(item.get("ttl_seconds") or metadata.get("ttl_seconds") or (7 * 24 * 3600 if source_type == "wiki" else 90 * 24 * 3600))
    version = item.get("version") or metadata.get("version") or "v1"
    source_of_truth = item.get("source_of_truth") or metadata.get("source_of_truth") or title
    explicit_markers = [
        item.get("required_context") is not None,
        metadata.get("required_context") is not None,
        item.get("retrieval_hints") is not None,
        metadata.get("retrieval_hints") is not None,
        item.get("owner") is not None,
        metadata.get("owner") is not None,
        item.get("ttl_seconds") is not None,
        metadata.get("ttl_seconds") is not None,
        item.get("version") is not None,
        metadata.get("version") is not None,
        item.get("source_of_truth") is not None,
        metadata.get("source_of_truth") is not None,
    ]
    contract_source = "explicit" if any(explicit_markers) else "default_injected"
    return {
        "required_context": required_context,
        "retrieval_hints": retrieval_hints,
        "owner": owner,
        "ttl_seconds": ttl_seconds,
        "version": version,
        "source_of_truth": source_of_truth,
        "contract_source": contract_source,
    }


def _enrich_knowledge_candidate(item: dict[str, Any]) -> dict[str, Any]:
    contract = _build_knowledge_contract(item)
    metadata = {
        **dict(item.get("metadata") or {}),
        "knowledge_contract": contract,
    }
    return {
        **item,
        "required_context": contract["required_context"],
        "retrieval_hints": contract["retrieval_hints"],
        "owner": contract["owner"],
        "ttl_seconds": contract["ttl_seconds"],
        "version": contract["version"],
        "source_of_truth": contract["source_of_truth"],
        "knowledge_contract": contract,
        "metadata": metadata,
    }


def _build_effective_filters(query_analysis: dict[str, Any], explicit_filters: dict[str, Any]) -> dict[str, Any]:
    hints = dict(query_analysis.get("filter_hints") or {})
    filters = dict(explicit_filters or {})
    if hints.get("conference_ids") and "conference_id" not in filters:
        filters["conference_id"] = list(hints["conference_ids"])
    if hints.get("publication_years") and "publication_year" not in filters:
        filters["publication_year"] = list(hints["publication_years"])
    return filters


def _normalize_filter_policy(
    query_analysis: dict[str, Any],
    explicit_filters: dict[str, Any],
    filter_policy: dict[str, Any] | None,
) -> dict[str, Any]:
    policy = dict(filter_policy or {})
    mode = str(policy.get("mode") or "soft_prefer").strip() or "soft_prefer"
    if mode not in {"soft_prefer", "hard_enforce"}:
        mode = "soft_prefer"

    filter_hints = dict(query_analysis.get("filter_hints") or {})
    explicit_payload_filters = bool(explicit_filters)
    explicit_scope = bool(filter_hints.get("explicit_scope"))
    hard_reason = policy.get("hard_enforce_reason")
    if hard_reason is not None:
        hard_reason = str(hard_reason).strip() or None

    inferred_reason = None
    if explicit_payload_filters:
        inferred_reason = "explicit_filters"
    elif explicit_scope:
        inferred_reason = "user_explicit"

    if mode == "soft_prefer" and inferred_reason:
        mode = "hard_enforce"
    if mode == "hard_enforce" and inferred_reason:
        hard_reason = hard_reason or inferred_reason

    return {
        "mode": mode,
        "hard_enforce_reason": hard_reason,
    }


def _apply_filter_policy_to_items(
    items: list[dict[str, Any]],
    *,
    filters: dict[str, Any],
    filter_policy: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    policy = dict(filter_policy or {})
    mode = str(policy.get("mode") or "soft_prefer")
    effective_filters = dict(filters or {})
    if not items:
      return [], {
          "filtered_candidate_count": 0,
          "hard_filter_empty": mode == "hard_enforce" and bool(effective_filters),
          "hard_filter_empty_reason": "scope_candidate_empty" if mode == "hard_enforce" and bool(effective_filters) else None,
          "fallback_reason": "hard_filter_empty" if mode == "hard_enforce" and bool(effective_filters) else None,
      }

    filtered_items = [item for item in items if _payload_matches_filters(item, effective_filters)]
    if mode == "hard_enforce":
        return filtered_items, {
            "filtered_candidate_count": len(filtered_items),
            "hard_filter_empty": len(filtered_items) == 0 and bool(effective_filters),
            "hard_filter_empty_reason": "scope_candidate_empty" if len(filtered_items) == 0 and bool(effective_filters) else None,
            "fallback_reason": "hard_filter_empty" if len(filtered_items) == 0 and bool(effective_filters) else None,
        }

    rescored: list[dict[str, Any]] = []
    for item in items:
        match_score = _metadata_match_score(item, effective_filters)
        updated = {
            **item,
            "metadata_match_score": match_score,
            "score": round_score(float(item.get("score") or 0.0) + match_score * 0.12),
        }
        rescored.append(updated)
    rescored.sort(
        key=lambda item: (
            float(item.get("metadata_match_score") or 0.0),
            float(item.get("score") or 0.0),
            float(item.get("semantic_score") or 0.0),
            float(item.get("bm25_score") or 0.0),
        ),
        reverse=True,
    )
    return rescored, {
        "filtered_candidate_count": len(filtered_items),
        "hard_filter_empty": False,
        "hard_filter_empty_reason": None,
        "fallback_reason": None,
    }


def _soft_recover_items_after_hard_filter_empty(
    items: list[dict[str, Any]],
    *,
    filters: dict[str, Any],
) -> list[dict[str, Any]]:
    if not items:
        return []

    rescored: list[dict[str, Any]] = []
    for item in items:
        payload = dict(item)
        metadata_match_score = _metadata_match_score(payload, filters)
        recovered = {
            **item,
            "metadata_match_score": metadata_match_score,
            "score": round_score(float(item.get("score") or 0.0) + metadata_match_score * 0.12),
        }
        rescored.append(recovered)

    rescored.sort(
        key=lambda item: (
            float(item.get("metadata_match_score") or 0.0),
            float(item.get("score") or 0.0),
            float(item.get("semantic_score") or 0.0),
            float(item.get("bm25_score") or 0.0),
        ),
        reverse=True,
    )
    return rescored


def _metadata_match_score(payload: dict[str, Any], filters: dict[str, Any]) -> float:
    if not filters:
        return 0.0
    score = 0.0
    total = 0.0
    for key, expected in filters.items():
        weight = 1.0
        total += weight
        actual = _payload_value(payload, key)
        matched = False
        if isinstance(expected, list):
            if isinstance(actual, list):
                matched = any(value in expected for value in actual)
            else:
                matched = actual in expected
        else:
            matched = actual == expected
        if matched:
            score += weight
    if total <= 0:
        return 0.0
    return round_score(score / total)


def _record_identity(payload: dict[str, Any]) -> str:
    return str(payload.get("chunk_id") or payload.get("doc_id") or payload.get("title") or "item")


def _point_identity(value: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, value))


def _record_search_text(payload: dict[str, Any]) -> str:
    metadata = payload.get("metadata") or {}
    parts = [
        payload.get("paper_title"),
        payload.get("title"),
        " ".join(payload.get("section_path") or []),
        metadata.get("paper_title"),
        payload.get("text"),
    ]
    return "\n".join(str(part) for part in parts if part)


def _tokenize_search_text(text: str) -> list[str]:
    tokens = [lower_text(match.group(0)).strip() for match in QUERY_TOKEN_PATTERN.finditer(text or "")]
    return [
        token
        for token in tokens
        if token and token not in RETRIEVAL_STOPWORDS and (not token.isascii() or len(token) > 1)
    ]


def _normalize_scores(items: list[dict[str, Any]], score_key: str) -> list[dict[str, Any]]:
    max_score = max((float(item.get(score_key) or 0.0) for item in items), default=0.0)
    normalized_key = f"{score_key}_normalized"
    for item in items:
        raw_score = float(item.get(score_key) or 0.0)
        item[normalized_key] = 0.0 if max_score <= 0 else round_score(raw_score / max_score)
    return items


def _parse_rrf_channel_weights(value: Any) -> dict[str, float]:
    if not value:
        return {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError("rrf_channel_weights must be a JSON object") from exc
    if not isinstance(value, dict):
        raise ValueError("rrf_channel_weights must be an object")
    weights: dict[str, float] = {}
    for key, raw_weight in value.items():
        channel = str(key or "").strip()
        if channel not in RRF_WEIGHT_KEYS:
            raise ValueError("rrf_channel_weights only supports semantic and bm25")
        weight = float(raw_weight)
        if weight < 0:
            raise ValueError("rrf_channel_weights values must be non-negative")
        weights[channel] = weight
    return weights


def _normalize_ablation_mode(value: Any, *, allowed: set[str], label: str) -> str:
    mode = str(value or "none").strip() or "none"
    if mode not in allowed:
        raise ValueError(f"{label} must be one of: {', '.join(sorted(allowed))}")
    return mode


def _apply_query_ablation(query_analysis: dict[str, Any], mode: str) -> dict[str, Any]:
    if mode == "none":
        return query_analysis

    ablated = copy.deepcopy(query_analysis)
    if mode in {"no_rewrites", "single_query"}:
        ablated["rewrites"] = {
            "enabled": False,
            "strategy": "ablated_no_rewrites",
            "variants": [],
        }
    if mode in {"no_decomposition", "single_query"}:
        ablated["decomposition"] = {
            "enabled": False,
            "strategy": "ablated_single_pass",
            "subqueries": [],
        }
        clarification = dict(ablated.get("clarification") or {})
        ablated["boundary"] = _build_boundary_policy(
            decomposition=ablated["decomposition"],
            clarification=clarification,
        )
    ablated["ablation"] = {
        **dict(ablated.get("ablation") or {}),
        "query": mode,
    }
    return ablated


def _score_bm25_payloads(
    payloads: list[dict[str, Any]],
    *,
    query_terms: list[str],
    filters: dict[str, Any],
    filter_policy: dict[str, Any] | None,
    limit: int,
) -> list[dict[str, Any]]:
    filter_policy = dict(filter_policy or {})
    mode = str(filter_policy.get("mode") or "soft_prefer")
    base_payloads = payloads
    if mode == "hard_enforce":
        base_payloads = [payload for payload in payloads if _payload_matches_filters(payload, filters)]
    if not base_payloads or not query_terms:
        return []

    docs: list[tuple[dict[str, Any], Counter[str], int]] = []
    doc_freq: Counter[str] = Counter()
    total_length = 0
    for payload in base_payloads:
        tokens = _tokenize_search_text(_record_search_text(payload))
        if not tokens:
            continue
        counts: Counter[str] = Counter(tokens)
        doc_length = len(tokens)
        total_length += doc_length
        docs.append((payload, counts, doc_length))
        for term in query_terms:
            if counts.get(term):
                doc_freq[term] += 1

    if not docs:
        return []

    avg_doc_length = max(total_length / len(docs), 1.0)
    ranked: list[dict[str, Any]] = []
    for payload, counts, doc_length in docs:
        score = 0.0
        for term in query_terms:
            frequency = counts.get(term, 0)
            if frequency <= 0:
                continue
            matches = doc_freq.get(term, 0)
            idf = math.log(1.0 + ((len(docs) - matches + 0.5) / (matches + 0.5)))
            denom = frequency + 1.2 * (1 - 0.75 + 0.75 * (doc_length / avg_doc_length))
            score += idf * ((frequency * 2.2) / max(denom, 1e-9))
        if score <= 0:
            continue
        metadata_match_score = _metadata_match_score(payload, filters)
        if mode == "soft_prefer":
            score += metadata_match_score * 0.8
        ranked.append(
            {
                "id": _record_identity(payload),
                "payload": payload,
                "score": score,
                "metadata_match_score": metadata_match_score,
            }
        )

    ranked.sort(key=lambda item: item.get("score", 0), reverse=True)
    return _normalize_scores(ranked[:limit], "score")


def _search_item_from_payload(
    payload: dict[str, Any],
    *,
    score: float = 0.0,
    semantic_score: float = 0.0,
    bm25_score: float = 0.0,
    channels: list[str] | None = None,
    low_signal: bool = False,
    section_role: str | None = None,
    rerank_adjustment: float = 0.0,
) -> dict[str, Any]:
    return {
        "doc_id": payload.get("doc_id"),
        "chunk_id": payload.get("chunk_id"),
        "title": payload.get("paper_title") or payload.get("title"),
        "source_type": payload.get("source_type") or "rag",
        "freshness": payload.get("freshness") or "stable",
        "text": payload.get("text"),
        "metadata": payload.get("metadata") or {},
        "score": round_score(score),
        "semantic_score": round_score(semantic_score),
        "bm25_score": round_score(bm25_score),
        "snippet": payload.get("text"),
        "section_path": payload.get("section_path") or [],
        "retrieval_channels": channels or [],
        "low_signal": low_signal,
        "section_role": section_role,
        "rerank_adjustment": round_score(rerank_adjustment),
    }


def _fuse_ranked_hits(
    semantic_hits: list[dict[str, Any]],
    bm25_hits: list[dict[str, Any]],
    *,
    limit: int,
    effective_mode: str,
    filters: dict[str, Any] | None = None,
    filter_policy: dict[str, Any] | None = None,
    channel_weights: dict[str, float] | None = None,
    query_terms: list[str] | None = None,
    evidence_ablation: str = "none",
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    fused: dict[str, dict[str, Any]] = {}
    filters = dict(filters or {})
    filter_policy = dict(filter_policy or {})
    mode = str(filter_policy.get("mode") or "soft_prefer")
    weights = {
        **RRF_WEIGHTS,
        **(channel_weights or {}),
    }
    channel_inputs = {
        "semantic": semantic_hits,
        "bm25": bm25_hits,
    }
    for channel_name, hits in channel_inputs.items():
        weight = float(weights.get(channel_name, 0.0))
        for index, hit in enumerate(hits):
            payload = dict(hit.get("payload") or {})
            identity = _record_identity(payload)
            existing = fused.setdefault(
                identity,
                {
                    "payload": payload,
                    "rrf_score": 0.0,
                    "semantic_score": 0.0,
                    "bm25_score": 0.0,
                    "metadata_match_score": 0.0,
                    "channels": [],
                },
            )
            existing["payload"] = payload
            existing["rrf_score"] += weight / (RRF_K + index + 1)
            normalized_score = float(hit.get("score_normalized") or hit.get("score") or 0.0)
            existing[f"{channel_name}_score"] = max(existing[f"{channel_name}_score"], normalized_score)
            existing["metadata_match_score"] = max(existing["metadata_match_score"], float(hit.get("metadata_match_score") or _metadata_match_score(payload, filters) or 0.0))
            if channel_name not in existing["channels"]:
                existing["channels"].append(channel_name)

    ranked: list[dict[str, Any]] = []
    low_signal_candidate_count = 0
    for item in fused.values():
        payload = item["payload"]
        metadata = payload.get("metadata") or {}
        metadata_boost = 0.0
        if payload.get("freshness") == "stable" and effective_mode != "wiki-first":
            metadata_boost += 0.04
        if metadata.get("conference_id") in {"acl", "emnlp", "iclr", "icml", "neurips", "ndss", "usenix_security"}:
            metadata_boost += 0.02
        if payload.get("section_path"):
            metadata_boost += 0.01
        if mode == "soft_prefer":
            metadata_boost += item["metadata_match_score"] * 0.12
        if evidence_ablation == "no_rerank_adjustment":
            section_role = _section_role(
                {
                    "section_path": list(payload.get("section_path") or []),
                    "snippet": str(payload.get("text") or ""),
                }
            )
            low_signal = _is_low_signal_text(str(payload.get("text") or ""))
            rerank_adjustment = 0.0
        else:
            rerank_adjustment, low_signal, section_role = _candidate_rerank_adjustment(
                payload,
                query_terms=query_terms,
            )
        if low_signal:
            low_signal_candidate_count += 1
        combined = item["rrf_score"] + metadata_boost + item["semantic_score"] * 0.18 + item["bm25_score"] * 0.16 + rerank_adjustment
        ranked.append(
            _search_item_from_payload(
                payload,
                score=combined,
                semantic_score=item["semantic_score"],
                bm25_score=item["bm25_score"],
                channels=list(item["channels"]),
                low_signal=low_signal,
                section_role=section_role,
                rerank_adjustment=rerank_adjustment,
            )
        )

    ranked.sort(
        key=lambda item: (
            item.get("score", 0),
            item.get("semantic_score", 0),
            item.get("bm25_score", 0),
        ),
        reverse=True,
    )
    diagnostics = {
        "semantic_hit_count": len(semantic_hits),
        "bm25_hit_count": len(bm25_hits),
        "fused_hit_count": len(ranked),
        "low_signal_candidate_count": low_signal_candidate_count,
        "evidence_ablation": evidence_ablation,
    }
    return ranked[:limit], diagnostics


def build_vector_points(chunk_records: list[dict[str, Any]], *, embedder: Any) -> list[dict[str, Any]]:
    texts = [str(record.get("text") or "") for record in chunk_records]
    batch = embedder.encode(texts, input_type="passage")
    points: list[dict[str, Any]] = []
    for record, vector in zip(chunk_records, batch.vectors):
        payload = {
            **_payload_from_chunk_record(record),
            "embedding_model": batch.model_name,
            "embedding_dim": batch.dimensions,
        }
        points.append(
            {
                "id": _point_identity(str(record.get("chunk_id") or record.get("doc_id"))),
                "vector": vector,
                "payload": payload,
            }
        )
    return points


def _chunked_records(records: list[dict[str, Any]], batch_size: int) -> list[list[dict[str, Any]]]:
    if batch_size <= 0:
        return [records]
    return [records[index : index + batch_size] for index in range(0, len(records), batch_size)]


def _index_records_in_batches(
    chunk_records: list[dict[str, Any]],
    *,
    embedder: Any,
    vector_store: Any,
    batch_size: int,
) -> tuple[int, int]:
    total_points = 0
    total_upserted = 0
    for record_batch in _chunked_records(chunk_records, batch_size):
        points = build_vector_points(record_batch, embedder=embedder)
        upsert = vector_store.upsert_points(points)
        total_points += len(points)
        total_upserted += int(upsert.get("upserted") or 0)
    return total_points, total_upserted


def index_chunk_file(payload: dict[str, Any]) -> dict[str, Any]:
    chunk_path = payload.get("chunk_path")
    if not chunk_path:
        raise ValueError("chunk_path is required")
    config = dict(payload.get("config") or {})
    chunk_records = load_chunk_records(chunk_path)
    embedder = create_embedder(config)
    batch_size = int(config.get("index_batch_size") or payload.get("index_batch_size") or 256)
    vector_store = create_vector_store(
        {
            **config,
            "vector_size": embedder.dimensions,
        }
    )
    try:
        vector_store.ensure_collection()
        points, upserted = _index_records_in_batches(
            chunk_records,
            embedder=embedder,
            vector_store=vector_store,
            batch_size=batch_size,
        )
        return {
            "chunk_path": str(chunk_path),
            "records": len(chunk_records),
            "points": points,
            "embedding_strategy": describe_embedding_strategy(config),
            "vector_backend": vector_store.describe(),
            "upsert": {
                **vector_store.describe(),
                "upserted": upserted,
            },
            "index_batch_size": batch_size,
        }
    finally:
        vector_store.close()


def batch_index_chunk_files(payload: dict[str, Any]) -> dict[str, Any]:
    chunk_paths = [str(item) for item in (payload.get("chunk_paths") or []) if str(item)]
    if not chunk_paths:
        raise ValueError("chunk_paths is required")

    config = dict(payload.get("config") or {})
    embedder = create_embedder(config)
    batch_size = int(config.get("index_batch_size") or payload.get("index_batch_size") or 256)
    vector_store = create_vector_store(
        {
            **config,
            "vector_size": embedder.dimensions,
        }
    )
    per_file: list[dict[str, Any]] = []
    total_records = 0
    total_points = 0
    try:
        vector_store.ensure_collection()
        for chunk_path in chunk_paths:
            chunk_records = load_chunk_records(chunk_path)
            points, upserted = _index_records_in_batches(
                chunk_records,
                embedder=embedder,
                vector_store=vector_store,
                batch_size=batch_size,
            )
            per_file.append(
                {
                    "chunk_path": str(chunk_path),
                    "records": len(chunk_records),
                    "points": points,
                    "upserted": upserted,
                }
            )
            total_records += len(chunk_records)
            total_points += points

        payloads = vector_store.iter_payloads(limit=max(total_points + 100, 1000))
        unique_doc_ids = {
            item["payload"].get("doc_id")
            for item in payloads
            if item.get("payload", {}).get("doc_id")
        }
        return {
            "chunk_paths": chunk_paths,
            "files": len(chunk_paths),
            "records": total_records,
            "points": total_points,
            "documents": len(unique_doc_ids),
            "embedding_strategy": describe_embedding_strategy(config),
            "vector_backend": vector_store.describe(),
            "per_file": per_file,
            "index_batch_size": batch_size,
        }
    finally:
        vector_store.close()


def search_indexed_chunks(payload: dict[str, Any]) -> dict[str, Any]:
    query = str(payload.get("query") or "")
    if not query:
        raise ValueError("query is required")
    config = dict(payload.get("config") or {})
    recall_mode = str(payload.get("recall_mode") or config.get("recall_mode") or "hybrid")
    if recall_mode not in {"hybrid", "semantic", "bm25"}:
        raise ValueError("recall_mode must be one of: hybrid, semantic, bm25")
    requested_rrf_weights = _parse_rrf_channel_weights(
        payload.get("rrf_channel_weights") or config.get("rrf_channel_weights")
    )
    query_ablation = _normalize_ablation_mode(
        payload.get("query_ablation") or config.get("query_ablation"),
        allowed=QUERY_ABLATION_MODES,
        label="query_ablation",
    )
    evidence_ablation = _normalize_ablation_mode(
        payload.get("evidence_ablation") or config.get("evidence_ablation"),
        allowed=EVIDENCE_ABLATION_MODES,
        label="evidence_ablation",
    )
    filters = dict(payload.get("filters") or {})
    requested_filters = dict(filters)
    filter_policy = _normalize_filter_policy(
        {},
        requested_filters,
        dict(payload.get("filter_policy") or {}),
    )
    limit = int(payload.get("limit") or 5)
    chunk_path = payload.get("chunk_path")
    embedding_strategy = describe_embedding_strategy(config)
    embedder = create_embedder(config)
    vector_store = create_vector_store(
        {
            **config,
            "vector_size": embedder.dimensions,
        }
    )
    try:
        chunk_records: list[dict[str, Any]] = []
        payload_corpus: list[dict[str, Any]] = []
        if chunk_path:
            chunk_records = load_chunk_records(chunk_path)
            vector_store.ensure_collection()
            points = build_vector_points(chunk_records, embedder=embedder)
            vector_store.upsert_points(points)
            payload_corpus = [_payload_from_chunk_record(record) for record in chunk_records]
        else:
            payload_corpus = [
                dict(item.get("payload") or {})
                for item in vector_store.iter_payloads(limit=int(payload.get("corpus_limit") or 100000))
            ]

        route = choose_retrieval_route(query)
        query_analysis = build_query_analysis(query, route)
        query_analysis = _apply_query_ablation(query_analysis, query_ablation)
        filter_policy = _normalize_filter_policy(query_analysis, requested_filters, filter_policy)
        effective_filters = _build_effective_filters(query_analysis, requested_filters)
        search_filters = effective_filters if filter_policy.get("mode") == "hard_enforce" else {}
        semantic_queries = [query]
        semantic_queries.extend(
            str(variant.get("text") or "")
            for variant in list((query_analysis.get("rewrites") or {}).get("variants") or [])[:2]
            if str(variant.get("text") or "").strip()
        )
        semantic_hits: list[dict[str, Any]] = []
        batch = None
        if recall_mode in {"hybrid", "semantic"}:
            batch = embedder.encode(semantic_queries, input_type="query")
            for variant_text, vector in zip(semantic_queries, batch.vectors):
                variant_hits = vector_store.search(
                    vector,
                    limit=max(limit * 6, SEMANTIC_TOP_K),
                    filters=search_filters,
                )
                for hit in variant_hits:
                    hit["query_variant"] = variant_text
                    hit["metadata_match_score"] = _metadata_match_score(dict(hit.get("payload") or {}), effective_filters)
                semantic_hits.extend(variant_hits)
            semantic_hits = _normalize_scores(semantic_hits, "score")
        bm25_hits = (
            _score_bm25_payloads(
                payload_corpus,
                query_terms=_normalize_query_terms(query_analysis),
                filters=effective_filters,
                filter_policy=filter_policy,
                limit=max(limit * 6, BM25_TOP_K),
            )
            if recall_mode in {"hybrid", "bm25"}
            else []
        )
        citation_mode = route.get("mode") or "rag-first"
        fused_chunk_limit = max(limit * 8, SEMANTIC_TOP_K)
        default_channel_weights = {
            "semantic": 0.08 if embedding_strategy.get("backend") == "deterministic_hash" else RRF_WEIGHTS["semantic"],
            "bm25": 0.92 if embedding_strategy.get("backend") == "deterministic_hash" else RRF_WEIGHTS["bm25"],
        }
        channel_weights = {
            "semantic": 1.0 if recall_mode == "semantic" else 0.0 if recall_mode == "bm25" else default_channel_weights["semantic"],
            "bm25": 1.0 if recall_mode == "bm25" else 0.0 if recall_mode == "semantic" else default_channel_weights["bm25"],
        }
        if recall_mode == "hybrid":
            channel_weights = {
                **channel_weights,
                **requested_rrf_weights,
            }
        fused_items, diagnostics = _fuse_ranked_hits(
            semantic_hits,
            bm25_hits,
            limit=max(fused_chunk_limit, 1),
            effective_mode=citation_mode,
            filters=effective_filters,
            filter_policy=filter_policy,
            channel_weights=channel_weights,
            query_terms=_normalize_query_terms(query_analysis),
            evidence_ablation=evidence_ablation,
        )
        filtered_candidate_count = len([payload_item for payload_item in payload_corpus if _payload_matches_filters(payload_item, effective_filters)])
        hard_filter_retrieval_hit_count = len(fused_items)
        hard_filter_empty = bool(
            filter_policy.get("mode") == "hard_enforce"
            and effective_filters
            and (filtered_candidate_count == 0 or hard_filter_retrieval_hit_count == 0)
        )
        hard_filter_empty_reason = None
        if hard_filter_empty:
            hard_filter_empty_reason = "scope_candidate_empty" if filtered_candidate_count == 0 else "retrieval_hit_empty"
        recovered_from_hard_filter_empty = False
        if hard_filter_empty:
            recovery_semantic_hits: list[dict[str, Any]] = []
            if recall_mode in {"hybrid", "semantic"}:
                if batch is None:
                    batch = embedder.encode(semantic_queries, input_type="query")
                for variant_text, vector in zip(semantic_queries, batch.vectors):
                    variant_hits = vector_store.search(
                        vector,
                        limit=max(limit * 6, SEMANTIC_TOP_K),
                        filters={},
                    )
                    for hit in variant_hits:
                        hit["query_variant"] = variant_text
                        hit["metadata_match_score"] = _metadata_match_score(dict(hit.get("payload") or {}), effective_filters)
                    recovery_semantic_hits.extend(variant_hits)
                recovery_semantic_hits = _normalize_scores(recovery_semantic_hits, "score")
            recovery_bm25_hits = (
                _score_bm25_payloads(
                    payload_corpus,
                    query_terms=_normalize_query_terms(query_analysis),
                    filters=effective_filters,
                    filter_policy={
                        **filter_policy,
                        "mode": "soft_prefer",
                    },
                    limit=max(limit * 6, BM25_TOP_K),
                )
                if recall_mode in {"hybrid", "bm25"}
                else []
            )
            recovery_fused_items, recovery_diagnostics = _fuse_ranked_hits(
                recovery_semantic_hits,
                recovery_bm25_hits,
                limit=max(fused_chunk_limit, 1),
                effective_mode=citation_mode,
                filters=effective_filters,
                filter_policy={
                    **filter_policy,
                    "mode": "soft_prefer",
                },
                channel_weights=channel_weights,
                query_terms=_normalize_query_terms(query_analysis),
                evidence_ablation=evidence_ablation,
            )
            recovered_items = _soft_recover_items_after_hard_filter_empty(
                [_enrich_knowledge_candidate(item) for item in recovery_fused_items],
                filters=effective_filters,
            )
            if recovered_items:
                recovered_from_hard_filter_empty = True
                fused_items = recovered_items
                semantic_hits = recovery_semantic_hits
                bm25_hits = recovery_bm25_hits
                diagnostics = recovery_diagnostics
            else:
                fused_items = [_enrich_knowledge_candidate(item) for item in fused_items]
        else:
            fused_items = [_enrich_knowledge_candidate(item) for item in fused_items]
        fallback_reason = "hard_filter_empty_soft_prefer_recovery" if recovered_from_hard_filter_empty else ("hard_filter_empty" if hard_filter_empty else None)
        effective_filter_mode = "soft_prefer" if recovered_from_hard_filter_empty else filter_policy.get("mode")
        diagnostics = {
            **diagnostics,
            "recall_mode": recall_mode,
            "rrf_channel_weights": channel_weights,
            "query_ablation": query_ablation,
            "evidence_ablation": evidence_ablation,
            "filtered_candidate_count": filtered_candidate_count,
            "requested_filter_count": len(requested_filters),
            "effective_filter_count": len(effective_filters),
            "hard_filter_scope_candidate_count": filtered_candidate_count,
            "hard_filter_retrieval_hit_count": hard_filter_retrieval_hit_count,
            "hard_filter_empty": hard_filter_empty,
            "hard_filter_empty_reason": hard_filter_empty_reason,
            "soft_recovered": recovered_from_hard_filter_empty,
        }
        doc_aggregates, supporting_chunks, parent_items = build_parent_child_aggregates(
            fused_items,
            citation_mode,
            query_terms=_normalize_query_terms(query_analysis),
            evidence_ablation=evidence_ablation,
        )
        retrieval_plan = build_retrieval_plan(
            route,
            query_analysis,
            filter_policy=filter_policy,
            requested_filters=requested_filters,
            effective_filters=effective_filters,
            config=config,
            embedding_strategy=embedding_strategy,
            vector_backend=vector_store.describe(),
        )
        retrieval_plan["implementation_status"] = "active_hybrid_rag"
        for channel in retrieval_plan["rag"]["channels"]:
            if channel["name"] == "semantic":
                channel["status"] = "disabled" if recall_mode == "bm25" else ("active" if semantic_hits else "no_hits")
                channel["returned"] = len(semantic_hits)
            elif channel["name"] == "bm25":
                channel["status"] = "disabled" if recall_mode == "semantic" else ("active" if bm25_hits else "no_hits")
                channel["returned"] = len(bm25_hits)

        return {
            "query": query,
            "limit": limit,
            "filters": effective_filters,
            "requested_filters": requested_filters,
            "effective_filters": effective_filters,
            "filter_policy": {
                **filter_policy,
                "mode": effective_filter_mode,
                "requested_filters": requested_filters,
                "effective_filters": effective_filters,
                "filtered_candidate_count": filtered_candidate_count,
                "requested_filter_count": len(requested_filters),
                "effective_filter_count": len(effective_filters),
                "hard_filter_scope_candidate_count": filtered_candidate_count,
                "hard_filter_retrieval_hit_count": hard_filter_retrieval_hit_count,
                "hard_filter_empty": hard_filter_empty,
                "hard_filter_empty_reason": hard_filter_empty_reason,
                "fallback_reason": fallback_reason,
                "recovered_soft_prefer": recovered_from_hard_filter_empty,
            },
            "query_analysis": query_analysis,
            "retrieval_plan": retrieval_plan,
            "embedding_strategy": retrieval_plan["embedding_strategy"],
            "recall_mode": recall_mode,
            "rrf_channel_weights": channel_weights,
            "query_ablation": query_ablation,
            "evidence_ablation": evidence_ablation,
            "vector_backend": retrieval_plan["embedding_strategy"]["vector_backend"],
            "raw_hits": fused_items,
            "channel_hits": {
                "semantic": semantic_hits,
                "bm25": bm25_hits,
            },
            "diagnostics": diagnostics,
            "items": parent_items[:limit],
            "doc_aggregates": doc_aggregates[:limit],
            "supporting_chunks": supporting_chunks,
        }
    finally:
        vector_store.close()


def build_retrieval_quality(
    route: dict[str, Any],
    query_analysis: dict[str, Any] | None = None,
    stable_items: list[dict[str, Any]] | None = None,
    dynamic_items: list[dict[str, Any]] | None = None,
    items: list[dict[str, Any]] | None = None,
    filter_policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    query_analysis = query_analysis or {}
    stable_items = stable_items or []
    dynamic_items = dynamic_items or []
    items = items or []
    filter_policy = dict(filter_policy or {})
    source_types = {item.get("source_type") for item in items if item.get("source_type")}
    requested_mode = route.get("mode") or "rag-first"
    effective_mode = route.get("effective_mode") or requested_mode
    primary_type = "wiki" if effective_mode == "wiki-first" else "rag"
    primary_items = [item for item in items if item.get("source_type") == primary_type]
    secondary_items = [item for item in items if item.get("source_type") != primary_type]
    historical_primary_items = [item for item in primary_items if item.get("freshness") == "historical"]

    entity_groups: dict[str, list[dict[str, Any]]] = {}
    for item in primary_items:
        metadata = dict(item.get("metadata") or {})
        entity_key = lower_text(
            metadata.get("entity_id")
            or metadata.get("entity_name")
            or item.get("entity_id")
            or item.get("title")
            or item.get("entry_id")
            or item.get("doc_id")
            or "item"
        )
        entity_groups.setdefault(entity_key, []).append(item)

    stale_unresolved_count = 0
    stale_shadowed_count = 0
    source_of_truth_conflict_count = 0
    for group_items in entity_groups.values():
        current_items = [item for item in group_items if item.get("freshness") != "historical"]
        historical_items = [item for item in group_items if item.get("freshness") == "historical"]
        if historical_items and current_items:
            stale_shadowed_count += len(historical_items)
        elif historical_items:
            stale_unresolved_count += len(historical_items)

        current_sources = {
            str(
                item.get("source_of_truth")
                or (item.get("knowledge_contract") or {}).get("source_of_truth")
                or item.get("title")
                or ""
            ).strip()
            for item in current_items
            if str(
                item.get("source_of_truth")
                or (item.get("knowledge_contract") or {}).get("source_of_truth")
                or item.get("title")
                or ""
            ).strip()
        }
        if len(current_sources) > 1:
            source_of_truth_conflict_count += 1

    stale_wiki_primary = stale_unresolved_count > 0
    citation_score = round_score(average([score_citation(item, effective_mode, index) for index, item in enumerate(items)]))
    coverage_score = round_score(min(1.0, len(items) / 2))
    route_alignment_score = round_score(
        0
        if not items
        else average(
            [
                1 if items[0].get("source_type") == primary_type else 0.55,
                min(1.0, len(primary_items) / len(items) + 0.15) if primary_items else 0.2,
            ]
        )
    )
    freshness_score = round_score(
        0.25
        if not primary_items
        else average(
            [
                0.95
                if item.get("source_type") == "wiki" and item.get("freshness") == "dynamic"
                else 0.5
                if item.get("source_type") == "wiki" and item.get("freshness") == "historical"
                else 0.8
                if item.get("source_type") == "wiki"
                else 0.95
                if item.get("freshness") == "stable"
                else 0.65
                if item.get("freshness") == "historical"
                else 0.8
                for item in primary_items
            ]
        )
    )
    source_balance_score = round_score(
        0.92 if "rag" in source_types and "wiki" in source_types else (0.7 if primary_items else 0.35) + (0.08 if secondary_items else 0)
    )
    contract_coverage_score = round_score(
        average(
            [
                1.0
                if (
                    (item.get("knowledge_contract") or {}).get("owner")
                    and (item.get("knowledge_contract") or {}).get("required_context")
                    and (item.get("knowledge_contract") or {}).get("retrieval_hints")
                )
                else 0.0
                for item in items
            ]
        )
        if items
        else 0.0
    )
    stale_penalty = (
        0.08
        if stale_unresolved_count > 0
        else 0.02
        if stale_shadowed_count > 0
        else 0.04
        if historical_primary_items
        else 0.0
    )
    source_conflict_penalty = min(0.12 * source_of_truth_conflict_count, 0.24)
    retrieval_score = round_score(
        average([citation_score, coverage_score, route_alignment_score, freshness_score, source_balance_score, contract_coverage_score])
        - stale_penalty
        - source_conflict_penalty
    )
    if filter_policy.get("hard_filter_empty") and bool((query_analysis.get("clarification") or {}).get("required")):
        recommended_action = "clarify"
    elif filter_policy.get("hard_filter_empty"):
        recommended_action = "supplement_wiki" if requested_mode == "wiki-first" else "supplement_rag"
    elif route.get("fallback_applied"):
        recommended_action = "supplement_wiki" if requested_mode == "wiki-first" else "supplement_rag"
    elif requested_mode == "wiki-first" and source_of_truth_conflict_count > 0:
        recommended_action = "supplement_rag"
    elif requested_mode != "wiki-first" and source_of_truth_conflict_count > 0:
        recommended_action = "supplement_wiki"
    elif requested_mode == "wiki-first" and (stale_wiki_primary or freshness_score < 0.7):
        recommended_action = "supplement_rag"
    elif requested_mode != "wiki-first" and historical_primary_items and freshness_score < 0.7:
        recommended_action = "supplement_wiki"
    elif retrieval_score >= 0.82:
        recommended_action = "accept"
    else:
        recommended_action = "supplement_rag" if requested_mode == "wiki-first" else "supplement_wiki"

    return {
        "retrieval_score": retrieval_score,
        "citation_score": citation_score,
        "coverage_score": coverage_score,
        "route_alignment_score": route_alignment_score,
        "freshness_score": freshness_score,
        "source_balance_score": source_balance_score,
        "contract_coverage_score": contract_coverage_score,
        "stale_penalty": stale_penalty,
        "source_conflict_penalty": source_conflict_penalty,
        "historical_primary_count": len(historical_primary_items),
        "stale_wiki_primary": stale_wiki_primary,
        "stale_unresolved_count": stale_unresolved_count,
        "stale_shadowed_count": stale_shadowed_count,
        "source_of_truth_conflict_count": source_of_truth_conflict_count,
        "entity_group_count": len(entity_groups),
        "boundary_action": (query_analysis.get("boundary") or {}).get("action"),
        "clarification_required": bool((query_analysis.get("clarification") or {}).get("required")),
        "recommended_action": recommended_action,
        "primary_source_count": len(primary_items),
        "secondary_source_count": len(secondary_items),
    }


def build_retrieval_result(payload: dict[str, Any]) -> dict[str, Any]:
    query = payload.get("query")
    persona_id = payload.get("persona_id")
    requested_filters = dict(payload.get("filters") or {})
    stable_items = [_enrich_knowledge_candidate(item) for item in list(payload.get("stable_items") or [])]
    dynamic_items = [_enrich_knowledge_candidate(item) for item in list(payload.get("dynamic_items") or [])]
    stable_items_original = list(stable_items)
    dynamic_items_original = list(dynamic_items)
    route = choose_retrieval_route(query)
    query_analysis = build_query_analysis(query, route)
    filter_policy = _normalize_filter_policy(
        query_analysis,
        requested_filters,
        dict(payload.get("filter_policy") or {}),
    )
    effective_filters = _build_effective_filters(query_analysis, requested_filters)
    stable_items, stable_filter_stats = _apply_filter_policy_to_items(
        stable_items,
        filters=effective_filters,
        filter_policy=filter_policy,
    )
    dynamic_items, dynamic_filter_stats = _apply_filter_policy_to_items(
        dynamic_items,
        filters=effective_filters,
        filter_policy=filter_policy,
    )
    requested_mode = route["mode"]
    primary_items = dynamic_items if requested_mode == "wiki-first" else stable_items
    secondary_items = stable_items if requested_mode == "wiki-first" else dynamic_items
    source_fallback_applied = not primary_items and bool(secondary_items)
    hard_filter_empty = bool(stable_filter_stats.get("hard_filter_empty")) and bool(dynamic_filter_stats.get("hard_filter_empty"))
    recovered_from_hard_filter_empty = False
    if hard_filter_empty:
        recovered_primary = dynamic_items_original if requested_mode == "wiki-first" else stable_items_original
        recovered_secondary = stable_items_original if requested_mode == "wiki-first" else dynamic_items_original
        recovered_primary = _soft_recover_items_after_hard_filter_empty(recovered_primary, filters=effective_filters)
        recovered_secondary = _soft_recover_items_after_hard_filter_empty(recovered_secondary, filters=effective_filters)
        primary_items = recovered_primary
        secondary_items = recovered_secondary
        recovered_from_hard_filter_empty = bool(primary_items or secondary_items)
    fallback_applied = source_fallback_applied
    effective_mode = ("rag-first" if requested_mode == "wiki-first" else "wiki-first") if fallback_applied else requested_mode
    ordered = (secondary_items + primary_items) if fallback_applied else (primary_items + secondary_items)
    route = {
        **route,
        "requested_mode": requested_mode,
        "effective_mode": effective_mode,
        "fallback_applied": fallback_applied,
        "fallback_reason": "primary_source_empty" if fallback_applied else None,
    }
    items = ordered[:4]
    citation_mode = route.get("effective_mode") or requested_mode
    retrieval_plan = build_retrieval_plan(
        route,
        query_analysis,
        persona_id=persona_id,
        filter_policy=filter_policy,
        requested_filters=requested_filters,
        effective_filters=effective_filters,
    )
    doc_aggregates, supporting_chunks, parent_items = build_parent_child_aggregates(items, citation_mode)
    filtered_candidate_count = (
        stable_filter_stats.get("filtered_candidate_count", 0)
        + dynamic_filter_stats.get("filtered_candidate_count", 0)
    )
    hard_filter_empty_reason = "scope_candidate_empty" if hard_filter_empty else None
    fallback_reason = "hard_filter_empty_soft_prefer_recovery" if recovered_from_hard_filter_empty else ("hard_filter_empty" if hard_filter_empty else None)
    effective_filter_mode = "soft_prefer" if recovered_from_hard_filter_empty else filter_policy.get("mode")

    return {
        "route": route,
        "query_analysis": query_analysis,
        "requested_filters": requested_filters,
        "effective_filters": effective_filters,
        "filter_policy": {
            **filter_policy,
            "mode": effective_filter_mode,
            "requested_filters": requested_filters,
            "effective_filters": effective_filters,
            "filtered_candidate_count": filtered_candidate_count,
            "requested_filter_count": len(requested_filters),
            "effective_filter_count": len(effective_filters),
            "hard_filter_empty": hard_filter_empty,
            "hard_filter_empty_reason": hard_filter_empty_reason,
            "fallback_reason": fallback_reason,
            "recovered_soft_prefer": recovered_from_hard_filter_empty,
        },
        "retrieval_plan": retrieval_plan,
        "items": parent_items,
        "raw_items": items,
        "stable_items": stable_items,
        "dynamic_items": dynamic_items,
        "doc_aggregates": doc_aggregates,
        "supporting_chunks": supporting_chunks,
        "citations": [
            {
                "id": item.get("doc_id") or item.get("entry_id"),
                "title": item.get("title"),
                "source_type": item.get("source_type"),
                "freshness": item.get("freshness"),
                "score": score_citation(item, citation_mode, index),
                "owner": item.get("owner"),
                "version": item.get("version"),
                "required_context": item.get("required_context"),
                "retrieval_hints": item.get("retrieval_hints"),
                "ttl_seconds": item.get("ttl_seconds"),
                "source_of_truth": item.get("source_of_truth"),
                "knowledge_contract": item.get("knowledge_contract"),
            }
            for index, item in enumerate(items)
        ],
        "quality": build_retrieval_quality(route, query_analysis, stable_items, dynamic_items, items, filter_policy={
            **filter_policy,
            "hard_filter_empty": hard_filter_empty,
            "hard_filter_empty_reason": hard_filter_empty_reason,
            "fallback_reason": fallback_reason,
            "recovered_soft_prefer": recovered_from_hard_filter_empty,
        }),
        "persona_id": persona_id,
    }
