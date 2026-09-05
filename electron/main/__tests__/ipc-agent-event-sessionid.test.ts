import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regression test for the `agentHost.onEvent` callback registered in
 * `electron/main/ipc/index.ts`.
 *
 * The handler used to forward `pi://update` (text chunk / tool_call /
 * tool_call_update) and `pi://complete` events to the renderer WITHOUT the
 * `sessionId` field, even though the `wireEvent` it received had it. The
 * renderer falls back to the *currently focused* session via `applyUpdate`
 * whenever `__sessionId` is missing, which silently drops messages into the
 * wrong transcript after any session switch (inspiration → main, main →
 * side channel, rewind, etc.) — leaving the user staring at an empty
 * assistant bubble ("no return value").
 *
 * The fix tags every outbound `pi://update` / `pi://complete` payload with
 * `sessionId` taken from `wireEvent.sessionId` (falling back to
 * `agentHost.getSession()?.sessionId`). This test pins that contract by
 * reading the production source and asserting the patterns that produced
 * the bug are gone.
 */

const SRC_PATH = resolve(__dirname, "../ipc/index.ts");
const src = readFileSync(SRC_PATH, "utf-8");

// Locate the `agentHost.onEvent((event: any) => { ... });` callback body.
function extractHandlerBody(): string {
  const start = src.indexOf("agentHost.onEvent((event");
  if (start === -1) throw new Error("agentHost.onEvent((event ...) callback not found");
  // Find matching `});` — the handler body is single-level braces.
  let depth = 0;
  let i = src.indexOf("{", start);
  const openStart = i;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return src.slice(openStart, i + 1);
      }
    }
  }
  throw new Error("Could not find end of agentHost.onEvent callback body");
}

const handlerBody = extractHandlerBody();

describe("ipc/index.ts agentHost.onEvent forwards sessionId", () => {
  it("declares a sessionId binding from wireEvent (or agentHost.getSession() fallback)", () => {
    expect(handlerBody).toMatch(
      /sessionId\s*=\s*\(event\s+as\s+\{\s*sessionId\?\s*:\s*string\s*\}\)\.sessionId\s*\?\s*\?\s*agentHost\.getSession\(\)\?\.sessionId/,
    );
  });

  it("agent_message_chunk payload includes the sessionId field", () => {
    // The buggy form was:  sendSafe(win, "pi://update", { type: "agent_message_chunk", content: ... })
    // The fixed form lives in the createStreamingCoalescer emit callback:
    //   sendSafeFast(ctx.contents, "pi://update", {
    //     sessionId: ctx.sessionId,
    //     type: "agent_message_chunk",
    //     content: [...],
    //   })
    // The sessionId flows from textDeltaCoalescer.setContext({ sessionId, contents })
    // inside the main handler.
    const re = /sendSafeFast\(\s*ctx\.contents\s*,\s*"pi:\/\/update"\s*,\s*\{\s*sessionId:\s*ctx\.sessionId\s*,\s*type:\s*"agent_message_chunk"/;
    expect(src).toMatch(re);
  });

  it("tool_call payload includes the sessionId field", () => {
    const re = /sendSafe\(\s*win\s*,\s*"pi:\/\/update"\s*,\s*\{\s*sessionId\s*,\s*type:\s*"tool_call"/;
    expect(src).toMatch(re);
  });

  it("tool_call_update payload includes the sessionId field", () => {
    const re = /sendSafe\(\s*win\s*,\s*"pi:\/\/update"\s*,\s*\{\s*sessionId\s*,\s*type:\s*"tool_call_update"/;
    expect(handlerBody).toMatch(re);
  });

  it("pi://complete payload uses the unified sessionId binding (no ad-hoc lookup)", () => {
    // The buggy form: sendSafe(win, "pi://complete", { sessionId: payload.sessionId ?? agentHost.getSession()?.sessionId ?? "", ... })
    // The fixed form: sendSafe(win, "pi://complete", { sessionId, ... })
    const re = /sendSafe\(\s*win\s*,\s*"pi:\/\/complete"\s*,\s*\{\s*sessionId\s*,\s*promptId/;
    expect(handlerBody).toMatch(re);
    // And the redundant `payload.sessionId ?? agentHost.getSession()?.sessionId ?? ""` chain must be gone.
    expect(handlerBody).not.toMatch(/sessionId:\s*payload\.sessionId\s*\?\?\s*agentHost\.getSession\(\)\?\.sessionId/);
  });

  it("no `pi://update` payload omits the sessionId field", () => {
    // Sanity: every sendSafe call to "pi://update" must have `{ sessionId` as its first payload key.
    // We scan all such calls in the handler body.
    const callRegex = /sendSafe\(\s*win\s*,\s*"pi:\/\/update"\s*,\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = callRegex.exec(handlerBody))) {
      const keys = m[1];
      expect(keys.trimStart().startsWith("sessionId")).toBe(true);
    }
  });

  // R-ToolStream-1 — pin the tool streaming partial wire. Without this,
  // long-running tools (bash/build) leave ToolCallCard stuck on
  // `in_progress` with no live output.
  it("tool_execution_update is forwarded as tool_call_update with update.partial=true", () => {
    const re = /if\s*\(\s*payload\.type\s*===\s*"tool_execution_update"\s*\)\s*\{[\s\S]*?sendSafe\(\s*win\s*,\s*"pi:\/\/update"\s*,\s*\{\s*sessionId\s*,\s*type:\s*"tool_call_update"[\s\S]*?update:\s*\{\s*partial:\s*true\s*,\s*partialResult:\s*payload\.partialResult\s*\}/;
    expect(handlerBody).toMatch(re);
  });

  it("tool_call_update payload for streaming partial includes the sessionId field", () => {
    // Same shape as the existing tool_call_update regression but anchored
    // on the streaming-partial branch specifically.
    const re = /sendSafe\(\s*win\s*,\s*"pi:\/\/update"\s*,\s*\{\s*sessionId\s*,\s*type:\s*"tool_call_update"\s*,\s*toolCallId:\s*payload\.toolCallId\s*,\s*update:\s*\{\s*partial:\s*true/;
    expect(handlerBody).toMatch(re);
  });
});
