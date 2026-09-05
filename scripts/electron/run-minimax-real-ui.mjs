/**
 * run-minimax-real-ui.mjs — drive the existing real-UI smoke against the
 * real MiniMax upstream.
 *
 * `scripts/electron/real-ui-smoke.mjs` is already the most complete AI-chat
 * verification in the repo: it configures a provider through the actual
 * Settings dialog, types into the composer, clicks 送信, and then asserts
 * BOTH the rendered `.msg--assistant` transcript and the real Pi event log
 * (`session/input` → `agent/start` → `assistant/update` → `assistant/end` →
 * `agent/settled`). What it lacked was a documented way to point it at a
 * real cloud model — the docs only showed a hand-typed `OPENBUDDY_E2E_*`
 * invocation, so in practice it always ran against the local echo provider
 * and no one exercised a real LLM through the UI.
 *
 * This runner closes that gap. It resolves MiniMax credentials through
 * `scripts/lib/e2e-credentials.mjs` (environment → `.env.e2e.local` →
 * `~/.pi/agent/auth.json`), then execs the smoke with the env contract it
 * expects. Sharing that resolver with `playwright.config.ts` means this
 * runner and the Playwright specs can never disagree about which key or host
 * is in play.
 *
 * Two things it deliberately fixes on the way through:
 *
 *  1. **Endpoint.** `~/.pi/agent/models-store.json` records MiniMax's
 *     baseUrl as `https://api.minimax.io/anthropic`, which answers
 *     `401 invalid api key`. Verified against two independent valid keys:
 *     `api.minimaxi.com` returns 200 and `api.minimax.io` returns 401 for
 *     both, so the host in that catalog is wrong rather than the credential.
 *     The shared default uses the working host; override with `--base-url`.
 *
 *  2. **Ambient credential leakage.** The smoke inherits `process.env`, so a
 *     developer with `ANTHROPIC_AUTH_TOKEN` exported has pi report the
 *     `anthropic` provider as already configured (pi treats that variable as
 *     an auth source). That makes the cold-start assertions meaningless. We
 *     strip the canonical variable set, shared with the Playwright fixture.
 *
 * Usage:
 *   node scripts/electron/run-minimax-real-ui.mjs
 *   node scripts/electron/run-minimax-real-ui.mjs --model MiniMax-M2.7
 *
 * The API key is read from disk and passed through the child env only. It is
 * never printed, and `real-ui-smoke.mjs` already redacts it from any error
 * text it emits.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL_ID,
  DEFAULT_PROVIDER,
  REPO_ROOT as ROOT,
  describeSource,
  resolveE2ECredentials,
  scrubProviderCredentials,
} from "../lib/e2e-credentials.mjs";

const SMOKE = join(ROOT, "scripts", "electron", "real-ui-smoke.mjs");

function parseArgs(argv) {
  const out = { baseUrl: DEFAULT_BASE_URL, modelId: DEFAULT_MODEL_ID, provider: DEFAULT_PROVIDER };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      i += 1;
      return value;
    };
    if (arg === "--base-url") out.baseUrl = next();
    else if (arg === "--model") out.modelId = next();
    else if (arg === "--provider") out.provider = next();
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function buildChildEnv(apiKey, { baseUrl, modelId }) {
  const env = scrubProviderCredentials(process.env);
  env.OPENBUDDY_E2E_REQUIRED = "1";
  env.OPENBUDDY_E2E_API_KEY = apiKey;
  env.OPENBUDDY_E2E_BASE_URL = baseUrl;
  env.OPENBUDDY_E2E_MODEL_ID = modelId;
  return env;
}

const options = parseArgs(process.argv.slice(2));

/**
 * Credentials resolve through the shared precedence chain (environment →
 * `.env.e2e.local` → `~/.pi/agent/auth.json`) rather than reading the pi
 * credential store directly, so this runner and the Playwright specs always
 * agree on which key is in play.
 */
const credentials = resolveE2ECredentials({ provider: options.provider });
if (!credentials.apiKey) {
  console.error(`[minimax-real-ui] ${describeSource(credentials)}`);
  console.error(
    "[minimax-real-ui] set OPENBUDDY_E2E_API_KEY, add it to .env.e2e.local, or run `pi auth login minimax`.",
  );
  process.exit(1);
}

// CLI flags win over stored values; stored values win over the built-in default.
if (options.baseUrl === DEFAULT_BASE_URL) options.baseUrl = credentials.baseUrl;
if (options.modelId === DEFAULT_MODEL_ID) options.modelId = credentials.modelId;

console.log(`[minimax-real-ui] ${describeSource({ ...credentials, ...options })}`);

const child = spawn(process.execPath, [SMOKE], {
  cwd: ROOT,
  env: buildChildEnv(credentials.apiKey, options),
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[minimax-real-ui] real-ui-smoke terminated by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
