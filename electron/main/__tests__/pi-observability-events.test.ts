/**
 * MVP-4 / MVP-5 / MVP-7 — regression tests for native Pi event forwards.
 *
 * These events are emitted by the pi SDK but were never forwarded to the
 * renderer. After this fix `openbuddy-pi-observability` subscribes to
 * them and re-emits via `emit(\`pi/...\`)`, which the existing
 * `agentHost.onPluginEvent` bridge forwards to the renderer as
 * `openbuddy://plugin-event`.
 *
 * The contract pinned here:
 *   session_tree           -> pi/session-tree          (MVP-4 native tree UI)
 *   session_before_fork    -> pi/session-before-fork   (MVP-5 fork confirm)
 *   before_provider_request-> pi/provider-request      (MVP-7 cost/latency)
 *   after_provider_response-> pi/provider-response     (MVP-7 cost/latency)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC_PATH = resolve(__dirname, "../agent/pi-extensions.ts");
const src = readFileSync(SRC_PATH, "utf-8");

function extractObservabilityBody(): string {
  // The "openbuddy-pi-observability" factory's body sits between two `})`
  // markers; pull everything between the `=> (pi: ExtensionAPI) => {`
  // opener and the matching closer.
  const start = src.indexOf('"openbuddy-pi-observability"');
  if (start === -1) throw new Error("openbuddy-pi-observability factory not found");
  const openBrace = src.indexOf("=> (pi: ExtensionAPI) => {", start);
  if (openBrace === -1) throw new Error("observability factory body opener not found");
  const openIdx = src.indexOf("{", openBrace);
  let depth = 1;
  for (let i = openIdx + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  throw new Error("could not find end of observability body");
}

const body = extractObservabilityBody();

describe("openbuddy-pi-observability forwards native events", () => {
  it("MVP-4: session_tree -> pi/session-tree", () => {
    expect(body).toMatch(
      /api\.on\(\s*"session_tree"\s*,\s*forward\(\s*"session-tree"\s*\)\s*\)/,
    );
  });

  it("MVP-5: session_before_fork -> pi/session-before-fork", () => {
    expect(body).toMatch(
      /api\.on\(\s*"session_before_fork"\s*,\s*forward\(\s*"session-before-fork"\s*\)\s*\)/,
    );
  });

  it("MVP-7: before_provider_request -> pi/provider-request", () => {
    expect(body).toMatch(
      /api\.on\(\s*"before_provider_request"\s*,\s*forward\(\s*"provider-request"\s*\)\s*\)/,
    );
  });

  it("MVP-7: after_provider_response -> pi/provider-response", () => {
    expect(body).toMatch(
      /api\.on\(\s*"after_provider_response"\s*,\s*forward\(\s*"provider-response"\s*\)\s*\)/,
    );
  });

  it("regression: pre-existing observability events still wired", () => {
    // Guard against accidentally removing the existing event forwards while
    // adding the new ones — these are the events the renderer already
    // consumes for streaming / status display.
    for (const [event, name] of [
      ["agent_start", "agent-start"],
      ["agent_end", "agent-end"],
      ["model_select", "model-select"],
      ["session_info_changed", "session-info-changed"],
    ] as const) {
      expect(body).toMatch(
        new RegExp(`api\\.on\\(\\s*"${event}"\\s*,\\s*forward\\(\\s*"${name}"\\s*\\)\\s*\\)`),
      );
    }
  });
});
