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
  // Phase K.2 (v6 §25) restructured `pi-extensions.ts` to declare each
  // builtin extension through a manifest entry first (`{ schema, id, tracks }`)
  // then a separate factory body. The first `"openbuddy-extra-providers"`
  // token now appears inside a manifest block, not inside the factory
  // body. Anchor on the factory's open-paren of the return arrow instead.
  const factoryAnchor = src.indexOf('"openbuddy-extra-providers": (_emit, _config, _options): ExtensionFactory =>');
  if (factoryAnchor === -1) {
    // Fallback for older single-token format (kept for safety).
    const fallbackAnchor = src.indexOf('"openbuddy-extra-providers": ');
    if (fallbackAnchor === -1) throw new Error("openbuddy-extra-providers factory not found");
    return readFactoryBody(fallbackAnchor);
  }
  return readFactoryBody(factoryAnchor);
}

function readFactoryBody(anchor: number): string {
  // Anchor on the factory body opener (the `{` after the `=>` arrow).
  const openBrace = src.indexOf("{", anchor);
  if (openBrace === -1) throw new Error("extra-providers body opener not found");
  let depth = 1;
  for (let i = openBrace + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(openBrace, i + 1);
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

  it("registers an Orcarouter.ai provider pointing at api.orcarouter.ai/v1", () => {
    expect(body).toMatch(
      /api\.registerProvider\(\s*"orcarouter"[\s\S]*?baseUrl:\s*orcarouterBaseUrl/,
    );
  });

  it("honors ORCAROUTER_BASE_URL env var with https://api.orcarouter.ai/v1 default", () => {
    expect(body).toMatch(
      /process\.env\.ORCAROUTER_BASE_URL\s*\?\?\s*"https:\/\/api\.orcarouter\.ai\/v1"/,
    );
  });

  it("only registers orcarouter when ORCAROUTER_API_KEY is set (no default dummy)", () => {
    // Same guard shape as corp-proxy: env-var check precedes registerProvider.
    const guardRe = /if\s*\(\s*orcarouterApiKey\s*\)\s*\{[\s\S]*?api\.registerProvider\(\s*"orcarouter"/;
    expect(body).toMatch(guardRe);
  });
});
