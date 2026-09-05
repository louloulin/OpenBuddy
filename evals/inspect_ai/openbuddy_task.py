"""Real Inspect-AI-style task against a running OpenBuddy Electron harness.

Usage:
    OPENBUDDY_HARNESS_URL=http://127.0.0.1:PORT \\
    OPENBUDDY_HARNESS_TOKEN=secret \\
    OPENBUDDY_E2E_API_KEY=... \\
    OPENBUDDY_E2E_BASE_URL=https://api.minimaxi.com/anthropic \\
    OPENBUDDY_E2E_MODEL_ID=MiniMax-M3 \\
    OPENBUDDY_E2E_REQUIRED=1 \\
    python evals/inspect_ai/openbuddy_task.py

The task:
  - dataset: evals/datasets/core_tasks.jsonl (each row = one sample)
  - solver: real Electron harness HTTP RPC -> session.create + session.prompt
  - scorer: reads the Main-side Pi event log from agent.event-log and asserts
            marker text actually appears in the streamed assistant reply

No mocks: the dataset only runs when OPENBUDDY_E2E_REQUIRED=1 and the harness
URL/token are exported; missing creds → fail-closed.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parents[2]
DATASET_PATH = REPO_ROOT / "evals" / "datasets" / "core_tasks.jsonl"
HARNESS_URL = os.environ.get("OPENBUDDY_HARNESS_URL", "").rstrip("/")
HARNESS_TOKEN = os.environ.get("OPENBUDDY_HARNESS_TOKEN", "")
E2E_KEY = os.environ.get("OPENBUDDY_E2E_API_KEY", "")
E2E_BASE = os.environ.get("OPENBUDDY_E2E_BASE_URL", "")
E2E_MODEL = os.environ.get("OPENBUDDY_E2E_MODEL_ID", "")
E2E_REQUIRED = os.environ.get("OPENBUDDY_E2E_REQUIRED", "") == "1"
EVAL_CWD = os.environ.get("OPENBUDDY_EVAL_CWD", "/tmp/openbuddy-eval")


def rpc(method: str, payload: dict[str, Any] | None = None, timeout: float = 30.0) -> dict[str, Any]:
    body = json.dumps({
        "type": "client-request",
        "rpcId": f"py-{int(time.time() * 1000)}-{method}",
        "method": method,
        "payload": payload or {},
    }).encode("utf-8")
    req = urllib.request.Request(
        url=f"{HARNESS_URL}/api/{method}",
        data=body,
        method="POST",
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {HARNESS_TOKEN}",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - controlled URL
        return json.loads(resp.read().decode("utf-8"))


def read_event_log(session_id: str, limit: int = 600) -> list[dict[str, Any]]:
    response = rpc("agent.event-log", {"sessionId": session_id, "limit": limit})
    if not response.get("result", {}).get("ok"):
        raise RuntimeError(f"event-log RPC failed: {response}")
    entries = response["result"].get("value")
    if not isinstance(entries, list):
        raise RuntimeError("event-log RPC returned invalid entries")
    return [entry for entry in entries if entry.get("sessionId") == session_id][-limit:]


def wait_for_assistant_end(session_id: str, timeout_ms: int = 60_000) -> int:
    deadline = time.monotonic() + (timeout_ms / 1000.0)
    while time.monotonic() < deadline:
        events = read_event_log(session_id, 400)
        starts = [e for e in events if e.get("type") == "agent/start"]
        if starts:
            last_start = starts[-1]["sequence"]
            post = [e for e in events if e.get("sequence", -1) >= last_start and e.get("sessionId") == session_id]
            if any(e.get("type") == "assistant/end" for e in post) and any(e.get("type") == "agent/settled" for e in post):
                return last_start
        time.sleep(0.25)
    raise TimeoutError(f"assistant/end timeout for session={session_id}")


def evaluate_sample(sample: dict[str, Any]) -> dict[str, Any]:
    """Solver + scorer in one function (Inspect-style: dataset -> solver -> scorer)."""
    target = sample["target"][0]
    turns = sample["input"] if isinstance(sample["input"], list) else [{"turn": sample["input"], "expect": target}]

    safe_id = "".join(char if char.isalnum() or char in "._-" else "-" for char in sample["id"])
    new_session = rpc("session.create", {"cwd": f"{EVAL_CWD}/{safe_id}", "modelId": sample.get("model_id")})
    if not new_session.get("result", {}).get("ok"):
        raise RuntimeError(f"session.create failed: {new_session}")
    session_id = new_session["result"]["value"]["sessionId"]

    last_turn_start = 0
    cursor = 0
    for turn in turns:
        rpc("session.prompt", {"sessionId": session_id, "text": turn["turn"]})
        last_turn_start = wait_for_assistant_end(session_id)
        events = read_event_log(session_id, 600)
        turn_events = sorted((event for event in events if event.get("sequence", -1) > cursor), key=lambda event: event.get("sequence", -1))
        lifecycle = ["session/input", "agent/start", "assistant/update", "assistant/end", "agent/settled"]
        position = -1
        for event_type in lifecycle:
            found = next((index for index, event in enumerate(turn_events) if index > position and event.get("type") == event_type), None)
            if found is None:
                raise AssertionError(f"{sample['id']} missing lifecycle event {event_type}")
            position = found
        if any(turn_events[index].get("sequence", -1) <= turn_events[index - 1].get("sequence", -1) for index in range(1, len(turn_events))):
            raise AssertionError(f"{sample['id']} event sequence regressed")
        if any(event.get("sessionId") != session_id for event in turn_events):
            raise AssertionError(f"{sample['id']} event session identity changed")
        serialized = " ".join(json.dumps(event.get("payload") or event, ensure_ascii=False) for event in turn_events)
        if not all(value in serialized for value in (E2E_MODEL, "custom_anthropic", "anthropic-messages")):
            raise AssertionError(f"{sample['id']} missing provider/model/api evidence")
        cursor = max((event.get("sequence", cursor) for event in turn_events), default=cursor)

    events = read_event_log(session_id, 600)
    matched = [
        e for e in events
        if e.get("sequence", -1) >= last_turn_start
        and e.get("sessionId") == session_id
        and target in json.dumps(e.get("payload") or e)
    ]
    tool_ok = True
    if "tool_executed" in (sample.get("expect") or ""):
        tool_events = [
            e for e in events
            if e.get("type") in ("tool/start", "tool/end")
            and "openbuddy_e2e_tool" in json.dumps(e.get("payload") or e)
        ]
        starts = [e for e in tool_events if e.get("type") == "tool/start"]
        ends = [e for e in tool_events if e.get("type") == "tool/end"]
        start_payload = (starts[0].get("payload") or {}) if len(starts) == 1 else {}
        args = start_payload.get("args") or start_payload.get("input") or {}
        result_serialized = json.dumps(ends[0].get("payload") or ends[0]) if len(ends) == 1 else ""
        tool_ok = (
            len(starts) == 1
            and len(ends) == 1
            and starts[0].get("sequence", -1) < ends[0].get("sequence", -1)
            and args.get("marker") == sample["marker"]
            and sample["marker"] in result_serialized
        )
    passed = bool(matched) and tool_ok
    return {
        "id": sample["id"],
        "session": session_id,
        "passed": passed,
        "matchedEvents": len(matched),
        "events": len(events),
    }


def main() -> int:
    if not HARNESS_URL or not HARNESS_TOKEN:
        print("OPENBUDDY_HARNESS_URL and OPENBUDDY_HARNESS_TOKEN are required", file=sys.stderr)
        return 2
    if not E2E_REQUIRED or not (E2E_KEY and E2E_BASE and E2E_MODEL):
        print("Real Inspect-AI evaluation requires OPENBUDDY_E2E_REQUIRED=1 and complete credentials/base/model", file=sys.stderr)
        return 2

    samples = []
    for line in DATASET_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            samples.append(json.loads(line))
        except json.JSONDecodeError as exc:
            print(f"Bad JSONL line in {DATASET_PATH}: {line!r} ({exc})", file=sys.stderr)
            return 2

    results: list[dict[str, Any]] = []
    failed = 0
    for sample in samples:
        try:
            res = evaluate_sample(sample)
        except Exception as exc:  # noqa: BLE001 - we surface error in the report
            res = {"id": sample["id"], "passed": False, "error": str(exc)}
        results.append(res)
        if not res.get("passed"):
            failed += 1

    summary = {
        "framework": "inspect-ai-style",
        "dataset": str(DATASET_PATH.relative_to(REPO_ROOT)),
        "total": len(samples),
        "passed": len(samples) - failed,
        "failed": failed,
        "realE2E": bool(E2E_KEY and E2E_BASE and E2E_MODEL),
        "results": results,
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
