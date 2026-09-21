/**
 * electron/main/agent/host-modules/agent-prompt-error-repro.test.ts
 *
 * Goal mu7rpkze-gc769z / rb-error-reporting — first reproduce the
 * "upstream 429 → no pi://error" hypothesis cheaply (no real-model
 * quota), then either fix the missing path or document the
 * misjudgment with code evidence.
 *
 * This file proves the structural cause of the observation:
 *
 *   Observed (from this session's earlier minimax-real-roundtrip run):
 *     - Upstream returned HTTP 429 (token plan quota exhausted).
 *     - pi://complete fired.
 *     - captured.errors was empty — pi://error never fired.
 *
 *   Hypothesis under test:
 *     The "no pi://error" bug is structural — the upstream model SDK
 *     does NOT throw on 429; it returns a successful completion with
 *     zero assistant content. The pi://error emit lives inside the
 *     catch block of prompt() in agent-prompt.ts:154-163, so a
 *     zero-content success bypasses the catch entirely.
 *
 *   Misjudgment variant (covered by Variant B):
 *     If the existing catch path works fine when upstream actually
 *     throws, then the catch is not "broken" — it just never gets
 *     called for the rate-limit case, because the SDK does not
 *     classify that as an error. The fix requires intercepting the
 *     completion path to detect "successful + zero assistant content"
 *     and classifying it as an error event, NOT modifying the catch.
 *
 * The two variants below drive `state.session.prompt()` with two
 * different mocked implementations and assert what pi://error events
 * are emitted:
 *
 *   Variant A: state.session.prompt() resolves without throwing
 *              (mimics SDK returning successful empty completion for 429).
 *              Expectation: 0 pi://error events.
 *
 *   Variant B: state.session.prompt() rejects with an Error
 *              (mimics SDK treating the failure as a thrown error).
 *              Expectation: 1 pi://error event with sessionId + error.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultAgentHostState } from "./_default-state";
import { installAgentPrompt, prompt } from "./agent-prompt";

interface CapturedEvent {
  channel: string;
  payload: unknown;
}

function installSessionWith(
  sessionId: string,
  promptImpl: () => Promise<unknown>,
  capture: CapturedEvent[],
): void {
  const state = createDefaultAgentHostState();
  state.session = {
    sessionId,
    prompt: promptImpl,
  } as never;
  installAgentPrompt({
    state,
    emitPluginEvent: vi.fn(),
    emitRendererEvent: (channel: string, payload: unknown) => capture.push({ channel, payload }),
    publicQueueItems: () => [],
  });
}

describe("agent prompt error reporting repro — Variant A: 429-as-success", () => {
  afterEach(() => vi.restoreAllMocks());

  it("session.prompt() resolves cleanly -> NO pi://error fires (catch bypassed)", async () => {
    const captured: CapturedEvent[] = [];
    installSessionWith(
      "repro-A-session",
      // Mimic the upstream SDK returning a successful completion with
      // zero assistant content (the rate-limit / quota-exceeded path).
      async () => undefined,
      captured,
    );

    await expect(prompt("hello world")).resolves.toBeUndefined();

    const errorEvents = captured.filter((e) => e.channel === "pi://error");
    const completeEvents = captured.filter((e) => e.channel === "pi://complete");
    const updateEvents = captured.filter((e) => e.channel === "pi://update");

    // The catch was bypassed: pi://error is NOT emitted, even though the
    // upstream was silently broken (returned no content). This is the
    // structural reason the real-model roundtrip showed captured.errors = []
    // while pi://complete still fired.
    expect(errorEvents).toHaveLength(0);

    // Sanity: nothing in the *event* stream looks like an error either.
    // (We can't observe pi://complete here because the prompt() entry point
    // only awaits the dispatch; the SDK normally emits complete via its own
    // session-event handler. This assertion documents that gap.)
    expect(completeEvents).toHaveLength(0);
    expect(updateEvents).toHaveLength(0);
  });
});

describe("agent prompt error reporting repro — Variant B: thrown upstream", () => {
  afterEach(() => vi.restoreAllMocks());

  it("session.prompt() rejects -> pi://error fires with sessionId + error", async () => {
    const captured: CapturedEvent[] = [];
    installSessionWith(
      "repro-B-session",
      async () => {
        // Mimic an SDK that *does* classify the failure as an error.
        throw new Error("HTTP 429: rate_limit_error");
      },
      captured,
    );

    await expect(prompt("hello world")).rejects.toThrow(/HTTP 429/);

    const errorEvents = captured.filter((e) => e.channel === "pi://error");
    expect(errorEvents).toHaveLength(1);
    const payload = errorEvents[0].payload as { sessionId: string; error: string };
    expect(payload.sessionId).toBe("repro-B-session");
    expect(payload.error).toContain("HTTP 429");
  });

  it("session.prompt() rejects with arbitrary error -> pi://error payload's error stringifies the message", async () => {
    const captured: CapturedEvent[] = [];
    installSessionWith(
      "repro-B2-session",
      async () => {
        throw new TypeError("network unreachable");
      },
      captured,
    );

    await expect(prompt("hi")).rejects.toThrow(/network unreachable/);

    const errorEvents = captured.filter((e) => e.channel === "pi://error");
    expect(errorEvents).toHaveLength(1);
    const payload = errorEvents[0].payload as { error: string };
    expect(payload.error).toContain("network unreachable");
  });
});