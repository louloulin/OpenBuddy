/**
 * MVP-2 — regression test for part-aware loadSession replay.
 *
 * Historical sessions persisted with the Pi JSONL content-parts schema
 * (`text` / `thinking` / `toolCall` / `image`) used to replay as plain
 * text only — `textOf(message.content)` joined all parts, dropping
 * thought blocks, tool calls, and images. The MVP-2 fix dispatches each
 * part type to its corresponding `pi://update` event so the renderer
 * rehydrates the full transcript.
 *
 * This test pins the wire contract by reading the production source and
 * asserting the per-type emit patterns are present. Pinning the contract
 * (rather than mocking the full agent host) keeps the test fast and
 * brittle-free against non-essential refactors.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC_PATH = resolve(__dirname, "../agent/host-modules/session-store.ts");
const src = readFileSync(SRC_PATH, "utf-8");

function extractLoadSessionBody(): string {
  // The function declaration spans a type literal (options?: { ... }) before
  // its body opener, so a naive `indexOf("{")` lands inside the type. Anchor
  // on the return-type annotation instead and grab the `{` that follows it.
  const declMatch = src.match(/async function loadSession\([^)]*\)[^:]*:\s*Promise<void>\s*\{/);
  if (!declMatch) throw new Error("loadSession declaration not found");
  const openStart = declMatch.index! + declMatch[0].length - 1;
  let depth = 1;
  for (let i = openStart + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(openStart, i + 1);
    }
  }
  throw new Error("Could not find end of loadSession body");
}

const body = extractLoadSessionBody();

describe("loadSession replay — MVP-2 part-aware dispatch", () => {
  it("emits user_message_replay for user-role text parts", () => {
    const re = /message\.role\s*===\s*"user"[\s\S]*?type:\s*"user_message_replay"/;
    expect(body).toMatch(re);
  });

  it("emits agent_thought_chunk for thinking parts (the regression fix)", () => {
    // The MVP-2 fix specifically adds this branch — without it, historical
    // thoughts vanish after a session reload.
    const re = /p\.type\s*===\s*"thinking"[\s\S]*?type:\s*"agent_thought_chunk"/;
    expect(body).toMatch(re);
  });

  it("emits tool_call events for toolCall parts", () => {
    const re = /p\.type\s*===\s*"toolCall"[\s\S]*?type:\s*"tool_call"/;
    expect(body).toMatch(re);
  });

  it("emits image content for image parts (user + assistant paths)", () => {
    // Both branches must include image forwarding so attachments survive reload.
    const userRe = /p\.type\s*===\s*"image"[\s\S]*?user_message_replay[\s\S]*?type:\s*"image"/;
    const assistantRe = /p\.type\s*===\s*"image"[\s\S]*?agent_message_chunk[\s\S]*?type:\s*"image"/;
    expect(body).toMatch(userRe);
    expect(body).toMatch(assistantRe);
  });

  it("dispatches via the part-aware branch when content is a non-empty array", () => {
    // Ensures we do NOT fall through to textOf-only when parts are present.
    const re = /Array\.isArray\(message\.content\)\s*&&\s*message\.content\.length\s*>\s*0/;
    expect(body).toMatch(re);
  });

  it("falls back to textOf dispatch when content is empty (legacy sessions)", () => {
    const re = /textOf\(message\.content\)/;
    expect(body).toMatch(re);
  });
});
