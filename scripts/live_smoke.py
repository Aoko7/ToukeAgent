#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from uuid import uuid4


def request_json(url: str, *, method: str = "GET", body: dict | None = None, timeout: float = 30.0) -> dict:
    data = None
    headers = {"accept": "application/json"}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["content-type"] = "application/json"

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = response.read().decode("utf-8")
    return json.loads(payload)


def build_message_payload(text: str, *, persona_hint: str, source_platform: str, conversation_id: str | None = None) -> dict:
    trace_id = f"trace_smoke_{uuid4().hex[:10]}"
    message_id = f"msg_smoke_{uuid4().hex[:10]}"
    conversation = conversation_id or f"conv_smoke_{uuid4().hex[:8]}"
    return {
        "message_id": message_id,
        "source_platform": source_platform,
        "source_message_id": f"raw_{message_id}",
        "workspace_id": "ws_smoke",
        "channel_id": "console",
        "conversation_id": conversation,
        "sender": {"id": "smoke_user", "role": "user"},
        "recipient": {"id": "agent_1", "role": "agent"},
        "content": [{"type": "text", "text": text}],
        "trace_id": trace_id,
        "persona_hint": persona_hint,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a localhost ToukeAgent smoke test.")
    parser.add_argument("--base-url", default="http://127.0.0.1:3000", help="Platform base URL")
    parser.add_argument("--persona", default="researcher", help="Persona hint for the test request")
    parser.add_argument(
        "--message",
        default="请用中文简要介绍你当前的多Agent协调策略与RAG路线。",
        help="User message content to send through /api/messages",
    )
    parser.add_argument("--source-platform", default="web", help="Canonical source platform id")
    parser.add_argument("--timeout", type=float, default=45.0, help="Request timeout in seconds")
    args = parser.parse_args()

    started_at = time.time()
    health_url = f"{args.base_url.rstrip('/')}/api/health"
    messages_url = f"{args.base_url.rstrip('/')}/api/messages"
    payload = build_message_payload(
        args.message,
        persona_hint=args.persona,
        source_platform=args.source_platform,
    )

    try:
        health = request_json(health_url, timeout=args.timeout)
        result = request_json(messages_url, method="POST", body=payload, timeout=args.timeout)
    except urllib.error.HTTPError as error:
        sys.stderr.write(f"HTTP error {error.code}: {error.reason}\n")
        return 1
    except urllib.error.URLError as error:
        sys.stderr.write(f"Connection error: {error.reason}\n")
        return 1

    run_state = result.get("run_state") or {}
    retrieval_step = next(
        (
            step
            for step in (run_state.get("step_results") or [])
            if isinstance(step, dict) and isinstance(step.get("output"), dict) and "route" in step["output"]
        ),
        {},
    )
    route = (retrieval_step.get("output") or {}).get("route", {})
    quality_gate = result.get("quality_gate") or {}
    governance = (result.get("governance") or {}).get("metrics") or {}
    output = run_state.get("output") or {}
    summary = {
        "ok": bool(health.get("ok")) and run_state.get("status") == "completed",
        "health": {
            "service": health.get("service"),
            "model_provider": health.get("model_provider"),
            "model": health.get("model"),
            "config_source": health.get("model_config_source"),
        },
        "request": {
            "trace_id": payload["trace_id"],
            "message_id": payload["message_id"],
            "persona_hint": payload["persona_hint"],
        },
        "run": {
            "status": run_state.get("status"),
            "completed_steps": run_state.get("completed_steps"),
            "total_steps": run_state.get("total_steps"),
            "route_mode": route.get("mode"),
            "effective_mode": route.get("effective_mode"),
            "fallback_applied": route.get("fallback_applied"),
            "quality_score": quality_gate.get("score"),
            "quality_status": quality_gate.get("status"),
            "tool_call_count": governance.get("tool_call_count"),
            "estimated_cost_units": governance.get("estimated_cost_units"),
            "duration_ms": governance.get("task_duration_ms"),
        },
        "response_preview": str(output.get("final_text") or "")[:160],
        "elapsed_ms": round((time.time() - started_at) * 1000, 2),
    }
    json.dump(summary, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
