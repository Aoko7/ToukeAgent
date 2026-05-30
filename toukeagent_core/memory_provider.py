from __future__ import annotations

from typing import Any

from .shared import clone


DEFAULT_MEMORY_PROVIDERS: dict[str, dict[str, Any]] = {
    "local_builtin": {
        "provider": "local_builtin",
        "label": "Local builtin memory",
        "mode": "local",
        "persistence": "process_local",
        "enabled": True,
        "available": True,
        "workspace_isolated": True,
        "persona_isolated": True,
        "capabilities": {
            "short_term": True,
            "long_term": True,
            "durable_persistence": False,
            "semantic_recall": False,
            "compression_reuse": True,
        },
    },
    "mem0_compatible": {
        "provider": "mem0_compatible",
        "label": "Mem0-compatible memory",
        "mode": "external",
        "persistence": "durable_remote",
        "enabled": True,
        "available": True,
        "workspace_isolated": True,
        "persona_isolated": True,
        "capabilities": {
            "short_term": True,
            "long_term": True,
            "durable_persistence": True,
            "semantic_recall": True,
            "compression_reuse": True,
        },
    },
}


def _pick(source: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in source:
            return source[key]
    return default


def _bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _normalize_capabilities(defaults: dict[str, Any], overrides: dict[str, Any] | None) -> dict[str, bool]:
    source = overrides if isinstance(overrides, dict) else {}
    return {
        "short_term": _bool(_pick(source, "short_term", "shortTerm"), bool(defaults.get("short_term"))),
        "long_term": _bool(_pick(source, "long_term", "longTerm"), bool(defaults.get("long_term"))),
        "durable_persistence": _bool(
            _pick(source, "durable_persistence", "durablePersistence"),
            bool(defaults.get("durable_persistence")),
        ),
        "semantic_recall": _bool(
            _pick(source, "semantic_recall", "semanticRecall"),
            bool(defaults.get("semantic_recall")),
        ),
        "compression_reuse": _bool(
            _pick(source, "compression_reuse", "compressionReuse"),
            bool(defaults.get("compression_reuse")),
        ),
    }


def _normalize_provider(provider_id: str, defaults: dict[str, Any], overrides: dict[str, Any] | None) -> dict[str, Any]:
    source = overrides if isinstance(overrides, dict) else {}
    return {
        "provider": provider_id,
        "label": str(_pick(source, "label", default=defaults.get("label") or provider_id)),
        "mode": str(
            _pick(
                source,
                "mode",
                default=defaults.get("mode") or ("local" if provider_id == "local_builtin" else "external"),
            )
        ),
        "persistence": str(_pick(source, "persistence", default=defaults.get("persistence") or "process_local")),
        "enabled": _bool(_pick(source, "enabled"), bool(defaults.get("enabled", True))),
        "available": _bool(_pick(source, "available"), bool(defaults.get("available", True))),
        "workspace_isolated": _bool(
            _pick(source, "workspace_isolated", "workspaceIsolated"),
            bool(defaults.get("workspace_isolated", True)),
        ),
        "persona_isolated": _bool(
            _pick(source, "persona_isolated", "personaIsolated"),
            bool(defaults.get("persona_isolated", True)),
        ),
        "capabilities": _normalize_capabilities(
            defaults.get("capabilities") if isinstance(defaults.get("capabilities"), dict) else {},
            source.get("capabilities") if isinstance(source.get("capabilities"), dict) else {},
        ),
        "metadata": clone(source.get("metadata") or {}),
    }


def _normalize_fallback_entry(entry: Any) -> dict[str, Any]:
    if isinstance(entry, str):
        source = {"provider": entry}
    elif isinstance(entry, dict):
        source = entry
    else:
        source = {}
    provider_id = str(source.get("provider") or "local_builtin")
    return {
        "provider": provider_id,
        "reason": str(source.get("reason") or ("local_recovery" if provider_id == "local_builtin" else "provider_fallback")),
    }


def _coerce_runtime_provider_status(value: Any) -> dict[str, Any]:
    if isinstance(value, bool):
        return {"available": value}
    if isinstance(value, str):
        return {"available": False, "reason": value}
    if isinstance(value, dict):
        return clone(value)
    return {}


def _runtime_provider_status(
    provider_id: str,
    provider: dict[str, Any],
    runtime: dict[str, Any] | None,
) -> dict[str, Any]:
    runtime_source = runtime if isinstance(runtime, dict) else {}
    provider_status = runtime_source.get("provider_status")
    if isinstance(provider_status, dict) and provider_id in provider_status:
        return _coerce_runtime_provider_status(provider_status.get(provider_id))
    capabilities = provider.get("capabilities") if isinstance(provider.get("capabilities"), dict) else {}
    if capabilities.get("durable_persistence") and "durable_backend_available" in runtime_source:
        return {
            "available": _bool(runtime_source.get("durable_backend_available"), True),
            "reason": runtime_source.get("durable_backend_reason"),
        }
    return {}


def _provider_unavailability_reason(
    provider_id: str,
    providers: dict[str, dict[str, Any]],
    runtime: dict[str, Any] | None = None,
) -> str | None:
    if provider_id == "local_builtin":
        return None

    provider = providers.get(provider_id) or {}
    runtime_status = _runtime_provider_status(provider_id, provider, runtime)
    runtime_enabled = runtime_status.get("enabled")
    if runtime_enabled is not None and not _bool(runtime_enabled, True):
        return str(runtime_status.get("reason") or "provider_disabled")
    runtime_available = runtime_status.get("available")
    if runtime_available is not None and not _bool(runtime_available, True):
        return str(runtime_status.get("reason") or "provider_unavailable")
    if not _bool(provider.get("enabled"), True):
        return "provider_disabled"
    if provider.get("available") is False:
        return "provider_unavailable"
    return None


def normalize_memory_provider_config(config: dict[str, Any] | None = None) -> dict[str, Any]:
    source = config if isinstance(config, dict) else {}
    selected_provider = str(_pick(source, "provider", default="local_builtin"))
    source_providers = source.get("providers") if isinstance(source.get("providers"), dict) else {}

    provider_ids = set(DEFAULT_MEMORY_PROVIDERS.keys()) | set(source_providers.keys()) | {selected_provider, "local_builtin"}
    providers = {
        provider_id: _normalize_provider(
            provider_id,
            DEFAULT_MEMORY_PROVIDERS.get(provider_id, {}),
            source_providers.get(provider_id),
        )
        for provider_id in sorted(provider_ids)
    }

    fallback_source = _pick(source, "fallback_chain", "fallbackChain")
    fallback_source = fallback_source if isinstance(fallback_source, list) else None
    fallback_chain = [_normalize_fallback_entry(item) for item in (fallback_source or [{"provider": "local_builtin"}])]
    if not any(entry.get("provider") == "local_builtin" for entry in fallback_chain):
        fallback_chain.append({"provider": "local_builtin", "reason": "local_recovery"})

    write_policy_source = _pick(source, "write_policy", "writePolicy", default={})
    retrieval_policy_source = _pick(source, "retrieval_policy", "retrievalPolicy", default={})
    compression_policy_source = _pick(source, "compression_policy", "compressionPolicy", default={})
    write_policy = write_policy_source if isinstance(write_policy_source, dict) else {}
    retrieval_policy = retrieval_policy_source if isinstance(retrieval_policy_source, dict) else {}
    compression_policy = compression_policy_source if isinstance(compression_policy_source, dict) else {}

    return {
        "provider": selected_provider,
        "providers": providers,
        "fallback_chain": fallback_chain,
        "write_policy": {
            "allow_auto_promote": _bool(
                _pick(write_policy, "allow_auto_promote", "allowAutoPromote"),
                True,
            ),
            "durable_write_threshold": float(
                _pick(write_policy, "durable_write_threshold", "durableWriteThreshold", default=0.85) or 0.85
            ),
            "require_verification": _bool(
                _pick(write_policy, "require_verification", "requireVerification"),
                True,
            ),
        },
        "retrieval_policy": {
            "default_top_k": int(_pick(retrieval_policy, "default_top_k", "defaultTopK", default=4) or 4),
            "prefer_long_term": _bool(
                _pick(retrieval_policy, "prefer_long_term", "preferLongTerm"),
                True,
            ),
            "stale_after_hours": int(
                _pick(retrieval_policy, "stale_after_hours", "staleAfterHours", default=168) or 168
            ),
        },
        "compression_policy": {
            "allow_snapshot_reuse": _bool(
                _pick(compression_policy, "allow_snapshot_reuse", "allowSnapshotReuse"),
                True,
            ),
            "require_must_keep": _bool(
                _pick(compression_policy, "require_must_keep", "requireMustKeep"),
                True,
            ),
        },
    }


def resolve_memory_provider_runtime(
    config: dict[str, Any] | None = None,
    runtime: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized = normalize_memory_provider_config(config)
    providers = normalized["providers"]
    requested_provider = str(normalized.get("provider") or "local_builtin")
    if requested_provider not in providers:
        requested_provider = "local_builtin"
    requested = providers.get(requested_provider) or providers["local_builtin"]
    unavailable_reason = _provider_unavailability_reason(requested_provider, providers, runtime)
    fallback_applied = unavailable_reason is not None
    fallback_reason = unavailable_reason
    effective_provider = requested_provider

    if fallback_applied:
        fallback_candidates = [entry.get("provider") for entry in normalized["fallback_chain"] if entry.get("provider")]
        if "local_builtin" not in fallback_candidates:
            fallback_candidates.append("local_builtin")
        for candidate_id in fallback_candidates:
            if not _provider_unavailability_reason(candidate_id, providers, runtime):
                effective_provider = candidate_id
                break
        else:
            effective_provider = "local_builtin"

    effective = providers.get(effective_provider) or providers["local_builtin"]

    fallback_labels = [entry.get("provider") for entry in normalized["fallback_chain"] if entry.get("provider")]
    summary = (
        f"memory provider {requested_provider} "
        f"({requested.get('mode')}, {requested.get('persistence')}) "
        f"with fallback {' -> '.join(fallback_labels)}"
    )
    if fallback_applied:
        summary = (
            f"memory provider {requested_provider} -> {effective_provider} "
            f"(fallback: {fallback_reason}) "
            f"with fallback {' -> '.join(fallback_labels)}"
        )

    return {
        "provider": requested_provider,
        "provider_label": requested.get("label"),
        "requested_provider": requested_provider,
        "requested_provider_label": requested.get("label"),
        "effective_provider": effective_provider,
        "effective_provider_label": effective.get("label"),
        "mode": effective.get("mode"),
        "persistence": effective.get("persistence"),
        "workspace_isolated": effective.get("workspace_isolated"),
        "persona_isolated": effective.get("persona_isolated"),
        "capabilities": clone(effective.get("capabilities") or {}),
        "requested_capabilities": clone(requested.get("capabilities") or {}),
        "effective_capabilities": clone(effective.get("capabilities") or {}),
        "fallback_chain": clone(normalized["fallback_chain"]),
        "fallback_applied": fallback_applied,
        "fallback_reason": fallback_reason,
        "providers": clone(providers),
        "write_policy": clone(normalized["write_policy"]),
        "retrieval_policy": clone(normalized["retrieval_policy"]),
        "compression_policy": clone(normalized["compression_policy"]),
        "summary": summary,
    }


def describe_memory_provider_strategy(
    config: dict[str, Any] | None = None,
    runtime: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return resolve_memory_provider_runtime(config, runtime)
