#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import threading
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


def read_partial_sse(url: str, *, timeout: float, min_seq: int) -> list[dict]:
    events: list[dict] = []
    with urllib.request.urlopen(url, timeout=timeout) as response:
        current: dict[str, str | None] = {"event": None, "data": None, "id": None}
        for raw_line in response:
            line = raw_line.decode("utf-8").rstrip("\n")
            if not line.strip():
                event_type = current.get("event")
                data = current.get("data")
                if event_type:
                    parsed = {
                        "event": event_type,
                        "id": current.get("id"),
                        "data": json.loads(data) if data else None,
                    }
                    events.append(parsed)
                    seq = ((parsed.get("data") or {}).get("seq") if isinstance(parsed.get("data"), dict) else None)
                    if event_type != "heartbeat" and isinstance(seq, int) and seq >= min_seq:
                        break
                current = {"event": None, "data": None, "id": None}
                continue
            if line.startswith("event: "):
                current["event"] = line[len("event: "):]
            elif line.startswith("id: "):
                current["id"] = line[len("id: "):]
            elif line.startswith("data: "):
                payload = line[len("data: "):]
                current["data"] = payload if current.get("data") is None else f"{current['data']}\n{payload}"
    return events


def read_tail_sse(url: str, *, timeout: float) -> list[dict]:
    events: list[dict] = []
    with urllib.request.urlopen(url, timeout=timeout) as response:
        current: dict[str, str | None] = {"event": None, "data": None, "id": None}
        seen_terminal = False
        for raw_line in response:
            line = raw_line.decode("utf-8").rstrip("\n")
            if not line.strip():
                event_type = current.get("event")
                data = current.get("data")
                if event_type:
                    parsed = {
                        "event": event_type,
                        "id": current.get("id"),
                        "data": json.loads(data) if data else None,
                    }
                    events.append(parsed)
                    if seen_terminal and event_type == "heartbeat":
                        break
                    if event_type in {"done", "error", "cancel"}:
                        seen_terminal = True
                current = {"event": None, "data": None, "id": None}
                continue
            if line.startswith("event: "):
                current["event"] = line[len("event: "):]
            elif line.startswith("id: "):
                current["id"] = line[len("id: "):]
            elif line.startswith("data: "):
                payload = line[len("data: "):]
                current["data"] = payload if current.get("data") is None else f"{current['data']}\n{payload}"
    return events


def build_message_payload() -> dict:
    trace_id = f"trace_reconnect_smoke_{uuid4().hex[:10]}"
    message_id = f"msg_reconnect_smoke_{uuid4().hex[:10]}"
    return {
        "message_id": message_id,
        "source_platform": "web",
        "source_message_id": f"raw_{message_id}",
        "workspace_id": "ws_reconnect_smoke",
        "channel_id": "console",
        "conversation_id": f"conv_reconnect_{uuid4().hex[:8]}",
        "sender": {"id": "reconnect_user", "role": "user"},
        "recipient": {"id": "agent_1", "role": "agent"},
        "content": [{"type": "text", "text": "请输出足够详细的执行轨迹，以便测试流式断线重连。"}],
        "trace_id": trace_id,
        "persona_hint": "researcher",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify mid-stream disconnect and reconnect with last_seq.")
    parser.add_argument("--base-url", default="http://127.0.0.1:3000", help="Platform base URL")
    parser.add_argument("--timeout", type=float, default=45.0, help="Timeout in seconds")
    args = parser.parse_args()

    started_at = time.time()
    base_url = args.base_url.rstrip("/")
    payload = build_message_payload()
    partial_holder: dict[str, object] = {"events": None, "error": None}

    def worker() -> None:
        try:
            partial_holder["events"] = read_partial_sse(
                f"{base_url}/api/stream?task_id={payload['trace_id']}&last_seq=0",
                timeout=args.timeout,
                min_seq=6,
            )
        except Exception as error:  # pragma: no cover
            partial_holder["error"] = error

    try:
        thread = threading.Thread(target=worker, daemon=True)
        thread.start()
        time.sleep(0.2)
        result = request_json(f"{base_url}/api/messages", method="POST", body=payload, timeout=args.timeout)
        thread.join(args.timeout)
        if thread.is_alive():
            raise TimeoutError("partial stream did not finish before timeout")
        if partial_holder.get("error"):
            raise partial_holder["error"]  # type: ignore[misc]
        partial_events = partial_holder.get("events")
        if not isinstance(partial_events, list):
            raise RuntimeError("partial stream returned no events")
        partial_domain = [event for event in partial_events if event.get("event") != "heartbeat" and isinstance(event.get("data"), dict)]
        last_seq = partial_domain[-1]["data"]["seq"]
        resumed_events = read_tail_sse(
            f"{base_url}/api/stream?task_id={payload['trace_id']}&last_seq={last_seq}",
            timeout=args.timeout,
        )
    except urllib.error.HTTPError as error:
        sys.stderr.write(f"HTTP error {error.code}: {error.reason}\n")
        return 1
    except urllib.error.URLError as error:
        sys.stderr.write(f"Connection error: {error.reason}\n")
        return 1

    resumed_domain = [event for event in resumed_events if event.get("event") != "heartbeat" and isinstance(event.get("data"), dict)]
    summary = {
        "ok": (
            result.get("run_state", {}).get("status") == "completed" and
            len(partial_domain) >= 1 and
            partial_domain[0]["event"] == "start" and
            all(event["data"]["seq"] > last_seq for event in resumed_domain) and
            resumed_domain[-1]["event"] == "done"
        ),
        "request": {
            "trace_id": payload["trace_id"],
            "message_id": payload["message_id"],
        },
        "stream": {
            "partial_event_count": len(partial_domain),
            "disconnect_after_seq": last_seq,
            "resume_event_count": len(resumed_domain),
            "resume_first_seq": resumed_domain[0]["data"]["seq"] if resumed_domain else None,
            "resume_last_event": resumed_domain[-1]["event"] if resumed_domain else None,
        },
        "elapsed_ms": round((time.time() - started_at) * 1000, 2),
    }
    json.dump(summary, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
