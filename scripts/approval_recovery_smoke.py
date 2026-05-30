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
    trace_id = f"trace_approval_smoke_{uuid4().hex[:10]}"
    message_id = f"msg_approval_smoke_{uuid4().hex[:10]}"
    return {
        "message_id": message_id,
        "source_platform": "web",
        "source_message_id": f"raw_{message_id}",
        "workspace_id": "ws_approval_smoke",
        "channel_id": "console",
        "conversation_id": f"conv_approval_{uuid4().hex[:8]}",
        "sender": {"id": "approval_user", "role": "user"},
        "recipient": {"id": "agent_1", "role": "agent"},
        "content": [{"type": "text", "text": "请先审批这个高风险操作，然后继续执行。"}],
        "trace_id": trace_id,
        "persona_hint": "researcher",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify approval, takeover, and recovery flows.")
    parser.add_argument("--base-url", default="http://127.0.0.1:3000", help="Platform base URL")
    parser.add_argument("--timeout", type=float, default=45.0, help="Timeout in seconds")
    args = parser.parse_args()

    started_at = time.time()
    base_url = args.base_url.rstrip("/")
    payload = build_message_payload()

    try:
        initial = request_json(f"{base_url}/api/messages", method="POST", body=payload, timeout=args.timeout)
        approvals = request_json(f"{base_url}/api/approvals?task_id={payload['trace_id']}", timeout=args.timeout)
        takeover = request_json(
            f"{base_url}/api/tasks/takeover",
            method="POST",
            body={
                "task_id": payload["trace_id"],
                "reviewer_id": "operator_smoke",
                "notes": "Smoke takeover before recovery resume",
            },
            timeout=args.timeout,
        )
        recovered = request_json(
            f"{base_url}/api/tasks/recover",
            method="POST",
            body={
                "task_id": payload["trace_id"],
                "mode": "resume",
                "reviewer_id": "operator_smoke",
                "notes": "Smoke recovery resume",
                "decision": "approved",
            },
            timeout=args.timeout,
        )
        drills = request_json(f"{base_url}/api/recovery/drills?task_id={payload['trace_id']}", timeout=args.timeout)
        replay = request_json(f"{base_url}/api/replay?task_id={payload['trace_id']}", timeout=args.timeout)
    except urllib.error.HTTPError as error:
        sys.stderr.write(f"HTTP error {error.code}: {error.reason}\n")
        return 1
    except urllib.error.URLError as error:
        sys.stderr.write(f"Connection error: {error.reason}\n")
        return 1

    approval_items = approvals.get("items") or []
    review_id = approval_items[0]["review_id"] if approval_items else None
    recovered_run = recovered.get("run_state") or {}
    summary = {
        "ok": (
            initial.get("approval_required") is True and
            initial.get("run_state", {}).get("status") == "waiting_approval" and
            len(approval_items) == 1 and
            takeover.get("task", {}).get("status") == "taken_over" and
            recovered_run.get("status") == "completed" and
            len(drills.get("items") or []) >= 1 and
            len(replay.get("stream_events") or []) > 0
        ),
        "request": {
            "trace_id": payload["trace_id"],
            "message_id": payload["message_id"],
        },
        "approval": {
            "initial_status": initial.get("run_state", {}).get("status"),
            "approval_required": initial.get("approval_required"),
            "plan_step_count": len(initial.get("plan", {}).get("steps") or []),
            "review_id": review_id,
            "queue_size": len(approval_items),
            "takeover_status": takeover.get("task", {}).get("status"),
        },
        "recovery": {
            "run_status": recovered_run.get("status"),
            "quality_status": (recovered.get("quality_gate") or {}).get("status"),
            "drill_count": len(drills.get("items") or []),
            "replay_event_count": len(replay.get("stream_events") or []),
        },
        "elapsed_ms": round((time.time() - started_at) * 1000, 2),
    }
    json.dump(summary, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
