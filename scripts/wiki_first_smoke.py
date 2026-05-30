#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
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


def build_message_payload(query: str) -> dict:
    trace_id = f"trace_wiki_smoke_{uuid4().hex[:10]}"
    message_id = f"msg_wiki_smoke_{uuid4().hex[:10]}"
    return {
        "message_id": message_id,
        "source_platform": "web",
        "source_message_id": f"raw_{message_id}",
        "workspace_id": "ws_wiki_smoke",
        "channel_id": "console",
        "conversation_id": f"conv_wiki_{uuid4().hex[:8]}",
        "sender": {"id": "wiki_user", "role": "user"},
        "recipient": {"id": "agent_1", "role": "agent"},
        "content": [{"type": "text", "text": query}],
        "trace_id": trace_id,
        "persona_hint": "researcher",
    }


def build_markdown_note() -> str:
    return """---
entry_id: wiki_deepseek_provider
title: DeepSeek provider profile
tags: [deepseek, provider, pricing, version, status]
owner: wiki_ops
ttl_seconds: 3600
source_of_truth: smoke_markdown_note
required_context:
  - provider_name
retrieval_hints:
  - latest version
  - pricing status
---

# DeepSeek provider profile

## Summary
This markdown note tracks the freshest provider pricing and version status.

## Facts
- Treat pricing, model availability, and release metadata as dynamic facts.
- Prefer the wiki path when the request asks for versions, pricing, or current provider status.
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the wiki-first dynamic retrieval route end to end.")
    parser.add_argument("--base-url", default="http://127.0.0.1:3000", help="Platform base URL")
    parser.add_argument("--timeout", type=float, default=45.0, help="Timeout in seconds")
    parser.add_argument("--notes-dir", default=None, help="Optional markdown notes directory to batch-import before running the smoke")
    parser.add_argument("--query", default="请告诉我最新版本和价格状态。", help="User query used for the smoke run")
    parser.add_argument("--expect-title", action="append", default=[], help="Citation title that should appear in the final retrieval output")
    args = parser.parse_args()

    started_at = time.time()
    base_url = args.base_url.rstrip("/")
    payload = build_message_payload(args.query)
    imported: dict = {}

    try:
        with tempfile.TemporaryDirectory(prefix="toukeagent_wiki_smoke_") as temp_dir:
            notes_dir = Path(args.notes_dir).expanduser() if args.notes_dir else Path(temp_dir)
            if not args.notes_dir:
                note_path = notes_dir / "deepseek_provider.md"
                note_path.write_text(build_markdown_note(), encoding="utf-8")
            imported = request_json(
                f"{base_url}/api/wiki/import-markdown-batch",
                method="POST",
                body={
                    "mode": "upsert",
                    "directory_path": str(notes_dir),
                    "source_trace_id": payload["trace_id"],
                },
                timeout=args.timeout,
            )
        result = request_json(f"{base_url}/api/messages", method="POST", body=payload, timeout=args.timeout)
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
    retrieval = retrieval_step.get("output") or {}
    route = retrieval.get("route") or {}
    dynamic_items = retrieval.get("dynamic_items") or []
    stable_items = retrieval.get("stable_items") or []
    citations = retrieval.get("citations") or []
    quality = retrieval.get("quality") or {}
    citation_titles = [item.get("title") for item in citations]
    expected_titles = [title for title in args.expect_title if title]
    missing_expected_titles = [title for title in expected_titles if title not in citation_titles]
    summary = {
        "ok": (
            run_state.get("status") == "completed" and
            route.get("mode") == "wiki-first" and
            route.get("effective_mode") == "wiki-first" and
            len(dynamic_items) >= 1 and
            quality.get("primary_source_count", 0) >= 1 and
            not missing_expected_titles
        ),
        "request": {
            "trace_id": payload["trace_id"],
            "message_id": payload["message_id"],
            "query": args.query,
        },
        "wiki_import": {
            "mode": imported.get("mode"),
            "file_count": imported.get("file_count"),
            "directory_path": imported.get("directory_path"),
            "entry_ids": [
                ((item.get("entry") or {}).get("entry_id"))
                for item in (imported.get("items") or [])
            ],
        },
        "retrieval": {
            "route_mode": route.get("mode"),
            "effective_mode": route.get("effective_mode"),
            "fallback_applied": route.get("fallback_applied"),
            "dynamic_count": len(dynamic_items),
            "stable_count": len(stable_items),
            "citation_titles": citation_titles,
            "expected_titles": expected_titles,
            "missing_expected_titles": missing_expected_titles,
            "retrieval_score": quality.get("retrieval_score"),
            "primary_source_count": quality.get("primary_source_count"),
        },
        "elapsed_ms": round((time.time() - started_at) * 1000, 2),
    }
    json.dump(summary, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
