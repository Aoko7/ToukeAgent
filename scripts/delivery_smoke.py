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
    trace_id = f"trace_delivery_smoke_{uuid4().hex[:10]}"
    message_id = f"msg_delivery_smoke_{uuid4().hex[:10]}"
    return {
        "message_id": message_id,
        "source_platform": "web",
        "source_message_id": f"raw_{message_id}",
        "workspace_id": "ws_delivery_smoke",
        "channel_id": "console",
        "conversation_id": f"conv_delivery_{uuid4().hex[:8]}",
        "sender": {"id": "delivery_user", "role": "user"},
        "recipient": {"id": "agent_1", "role": "agent"},
        "content": [{"type": "text", "text": "请把这条结果同时投递到多个平台。"}],
        "attachments": [
            {
                "type": "image",
                "name": "architecture.png",
                "url": "https://example.com/architecture.png",
                "alt_text": "architecture overview",
            },
            {
                "type": "file",
                "name": "runbook.pdf",
                "url": "https://example.com/runbook.pdf",
                "mime_type": "application/pdf",
            },
        ],
        "trace_id": trace_id,
        "persona_hint": "researcher",
        "metadata": {
            "target_platforms": ["web", "slack", "telegram"],
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify multi-platform delivery and callback flows.")
    parser.add_argument("--base-url", default="http://127.0.0.1:3000", help="Platform base URL")
    parser.add_argument("--timeout", type=float, default=45.0, help="Timeout in seconds")
    args = parser.parse_args()

    started_at = time.time()
    base_url = args.base_url.rstrip("/")
    payload = build_message_payload()

    try:
        initial = request_json(f"{base_url}/api/messages", method="POST", body=payload, timeout=args.timeout)
        deliveries = request_json(f"{base_url}/api/deliveries?task_id={payload['trace_id']}", timeout=args.timeout)
        adapters = request_json(f"{base_url}/api/platform-adapters", timeout=args.timeout)
        callback_results = []
        for item in deliveries.get("items") or []:
            callback_results.append(request_json(
                f"{base_url}/api/delivery-callbacks",
                method="POST",
                body={
                    "delivery_id": item["delivery_id"],
                    "status": "delivered",
                    "callback_state": "acknowledged",
                    "external_message_id": f"ext_{item['target_platform']}_{uuid4().hex[:6]}",
                },
                timeout=args.timeout,
            ))
        delivered = request_json(
            f"{base_url}/api/deliveries?task_id={payload['trace_id']}&status=delivered",
            timeout=args.timeout,
        )
    except urllib.error.HTTPError as error:
        sys.stderr.write(f"HTTP error {error.code}: {error.reason}\n")
        return 1
    except urllib.error.URLError as error:
        sys.stderr.write(f"Connection error: {error.reason}\n")
        return 1

    delivery_items = deliveries.get("items") or []
    targets = sorted(item.get("target_platform") for item in delivery_items)
    payload_shapes = {
        item.get("target_platform"): {
            "kind": (item.get("rendered_payload") or {}).get("kind"),
            "has_blocks": bool((item.get("rendered_payload") or {}).get("blocks")),
            "has_media_group": bool((item.get("rendered_payload") or {}).get("media_group")),
        }
        for item in delivery_items
    }
    adapter_ids = sorted(item.get("platform_id") for item in adapters.get("adapters") or [])
    summary = {
        "ok": (
            initial.get("run_state", {}).get("status") == "completed" and
            targets == ["slack", "telegram", "web"] and
            len(callback_results) == 3 and
            len(delivered.get("items") or []) == 3 and
            {"web", "slack", "telegram"}.issubset(set(adapter_ids)) and
            payload_shapes.get("telegram", {}).get("has_media_group") is True
        ),
        "request": {
            "trace_id": payload["trace_id"],
            "message_id": payload["message_id"],
        },
        "delivery": {
            "targets": targets,
            "delivery_count": len(delivery_items),
            "delivered_count": len(delivered.get("items") or []),
            "payload_shapes": payload_shapes,
        },
        "adapters": adapter_ids,
        "elapsed_ms": round((time.time() - started_at) * 1000, 2),
    }
    json.dump(summary, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
