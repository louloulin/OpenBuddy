"""Pytest + DeepEval-style real test against OpenBuddy Electron harness.

Run with:
    pip install deepeval pytest
    OPENBUDDY_HARNESS_URL=http://127.0.0.1:PORT \
    OPENBUDDY_HARNESS_TOKEN=secret \
    OPENBUDDY_E2E_API_KEY=... \
    OPENBUDDY_E2E_BASE_URL=https://api.minimaxi.com/anthropic \
    OPENBUDDY_E2E_MODEL_ID=MiniMax-M3 \
    OPENBUDDY_E2E_REQUIRED=1 \
    pytest evals/deepeval/test_openbuddy_chat.py -q

The suite is deliberately fail-closed: missing credentials or harness is a
collection error, never an empty/ skipped success. DeepEval remains optional;
the assertions below still validate the real harness when pytest is present.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

HARNESS_URL = os.environ.get("OPENBUDDY_HARNESS_URL", "").rstrip("/")
HARNESS_TOKEN = os.environ.get("OPENBUDDY_HARNESS_TOKEN", "")
E2E_KEY = os.environ.get("OPENBUDDY_E2E_API_KEY", "")
E2E_BASE = os.environ.get("OPENBUDDY_E2E_BASE_URL", "")
E2E_MODEL = os.environ.get("OPENBUDDY_E2E_MODEL_ID", "")
E2E_REQUIRED = os.environ.get("OPENBUDDY_E2E_REQUIRED", "") == "1"

# Real samples, no mocks. Marker text is deliberately scoped so any stray
# "hello" doesn't accidentally pass.
SAMPLES = [
    {"id": "chat.greet-zh", "turns": ["请只回复 CORE-GREET-ZH；不要解释。"], "marker": "CORE-GREET-ZH"},
    {"id": "chat.context", "turns": [
        "请只回复 CORE-CTX-A，并记住数字 9031；不要解释。",
        "基于上一条消息的 9031，只回复 CORE-CTX-B-9031；不要重新询问数字。",
    ], "marker": "CORE-CTX-B-9031"},
    {"id": "chat.tool", "turns": [
        "必须调用 openbuddy_e2e_tool，参数 marker=CORE-TOOL-BASH，收到结果后只回复该 marker；不要解释。",
    ], "marker": "CORE-TOOL-BASH"},
]


def _require_harness():
    if not HARNESS_URL or not HARNESS_TOKEN:
        pytest.fail("OPENBUDDY_HARNESS_URL/TOKEN are required for the real evaluation")
    if not E2E_REQUIRED or not (E2E_KEY and E2E_BASE and E2E_MODEL):
        pytest.fail("Real evaluation requires OPENBUDDY_E2E_REQUIRED=1 and complete credentials/base/model")


def _rpc(method: str, payload: dict[str, Any] | None = None, timeout: float = 30.0) -> dict[str, Any]:
    body = json.dumps({"type": "client-request", "rpcId": f"py-{time.time_ns()}-{method}", "method": method, "payload": payload or {}}).encode("utf-8")
    req = urllib.request.Request(
        url=f"{HARNESS_URL}/api/{method}",
        data=body,
        method="POST",
        headers={"content-type": "application/json", "authorization": f"Bearer {HARNESS_TOKEN}"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8"))


def _read_events(session_id: str, limit: int = 600) -> list[dict[str, Any]]:
    response = _rpc("agent.event-log", {"sessionId": session_id, "limit": limit})
    if not response.get("result", {}).get("ok"):
        raise RuntimeError(f"event-log RPC failed: {response}")
    entries = response["result"].get("value")
    if not isinstance(entries, list):
        raise RuntimeError("event-log RPC returned invalid entries")
    return [entry for entry in entries if entry.get("sessionId") == session_id][-limit:]


def _wait_assistant_end(session_id: str, timeout_ms: int = 60_000) -> int:
    deadline = time.monotonic() + (timeout_ms / 1000.0)
    while time.monotonic() < deadline:
        events = _read_events(session_id, 400)
        starts = [e for e in events if e.get("type") == "agent/start"]
        if starts:
            last = starts[-1]["sequence"]
            post = [e for e in events if e.get("sequence", -1) >= last and e.get("sessionId") == session_id]
            if any(e.get("type") == "assistant/end" for e in post) and any(e.get("type") == "agent/settled" for e in post):
                return last
        time.sleep(0.25)
    raise TimeoutError(f"assistant/end timeout for session={session_id}")


def _drive_sample(sample: dict[str, Any]) -> dict[str, Any]:
    safe_id = "".join(char if char.isalnum() or char in "._-" else "-" for char in sample["id"])
    new_session = _rpc("session.create", {"cwd": f"/tmp/openbuddy-eval/{safe_id}", "modelId": f"custom_anthropic/{E2E_MODEL}"})
    assert new_session.get("result", {}).get("ok"), f"session.create failed: {new_session}"
    session_id = new_session["result"]["value"]["sessionId"]
    last_start = 0
    cursor = 0
    for turn in sample["turns"]:
        _rpc("session.prompt", {"sessionId": session_id, "text": turn})
        last_start = _wait_assistant_end(session_id)
        events = _read_events(session_id, 600)
        turn_events = sorted((event for event in events if event.get("sequence", -1) > cursor), key=lambda event: event.get("sequence", -1))
        lifecycle = ["session/input", "agent/start", "assistant/update", "assistant/end", "agent/settled"]
        position = -1
        for event_type in lifecycle:
            found = next((index for index, event in enumerate(turn_events) if index > position and event.get("type") == event_type), None)
            assert found is not None, f"{sample['id']} missing lifecycle event {event_type}"
            position = found
        assert all(turn_events[index]["sequence"] > turn_events[index - 1]["sequence"] for index in range(1, len(turn_events)))
        serialized = " ".join(json.dumps(event.get("payload") or event, ensure_ascii=False) for event in turn_events)
        assert all(value in serialized for value in (E2E_MODEL, "custom_anthropic", "anthropic-messages"))
        cursor = max((event.get("sequence", cursor) for event in turn_events), default=cursor)
    events = _read_events(session_id, 600)
    matched = [e for e in events if e.get("sequence", -1) >= last_start and sample["marker"] in json.dumps(e.get("payload") or e)]
    return {"session_id": session_id, "marker": sample["marker"], "matched": len(matched), "events": len(events)}


@pytest.mark.parametrize("sample", SAMPLES, ids=[s["id"] for s in SAMPLES])
def test_real_minimax_chat(sample: dict[str, Any]) -> None:
    """End-to-end: each sample must produce a real streamed reply from MiniMax."""
    _require_harness()
    result = _drive_sample(sample)
    assert result["matched"] >= 1, (
        f"marker {result['marker']!r} not present in any assistant event for session={result['session_id']}"
    )


def test_real_provider_evidence() -> None:
    """Hard-evidence the stream went through Pi → MiniMax (anthropic-messages)."""
    _require_harness()
    sample = SAMPLES[0]
    result = _drive_sample(sample)
    events = _read_events(result["session_id"], 600)
    serialized = " ".join(json.dumps(e.get("payload") or e, ensure_ascii=False, separators=(",", ":")) for e in events)
    assert "custom_anthropic" in serialized, serialized[:1000]
    assert "MiniMax-M3" in serialized or E2E_MODEL in serialized, serialized[:1000]
    assert "anthropic-messages" in serialized, serialized[:1000]
