from __future__ import annotations

from typing import Any

QUALITY_HINTS = (
    "deep",
    "detailed",
    "thorough",
    "rigorous",
    "careful",
    "analyze",
    "research",
    "复杂",
    "详细",
    "深入",
    "严谨",
    "分析",
    "研究",
)

LATENCY_HINTS = (
    "quick",
    "fast",
    "brief",
    "short",
    "summary",
    "马上",
    "快速",
    "简短",
    "简洁",
    "一句话",
)


def normalize_text(value: Any) -> str:
    return " ".join(str(value or "").split())


def infer_budget_tier(metadata: dict[str, Any] | None = None) -> str:
    metadata = metadata or {}
    value = str(metadata.get("budget_tier") or metadata.get("budgetTier") or "balanced").lower()
    if value in ("low", "economy", "cheap"):
        return "economy"
    if value in ("high", "premium", "best"):
        return "premium"
    return "balanced"


def infer_quality_tier(text: str, metadata: dict[str, Any] | None = None, risk_flags: list[str] | None = None) -> str:
    metadata = metadata or {}
    risk_flags = risk_flags or []
    explicit = str(metadata.get("quality_tier") or metadata.get("qualityTier") or "").lower()
    if explicit in ("high", "premium", "strict"):
        return "high"
    if explicit in ("low", "draft"):
        return "low"
    lowered = normalize_text(text).lower()
    if "requires_approval" in risk_flags or any(hint in lowered for hint in QUALITY_HINTS):
        return "high"
    return "balanced"


def infer_latency_tier(text: str, metadata: dict[str, Any] | None = None) -> str:
    metadata = metadata or {}
    explicit = str(metadata.get("latency_tier") or metadata.get("latencyTier") or "").lower()
    if explicit in ("high", "urgent", "realtime"):
        return "high"
    if explicit in ("low", "background"):
        return "low"
    lowered = normalize_text(text).lower()
    return "high" if any(hint in lowered for hint in LATENCY_HINTS) else "balanced"


def estimate_token_demand(
    text: str,
    memory_snapshot: dict[str, Any] | None = None,
    plan: dict[str, Any] | None = None,
    retrieval_result: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> int:
    memory_snapshot = memory_snapshot or {}
    plan = plan or {}
    retrieval_result = retrieval_result or {}
    metadata = metadata or {}
    context_token_estimate = metadata.get("context_token_estimate")
    if isinstance(context_token_estimate, (int, float)):
        return int(context_token_estimate)
    text_tokens = (len(normalize_text(text)) + 3) // 4
    plan_tokens = len(plan.get("steps") or []) * 120
    short_term_tokens = len(memory_snapshot.get("short_term") or []) * 80
    long_term_tokens = len(memory_snapshot.get("long_term") or []) * 120
    retrieval_items = (
        ((retrieval_result.get("result") or {}).get("items"))
        or retrieval_result.get("items")
        or []
    )
    retrieval_tokens = len(retrieval_items) * 160
    return text_tokens + plan_tokens + short_term_tokens + long_term_tokens + retrieval_tokens


def choose_profile(budget_tier: str, quality_tier: str, latency_tier: str, token_estimate: int) -> str:
    if budget_tier == "economy" or latency_tier == "high":
        return "fast"
    if quality_tier == "high" or token_estimate >= 6000:
        return "deep"
    return "balanced"


def normalize_profile(source: dict[str, Any] | None = None, fallback: dict[str, Any] | None = None) -> dict[str, Any]:
    source = source or {}
    fallback = fallback or {}
    return {
        "provider": source.get("provider", fallback.get("provider")),
        "model": source.get("model", fallback.get("model")),
        "reasoning_effort": source.get("reasoningEffort")
        or source.get("reasoning_effort")
        or fallback.get("reasoning_effort")
        or "medium",
        "budget_tier": source.get("budgetTier")
        or source.get("budget_tier")
        or fallback.get("budget_tier")
        or "balanced",
    }


def normalize_profiles(
    source_profiles: dict[str, Any] | None,
    default_reasoning_effort: str,
    primary_model: str,
    primary_provider: str,
) -> dict[str, Any]:
    source_profiles = source_profiles or {}
    defaults = {
        "fast": {
            "provider": primary_provider,
            "model": primary_model,
            "reasoning_effort": "low",
            "budget_tier": "economy",
        },
        "balanced": {
            "provider": primary_provider,
            "model": primary_model,
            "reasoning_effort": default_reasoning_effort,
            "budget_tier": "balanced",
        },
        "deep": {
            "provider": primary_provider,
            "model": primary_model,
            "reasoning_effort": "high",
            "budget_tier": "premium",
        },
    }
    merged = {**defaults, **source_profiles}
    normalized: dict[str, Any] = {}
    for name, profile in merged.items():
        normalized[name] = normalize_profile(
            profile,
            defaults.get(
                name,
                {
                    "provider": primary_provider,
                    "model": primary_model,
                    "reasoning_effort": default_reasoning_effort,
                    "budget_tier": "balanced",
                },
            ),
        )
    return normalized


def normalize_provider(
    source: dict[str, Any] | None = None,
    fallback: dict[str, Any] | None = None,
    provider_id: str = "unknown",
) -> dict[str, Any]:
    source = source or {}
    fallback = fallback or {}
    return {
        "provider": provider_id,
        "label": source.get("label") or fallback.get("label") or provider_id,
        "mode": source.get("mode")
        or fallback.get("mode")
        or ("local-compose" if provider_id == "local" else "remote"),
        "enabled": source.get("enabled", fallback.get("enabled", True)),
        "available": source.get("available", fallback.get("available")),
        "model": source.get("model", fallback.get("model")),
        "reasoning_effort": source.get("reasoningEffort")
        or source.get("reasoning_effort")
        or fallback.get("reasoning_effort"),
    }


def normalize_providers(
    source_providers: dict[str, Any] | None,
    primary_provider: str,
    primary_model: str,
    default_reasoning_effort: str,
    is_primary_configured: bool,
) -> dict[str, Any]:
    source_providers = source_providers or {}
    defaults: dict[str, Any] = {
        primary_provider: {
            "provider": primary_provider,
            "label": f"{primary_provider} primary",
            "mode": "remote",
            "enabled": True,
            "available": is_primary_configured,
            "model": primary_model,
            "reasoning_effort": default_reasoning_effort,
        },
        "local": {
            "provider": "local",
            "label": "local compose",
            "mode": "local-compose",
            "enabled": True,
            "available": True,
            "model": None,
            "reasoning_effort": "none",
        },
    }
    for provider_id in source_providers:
        if provider_id not in defaults:
            defaults[provider_id] = {
                "provider": provider_id,
                "label": provider_id,
                "mode": "remote",
                "enabled": True,
                "available": False,
                "model": None,
                "reasoning_effort": None,
            }
    merged = {**defaults, **source_providers}
    return {
        name: normalize_provider(provider, defaults.get(name, {}), name)
        for name, provider in merged.items()
    }


def normalize_fallback_entry(
    source: dict[str, Any] | None = None,
    fallback: dict[str, Any] | None = None,
) -> dict[str, Any]:
    source = source or {}
    fallback = fallback or {}
    provider_id = source.get("provider") or fallback.get("provider") or "local"
    return {
        "provider": provider_id,
        "label": source.get("label") or fallback.get("label") or provider_id,
        "strategy": source.get("strategy")
        or source.get("mode")
        or fallback.get("strategy")
        or fallback.get("mode")
        or ("local-compose" if provider_id == "local" else "remote"),
        "mode": source.get("mode")
        or fallback.get("mode")
        or ("local-compose" if provider_id == "local" else "remote"),
        "enabled": source.get("enabled", fallback.get("enabled", True)),
    }


def normalize_fallback_chain(source: list[Any] | None, fallback: dict[str, Any] | None) -> list[dict[str, Any]]:
    base = source if isinstance(source, list) and source else [fallback or {"provider": "local", "strategy": "local-compose", "mode": "local-compose"}]
    entries = []
    for index, entry in enumerate(base):
        if entry is None:
            continue
        normalized = normalize_fallback_entry(
            {"provider": entry} if isinstance(entry, str) else entry,
            fallback if index == 0 else {},
        )
        entries.append(normalized)
    return entries or [normalize_fallback_entry({"provider": "local", "strategy": "local-compose", "mode": "local-compose"})]


def build_model_policy(payload: dict[str, Any]) -> dict[str, Any]:
    provider = payload.get("provider", "deepseek")
    primary_model = payload.get("primaryModel", "deepseek-v4-flash")
    default_reasoning_effort = payload.get("defaultReasoningEffort", "medium")
    is_primary_configured = bool(payload.get("isPrimaryConfigured", False))
    profiles = normalize_profiles(payload.get("profiles"), default_reasoning_effort, primary_model, provider)
    providers = normalize_providers(
        payload.get("providers"),
        provider,
        primary_model,
        default_reasoning_effort,
        is_primary_configured,
    )
    fallback_chain = normalize_fallback_chain(payload.get("fallbackChain"), payload.get("fallback"))
    return {
        "provider": provider,
        "primary_model": primary_model,
        "default_reasoning_effort": default_reasoning_effort,
        "fallback": fallback_chain[0],
        "fallback_chain": fallback_chain,
        "providers": providers,
        "profiles": profiles,
    }


def dedupe_providers(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    items: list[str] = []
    for value in values:
        key = str(value or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        items.append(key)
    return items


def is_provider_available(provider: dict[str, Any] | None) -> bool:
    if not provider:
        return False
    if provider.get("enabled") is False:
        return False
    if provider.get("available") is False:
        return False
    return True


def route_model(payload: dict[str, Any]) -> dict[str, Any]:
    policy = payload.get("policy") or build_model_policy(payload.get("config") or {})
    message = payload.get("message") or {}
    plan = payload.get("plan") or {}
    memory_snapshot = payload.get("memorySnapshot") or {}
    retrieval_result = payload.get("retrievalResult") or {}
    text = "\n".join(
        [*(part.get("text") for part in message.get("content", []) if isinstance(part, dict) and part.get("type") == "text"), plan.get("goal") or ""]
    ).strip()
    metadata = message.get("metadata") or {}
    risk_flags = [str(item).lower() for item in (message.get("risk_flags") or [])]
    token_estimate = estimate_token_demand(text, memory_snapshot, plan, retrieval_result, metadata)
    budget_tier = infer_budget_tier(metadata)
    quality_tier = infer_quality_tier(text, metadata, risk_flags)
    latency_tier = infer_latency_tier(text, metadata)
    forced_profile = str(metadata.get("model_profile") or "").lower() or None
    profiles = policy.get("profiles") or {}
    providers = policy.get("providers") or {}
    fallback_chain = policy.get("fallback_chain") or []
    profile = forced_profile if forced_profile and forced_profile in profiles else choose_profile(budget_tier, quality_tier, latency_tier, token_estimate)
    selected_profile = profiles.get(profile) or profiles.get("balanced") or {}
    force_local = metadata.get("force_local") is True
    preferred_provider_id = (
        "local"
        if force_local
        else str(metadata.get("model_provider")).lower()
        if metadata.get("model_provider")
        else (selected_profile.get("provider") or policy.get("provider") or "deepseek")
    )

    def get_provider_entry(provider_id: str) -> dict[str, Any] | None:
        return providers.get(provider_id)

    def find_fallback_entry(provider_id: str) -> dict[str, Any] | None:
        for entry in fallback_chain:
            if entry.get("provider") == provider_id:
                return entry
        return None

    if force_local:
        selected_provider_id = "local"
        provider_entry = get_provider_entry("local") or normalize_provider({}, {}, "local")
        fallback_entry = find_fallback_entry("local") or normalize_fallback_entry({"provider": "local", "strategy": "local-compose", "mode": "local-compose"})
        fallback_applied = True
        fallback_reason = "forced_local"
    else:
        selected_provider_id = "local"
        provider_entry = get_provider_entry("local") or normalize_provider({}, {"available": True}, "local")
        fallback_entry = find_fallback_entry("local") or normalize_fallback_entry({"provider": "local", "strategy": "local-compose", "mode": "local-compose"})
        fallback_applied = True
        fallback_reason = "primary_not_configured" if preferred_provider_id == policy.get("provider") else "provider_unavailable"
        candidates = dedupe_providers([preferred_provider_id, *[entry.get("provider") for entry in fallback_chain], "local"])
        for candidate_id in candidates:
            entry = get_provider_entry(candidate_id)
            if not is_provider_available(entry):
                continue
            selected_provider_id = candidate_id
            provider_entry = entry
            fallback_entry = find_fallback_entry(candidate_id)
            fallback_applied = candidate_id != preferred_provider_id
            fallback_reason = None if candidate_id == preferred_provider_id else ("primary_not_configured" if preferred_provider_id == policy.get("provider") else "provider_unavailable")
            break

    fallback_strategy = (fallback_entry or {}).get("strategy") or (provider_entry or {}).get("mode") or "local-compose"
    fallback_payload = {
        "provider": selected_provider_id if fallback_applied else None,
        "strategy": fallback_strategy if fallback_applied else ((fallback_chain[0] or {}).get("strategy") if fallback_chain else None),
        "applied": fallback_applied,
        "reason": fallback_reason,
        "preferred_provider": preferred_provider_id,
        "candidates": [{"provider": entry.get("provider"), "strategy": entry.get("strategy")} for entry in fallback_chain],
    }

    if (provider_entry or {}).get("mode") == "local-compose":
        return {
            "provider": selected_provider_id,
            "provider_label": (provider_entry or {}).get("label") or selected_provider_id,
            "mode": (provider_entry or {}).get("mode") or "local-compose",
            "model": None,
            "reasoning_effort": "none",
            "profile": profile,
            "token_estimate": token_estimate,
            "budget_tier": budget_tier,
            "quality_tier": quality_tier,
            "latency_tier": latency_tier,
            "selection_reason": (
                "message metadata forced local composition"
                if force_local
                else f"provider {preferred_provider_id} unavailable, using {selected_provider_id}"
                if fallback_applied
                else "selected local composition provider"
            ),
            "fallback": fallback_payload,
        }

    model_name = metadata.get("model_override") or selected_profile.get("model") or (provider_entry or {}).get("model") or policy.get("primary_model")
    reasoning_effort = metadata.get("reasoning_effort") or selected_profile.get("reasoning_effort") or (provider_entry or {}).get("reasoning_effort") or policy.get("default_reasoning_effort")
    return {
        "provider": selected_provider_id,
        "provider_label": (provider_entry or {}).get("label") or selected_provider_id,
        "mode": (provider_entry or {}).get("mode") or "remote",
        "model": model_name,
        "reasoning_effort": reasoning_effort,
        "profile": profile,
        "token_estimate": token_estimate,
        "budget_tier": budget_tier,
        "quality_tier": quality_tier,
        "latency_tier": latency_tier,
        "selection_reason": (
            f"profile={profile}, preferred_provider={preferred_provider_id}, routed_provider={selected_provider_id}, budget={budget_tier}, quality={quality_tier}, latency={latency_tier}, tokens={token_estimate}"
            if fallback_applied
            else f"profile={profile}, provider={selected_provider_id}, budget={budget_tier}, quality={quality_tier}, latency={latency_tier}, tokens={token_estimate}"
        ),
        "fallback": fallback_payload,
    }
