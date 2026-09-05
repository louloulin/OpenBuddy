/**
 * MVP-6 — regression test for the first-class provider registrations.
 *
 * OpenBuddy previously routed custom providers through the local
 * `models.json` catalog, but local Ollama was a top user request and
 * had no first-class provider entry. After this fix the new
 * `openbuddy-extra-providers` extension calls `pi.registerProvider(...)`
 * for Ollama (always) and an optional corporate proxy (when
 * OPENBUDDY_PROXY_BASE_URL is set).
 *
 * This test pins:
 *   - The factory exists in builtinPiExtensionFactories
 *   - It registers "ollama" with the openai-completions-shaped baseUrl
 *   - It honors OLLAMA_HOST when present (default localhost:11434)
 *   - It only registers "corp-proxy" when OPENBUDDY_PROXY_BASE_URL is set
 *
 * We assert against the factory's source text rather than mocking the
 * pi API — same pattern as MVP-1 / MVP-2 — so the test stays focused
 * on the contract we care about.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC_PATH = resolve(__dirname, "../agent/pi-extensions.ts");
const src = readFileSync(SRC_PATH, "utf-8");

function extractExtraProvidersBody(): string {
  const start = src.indexOf('"openbuddy-extra-providers"');
  if (start === -1) throw new Error("openbuddy-extra-providers factory not found");
  // Anchor on the factory body opener.
  const openBrace = src.indexOf(": ExtensionFactory => (pi) => {", start);
  if (openBrace === -1) throw new Error("extra-providers body opener not found");
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
  throw new Error("could not find end of extra-providers body");
}

const body = extractExtraProvidersBody();

describe("openbuddy-extra-providers — MVP-6 first-class providers", () => {
  it("registers an Ollama provider pointing at /v1 (OpenAI-compat)", () => {
    expect(body).toMatch(
      /api\.registerProvider\(\s*"ollama"[\s\S]*?baseUrl:\s*`\$\{ollamaBaseUrl\}\/v1`/,
    );
  });

  it("honors OLLAMA_HOST env var and defaults to localhost:11434", () => {
    expect(body).toMatch(/process\.env\.OLLAMA_HOST\s*\?\?\s*"http:\/\/localhost:11434"/);
  });

  it("uses apiKey 'ollama' (Ollama ignores Authorization header but the SDK requires a non-empty key)", () => {
    expect(body).toMatch(/apiKey:\s*"ollama"/);
  });

  it("only registers corp-proxy when OPENBUDDY_PROXY_BASE_URL is set (no default dummy)", () => {
    // The guard must precede the registerProvider call so the default
    // install doesn't ship a placeholder corporate endpoint.
    const guardRe = /if\s*\(\s*proxyBaseUrl\s*\)\s*\{[\s\S]*?api\.registerProvider\(\s*"corp-proxy"/;
    expect(body).toMatch(guardRe);
  });

  it("guards against missing pi.registerProvider (older SDK builds)", () => {
    expect(body).toMatch(
      /typeof\s+api\.registerProvider\s*!==\s*"function"\s*\)\s*return/,
    );
  });

  it("keeps models:[] so pi's discovery layer fills them on next /v1/models fetch", () => {
    // Empty models array signals to pi that this provider is alive but
    // model list should be fetched on demand, not statically defined.
    expect(body).toMatch(/models:\s*\[\s*\]/);
  });
});
