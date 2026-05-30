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
        return json.loads(response.read().decode("utf-8"))


def build_message_payload() -> dict:
    trace_id = f"trace_restart_smoke_{uuid4().hex[:10]}"
    message_id = f"msg_restart_smoke_{uuid4().hex[:10]}"
    return {
        "message_id": message_id,
        "source_platform": "web",
        "source_message_id": f"raw_{message_id}",
        "workspace_id": "ws_restart_smoke",
        "channel_id": "console",
        "conversation_id": f"conv_restart_{uuid4().hex[:8]}",
        "sender": {"id": "restart_user", "role": "user"},
        "recipient": {"id": "agent_1", "role": "agent"},
        "content": [{"type": "text", "text": "请回放并恢复这个任务。"}],
        "trace_id": trace_id,
        "persona_hint": "researcher",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify restart-mode recovery via live HTTP endpoints.")
    parser.add_argument("--base-url", default="http://127.0.0.1:3000", help="Platform base URL")
    parser.add_argument("--timeout", type=float, default=45.0, help="Timeout in seconds")
    args = parser.parse_args()

    started_at = time.time()
    base_url = args.base_url.rstrip("/")
    payload = build_message_payload()

    try:
        initial = request_json(f"{base_url}/api/messages", method="POST", body=payload, timeout=args.timeout)
        replay_before = request_json(f"{base_url}/api/replay?task_id={payload['trace_id']}", timeout=args.timeout)
        recovered = request_json(
            f"{base_url}/api/tasks/recover",
            method="POST",
            body={
                "task_id": payload["trace_id"],
                "mode": "restart",
                "reviewer_id": "operator_restart",
                "notes": "Smoke restart recovery",
            },
            timeout=args.timeout,
        )
        drills = request_json(f"{base_url}/api/recovery/drills?task_id={payload['trace_id']}", timeout=args.timeout)
        replay_after = request_json(f"{base_url}/api/replay?task_id={payload['trace_id']}", timeout=args.timeout)
    except urllib.error.HTTPError as error:
        sys.stderr.write(f"HTTP error {error.code}: {error.reason}\n")
        return 1
    except urllib.error.URLError as error:
        sys.stderr.write(f"Connection error: {error.reason}\n")
        return 1

    replay_before_count = len(replay_before.get("stream_events") or [])
    replay_after_count = len(replay_after.get("stream_events") or [])
    drill_items = drills.get("items") or []
    recovery_drill = recovered.get("recovery_drill") or {}
    summary = {
        "ok": (
            initial.get("run_state", {}).get("status") == "completed" and
            recovered.get("run_state", {}).get("status") == "completed" and
            recovery_drill.get("status") == "completed" and
            len(drill_items) >= 1 and
            replay_after_count > replay_before_count
        ),
        "request": {
            "trace_id": payload["trace_id"],
            "message_id": payload["message_id"],
        },
        "recovery": {
            "mode": "restart",
            "initial_run_status": initial.get("run_state", {}).get("status"),
            "recovered_run_status": recovered.get("run_state", {}).get("status"),
            "drill_status": recovery_drill.get("status"),
            "drill_count": len(drill_items),
            "replay_before_count": replay_before_count,
            "replay_after_count": replay_after_count,
        },
        "elapsed_ms": round((time.time() - started_at) * 1000, 2),
    }
    json.dump(summary, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
