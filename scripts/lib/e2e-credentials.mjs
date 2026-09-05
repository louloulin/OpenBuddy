/**
 * e2e-credentials.mjs — single source of truth for real-model E2E credentials
 * and for ambient provider-credential scrubbing.
 *
 * ## Why this module exists
 *
 * Two problems were solved by copy-paste before this file existed:
 *
 * 1. **Real-model coverage was zero.** `minimax-real-roundtrip.spec.ts` and
 *    `session-history-load.spec.ts` skip unless `OPENBUDDY_E2E_API_KEY` and
 *    `OPENBUDDY_E2E_BASE_URL` are exported. Nobody exports them, so a normal
 *    `npx playwright test` run reported "79 passed / 7 skipped" while six of
 *    those skips were the only tests that would ever touch a real LLM.
 *    Credentials now resolve from disk, so the real-model specs run whenever
 *    the machine actually has a usable key and skip only when it does not.
 *
 * 2. **The scrub list had drifted into three different versions.**
 *    `tests/electron/_fixtures.ts`, `run-minimax-real-ui.mjs`, and
 *    `diagnose-chat-stall.mjs` each carried their own literal array; the two
 *    script copies were missing ~15 variables the fixture had (AWS_*,
 *    AZURE_OPENAI_API_KEY, TOGETHER_API_KEY, ...). A variable missing from
 *    the list is an ambient credential leaking into the app under test, which
 *    silently flips `agent:auth-status.ready` to true. One list, imported
 *    everywhere, is the only way this stays correct.
 *
 * ## Resolution order (first hit wins)
 *
 *   1. `OPENBUDDY_E2E_API_KEY` / `_BASE_URL` / `_MODEL_ID` in the environment
 *      — explicit invocation always beats stored config.
 *   2. `.env.e2e.local` at the repo root — machine-local, matched by the
 *      existing `*.local` rule in `.gitignore`, so it is never committed.
 *   3. `~/.pi/agent/auth.json` — where `pi auth login <provider>` stores keys.
 *
 * Nothing here logs a key. `describeSource()` exists so callers can report
 * provenance and key length without exposing the value.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root, resolved from this file's own location (scripts/lib/ → ../..). */
export const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** Machine-local credential file, gitignored via the `*.local` rule. */
export const DOTENV_LOCAL_PATH = join(REPO_ROOT, ".env.e2e.local");

/**
 * The MiniMax host that actually accepts these credentials.
 *
 * `~/.pi/agent/models-store.json` records every MiniMax model's baseUrl as
 * `https://api.minimax.io/anthropic`, which answers `401 invalid api key`.
 * Verified against both the key in the pi credential store and a freshly
 * issued one: `api.minimaxi.com` returns 200, `api.minimax.io` returns 401
 * for both. So the host is wrong in that catalog, not the key — do not
 * "fix" a 401 here by rotating credentials.
 */
export const DEFAULT_BASE_URL = "https://api.minimaxi.com/anthropic";
export const DEFAULT_MODEL_ID = "MiniMax-M3";
export const DEFAULT_PROVIDER = "minimax";

/**
 * Environment variables that pi treats as a configured auth source.
 *
 * `pi-ai`'s `getApiKeyEnvVars()` (`node_modules/@earendil-works/pi-ai/dist/
 * env-api-keys.js`) resolves provider credentials from these, which flows up
 * through `ModelRuntime.hasConfiguredAuth()` into
 * `electron/main/agent/host-modules/agent-model.ts:authStatus()` and finally
 * `apiReady` in the renderer. Any of them present in the child env makes the
 * app under test believe a provider is already configured.
 *
 * `OPENBUDDY_E2E_*` are deliberately NOT scrubbed: those are read by the test
 * process to decide whether to skip, never by the app.
 */
export const PROVIDER_CREDENTIAL_ENV_VARS = Object.freeze([
  // Anthropic — all three participate in pi's env discovery.
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  // Other first-party providers pi maps to a single env var each.
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "AZURE_OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_CLOUD_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "DEEPSEEK_API_KEY",
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "XAI_API_KEY",
  "MISTRAL_API_KEY",
  "MINIMAX_API_KEY",
  "MINIMAX_CN_API_KEY",
  "MOONSHOT_API_KEY",
  "KIMI_API_KEY",
  "ZAI_API_KEY",
  "OPENROUTER_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "BASETEN_API_KEY",
  "NVIDIA_API_KEY",
  "HF_TOKEN",
  "COPILOT_GITHUB_TOKEN",
  "OPENCODE_API_KEY",
  "AI_GATEWAY_API_KEY",
  "CLOUDFLARE_API_KEY",
  "XIAOMI_API_KEY",
  // Amazon Bedrock treats any of these as "authenticated".
  "AWS_PROFILE",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_BEARER_TOKEN_BEDROCK",
]);

/**
 * Returns a copy of `env` with every ambient provider credential removed, so
 * the app under test boots with zero configured providers regardless of the
 * developer's shell. Undefined entries are dropped because Playwright's `env`
 * option requires string values.
 */
export function scrubProviderCredentials(env) {
  const scrubbed = new Set(PROVIDER_CREDENTIAL_ENV_VARS);
  const result = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (scrubbed.has(key)) continue;
    result[key] = String(value);
  }
  return result;
}

/**
 * Minimal `.env` parser — `KEY=value` per line, `#` comments, optional
 * surrounding quotes. Deliberately not a dotenv dependency: this runs from
 * both Playwright's TS loader and bare `node scripts/...`, and the format we
 * need is three flat keys.
 */
export function parseDotEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Reads `.env.e2e.local` if present. Returns `{}` when absent or unreadable. */
export function readDotEnvLocal(path = DOTENV_LOCAL_PATH) {
  if (!existsSync(path)) return {};
  try {
    return parseDotEnv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Reads a provider's API key out of the pi credential store. Returns
 * `undefined` rather than throwing so callers can fall through to "skip".
 */
export function readPiApiKey(providerId = DEFAULT_PROVIDER) {
  const authPath = join(homedir(), ".pi", "agent", "auth.json");
  try {
    const parsed = JSON.parse(readFileSync(authPath, "utf8"));
    const entry = parsed?.[providerId];
    if (!entry) return undefined;
    const key = typeof entry === "string" ? entry : (entry.key ?? entry.apiKey);
    return typeof key === "string" && key.length > 0 ? key : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves real-model credentials using the documented precedence.
 *
 * Returns `{ apiKey, baseUrl, modelId, source }` where `apiKey` is
 * `undefined` when no source has one — callers should skip in that case
 * rather than fail, so a machine without credentials still runs the rest of
 * the suite.
 */
export function resolveE2ECredentials({ provider = DEFAULT_PROVIDER, env = process.env } = {}) {
  const local = readDotEnvLocal();

  const pick = (name) => {
    const fromEnv = env[name]?.trim();
    if (fromEnv) return { value: fromEnv, source: "env" };
    const fromLocal = local[name]?.trim();
    if (fromLocal) return { value: fromLocal, source: ".env.e2e.local" };
    return undefined;
  };

  const key = pick("OPENBUDDY_E2E_API_KEY");
  const base = pick("OPENBUDDY_E2E_BASE_URL");
  const model = pick("OPENBUDDY_E2E_MODEL_ID");

  let apiKey = key?.value;
  let source = key?.source;
  if (!apiKey) {
    apiKey = readPiApiKey(provider);
    if (apiKey) source = "~/.pi/agent/auth.json";
  }

  return {
    apiKey,
    baseUrl: base?.value ?? DEFAULT_BASE_URL,
    modelId: model?.value ?? DEFAULT_MODEL_ID,
    provider,
    source: apiKey ? source : "none",
  };
}

/** Human-readable provenance line that never contains the key itself. */
export function describeSource(creds) {
  if (!creds.apiKey) return "no credentials found (env, .env.e2e.local, ~/.pi/agent/auth.json)";
  return `provider=${creds.provider} model=${creds.modelId} baseUrl=${creds.baseUrl} key=<${creds.apiKey.length} chars from ${creds.source}>`;
}

/**
 * Populates `process.env.OPENBUDDY_E2E_*` from resolved credentials without
 * overwriting values already set explicitly. Playwright specs read those
 * variables at module load to decide whether to skip, so calling this from
 * `playwright.config.ts` is what makes stored credentials visible to them.
 *
 * Returns the resolved credentials for logging.
 */
export function hydrateE2EEnv({ provider = DEFAULT_PROVIDER, env = process.env } = {}) {
  const creds = resolveE2ECredentials({ provider, env });
  if (creds.apiKey) {
    env.OPENBUDDY_E2E_API_KEY ??= creds.apiKey;
    env.OPENBUDDY_E2E_BASE_URL ??= creds.baseUrl;
    env.OPENBUDDY_E2E_MODEL_ID ??= creds.modelId;
  }
  return creds;
}
