/**
 * probe-minimax-upstream.mjs — evidence-style probe of the live MiniMax
 * endpoint pair documented in `scripts/lib/e2e-credentials.mjs`.
 *
 * Why this exists
 * ---------------
 * `e2e-credentials.mjs` chose `https://api.minimaxi.com/anthropic` as the
 * working host after a manual two-key comparison showed `api.minimax.io`
 * returns 401 for both valid and invalid keys. The argument was empirical,
 * not theoretical, and any future rotation of either host or auth scheme
 * needs the same evidence collected the same way.
 *
 * What this script does
 * ---------------------
 * Reads the credential from `.env.e2e.local` (matched by `*.local` in
 * `.gitignore`, never committed), then exercises the two production wire
 * shapes:
 *
 *   1. Anthropic-Messages: `POST …/anthropic/v1/messages` with `x-api-key`
 *      and `anthropic-version: 2023-06-01` (the shape `agent:providers-test`
 *      and `chat-ui-minimax-real.spec.ts` use).
 *   2. OpenAI Chat Completions: `POST …/v1/chat/completions` with
 *      `Authorization: Bearer …` (the shape every OpenAI-compat provider
 *      uses).
 *
 * It writes a structured JSON report to stdout so it can be diffed between
 * runs. The report NEVER includes the API key — only its length and the
 * upstream status/body. The key is read at runtime, used to set headers,
 * and discarded; nothing in the output tree carries the secret.
 *
 * Usage:
 *   node scripts/electron/probe-minimax-upstream.mjs > probe-report.json
 *
 * Exit code is 0 even on 401 — a 401 here is data, not a failure. The whole
 * point is to capture what the upstream actually returns for the current
 * credential, so we want the probe to always run to completion.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const dotEnvPath = join(root, ".env.e2e.local");

/**
 * Mirror `scripts/lib/e2e-credentials.mjs` resolution order so this probe
 * agrees with the rest of the E2E suite: explicit env vars win, then the
 * gitignored `.env.e2e.local`, then `~/.pi/agent/auth.json`. The probe used
 * to throw ENOENT on any machine without `.env.e2e.local` (which is the
 * common case — the file is gitignored). Falling through keeps the script
 * useful as a sanity check whenever a developer has the key anywhere pi
 * itself would find it.
 */
function parseDotEnv(text) {
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

function readPiApiKey(provider) {
  const authPath = join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".pi", "agent", "auth.json");
  if (!existsSync(authPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(authPath, "utf8"));
    const entry = parsed?.[provider];
    if (!entry) return undefined;
    const key = typeof entry === "string" ? entry : (entry.key ?? entry.apiKey);
    return typeof key === "string" && key.length > 0 ? key : undefined;
  } catch {
    return undefined;
  }
}

const localEnv = existsSync(dotEnvPath) ? parseDotEnv(readFileSync(dotEnvPath, "utf8")) : {};
const apiKey = process.env.OPENBUDDY_E2E_API_KEY || localEnv.OPENBUDDY_E2E_API_KEY || readPiApiKey("minimax") || readPiApiKey("minimax-cn");
const report = {
  schema: "openbuddy.minimax-probe.v1",
  generatedAt: new Date().toISOString(),
  ok: false,
  evidence: {
    credentialLength: apiKey?.length ?? 0,
    credentialShape: "JWT (RS256) — see scripts/electron/probe-minimax-upstream.mjs header",
    attempts: [],
  },
};

const cases = [
  {
    label: "anthropic-messages-bearer",
    url: "https://api.minimaxi.com/anthropic/v1/messages",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      authorization: `Bearer ${apiKey}`,
    },
    model: "MiniMax-M3",
  },
  {
    label: "anthropic-messages-x-api-key",
    url: "https://api.minimaxi.com/anthropic/v1/messages",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "X-Api-Key": apiKey,
    },
    model: "MiniMax-M3",
  },
  {
    label: "anthropic-messages-x-api-key-M2.7",
    url: "https://api.minimaxi.com/anthropic/v1/messages",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "X-Api-Key": apiKey,
    },
    model: "MiniMax-M2.7",
  },
  {
    label: "openai-chat-bearer-MiniMax-M3",
    url: "https://api.minimaxi.com/v1/chat/completions",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    model: "MiniMax-M3",
  },
  {
    label: "openai-chat-bearer-MiniMax-Text-01",
    url: "https://api.minimaxi.com/v1/chat/completions",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    model: "MiniMax-Text-01",
  },
];

let saw2xx = false;
for (const c of cases) {
  const body = JSON.stringify({
    model: c.model,
    max_tokens: 16,
    messages: [{ role: "user", content: "Reply with the single word PONG." }],
  });
  const t0 = Date.now();
  try {
    const res = await fetch(c.url, { method: "POST", headers: c.headers, body });
    const text = await res.text();
    if (res.status >= 200 && res.status < 300) saw2xx = true;
    report.evidence.attempts.push({
      case: c.label,
      url: c.url,
      model: c.model,
      status: res.status,
      ms: Date.now() - t0,
      body: text.slice(0, 400),
    });
  } catch (err) {
    report.evidence.attempts.push({
      case: c.label,
      url: c.url,
      error: String(err),
    });
  }
}

report.ok = saw2xx;
console.log(JSON.stringify(report, null, 2));
