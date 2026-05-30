from __future__ import annotations

from typing import Any

from .shared import clone


DEFAULT_PERSONA_PACKS: list[dict[str, Any]] = [
    {
        "pack_id": "analysis_pack",
        "label": "Analysis Pack",
        "description": "Research-heavy reasoning with strong retrieval and evidence discipline.",
        "default_toolset_id": "analysis_toolset",
        "style": {"tone": "analytical", "verbosity": "medium"},
        "boundaries": ["do_not_invent_sources"],
        "preferred_tools": ["search_docs", "hybrid_retrieve"],
        "retrieval_policy": {"prefer_hybrid_rag": True, "citation_required": True},
        "memory_policy": {"prefer_long_term": True, "write_short_term_summary": True},
        "model_policy": {"tier": "high_reasoning"},
        "approval_policy": {"required_for_side_effects": True},
        "channel_policy": {"prefer_streaming": True},
        "metadata": {
            "focus": "evidence",
            "handoff_mode": "analysis",
        },
    },
    {
        "pack_id": "review_pack",
        "label": "Review Pack",
        "description": "Risk-first checking, verification, and quality-gate work.",
        "default_toolset_id": "review_toolset",
        "style": {"tone": "direct", "verbosity": "medium"},
        "boundaries": ["do_not_hide_risk", "do_not_skip_verification"],
        "preferred_tools": ["search_docs"],
        "retrieval_policy": {"prefer_hybrid_rag": True, "citation_required": True},
        "memory_policy": {"prefer_long_term": True},
        "model_policy": {"tier": "high_reasoning"},
        "approval_policy": {"required_for_side_effects": True},
        "channel_policy": {"prefer_streaming": True},
        "metadata": {
            "focus": "risk",
            "handoff_mode": "review",
        },
    },
    {
        "pack_id": "operations_pack",
        "label": "Operations Pack",
        "description": "Execution-facing work with checkpoints, takeover, and approval awareness.",
        "default_toolset_id": "operations_toolset",
        "style": {"tone": "steady", "verbosity": "low"},
        "boundaries": ["do_not_skip_verification"],
        "preferred_tools": ["search_docs"],
        "retrieval_policy": {"prefer_hybrid_rag": True},
        "memory_policy": {"prefer_short_term": True},
        "model_policy": {"tier": "balanced"},
        "approval_policy": {"required_for_side_effects": True},
        "channel_policy": {"prefer_streaming": True},
        "metadata": {
            "focus": "execution",
            "handoff_mode": "operations",
        },
    },
    {
        "pack_id": "planning_pack",
        "label": "Planning Pack",
        "description": "Dependency-aware planning and decomposition.",
        "default_toolset_id": "planning_toolset",
        "style": {"tone": "structured", "verbosity": "medium"},
        "boundaries": ["do_not_skip_constraints"],
        "preferred_tools": ["search_docs"],
        "retrieval_policy": {"prefer_hybrid_rag": True},
        "memory_policy": {"prefer_long_term": True},
        "model_policy": {"tier": "high_reasoning"},
        "approval_policy": {"required_for_side_effects": True},
        "channel_policy": {"prefer_streaming": True},
        "metadata": {
            "focus": "decomposition",
            "handoff_mode": "planning",
        },
    },
    {
        "pack_id": "delivery_pack",
        "label": "Delivery Pack",
        "description": "Final response drafting, channel shaping, and user-facing output.",
        "default_toolset_id": "writing_toolset",
        "style": {"tone": "clear", "verbosity": "medium"},
        "boundaries": ["do_not_drop_citations"],
        "preferred_tools": ["search_docs"],
        "retrieval_policy": {"prefer_hybrid_rag": True, "citation_required": True},
        "memory_policy": {"prefer_short_term": True},
        "model_policy": {"tier": "balanced"},
        "approval_policy": {"required_for_side_effects": True},
        "channel_policy": {"prefer_streaming": True},
        "metadata": {
            "focus": "delivery",
            "handoff_mode": "writing",
        },
    },
]

DEFAULT_TOOLSETS: list[dict[str, Any]] = [
    {
        "toolset_id": "analysis_toolset",
        "label": "Analysis Toolset",
        "description": "Stable retrieval and planning tools for research-oriented personas.",
        "allowed_permissions": ["read_docs", "read_wiki"],
        "required_capabilities": ["retrieval"],
        "allowed_release_channels": ["stable"],
        "allow_side_effects": False,
        "enabled": True,
        "release_channel": "stable",
        "capabilities": ["retrieval", "planning"],
    },
    {
        "toolset_id": "review_toolset",
        "label": "Review Toolset",
        "description": "Read-only verification and evidence inspection tools.",
        "allowed_permissions": ["read_docs", "read_wiki"],
        "required_capabilities": ["retrieval"],
        "allowed_release_channels": ["stable"],
        "allow_side_effects": False,
        "enabled": True,
        "release_channel": "stable",
        "capabilities": ["retrieval", "verification"],
    },
    {
        "toolset_id": "operations_toolset",
        "label": "Operations Toolset",
        "description": "Operational tools that may require side-effect-aware execution.",
        "allowed_permissions": ["read_docs", "read_wiki", "write_state"],
        "required_capabilities": ["operations"],
        "allowed_release_channels": ["stable", "beta"],
        "allow_side_effects": True,
        "enabled": True,
        "release_channel": "stable",
        "capabilities": ["operations", "retrieval"],
    },
    {
        "toolset_id": "planning_toolset",
        "label": "Planning Toolset",
        "description": "Planning and decomposition helpers with stable retrieval support.",
        "allowed_permissions": ["read_docs"],
        "required_capabilities": ["planning"],
        "allowed_release_channels": ["stable"],
        "allow_side_effects": False,
        "enabled": True,
        "release_channel": "stable",
        "capabilities": ["planning"],
    },
    {
        "toolset_id": "writing_toolset",
        "label": "Writing Toolset",
        "description": "Response drafting helpers with limited retrieval access.",
        "allowed_permissions": ["read_docs"],
        "required_capabilities": ["delivery"],
        "allowed_release_channels": ["stable"],
        "allow_side_effects": False,
        "enabled": True,
        "release_channel": "stable",
        "capabilities": ["delivery"],
    },
]


DEFAULT_PERSONAS: list[dict[str, Any]] = [
    {
        "persona_id": "researcher",
        "pack_id": "analysis_pack",
        "name": "Researcher",
        "purpose": "Decompose requests, gather context, and produce structured plans",
        "metadata": {
            "role_type": "generalist",
            "specialist_profile": "analysis_generalist",
        },
    },
    {
        "persona_id": "retriever",
        "pack_id": "analysis_pack",
        "name": "Retriever",
        "purpose": "Collect stable and dynamic evidence with explicit citations",
        "preferred_tools": ["search_docs", "hybrid_retrieve"],
        "metadata": {
            "role_type": "specialist",
            "specialist_profile": "retrieval_specialist",
            "default_handoff_role": "retriever",
        },
    },
    {
        "persona_id": "reviewer",
        "pack_id": "review_pack",
        "name": "Reviewer",
        "purpose": "Prioritize risks, gaps, regressions, and missing tests",
        "tool_access_policy": {
            "allowed_permissions": ["read_docs", "read_wiki"],
            "allow_side_effects": False,
            "allow_unlisted_tools": True,
            "disallowed_tools": [],
        },
        "metadata": {
            "role_type": "specialist",
            "specialist_profile": "quality_reviewer",
            "default_handoff_role": "reviewer",
        },
    },
    {
        "persona_id": "operator",
        "pack_id": "operations_pack",
        "name": "Operator",
        "purpose": "Execute procedural steps and report progress clearly",
        "metadata": {
            "role_type": "specialist",
            "specialist_profile": "operations_operator",
            "default_handoff_role": "operator",
        },
    },
    {
        "persona_id": "planner",
        "pack_id": "planning_pack",
        "name": "Planner",
        "purpose": "Turn broad goals into staged execution plans with explicit checkpoints",
        "metadata": {
            "role_type": "specialist",
            "specialist_profile": "plan_architect",
            "default_handoff_role": "planner",
        },
    },
    {
        "persona_id": "writer",
        "pack_id": "delivery_pack",
        "name": "Writer",
        "purpose": "Convert gathered evidence and plans into clear final responses",
        "metadata": {
            "role_type": "specialist",
            "specialist_profile": "response_writer",
            "default_handoff_role": "writer",
        },
    },
]


def _merge_lists(*values: Any) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, list):
            continue
        for item in value:
            text = str(item)
            if text not in seen:
                seen.add(text)
                result.append(text)
    return result


def _merge_objects(*values: Any) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for value in values:
        if isinstance(value, dict):
            merged.update(clone(value))
    return merged


def _normalize_style(*styles: Any) -> dict[str, str]:
    merged = _merge_objects(*styles)
    return {
        "tone": str(merged.get("tone") or "neutral"),
        "verbosity": str(merged.get("verbosity") or "medium"),
    }


def _normalize_toolset(toolset: dict[str, Any]) -> dict[str, Any]:
    return {
        "toolset_id": str(toolset.get("toolset_id") or "default_toolset"),
        "label": str(toolset.get("label") or "Toolset"),
        "description": str(toolset.get("description") or "toolset defaults"),
        "allowed_permissions": _merge_lists(toolset.get("allowed_permissions")),
        "required_capabilities": _merge_lists(toolset.get("required_capabilities")),
        "allowed_release_channels": _merge_lists(toolset.get("allowed_release_channels")) or ["stable"],
        "allow_side_effects": bool(toolset.get("allow_side_effects", True)),
        "enabled": bool(toolset.get("enabled", True)),
        "release_channel": str(toolset.get("release_channel") or "stable"),
        "capabilities": _merge_lists(toolset.get("capabilities")),
        "egress_allowlist": _merge_objects(toolset.get("egress_allowlist")),
        "metadata": _merge_objects(toolset.get("metadata")),
    }


def _normalize_toolsets(toolsets: Any = None) -> list[dict[str, Any]]:
    source = toolsets if isinstance(toolsets, list) and toolsets else DEFAULT_TOOLSETS
    return [_normalize_toolset(item if isinstance(item, dict) else {}) for item in source]


def _normalize_persona_pack(pack: dict[str, Any]) -> dict[str, Any]:
    return {
        "pack_id": str(pack.get("pack_id") or "analysis_pack"),
        "label": str(pack.get("label") or "Persona Pack"),
        "description": str(pack.get("description") or "persona defaults"),
        "default_toolset_id": str(pack.get("default_toolset_id") or "analysis_toolset"),
        "style": _normalize_style(pack.get("style")),
        "boundaries": _merge_lists(pack.get("boundaries")),
        "preferred_tools": _merge_lists(pack.get("preferred_tools")),
        "disallowed_tools": _merge_lists(pack.get("disallowed_tools")),
        "retrieval_policy": _merge_objects(pack.get("retrieval_policy")),
        "memory_policy": _merge_objects(pack.get("memory_policy")),
        "model_policy": _merge_objects(pack.get("model_policy")),
        "approval_policy": _merge_objects(pack.get("approval_policy")),
        "channel_policy": _merge_objects({"prefer_streaming": True}, pack.get("channel_policy")),
        "metadata": _merge_objects(pack.get("metadata")),
    }


def _normalize_persona_packs(packs: Any = None) -> list[dict[str, Any]]:
    source = packs if isinstance(packs, list) and packs else DEFAULT_PERSONA_PACKS
    return [_normalize_persona_pack(item if isinstance(item, dict) else {}) for item in source]


def _normalize_persona_profile(
    persona: dict[str, Any],
    pack_map: dict[str, dict[str, Any]],
    toolset_map: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    requested_pack_id = str(persona.get("pack_id") or "analysis_pack")
    pack = pack_map.get(requested_pack_id) or next(iter(pack_map.values()))
    pack_metadata = pack.get("metadata") if isinstance(pack, dict) else {}
    persona_metadata = persona.get("metadata") if isinstance(persona.get("metadata"), dict) else {}
    merged_metadata = _merge_objects(pack_metadata, persona_metadata)
    merged_metadata.update({
        "pack_id": pack["pack_id"],
        "pack_label": pack["label"],
        "default_toolset_id": pack["default_toolset_id"],
        "role_type": str(merged_metadata.get("role_type") or "generalist"),
        "specialist_profile": str(merged_metadata.get("specialist_profile") or merged_metadata.get("role_type") or "generalist"),
    })
    tool_access_policy = _merge_objects(
        {"toolset_id": pack["default_toolset_id"]},
        pack.get("tool_access_policy"),
        persona.get("tool_access_policy"),
    )
    if tool_access_policy:
        toolset_id = str(tool_access_policy.get("toolset_id") or pack["default_toolset_id"])
        active_toolset = toolset_map.get(toolset_id) or {}
        tool_access_policy["toolset_id"] = toolset_id
        tool_access_policy["allow_side_effects"] = bool(
            tool_access_policy.get("allow_side_effects", active_toolset.get("allow_side_effects", True))
        )
        tool_access_policy.setdefault("allow_unlisted_tools", True)
        tool_access_policy["allowed_permissions"] = _merge_lists(
            tool_access_policy.get("allowed_permissions"),
            active_toolset.get("allowed_permissions"),
        )
        tool_access_policy["allowed_tools"] = _merge_lists(tool_access_policy.get("allowed_tools"))
        tool_access_policy["disallowed_tools"] = _merge_lists(tool_access_policy.get("disallowed_tools"))
        tool_access_policy["allowed_release_channels"] = _merge_lists(
            tool_access_policy.get("allowed_release_channels"),
            active_toolset.get("allowed_release_channels"),
        )
        tool_access_policy["required_capabilities"] = _merge_lists(
            tool_access_policy.get("required_capabilities"),
            active_toolset.get("required_capabilities"),
        )
        tool_access_policy["egress_allowlist"] = _merge_objects(
            active_toolset.get("egress_allowlist"),
            tool_access_policy.get("egress_allowlist"),
        )

    return {
        "persona_id": str(persona.get("persona_id") or "researcher"),
        "name": str(persona.get("name") or "Researcher"),
        "purpose": str(persona.get("purpose") or "general persona"),
        "style": _normalize_style(pack.get("style"), persona.get("style")),
        "boundaries": _merge_lists(pack.get("boundaries"), persona.get("boundaries")),
        "preferred_tools": _merge_lists(pack.get("preferred_tools"), persona.get("preferred_tools")),
        "disallowed_tools": _merge_lists(pack.get("disallowed_tools"), persona.get("disallowed_tools")),
        "retrieval_policy": _merge_objects(pack.get("retrieval_policy"), persona.get("retrieval_policy")),
        "memory_policy": _merge_objects(pack.get("memory_policy"), persona.get("memory_policy")),
        "model_policy": _merge_objects(pack.get("model_policy"), persona.get("model_policy")),
        "approval_policy": _merge_objects(pack.get("approval_policy"), persona.get("approval_policy")),
        "tool_access_policy": tool_access_policy,
        "channel_policy": _merge_objects({"prefer_streaming": True}, pack.get("channel_policy"), persona.get("channel_policy")),
        "active": bool(persona.get("active", True)),
        "metadata": merged_metadata,
    }


def _normalize_personas(personas: Any = None, packs: Any = None, toolsets: Any = None) -> list[dict[str, Any]]:
    pack_list = _normalize_persona_packs(packs)
    pack_map = {pack["pack_id"]: pack for pack in pack_list}
    toolset_list = _normalize_toolsets(toolsets)
    toolset_map = {toolset["toolset_id"]: toolset for toolset in toolset_list}
    source = personas if isinstance(personas, list) and personas else DEFAULT_PERSONAS
    return [
        _normalize_persona_profile(item if isinstance(item, dict) else {}, pack_map, toolset_map)
        for item in source
    ]


def list_persona_packs(payload: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    return _normalize_persona_packs((payload or {}).get("packs"))


def list_personas(payload: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    data = payload or {}
    return _normalize_personas(data.get("personas"), data.get("packs"), data.get("toolsets"))


def describe_persona_catalog(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or {}
    packs = _normalize_persona_packs(data.get("packs"))
    toolsets = _normalize_toolsets(data.get("toolsets"))
    personas = _normalize_personas(data.get("personas"), packs, toolsets)
    return {
        "default_persona_id": "researcher",
        "packs": packs,
        "personas": personas,
        "toolsets": toolsets,
    }


def resolve_persona(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or {}
    persona_id = str(data.get("persona_id") or "researcher")
    personas = _normalize_personas(data.get("personas"), data.get("packs"), data.get("toolsets"))
    persona_map = {persona["persona_id"]: persona for persona in personas}
    return persona_map.get(persona_id) or persona_map.get("researcher") or personas[0]
