/**
 * MVP-8 — regression test for compact-announce user-message injection.
 *
 * When the Pi SDK fires `session_compact`, OpenBuddy now uses
 * `pi.sendUserMessage` to inject a structured note into the transcript
 * explaining what was reclaimed. This makes compaction visible to the
 * user without requiring a separate UI surface.
 *
 * This test pins:
 *   - The factory exists in builtinPiExtensionFactories
 *   - It guards on `api.sendUserMessage` (no-op when the SDK lacks it)
 *   - It subscribes to `session_compact`
 *   - It surfaces the reclaimed-tokens math (tokensBefore - tokensAfter)
 *   - It surfaces the compaction reason (manual / threshold / overflow)
 *   - It guards older SDK builds that lack sendUserMessage
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC_PATH = resolve(__dirname, "../agent/pi-extensions.ts");
const src = readFileSync(SRC_PATH, "utf-8");

function extractAnnounceBody(): string {
  const start = src.indexOf('"openbuddy-pi-compact-announce"');
  if (start === -1) throw new Error("openbuddy-pi-compact-announce factory not found");
  const openBrace = src.indexOf(": ExtensionFactory => (pi) => {", start);
  if (openBrace === -1) throw new Error("announce body opener not found");
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
  throw new Error("could not find end of announce body");
}

const body = extractAnnounceBody();

describe("openbuddy-pi-compact-announce — MVP-8 sendUserMessage injection", () => {
  it("guards on api.sendUserMessage (no-op for older SDK builds)", () => {
    expect(body).toMatch(
      /typeof\s+api\.sendUserMessage\s*!==\s*"function"\s*\)\s*return/,
    );
  });

  it("subscribes to session_compact", () => {
    expect(body).toMatch(/api\.on\(\s*"session_compact"\s*,/);
  });

  it("computes reclaimed tokens as tokensBefore - tokensAfter", () => {
    // The local variables `before` / `after` come from tokensBefore /
    // tokensAfter; assert the subtraction rather than the field names so
    // the test stays robust if we rename the locals.
    expect(body).toMatch(/before\s*-\s*after/);
  });

  it("surfaces the compaction reason (manual / threshold / overflow)", () => {
    expect(body).toMatch(/reason\s*\?\?\s*"manual"/);
  });

  it("calls sendUserMessage with structured lines", () => {
    expect(body).toMatch(/api\.sendUserMessage!\(lines\.join\(/);
  });

  it("truncates the embedded summary preview to 240 chars", () => {
    expect(body).toMatch(/oneLine\.length\s*>\s*240/);
  });

  it("tags the injected message source as 'extension' (auditability)", () => {
    expect(body).toMatch(/source:\s*"extension"/);
  });
});
