from __future__ import annotations

import re
from copy import deepcopy
from typing import Any


DYNAMIC_HINT_WEIGHTS = {
    "latest": 1.0,
    "today": 1.0,
    "status": 1.0,
    "version": 1.0,
    "pricing": 1.0,
    "price": 1.0,
    "release": 0.8,
    "owner": 0.8,
    "current": 0.35,
    "最新": 1.0,
    "今天": 1.0,
    "状态": 1.0,
    "版本": 1.0,
    "价格": 1.0,
    "进度": 0.8,
    "负责人": 0.8,
    "当前": 0.35,
}

DYNAMIC_HINTS = tuple(DYNAMIC_HINT_WEIGHTS.keys())

STABLE_HINT_WEIGHTS = {
    "architecture": 0.9,
    "design": 0.85,
    "workflow": 0.75,
    "delivery": 0.75,
    "rag": 0.75,
    "route": 0.65,
    "strategy": 0.65,
    "policy": 0.6,
    "manual": 0.55,
    "spec": 0.55,
    "docs": 0.45,
    "架构": 0.9,
    "设计": 0.85,
    "流程": 0.75,
    "交付": 0.75,
    "路线": 0.65,
    "策略": 0.65,
    "规范": 0.55,
    "手册": 0.55,
    "文档": 0.45,
}


def clone(value: Any) -> Any:
    return deepcopy(value)


def extract_user_text(message: dict[str, Any] | None) -> str:
    if not isinstance(message, dict):
        return ""
    parts = message.get("content") or []
    texts = []
    for part in parts:
        if isinstance(part, dict) and part.get("type") == "text":
            texts.append(str(part.get("text", "")))
    return "\n".join(texts).strip()


def summarize_goal(text: str) -> str:
    trimmed = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(trimmed) > 96:
        return f"{trimmed[:93]}..."
    return trimmed


def round_score(value: Any) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        numeric = 0.0
    return round(max(0.0, min(1.0, numeric)), 2)


def average(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def lower_text(value: Any) -> str:
    return str(value or "").lower()


def normalize_identifier(value: Any, fallback: str = "trace") -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", str(value or fallback))
