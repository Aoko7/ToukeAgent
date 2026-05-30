from __future__ import annotations

from typing import Any


DEFAULT_RESPONSE_POLICY = {
    "citation_required": True,
    "grounding_mode": "compact_evidence_pack",
    "clarification_first": False,
    "max_parent_items": 3,
    "max_supporting_chunks_per_item": 2,
    "max_supporting_chunks_total": 4,
    "max_snippet_chars": 280,
    "max_evidence_chars": 1400,
    "include_quality_summary": True,
    "include_clarification_questions": True,
}


def _normalize_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _truncate(value: Any, limit: int) -> str:
    text = _normalize_text(value)
    if limit <= 3:
        return text[:limit]
    return f"{text[: limit - 3]}..." if len(text) > limit else text


def _join_memory(entries: list[dict[str, Any]] | None, *, title_only: bool = False) -> str:
    entries = entries or []
    values = []
    for entry in entries:
        value = entry.get("title") if title_only else (entry.get("summary") or entry.get("title"))
        if value:
            values.append(str(value))
    return " | ".join(values) if values else "none"


def _join_titles(items: list[dict[str, Any]] | None) -> str:
    items = items or []
    titles = []
    for item in items:
        title = item.get("title")
        source_type = item.get("source_type") or "context"
        if title:
            titles.append(f"{title} ({source_type})")
    return ", ".join(titles) if titles else "internal stable context"


def _extract_message_text(message: dict[str, Any]) -> str:
    return "\n".join(
        str(part.get("text", ""))
        for part in (message.get("content") or [])
        if isinstance(part, dict) and part.get("type") == "text"
    ).strip()


def _coerce_int(value: Any, default: int) -> int:
    try:
        coerced = int(value)
    except (TypeError, ValueError):
        return default
    return coerced if coerced > 0 else default


def _build_response_policy(retrieval_result: dict[str, Any], query_analysis: dict[str, Any]) -> dict[str, Any]:
    response_policy = (
        ((retrieval_result.get("retrieval_plan") or {}).get("response_policy") or {})
        if isinstance(retrieval_result, dict)
        else {}
    )
    clarification_required = bool((query_analysis.get("clarification") or {}).get("required"))
    policy = {
        **DEFAULT_RESPONSE_POLICY,
        **response_policy,
    }
    if "clarification_first" not in response_policy:
        policy["clarification_first"] = clarification_required
    policy["max_parent_items"] = _coerce_int(policy.get("max_parent_items"), DEFAULT_RESPONSE_POLICY["max_parent_items"])
    policy["max_supporting_chunks_per_item"] = _coerce_int(
        policy.get("max_supporting_chunks_per_item"),
        DEFAULT_RESPONSE_POLICY["max_supporting_chunks_per_item"],
    )
    policy["max_supporting_chunks_total"] = _coerce_int(
        policy.get("max_supporting_chunks_total"),
        DEFAULT_RESPONSE_POLICY["max_supporting_chunks_total"],
    )
    policy["max_snippet_chars"] = _coerce_int(policy.get("max_snippet_chars"), DEFAULT_RESPONSE_POLICY["max_snippet_chars"])
    policy["max_evidence_chars"] = _coerce_int(policy.get("max_evidence_chars"), DEFAULT_RESPONSE_POLICY["max_evidence_chars"])
    policy["citation_required"] = bool(policy.get("citation_required", True))
    policy["include_quality_summary"] = bool(policy.get("include_quality_summary", True))
    policy["include_clarification_questions"] = bool(policy.get("include_clarification_questions", True))
    return policy


def _route_mode_label(route: dict[str, Any]) -> str:
    requested = str(route.get("mode") or route.get("requested_mode") or "rag-first")
    effective = str(route.get("effective_mode") or requested)
    if route.get("fallback_applied") and effective != requested:
        return f"{requested} -> {effective} (fallback)"
    return effective


def _query_summary(query_analysis: dict[str, Any]) -> tuple[str, str, bool]:
    query_mode = str(query_analysis.get("query_mode") or "lookup")
    boundary = query_analysis.get("boundary") or {}
    boundary_action = str(boundary.get("action") or "answer")
    clarification_required = bool((query_analysis.get("clarification") or {}).get("required"))
    return query_mode, boundary_action, clarification_required


def _format_quality_summary(quality: dict[str, Any] | None) -> str:
    quality = quality or {}
    parts = []
    if quality.get("retrieval_score") is not None:
        parts.append(f"retrieval={quality.get('retrieval_score')}")
    if quality.get("citation_score") is not None:
        parts.append(f"citation={quality.get('citation_score')}")
    if quality.get("route_alignment_score") is not None:
        parts.append(f"route_alignment={quality.get('route_alignment_score')}")
    if quality.get("recommended_action"):
        parts.append(f"recommended={quality.get('recommended_action')}")
    return " | ".join(parts) if parts else "none"


def _format_citations(citations: list[dict[str, Any]] | None, *, limit: int = 3) -> str:
    citations = citations or []
    parts = []
    for citation in citations[:limit]:
        title = _normalize_text(citation.get("title"))
        if not title:
            continue
        source_type = citation.get("source_type") or "context"
        freshness = citation.get("freshness") or "unknown"
        score = citation.get("score")
        suffix = f"{source_type}, {freshness}"
        if score is not None:
            suffix += f", score={score}"
        parts.append(f"{title} [{suffix}]")
    return " | ".join(parts) if parts else "none"


def _chunk_identity(chunk: dict[str, Any], parent: dict[str, Any] | None = None) -> str:
    parent = parent or {}
    return "|".join(
        [
            str(chunk.get("chunk_id") or chunk.get("id") or ""),
            str(chunk.get("doc_id") or parent.get("doc_id") or ""),
            str(chunk.get("title") or parent.get("title") or ""),
            str(chunk.get("section") or ""),
            _normalize_text(chunk.get("snippet") or chunk.get("text") or ""),
        ]
    )


def _format_evidence_line(parent: dict[str, Any], chunk: dict[str, Any], *, max_snippet_chars: int) -> str | None:
    snippet = _normalize_text(chunk.get("snippet") or chunk.get("text") or "")
    if not snippet:
        return None
    title = _normalize_text(parent.get("title") or chunk.get("title") or parent.get("doc_id") or "Untitled source")
    source_type = parent.get("source_type") or chunk.get("source_type") or "context"
    freshness = parent.get("freshness") or chunk.get("freshness") or "unknown"
    section_path = [
        _normalize_text(part)
        for part in list(chunk.get("section_path") or [])
        if _normalize_text(part)
    ]
    section = _normalize_text(chunk.get("section") or (section_path[-1] if section_path else ""))
    score = chunk.get("score") or parent.get("aggregate_score") or parent.get("score")
    detail = [source_type, freshness]
    if section:
        detail.append(f"section={section}")
    if score is not None:
        detail.append(f"score={score}")
    return f"- {title} [{' | '.join(detail)}] {_truncate(snippet, max_snippet_chars)}"


def _pack_evidence(retrieval_result: dict[str, Any], policy: dict[str, Any]) -> tuple[list[str], list[str], int, list[dict[str, Any]]]:
    items = list(retrieval_result.get("items") or [])
    evidence_lines: list[str] = []
    evidence_refs: list[str] = []
    selected_parents: list[dict[str, Any]] = []
    seen: set[str] = set()
    selected_parent_ids: set[str] = set()
    total_chars = 0
    total_chunks = 0

    for parent in items[: policy["max_parent_items"]]:
        supporting_chunks = list(parent.get("supporting_chunks") or [])
        item_count = 0
        for chunk in supporting_chunks:
            if item_count >= policy["max_supporting_chunks_per_item"]:
                break
            if total_chunks >= policy["max_supporting_chunks_total"]:
                break
            identity = _chunk_identity(chunk, parent)
            if identity in seen:
                continue
            line = _format_evidence_line(parent, chunk, max_snippet_chars=policy["max_snippet_chars"])
            if not line:
                continue
            if total_chars + len(line) > policy["max_evidence_chars"]:
                remaining = policy["max_evidence_chars"] - total_chars
                if remaining < 48:
                    continue
                smaller_limit = max(32, min(policy["max_snippet_chars"], remaining // 2))
                line = _format_evidence_line(parent, chunk, max_snippet_chars=smaller_limit)
                if not line or total_chars + len(line) > policy["max_evidence_chars"]:
                    continue
            evidence_lines.append(line)
            evidence_refs.append(str(chunk.get("chunk_id") or chunk.get("id") or parent.get("doc_id") or parent.get("entry_id") or title_safe(parent)))
            parent_id = str(parent.get("doc_id") or parent.get("entry_id") or title_safe(parent))
            if parent_id not in selected_parent_ids:
                selected_parents.append(parent)
                selected_parent_ids.add(parent_id)
            seen.add(identity)
            total_chars += len(line)
            total_chunks += 1
            item_count += 1

    if evidence_lines:
        return evidence_lines, evidence_refs, total_chars, selected_parents

    fallback_chunks = list(retrieval_result.get("supporting_chunks") or [])
    for chunk in fallback_chunks:
        if total_chunks >= policy["max_supporting_chunks_total"]:
            break
        identity = _chunk_identity(chunk)
        if identity in seen:
            continue
        pseudo_parent = {
            "title": chunk.get("title"),
            "doc_id": chunk.get("doc_id"),
            "entry_id": chunk.get("entry_id"),
            "source_type": chunk.get("source_type"),
            "freshness": chunk.get("freshness"),
            "aggregate_score": chunk.get("score"),
        }
        line = _format_evidence_line(pseudo_parent, chunk, max_snippet_chars=policy["max_snippet_chars"])
        if not line:
            continue
        if total_chars + len(line) > policy["max_evidence_chars"]:
            break
        evidence_lines.append(line)
        evidence_refs.append(str(chunk.get("chunk_id") or chunk.get("id") or chunk.get("doc_id") or chunk.get("entry_id") or "evidence"))
        parent_id = str(pseudo_parent.get("doc_id") or pseudo_parent.get("entry_id") or title_safe(pseudo_parent))
        if parent_id not in selected_parent_ids:
            selected_parents.append(pseudo_parent)
            selected_parent_ids.add(parent_id)
        seen.add(identity)
        total_chars += len(line)
        total_chunks += 1

    return evidence_lines, evidence_refs, total_chars, selected_parents


def title_safe(item: dict[str, Any]) -> str:
    return _normalize_text(item.get("title") or "source").replace(" ", "_").lower()


def draft_response(payload: dict[str, Any]) -> dict[str, Any]:
    persona = payload.get("persona") or {}
    plan = payload.get("plan") or {}
    retrieval_result = payload.get("retrievalResult") or payload.get("retrieval_result") or {}
    message = payload.get("message") or {}
    memory_snapshot = payload.get("memorySnapshot") or payload.get("memory_snapshot") or {}

    text = _extract_message_text(message)
    route = retrieval_result.get("route") or {}
    route_mode = _route_mode_label(route)
    query_analysis = retrieval_result.get("query_analysis") or {}
    query_mode, boundary_action, clarification_required = _query_summary(query_analysis)
    policy = _build_response_policy(retrieval_result, query_analysis)
    quality = retrieval_result.get("quality") or {}
    quality_summary = _format_quality_summary(quality) if policy["include_quality_summary"] else "omitted"
    recommended_action = _normalize_text(quality.get("recommended_action") or "accept")
    citation_summary = _format_citations(retrieval_result.get("citations") or [], limit=policy["max_parent_items"])
    evidence_lines, evidence_refs, evidence_char_count, selected_parents = _pack_evidence(retrieval_result, policy)
    source_titles = _join_titles(selected_parents or (retrieval_result.get("items") or [])[: policy["max_parent_items"]])
    clarification = query_analysis.get("clarification") or {}
    clarification_questions = [
        _normalize_text(question)
        for question in list(clarification.get("questions") or [])
        if _normalize_text(question)
    ][:3]
    short_term = _join_memory(memory_snapshot.get("short_term") or [])
    long_term = _join_memory(memory_snapshot.get("long_term") or [], title_only=False)

    plan_summary = " | ".join(
        f"{index + 1}. {step.get('title')}"
        for index, step in enumerate(plan.get("steps") or [])
    )
    evidence_block = "\n".join(evidence_lines) if evidence_lines else "- none"
    clarification_block = " | ".join(clarification_questions) if clarification_questions else "none"
    next_move = (
        "ask the shortest necessary clarification question before answering"
        if policy["clarification_first"] and clarification_required
        else f'start from the smallest verified grounded answer for "{text}".'
    )

    local_content = "\n".join(
        [
            f"[{persona.get('name')}]",
            f"Goal: {plan.get('goal')}",
            f"Plan: {plan_summary}",
            f"Retrieval route: {route_mode}",
            f"Query mode: {query_mode}",
            f"Boundary action: {boundary_action}",
            f"Context: {source_titles}",
            f"Citations: {citation_summary}",
            f"Retrieval quality: {quality_summary}",
            f"Recommended action: {recommended_action}",
            f"Clarification questions: {clarification_block}",
            "Evidence pack:",
            evidence_block,
            f"Short-term memory: {short_term}",
            f"Long-term memory: {long_term}",
            f"Next move: {next_move}",
        ]
    )

    system_parts = [
        f"You are {persona.get('name')}.",
        f"Follow the persona purpose: {persona.get('purpose')}.",
        "Respond in the user's language, be concise, and preserve the plan trace.",
        "Use the retrieval evidence pack when relevant and do not invent facts beyond it.",
        "Prefer grounded claims tied to the cited sources.",
    ]
    if policy["clarification_first"] and clarification_required:
        system_parts.append("If clarification is required, ask a focused clarification question before attempting an answer.")
    elif quality.get("recommended_action") and quality.get("recommended_action") != "accept":
        system_parts.append("If the evidence looks incomplete, be explicit about uncertainty and what source should be supplemented.")
    if policy["citation_required"]:
        system_parts.append("Retain source awareness when answering and avoid dropping relevant citation context.")
    system_prompt = " ".join(system_parts)

    user_prompt_lines = [
        f"User request: {text}",
        f"Goal: {plan.get('goal')}",
        f"Plan: {plan_summary}",
        f"Retrieval route: {route_mode}",
        f"Query mode: {query_mode}",
        f"Boundary action: {boundary_action}",
        f"Context: {source_titles}",
        f"Citations: {citation_summary}",
        f"Retrieval quality: {quality_summary}",
        f"Recommended action: {recommended_action}",
    ]
    if policy["include_clarification_questions"]:
        user_prompt_lines.append(f"Clarification questions: {clarification_block}")
    user_prompt_lines.extend(
        [
            "Evidence pack:",
            evidence_block,
            f"Short-term memory: {short_term}",
            f"Long-term memory: {long_term}",
            f"Grounding mode: {policy.get('grounding_mode')}",
            f"Evidence refs: {' | '.join(evidence_refs) if evidence_refs else 'none'}",
            f"Evidence chars used: {evidence_char_count}",
        ]
    )

    return {
        "content": local_content,
        "messages": [
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": "\n".join(user_prompt_lines),
            },
        ],
        "fallback": {
            "applied": False,
            "reason": None,
            "strategy": None,
        },
        "route_mode": route_mode,
        "response_policy": policy,
    }
