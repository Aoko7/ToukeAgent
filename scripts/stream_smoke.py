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


def read_sse(
    url: str,
    *,
    timeout: float,
    stop_events: set[str] | None = None,
    require_heartbeat_after_terminal: bool = False,
) -> list[dict]:
    stop_events = stop_events or {"done", "error", "cancel"}
    events: list[dict] = []
    seen_terminal = False
    with urllib.request.urlopen(url, timeout=timeout) as response:
        current_event: dict[str, str | None] = {"event": None, "data": None, "id": None}
        for raw_line in response:
            line = raw_line.decode("utf-8").rstrip("\n")
            if not line.strip():
                event_type = current_event.get("event")
                data = current_event.get("data")
                if event_type:
                    parsed = {
                        "event": event_type,
                        "id": current_event.get("id"),
                        "data": json.loads(data) if data else None,
                    }
                    events.append(parsed)
                    if seen_terminal and event_type == "heartbeat":
                        break
                    if event_type in stop_events:
                        if require_heartbeat_after_terminal:
                            seen_terminal = True
                        else:
                            break
                    elif seen_terminal and not require_heartbeat_after_terminal:
                        break
                current_event = {"event": None, "data": None, "id": None}
                continue
            if line.startswith("event: "):
                current_event["event"] = line[len("event: "):]
            elif line.startswith("id: "):
                current_event["id"] = line[len("id: "):]
            elif line.startswith("data: "):
                payload = line[len("data: "):]
                current_event["data"] = payload if current_event.get("data") is None else f"{current_event['data']}\n{payload}"
    return events


def build_message_payload(text: str, *, persona_hint: str, source_platform: str) -> dict:
    trace_id = f"trace_stream_{uuid4().hex[:10]}"
    message_id = f"msg_stream_{uuid4().hex[:10]}"
    return {
        "message_id": message_id,
        "source_platform": source_platform,
        "source_message_id": f"raw_{message_id}",
        "workspace_id": "ws_stream_smoke",
        "channel_id": "console",
        "conversation_id": f"conv_stream_{uuid4().hex[:8]}",
        "sender": {"id": "stream_user", "role": "user"},
        "recipient": {"id": "agent_1", "role": "agent"},
        "content": [{"type": "text", "text": text}],
        "trace_id": trace_id,
        "persona_hint": persona_hint,
    }


def summarize_events(events: list[dict]) -> dict:
    domain_events = [event for event in events if event.get("event") != "heartbeat"]
    sequences = [
        int((event.get("data") or {}).get("seq"))
        for event in domain_events
        if isinstance(event.get("data"), dict) and str((event.get("data") or {}).get("seq", "")).isdigit()
    ]
    terminal = next((event.get("event") for event in reversed(domain_events) if event.get("event")), None)
    return {
        "event_count": len(domain_events),
        "heartbeat_count": len(events) - len(domain_events),
        "raw_first_event": events[0].get("event") if events else None,
        "first_event": domain_events[0].get("event") if domain_events else None,
        "last_event": terminal,
        "first_seq": sequences[0] if sequences else None,
        "last_seq": sequences[-1] if sequences else None,
    }


def run_inflight_stream_check(base_url: str, payload: dict, timeout: float) -> tuple[dict, dict]:
    url = f"{base_url}/api/stream?task_id={payload['trace_id']}&last_seq=0"
    stream_result: dict[str, object] = {"events": None, "error": None}

    def worker() -> None:
        try:
            stream_result["events"] = read_sse(url, timeout=timeout)
        except Exception as error:  # pragma: no cover - surfaced in caller
            stream_result["error"] = error

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    time.sleep(0.2)
    post_result = request_json(f"{base_url}/api/messages", method="POST", body=payload, timeout=timeout)
    thread.join(timeout)
    if thread.is_alive():
        raise TimeoutError("in-flight stream reader did not finish before timeout")
    if stream_result.get("error"):
        raise stream_result["error"]  # type: ignore[misc]
    events = stream_result.get("events")
    if not isinstance(events, list):
        raise RuntimeError("in-flight stream reader returned no events")
    return post_result, summarize_events(events)


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify ToukeAgent SSE replay and resume behavior.")
    parser.add_argument("--base-url", default="http://127.0.0.1:3000", help="Platform base URL")
    parser.add_argument("--persona", default="researcher", help="Persona hint for the generated task")
    parser.add_argument(
        "--message",
        default="请用中文概述当前 agent 的运行流程，并输出计划与执行轨迹。",
        help="User message content to send through /api/messages",
    )
    parser.add_argument("--source-platform", default="web", help="Canonical source platform id")
    parser.add_argument("--timeout", type=float, default=45.0, help="Request timeout in seconds")
    args = parser.parse_args()

    started_at = time.time()
    base_url = args.base_url.rstrip("/")
    payload = build_message_payload(args.message, persona_hint=args.persona, source_platform=args.source_platform)

    try:
        result, inflight_summary = run_inflight_stream_check(base_url, payload, args.timeout)
        first_pass = read_sse(
            f"{base_url}/api/stream?task_id={payload['trace_id']}&last_seq=0",
            timeout=args.timeout,
            require_heartbeat_after_terminal=True,
        )
        first_summary = summarize_events(first_pass)
        tail_start = max(0, int(first_summary["last_seq"] or 0) - 2)
        second_pass = read_sse(
            f"{base_url}/api/stream?task_id={payload['trace_id']}&last_seq={tail_start}",
            timeout=args.timeout,
            require_heartbeat_after_terminal=True,
        )
        second_summary = summarize_events(second_pass)
    except urllib.error.HTTPError as error:
        sys.stderr.write(f"HTTP error {error.code}: {error.reason}\n")
        return 1
    except urllib.error.URLError as error:
        sys.stderr.write(f"Connection error: {error.reason}\n")
        return 1

    output = {
        "ok": (
            result.get("run_state", {}).get("status") == "completed" and
            inflight_summary["last_event"] == "done" and
            inflight_summary["first_event"] == "start" and
            first_summary["last_event"] == "done" and
            first_summary["heartbeat_count"] >= 1 and
            (second_summary["first_seq"] or 0) > tail_start
        ),
        "request": {
            "trace_id": payload["trace_id"],
            "message_id": payload["message_id"],
        },
        "stream": {
            "inflight": inflight_summary,
            "initial": first_summary,
            "resume_from_seq": tail_start,
            "resume": second_summary,
        },
        "elapsed_ms": round((time.time() - started_at) * 1000, 2),
    }
    json.dump(output, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if output["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
