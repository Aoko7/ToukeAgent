#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
LOCAL_CONFIG = ROOT / "config" / "model-config.local.json"
EXAMPLE_CONFIG = ROOT / "config" / "model-config.example.json"


def read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def redact_key(value: str | None) -> str | None:
    if not value:
        return None
    return f"{value[:3]}...{value[-4:]}" if len(value) >= 8 else "[set]"


def check_config() -> dict[str, Any]:
    local = read_json(LOCAL_CONFIG)
    example = read_json(EXAMPLE_CONFIG)
    local_key = (((local or {}).get("deepseek") or {}).get("apiKey")) if local else None
    example_key = (((example or {}).get("deepseek") or {}).get("apiKey")) if example else None
    example_placeholder = example_key in {None, "", "YOUR_DEEPSEEK_API_KEY_HERE"}
    return {
        "local_config_exists": LOCAL_CONFIG.exists(),
        "example_config_exists": EXAMPLE_CONFIG.exists(),
        "local_api_key_present": bool(local_key),
        "local_api_key_redacted": redact_key(local_key),
        "example_uses_placeholder": example_placeholder,
    }


def request_json(url: str, timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def check_health(base_url: str, timeout: float) -> dict[str, Any]:
    try:
        payload = request_json(f"{base_url.rstrip('/')}/api/health", timeout=timeout)
        return {
            "reachable": True,
            "ok": payload.get("ok"),
            "service": payload.get("service"),
            "model_provider": payload.get("model_provider"),
            "model": payload.get("model"),
            "config_source": payload.get("model_config_source"),
        }
    except urllib.error.URLError as error:
        return {
            "reachable": False,
            "ok": False,
            "error": str(error.reason),
        }


def run_script(script_name: str, *, timeout: float) -> dict[str, Any]:
    script_path = ROOT / "scripts" / script_name
    result = subprocess.run(
        [sys.executable, str(script_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    parsed = None
    if result.stdout.strip():
        try:
            parsed = json.loads(result.stdout)
        except json.JSONDecodeError:
            parsed = None
    return {
        "ok": result.returncode == 0,
        "returncode": result.returncode,
        "stdout": parsed,
        "stderr": result.stderr.strip() or None,
    }


def build_coverage_notes(smokes: dict[str, Any] | None) -> list[str]:
    if not smokes:
        return []

    notes: list[str] = []
    delivery = ((smokes.get("delivery") or {}).get("stdout") or {}).get("delivery") or {}
    payload_shapes = delivery.get("payload_shapes") or {}
    telegram = payload_shapes.get("telegram") or {}
    approval = ((smokes.get("approval_recovery") or {}).get("stdout") or {}).get("recovery") or {}
    restart = ((smokes.get("restart_recovery") or {}).get("stdout") or {}).get("recovery") or {}
    live = ((smokes.get("live") or {}).get("stdout") or {}).get("run") or {}
    wiki_first = ((smokes.get("wiki_first") or {}).get("stdout") or {}).get("retrieval") or {}
    stream = ((smokes.get("stream") or {}).get("stdout") or {}).get("stream") or {}
    reconnect = ((smokes.get("stream_reconnect") or {}).get("stdout") or {}).get("stream") or {}

    if telegram.get("has_media_group") is False:
        notes.append("delivery smoke 尚未覆盖 telegram 富媒体降级路径；当前只验证了基础文本/回执链路。")
    if approval.get("drill_count") == 1 and restart.get("drill_count", 0) < 1:
        notes.append("approval/recovery smoke 当前覆盖的是 approval pause -> recover(resume)；restart 模式仍主要依赖测试而非 live smoke。")
    if live.get("route_mode") == "rag-first" and wiki_first.get("route_mode") == "wiki-first":
        notes.append("wiki-first smoke 已额外覆盖 markdown notes 导入后的动态知识路径；live smoke 仍主要验证稳定主链。")
    elif live.get("route_mode") == "rag-first" and wiki_first.get("route_mode") != "wiki-first":
        notes.append("live smoke 当前主要验证稳定运行链路，尚未刻意压测 wiki-first 动态知识路径。")
    inflight = stream.get("inflight") or {}
    if inflight.get("raw_first_event") == "heartbeat" and reconnect.get("resume_last_event") != "done":
        notes.append("in-flight SSE 首帧通常是 heartbeat；这说明连接先建立成功，但也意味着当前 smoke 未对中途断线重连做压力验证。")

    return notes


def main() -> int:
    parser = argparse.ArgumentParser(description="Check ToukeAgent local runtime readiness.")
    parser.add_argument("--base-url", default="http://127.0.0.1:3000", help="Platform base URL")
    parser.add_argument("--timeout", type=float, default=45.0, help="Timeout in seconds for HTTP/script checks")
    parser.add_argument("--run-smokes", action="store_true", help="Also run live, stream, approval/recovery, and delivery smoke checks")
    args = parser.parse_args()

    config = check_config()
    health = check_health(args.base_url, args.timeout)
    smokes = None
    if args.run_smokes and health.get("reachable"):
        smokes = {
            "live": run_script("live_smoke.py", timeout=args.timeout),
            "stream": run_script("stream_smoke.py", timeout=args.timeout),
            "stream_reconnect": run_script("stream_reconnect_smoke.py", timeout=args.timeout),
            "approval_recovery": run_script("approval_recovery_smoke.py", timeout=args.timeout),
            "restart_recovery": run_script("restart_recovery_smoke.py", timeout=args.timeout),
            "wiki_first": run_script("wiki_first_smoke.py", timeout=args.timeout),
            "delivery": run_script("delivery_smoke.py", timeout=args.timeout),
        }
    coverage_notes = build_coverage_notes(smokes)

    summary = {
        "ok": (
            config["local_config_exists"] and
            config["local_api_key_present"] and
            config["example_uses_placeholder"] and
            health.get("ok") is True and
            (
                smokes is None or
                (
                    smokes["live"]["ok"]
                    and smokes["stream"]["ok"]
                    and smokes["stream_reconnect"]["ok"]
                    and smokes["approval_recovery"]["ok"]
                    and smokes["restart_recovery"]["ok"]
                    and smokes["wiki_first"]["ok"]
                    and smokes["delivery"]["ok"]
                )
            )
        ),
        "config": config,
        "health": health,
        "smokes": smokes,
        "coverage_notes": coverage_notes,
    }
    json.dump(summary, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
