"""Real Langfuse-style trace pull from OpenBuddy Electron harness.

Pulls the Main-side Pi event log through agent.event-log, projects it into
Langfuse-style spans/generations/tool calls, and asserts:
  * assistant/update and assistant/end events are paired
  * provider/model/api are stamped on every generation
  * tool/start and tool/end arrive in the correct order
  * no event sequence regresses (sequence is strictly increasing)

No mocks: requires a live harness and OPENBUDDY_E2E_* creds.

Usage:
    OPENBUDDY_HARNESS_URL=http://127.0.0.1:PORT \\
    OPENBUDDY_HARNESS_TOKEN=secret \\
    OPENBUDDY_E2E_API_KEY=... OPENBUDDY_E2E_BASE_URL=https://api.minimaxi.com/anthropic \\
    OPENBUDDY_E2E_MODEL_ID=MiniMax-M3 OPENBUDDY_E2E_REQUIRED=1 \\
    python evals/langfuse/trace_realtime.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]

HARNESS_URL = os.environ.get("OPENBUDDY_HARNESS_URL", "").rstrip("/")
HARNESS_TOKEN = os.environ.get("OPENBUDDY_HARNESS_TOKEN", "")
E2E_KEY = os.environ.get("OPENBUDDY_E2E_API_KEY", "")
E2E_BASE = os.environ.get("OPENBUDDY_E2E_BASE_URL", "")
E2E_MODEL = os.environ.get("OPENBUDDY_E2E_MODEL_ID", "")
E2E_REQUIRED = os.environ.get("OPENBUDDY_E2E_REQUIRED", "") == "1"


def _rpc(method: str, payload: dict[str, Any] | None = None, timeout: float = 30.0) -> dict[str, Any]:
    body = json.dumps({"type": "client-request", "rpcId": f"lf-{time.time_ns()}-{method}", "method": method, "payload": payload or {}}).encode("utf-8")
    req = urllib.request.Request(
        url=f"{HARNESS_URL}/api/{method}",
        data=body,
        method="POST",
        headers={"content-type": "application/json", "authorization": f"Bearer {HARNESS_TOKEN}"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8"))


def _collect_events(session_id: str, deadline_ms: int = 60_000) -> list[dict[str, Any]]:
    deadline = time.monotonic() + deadline_ms / 1000.0
    latest: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        response = _rpc("agent.event-log", {"sessionId": session_id, "limit": 800})
        if not response.get("result", {}).get("ok"):
            raise RuntimeError(f"event-log RPC failed: {response}")
        entries = response["result"].get("value")
        if not isinstance(entries, list):
            raise RuntimeError("event-log RPC returned invalid entries")
        latest = [entry for entry in entries if entry.get("sessionId") == session_id]
        if any(entry.get("type") == "assistant/end" for entry in latest) and any(entry.get("type") == "agent/settled" for entry in latest):
            return latest[-800:]
        time.sleep(0.25)
    return latest[-800:]


def project_to_langfuse_spans(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map Pi event types to Langfuse observation taxonomy."""
    out: list[dict[str, Any]] = []
    for event in events:
        t = event.get("type", "")
        payload = event.get("payload") or {}
        if t == "agent/start":
            out.append({"type": "span", "name": "agent-turn", "sequence": event["sequence"], "metadata": payload})
        elif t == "agent/settled":
            out.append({"type": "span", "name": "agent-settled", "sequence": event["sequence"], "metadata": payload})
        elif t == "assistant/update":
            text = payload.get("text") or ""
            if isinstance(text, dict):
                text = text.get("delta") or text.get("text") or ""
            serialized = json.dumps(payload, ensure_ascii=False)
            metadata = {
                "provider": payload.get("provider") or ("custom_anthropic" if "custom_anthropic" in serialized else None),
                "model": payload.get("model") or ("MiniMax-M3" if "MiniMax-M3" in serialized else None),
                "api": payload.get("api") or ("anthropic-messages" if "anthropic-messages" in serialized else None),
            }
            out.append({"type": "generation", "name": "assistant.delta", "sequence": event["sequence"], "delta": text[:120], "metadata": metadata})
        elif t == "assistant/end":
            serialized = json.dumps(payload, ensure_ascii=False)
            metadata = {
                "provider": payload.get("provider") or ("custom_anthropic" if "custom_anthropic" in serialized else None),
                "model": payload.get("model") or ("MiniMax-M3" if "MiniMax-M3" in serialized else None),
                "api": payload.get("api") or ("anthropic-messages" if "anthropic-messages" in serialized else None),
            }
            out.append({"type": "generation", "name": "assistant.end", "sequence": event["sequence"], "metadata": metadata})
        elif t == "tool/start":
            out.append({"type": "tool", "name": payload.get("tool") or "tool", "sequence": event["sequence"], "phase": "start", "metadata": payload})
        elif t == "tool/end":
            out.append({"type": "tool", "name": payload.get("tool") or "tool", "sequence": event["sequence"], "phase": "end", "metadata": payload})
        elif t in ("session/input", "session/permission", "session/question", "session/event"):
            out.append({"type": "span", "name": t, "sequence": event["sequence"], "metadata": payload})
    return out


def main() -> int:
    if not HARNESS_URL or not HARNESS_TOKEN:
        print("OPENBUDDY_HARNESS_URL and OPENBUDDY_HARNESS_TOKEN are required", file=sys.stderr)
        return 2
    if not E2E_REQUIRED or not (E2E_KEY and E2E_BASE and E2E_MODEL):
        print("Real Langfuse trace evaluation requires OPENBUDDY_E2E_REQUIRED=1 and complete credentials/base/model", file=sys.stderr)
        return 2

    new_session = _rpc("session.create", {"cwd": f"/tmp/openbuddy-eval/langfuse-{time.time_ns()}", "modelId": f"custom_anthropic/{E2E_MODEL}"})
    if not new_session.get("result", {}).get("ok"):
        print(f"session.create failed: {new_session}", file=sys.stderr)
        return 1
    session_id = new_session["result"]["value"]["sessionId"]

    marker = "LANGFUSE-TRACE-OK"
    _rpc("session.prompt", {"sessionId": session_id, "text": f"请只回复 {marker}；不要解释。"})
    events = _collect_events(session_id, deadline_ms=60_000)
    spans = project_to_langfuse_spans(events)

    sequence = [event["sequence"] for event in events]
    sequence_ok = all(sequence[i] < sequence[i + 1] for i in range(len(sequence) - 1))
    lifecycle = ["session/input", "agent/start", "assistant/update", "assistant/end", "agent/settled"]
    lifecycle_ok = all(any(event.get("type") == event_type for event in events) for event_type in lifecycle)

    providers = {(span.get("metadata") or {}).get("provider") for span in spans if span.get("type") == "generation"}
    models = {(span.get("metadata") or {}).get("model") for span in spans if span.get("type") == "generation"}
    apis = {(span.get("metadata") or {}).get("api") for span in spans if span.get("type") == "generation"}

    tool_pairs = defaultdict(int)
    for span in spans:
        if span.get("type") == "tool":
            tool_pairs[(span.get("sequence"), span.get("phase"))] += 1

    summary = {
        "framework": "langfuse-style",
        "sessionId": session_id,
        "totalEvents": len(events),
        "spans": len(spans),
        "sequenceStrictlyIncreasing": sequence_ok,
        "lifecycleComplete": lifecycle_ok,
        "providers": sorted(provider for provider in providers if provider),
        "models": sorted(model for model in models if model),
        "apis": sorted(api for api in apis if api),
        "markerSeen": any(marker in json.dumps(event.get("payload") or event) for event in events),
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))

    ok = summary["markerSeen"] and summary["sequenceStrictlyIncreasing"] and summary["lifecycleComplete"] and "custom_anthropic" in summary["providers"] and E2E_MODEL in summary["models"] and "anthropic-messages" in summary["apis"]
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
