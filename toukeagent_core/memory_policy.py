from __future__ import annotations

import re
from typing import Any

from .embedding import create_embedder
from .shared import clone


TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_.-]+|[\u4e00-\u9fff]{1,8}")
TEMPORARY_HINTS = (
    "tomorrow",
    "today",
    "next week",
    "this afternoon",
    "remind me",
    "one-time",
    "once",
    "明天",
    "今天",
    "后天",
    "提醒我",
    "一次性",
    "这周",
    "下午",
)
DURABLE_HINTS = (
    "remember",
    "preference",
    "prefer",
    "always",
    "default",
    "keep",
    "persist",
    "长期",
    "记住",
    "偏好",
    "始终",
    "默认",
    "以后",
    "持续",
)


def _normalize_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _parse_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _round(value: Any, digits: int = 4) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        numeric = 0.0
    return round(numeric, digits)


def _tokenize(text: str) -> list[str]:
    return [match.group(0).casefold() for match in TOKEN_PATTERN.finditer(text or "")]


def _lexical_overlap(query: str, entry_text: str) -> float:
    query_terms = _tokenize(query)
    if not query_terms:
        return 0.0
    normalized_entry = _normalize_text(entry_text).casefold()
    entry_terms = set(_tokenize(entry_text))
    if not normalized_entry and not entry_terms:
        return 0.0
    hits = 0
    for term in query_terms:
        if term in normalized_entry:
            hits += 1
            continue
        if any(term in candidate or candidate in term for candidate in entry_terms):
            hits += 1
    return hits / len(query_terms)


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    return sum(a * b for a, b in zip(left, right))


def _entry_text(entry: dict[str, Any]) -> str:
    values = [
        entry.get("title"),
        entry.get("summary"),
        entry.get("content"),
        *list(entry.get("facts") or []),
        *list(entry.get("tags") or []),
    ]
    return " ".join(_normalize_text(value) for value in values if _normalize_text(value))


def _parse_timestamp_ms(value: Any) -> float | None:
    import datetime as _dt

    text = str(value or "").strip()
    if not text:
        return None
    try:
        normalized = text.replace("Z", "+00:00")
        dt = _dt.datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_dt.timezone.utc)
        return dt.timestamp() * 1000.0
    except Exception:
        return None


def _parse_timestamp_hours_ago(entry: dict[str, Any], now_ms: float) -> float | None:
    for key in ("updated_at", "created_at"):
        timestamp_ms = _parse_timestamp_ms(entry.get(key))
        if timestamp_ms is None:
            continue
        age_seconds = max(0.0, (now_ms - timestamp_ms) / 1000.0)
        return age_seconds / 3600.0
    return None


def _semantic_enabled(runtime: dict[str, Any], strategy: dict[str, Any]) -> bool:
    caps = strategy.get("effective_capabilities") or strategy.get("capabilities") or {}
    if caps.get("semantic_recall") is False:
        return False
    return runtime.get("semantic_recall") is not False


def rank_memory_recall(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or {}
    query = _normalize_text(data.get("query"))
    entries = [clone(entry) for entry in list(data.get("entries") or []) if isinstance(entry, dict)]
    limit = max(1, int(data.get("limit") or 4))
    strategy = dict(data.get("strategy") or {})
    runtime = dict(data.get("runtime") or {})
    now_ms = _parse_float(data.get("now"), 0.0) or 0.0
    if now_ms <= 0:
        import time as _time

        now_ms = _time.time() * 1000.0

    stale_after_hours = int(((strategy.get("retrieval_policy") or {}).get("stale_after_hours")) or 168)
    lexical_weight = _parse_float(runtime.get("lexical_weight"), 0.5)
    semantic_weight = _parse_float(runtime.get("semantic_weight"), 0.35)
    importance_weight = _parse_float(runtime.get("importance_weight"), 0.1)
    freshness_weight = _parse_float(runtime.get("freshness_weight"), 0.05)

    query_vector: list[float] | None = None
    entry_vectors: list[list[float]] | None = None
    embedding_strategy: dict[str, Any] | None = None
    semantic_available = bool(query) and _semantic_enabled(runtime, strategy)
    if semantic_available and entries:
        try:
            embedder = create_embedder(dict(runtime.get("embedding_config") or {}))
            query_vector = embedder.encode([query], input_type="query").vectors[0]
            entry_vectors = embedder.encode([_entry_text(entry) for entry in entries], input_type="passage").vectors
            embedding_strategy = {
                "backend": embedder.backend,
                "model_name": embedder.model_name,
                "dimensions": embedder.dimensions,
            }
        except Exception as exc:
            semantic_available = False
            embedding_strategy = {
                "backend": "disabled",
                "reason": f"semantic_recall_unavailable:{exc.__class__.__name__}",
            }

    ranked: list[dict[str, Any]] = []
    for index, entry in enumerate(entries):
        lexical_score = _lexical_overlap(query, _entry_text(entry))
        semantic_score = 0.0
        if semantic_available and query_vector and entry_vectors and index < len(entry_vectors):
            semantic_score = max(0.0, _cosine_similarity(query_vector, entry_vectors[index]))
        importance_score = max(0.0, min(1.0, _parse_float(entry.get("importance"), 0.5)))
        hours_ago = _parse_timestamp_hours_ago(entry, now_ms)
        expires_at_ms = _parse_timestamp_ms(entry.get("expires_at"))
        expired = expires_at_ms is not None and now_ms >= expires_at_ms
        stale = bool(entry.get("stale")) or expired
        stale_penalty = 0.0
        freshness_score = 1.0
        if hours_ago is not None and stale_after_hours > 0:
            freshness_score = max(0.0, 1.0 - min(hours_ago / stale_after_hours, 1.0))
            stale = stale or hours_ago > stale_after_hours
        if stale:
            stale_penalty = _parse_float(runtime.get("stale_penalty"), 0.2)
            freshness_score = min(freshness_score, 0.25)

        score = (
            lexical_score * lexical_weight
            + semantic_score * semantic_weight
            + importance_score * importance_weight
            + freshness_score * freshness_weight
            - stale_penalty
        )

        if lexical_score <= 0 and semantic_score <= 0:
            continue

        ranked.append({
            **entry,
            "stale": stale,
            "lexical_score": _round(lexical_score),
            "semantic_score": _round(semantic_score),
            "importance_score": _round(importance_score),
            "freshness_score": _round(freshness_score),
            "stale_penalty": _round(stale_penalty),
            "score_breakdown": {
                "lexical": _round(lexical_score * lexical_weight),
                "semantic": _round(semantic_score * semantic_weight),
                "importance": _round(importance_score * importance_weight),
                "freshness": _round(freshness_score * freshness_weight),
                "stale_penalty": _round(stale_penalty),
            },
            "score": _round(score),
        })

    ranked.sort(
        key=lambda item: (
            -_parse_float(item.get("score")),
            -_parse_float(item.get("importance")),
            -_parse_float(item.get("semantic_score")),
            -_parse_float(item.get("lexical_score")),
        )
    )
    ranked = ranked[:limit]

    return {
        "query": query,
        "items": ranked,
        "strategy": {
            "mode": "python_ranked_recall",
            "semantic_enabled": semantic_available,
            "weights": {
                "lexical": lexical_weight,
                "semantic": semantic_weight if semantic_available else 0.0,
                "importance": importance_weight,
                "freshness": freshness_weight,
            },
            "stale_after_hours": stale_after_hours,
            "embedding": embedding_strategy,
        },
    }


def judge_durable_memory_write(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or {}
    strategy = dict(data.get("strategy") or {})
    write_policy = dict(strategy.get("write_policy") or {})
    message_text = _normalize_text(data.get("message_text"))
    response_text = _normalize_text(data.get("response_text"))
    task_id = data.get("task_id")
    trace_id = data.get("trace_id")
    workspace_id = data.get("workspace_id")
    persona_id = data.get("persona_id")
    source = data.get("source") or "task_completion"
    title_limit = int(data.get("title_limit") or 80)
    fact_limit = int(data.get("fact_limit") or 200)
    combined = _normalize_text(f"{message_text} {response_text}")
    lowered = combined.casefold()
    threshold = _parse_float(write_policy.get("durable_write_threshold"), 0.85)

    if not write_policy.get("allow_auto_promote", True):
        return {
            "should_promote": False,
            "confidence": 0.0,
            "threshold": threshold,
            "reasons": ["auto_promote_disabled"],
            "normalized_entry": None,
        }

    reasons: list[str] = []
    positive_score = 0.0
    temporary_score = 0.0

    durable_hits = [hint for hint in DURABLE_HINTS if hint in lowered]
    temporary_hits = [hint for hint in TEMPORARY_HINTS if hint in lowered]

    if durable_hits:
        positive_score += min(0.55, 0.14 * len(durable_hits))
        reasons.append(f"durable_hints:{','.join(durable_hits[:4])}")

    if any(token in lowered for token in ("prefer", "偏好", "默认", "always", "始终")):
        positive_score += 0.2
        reasons.append("stable_preference_signal")

    if any(token in lowered for token in ("remember", "记住", "以后", "长期", "persist")):
        positive_score += 0.18
        reasons.append("explicit_memory_signal")

    if message_text and len(message_text) <= 160:
        positive_score += 0.05
        reasons.append("concise_preference_like_instruction")

    if temporary_hits:
        temporary_score += min(0.7, 0.2 * len(temporary_hits))
        reasons.append(f"temporary_hints:{','.join(temporary_hits[:4])}")

    if any(char.isdigit() for char in message_text) and any(token in lowered for token in ("点", "am", "pm", "tomorrow", "今天", "明天")):
        temporary_score += 0.2
        reasons.append("time_bound_instruction")

    confidence = max(0.0, min(1.0, positive_score - temporary_score + 0.35))
    should_promote = confidence >= threshold and temporary_score < positive_score

    if not should_promote:
        return {
            "should_promote": False,
            "confidence": _round(confidence),
            "threshold": threshold,
            "reasons": reasons or ["insufficient_stability_signal"],
            "normalized_entry": None,
        }

    def _truncate(text: str, limit: int) -> str:
        return text if len(text) <= limit else f"{text[: limit - 3]}..."

    title = _truncate(message_text or "Durable task memory", title_limit)
    facts = [_truncate(message_text, fact_limit)] if message_text else []
    if response_text:
        facts.append(_truncate(response_text, fact_limit))
    tags = ["durable", "session", persona_id or "persona"]
    summary = f"Durable instruction captured from task {task_id}"
    durable_key = "::".join([str(workspace_id or "global"), str(persona_id or "default"), title])

    return {
        "should_promote": True,
        "confidence": _round(confidence),
        "threshold": threshold,
        "reasons": reasons,
        "normalized_entry": {
            "task_id": task_id,
            "trace_id": trace_id,
            "title": title,
            "summary": summary,
            "facts": facts,
            "tags": tags,
            "source": source,
            "source_task_id": task_id,
            "source_trace_id": trace_id,
            "importance": 0.9,
            "workspace_id": workspace_id,
            "persona_id": persona_id,
            "metadata": {
                "workspace_id": workspace_id,
                "persona_id": persona_id,
                "plan_id": data.get("plan_id"),
                "durable_key": durable_key,
                "durable_confidence": _round(confidence),
                "promotion_reasons": reasons,
            },
        },
    }
