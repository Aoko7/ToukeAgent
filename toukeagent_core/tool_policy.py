from __future__ import annotations

from typing import Any


def _as_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item)]


def _normalize_egress_allowlist(value: Any) -> dict[str, Any]:
    data = value if isinstance(value, dict) else {}
    bindings = (
        data.get("provider_host_bindings")
        or data.get("providerHostBindings")
        or data.get("bindings")
        or data.get("routes")
        or []
    )
    normalized_bindings: list[dict[str, Any]] = []
    if isinstance(bindings, list):
        for binding in bindings:
            if not isinstance(binding, dict):
                continue
            provider = str(binding.get("provider") or binding.get("service") or "*")
            hosts = _as_string_list(
                binding.get("hosts")
                or binding.get("domains")
                or ([binding.get("host")] if binding.get("host") else [])
            )
            if provider and hosts:
                normalized_bindings.append({
                    "provider": provider,
                    "hosts": hosts,
                })
    return {
        "hosts": _as_string_list(data.get("hosts") or data.get("domains")),
        "providers": _as_string_list(data.get("providers") or data.get("services")),
        "provider_host_bindings": normalized_bindings,
    }


def _normalize_tool_access_policy(policy: dict[str, Any] | None = None) -> dict[str, Any]:
    data = policy or {}
    return {
        "toolset_id": str(data.get("toolset_id") or "default_toolset"),
        "allowed_permissions": _as_string_list(data.get("allowed_permissions")),
        "allowed_tools": _as_string_list(data.get("allowed_tools")),
        "disallowed_tools": _as_string_list(data.get("disallowed_tools")),
        "allow_side_effects": bool(data.get("allow_side_effects", True)),
        "allow_unlisted_tools": bool(data.get("allow_unlisted_tools", True)),
        "allowed_release_channels": _as_string_list(data.get("allowed_release_channels")),
        "required_capabilities": _as_string_list(data.get("required_capabilities")),
        "egress_allowlist": _normalize_egress_allowlist(data.get("egress_allowlist")),
    }


def evaluate_tool_access(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or {}
    definition = data.get("definition") or {}
    request = data.get("request") or {}
    policy = _normalize_tool_access_policy(
        request.get("access_policy") if isinstance(request, dict) else data.get("access_policy")
    )

    tool_name = str(definition.get("tool_name") or request.get("tool_name") or "")
    permissions = _as_string_list(definition.get("permissions"))
    side_effect_scope = str(definition.get("side_effect_scope") or "none")

    if tool_name and tool_name in policy["disallowed_tools"]:
        return {
            "allowed": False,
            "reason": "tool_disallowed",
            "summary": f"Tool {tool_name} is disallowed by the active tool access policy",
            "missing_permissions": [],
            "policy": policy,
        }

    allowed_tools = policy["allowed_tools"]
    if allowed_tools and not policy["allow_unlisted_tools"] and tool_name not in allowed_tools:
        return {
            "allowed": False,
            "reason": "tool_not_in_allowlist",
            "summary": f"Tool {tool_name} is not present in the active tool allowlist",
            "missing_permissions": [],
            "policy": policy,
        }

    allowed_permissions = set(policy["allowed_permissions"])
    missing_permissions = [item for item in permissions if item not in allowed_permissions]
    if missing_permissions:
        return {
            "allowed": False,
            "reason": "permission_denied",
            "summary": f"Tool {tool_name} requires permissions outside the active tool access policy",
            "missing_permissions": missing_permissions,
            "policy": policy,
        }

    if not policy["allow_side_effects"] and side_effect_scope not in {"none", "read_only"}:
        return {
            "allowed": False,
            "reason": "side_effect_not_allowed",
            "summary": f"Tool {tool_name} requests side effects that are not allowed by the active tool access policy",
            "missing_permissions": [],
            "policy": policy,
        }

    release_channel = str(definition.get("release_channel") or "stable")
    allowed_release_channels = policy["allowed_release_channels"]
    if allowed_release_channels and release_channel not in allowed_release_channels:
        return {
            "allowed": False,
            "reason": "tool_release_channel_blocked",
            "summary": f"Tool {tool_name} is on release channel {release_channel}, which is not enabled for the active toolset",
            "missing_permissions": [],
            "policy": policy,
        }

    capabilities = set(_as_string_list(definition.get("capabilities")))
    required_capabilities = policy["required_capabilities"]
    missing_capabilities = [item for item in required_capabilities if item not in capabilities]
    if missing_capabilities:
        return {
            "allowed": False,
            "reason": "tool_capability_mismatch",
            "summary": f"Tool {tool_name} does not satisfy the required capabilities of the active toolset",
            "missing_permissions": [],
            "missing_capabilities": missing_capabilities,
            "policy": policy,
        }

    return {
        "allowed": True,
        "reason": "ok",
        "summary": "Tool access policy check passed",
        "missing_permissions": [],
        "missing_capabilities": [],
        "policy": policy,
    }


def build_tool_policy(definition: dict[str, Any]) -> dict[str, Any]:
    explicit = definition.get("retry_policy") or {}
    retryable_by_default = bool(definition.get("idempotent")) and definition.get("risk_level") in ("low", "medium")
    max_attempts = explicit.get("max_attempts")
    if isinstance(max_attempts, (int, float)):
        max_attempts = max(1, int(max_attempts))
    else:
        max_attempts = 2 if retryable_by_default else 1
    backoff_ms = explicit.get("backoff_ms")
    if isinstance(backoff_ms, (int, float)):
        backoff_ms = max(0, int(backoff_ms))
    else:
        backoff_ms = 0
    retry_on = explicit.get("retry_on")
    if not isinstance(retry_on, list) or not retry_on:
        retry_on = ["error", "timeout"]
    return {
        "max_attempts": max_attempts,
        "backoff_ms": backoff_ms,
        "retry_on": [str(item) for item in retry_on],
    }


def evaluate_tool_attempt(payload: dict[str, Any]) -> dict[str, Any]:
    definition = payload.get("definition") or {}
    policy = payload.get("policy") or build_tool_policy(definition)
    attempt = int(payload.get("attempt") or 0)
    status = str(payload.get("status") or "error")
    extra = payload.get("extra") or {}
    blocked_error_codes = {
        "approval_required",
        "network_access_blocked",
        "network_egress_blocked",
        "filesystem_scope_blocked",
        "filesystem_path_blocked",
        "shell_access_blocked",
    }
    error_code = str(extra.get("error_code") or "")
    blocked_by_policy = error_code in blocked_error_codes
    should_retry = (
        attempt < int(policy.get("max_attempts") or 1)
        and status in (policy.get("retry_on") or [])
        and not blocked_by_policy
    )
    metrics = {
        "timeout_ms": definition.get("timeout_ms"),
        "attempt_count": attempt,
        "retry_count": max(0, attempt - 1),
        "risk_level": definition.get("risk_level"),
        "idempotent": bool(definition.get("idempotent")),
        "policy_max_attempts": policy.get("max_attempts"),
        "policy_retry_on": list(policy.get("retry_on") or []),
        "blocked_by_policy": blocked_by_policy,
        **extra,
    }
    return {
        "should_retry": should_retry,
        "metrics": metrics,
        "policy": policy,
    }
