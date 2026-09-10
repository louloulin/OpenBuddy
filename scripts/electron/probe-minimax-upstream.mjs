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
import { readFileSync } from "node:fs";

const envText = readFileSync(".env.e2e.local", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) continue;
  env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
}

const apiKey = env.OPENBUDDY_E2E_API_KEY;
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
