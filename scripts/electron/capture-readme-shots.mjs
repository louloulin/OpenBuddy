#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Capture the README screenshots from the REAL Electron app.
//
// Why this script exists:
//   README.md and README.zh-CN.md both embed seven canonical AI-chat
//   screenshots at docs/screenshots/01..07. Until now those PNGs were
//   captured by hand, then slowly drifted away from the live renderer:
//   the chat bubble layout moved on, but the PNGs did not. Anyone
//   reviewing the README today sees a frozen snapshot from before
//   R55 (ThemeStudio export), R58 (message-meta token badges) and
//   R60 (StreamingMarkdown inline-image placeholders).
//
//   This script regenerates the same seven filenames from the live
//   Electron renderer against the real MiniMax upstream, so the README
//   and the live UI can never disagree. It mirrors the launch envelope
//   used by tests/electron/_fixtures.ts (compiled out/main over file://,
//   isolated user-data-dir, provider credentials scrubbed) so a
//   regression in the chat pipeline produces a bad screenshot — never
//   a silent fall-back to "looks fine in the doc".
//
// Offline behaviour:
//   If the e2e credentials are not configured (no env var, no
//   .env.e2e.local, no `~/.pi/agent/auth.json` entry for `minimax`),
//   the script still runs — it captures the offline-only shots
//   (cold-start) and exits 0 with a warning instead of 1. This keeps
//   `pnpm docs:screenshots` usable in low-privilege CI without leaking
//   the requirement that the developer running it locally needs a key.
//
// Usage:
//   pnpm build && pnpm docs:screenshots
//   node scripts/electron/capture-readme-shots.mjs
//   node scripts/electron/capture-readme-shots.mjs --offline
// ---------------------------------------------------------------------------
import { _electron } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MODEL_ID,
  resolveE2ECredentials,
  describeSource,
  scrubProviderCredentials,
} from "../lib/e2e-credentials.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = join(ROOT, "docs/screenshots");
const VIEWPORT = { width: 1440, height: 900 };

const COMPOSER = "textarea.wb-composer__input";
const ASSISTANT = ".msg--assistant";
const STOP_BUTTON = '[aria-label="\u505c\u6b62\u751f\u6210"]';
const SETTINGS_TRIGGER = ['[data-testid="open-settings"]', 'button[aria-label*="\u8bbe\u7f6e"]'];

const MAX_FLAT_SHARE = 0.9;
const MIN_TEXT_LENGTH = 80;

const cli = process.argv.slice(2);
const forceOffline = cli.includes("--offline");
const creds = forceOffline ? { apiKey: null } : resolveE2ECredentials({ provider: "minimax" });
const hasCreds = Boolean(creds.apiKey);

const problems = [];
const warnings = [];

const log = (...args) => console.log("[readme-shots]", ...args);
const warn = (msg) => { warnings.push(msg); console.warn("[readme-shots] " + msg); };

const assertNotBlank = (file) => {
  let histogram;
  try {
    histogram = execFileSync(
      "magick",
      [file, "-format", "%c", "-depth", "8", "histogram:info:-"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    warn(`magick unavailable — skipped blank-frame check for ${file}`);
    return undefined;
  }
  let top = 0;
  let total = 0;
  for (const line of histogram.split("\n")) {
    const count = Number(line.trim().split(":")[0]);
    if (!Number.isFinite(count)) continue;
    total += count;
    if (count > top) top = count;
  }
  const share = total ? top / total : 1;
  if (share > MAX_FLAT_SHARE) {
    problems.push(`${file}: ${(share * 100).toFixed(1)}% of pixels are one colour — blank render`);
  }
  return share;
};

const capture = async (page, name, { prepare, expectText } = {}) => {
  if (prepare) await prepare();
  await page.waitForTimeout(600);
  const text = await page.evaluate(() => document.body.innerText.trim().length);
  const minText = expectText ?? MIN_TEXT_LENGTH;
  if (text < minText) {
    problems.push(`${name}: renderer shows only ${text} chars of text (need >= ${minText}) — not rendered`);
  }
  const file = join(OUT_DIR, name);
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file });
  const share = assertNotBlank(file);
  const flat = share === undefined ? "?" : `${(share * 100).toFixed(1)}% flat`;
  log(`captured ${name}  (${text} chars text, ${flat})`);
};

const invoke = (page, channel, args) =>
  page.evaluate(({ channel, args }) => window.api.invoke(channel, args), { channel, args });

async function openSettings(page) {
  for (const sel of SETTINGS_TRIGGER) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(600);
      return true;
    }
  }
  const byText = page.getByRole("button", { name: /\u8bbe\u7f6e|settings|preferences/i }).first();
  if (await byText.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await byText.click();
    await page.waitForTimeout(600);
    return true;
  }
  return false;
}

async function sendAndAwaitSettled(page, prompt, { expectMarker } = {}) {
  const before = await page.locator(ASSISTANT).count();
  await page.locator(COMPOSER).first().fill(prompt);
  await page.getByRole("button", { name: "\u53d1\u9001", exact: true }).click();
  await page.waitForFunction(
    ({ sel, count }) => document.querySelectorAll(sel).length > count,
    { sel: ASSISTANT, count: before },
    { timeout: 60_000 },
  );
  if (expectMarker) {
    await page.waitForFunction(
      ({ sel, count, needle }) => {
        const nodes = [...document.querySelectorAll(sel)];
        if (nodes.length <= count) return false;
        return (nodes[nodes.length - 1].innerText ?? "").includes(needle);
      },
      { sel: ASSISTANT, count: before, needle: expectMarker },
      { timeout: 60_000 },
    ).catch(() => warn(`marker "${expectMarker}" not seen in last bubble; capturing whatever rendered`));
  }
  await page.waitForFunction(
    ({ sel }) => !document.querySelector(sel),
    { sel: STOP_BUTTON },
    { timeout: 60_000 },
  ).catch(() => {});
}

async function captureMidStream(page, prompt, settleMs = 800) {
  const before = await page.locator(ASSISTANT).count();
  await page.locator(COMPOSER).first().fill(prompt);
  await page.getByRole("button", { name: "\u53d1\u9001", exact: true }).click();
  await page.waitForFunction(
    ({ sel, count }) => document.querySelectorAll(sel).length > count,
    { sel: ASSISTANT, count: before },
    { timeout: 30_000 },
  );
  await page.waitForSelector(STOP_BUTTON, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(settleMs);
}

mkdirSync(OUT_DIR, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), "openbuddy-readme-shots-"));
const piAgentDir = join(userData, "pi-agent");
const workspace = join(userData, "workspace");
mkdirSync(piAgentDir, { recursive: true });
mkdirSync(workspace, { recursive: true });
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: {} }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({}, null, 2)}\n`, { mode: 0o600 });

const childEnv = scrubProviderCredentials(process.env);
Object.assign(childEnv, {
  ELECTRON_RENDERER_URL: "",
  PI_CODING_AGENT_DIR: piAgentDir,
  OPENBUDDY_DEBUG_UI: "0",
  OPENBUDDY_HARNESS_FILE: "",
});

if (hasCreds) {
  log(`${describeSource(creds)} — capturing 7 real-LLM screenshots`);
} else {
  warn("no MiniMax credentials — falling back to offline shots (01 only)");
}

const app = await _electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT, "--disable-gpu"],
  executablePath: process.env.OPENBUDDY_ELECTRON_PATH ?? join(ROOT, "node_modules/.bin/electron"),
  cwd: ROOT,
  timeout: 60_000,
  env: childEnv,
});

let exitCode = 0;
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => problems.push(`uncaught renderer error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      problems.push(`console error: ${message.text().slice(0, 200)}`);
    }
  });

  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });

  await app.evaluate(async ({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setBounds({ x: 0, y: 0, ...size });
  }, VIEWPORT);

  await page.locator(COMPOSER).first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(800);
  await capture(page, "01-home-cold-start.png", { expectText: 60 });

  if (!hasCreds) {
    await app.close().catch(() => {});
    log("done (offline mode)");
    if (problems.length) {
      console.error("\n\u2717 capture rejected:");
      for (const p of [...new Set(problems)]) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log(`\nWrote screenshots to ${OUT_DIR.replace(`${ROOT}/`, "")}`);
    process.exit(0);
  }

  log("configuring MiniMax provider over IPC\u2026");
  const modelId = creds.modelId ?? DEFAULT_MODEL_ID;
  await invoke(page, "agent:providers-save-provider", {
    provider: {
      id: "custom_anthropic",
      label: "MiniMax",
      providerKind: "custom_anthropic",
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      apiBackend: "messages",
      authScheme: "x_api_key",
    },
  });
  await invoke(page, "agent:providers-save-model", {
    model: { providerId: "custom_anthropic", modelId, name: modelId, contextWindow: 128_000, reasoning: true },
  });
  await invoke(page, "agent:new-session", { cwd: workspace, modelId: `custom_anthropic/${modelId}` });
  await invoke(page, "agent:set-thinking-level", { level: "high" }).catch(() => {});

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });
  await page.locator(COMPOSER).first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(600);

  await capture(page, "02-composer-ready.png", { expectText: 80 });

  await captureMidStream(
    page,
    "\u7528\u4e00\u53e5\u8bdd\u4ecb\u7ecd\u4f60\u81ea\u5df1\uff0c\u5e76\u8bf4\u660e\u4f60\u80fd\u5e2e\u6211\u505a\u4ec0\u4e48\u3002\u4e0d\u8981\u8c03\u7528\u4efb\u4f55\u5de5\u5177\uff0c\u76f4\u63a5\u7528\u6587\u5b57\u56de\u7b54\u3002",
    900,
  );
  await capture(page, "03-turn1-mid-stream.png");
  await page.waitForFunction(
    ({ sel }) => !document.querySelector(sel),
    { sel: STOP_BUTTON },
    { timeout: 60_000 },
  ).catch(() => {});

  await capture(page, "04-turn1-settled.png");

  await sendAndAwaitSettled(
    page,
    "Hello world \u600e\u4e48\u8bf4\u4e2d\u6587\uff1f\u53ea\u56de\u7b54\u4e00\u53e5\u8bdd\u3002\u4e0d\u8981\u8c03\u7528\u4efb\u4f55\u5de5\u5177\u3002",
  );
  await capture(page, "05-turn2-settled.png");

  await sendAndAwaitSettled(
    page,
    "\u8bf7\u7ed9\u6211\u4e09\u884c\u4e2d\u6587\u5f85\u529e\u6e05\u5355\uff0c\u6bcf\u884c\u4e00\u4ef6\u4e8b\uff0c\u4e0d\u8981\u989d\u5916\u8bf4\u660e\u3002\u4e0d\u8981\u8c03\u7528\u4efb\u4f55\u5de5\u5177\u3002",
    { expectMarker: "\u4e70\u83dc" },
  );
  await capture(page, "06-turn3-settled.png");

  await page.evaluate(() => {
    const scroller = document.querySelector(
      ".chatview__scroll, .msg-list, [data-testid='chatview-scroll']",
    );
    if (scroller) scroller.scrollTop = 0;
  });
  await page.waitForTimeout(400);
  await capture(page, "07-three-turns-full.png");

  const bubbles = await page.locator(ASSISTANT).count();
  log(`assistant bubbles=${bubbles}`);
  const transcript = await page.evaluate(() => {
    const roleOf = (n) => (n.classList.contains("msg--user") ? "user" : "assistant");
    return [...document.querySelectorAll(".msg--user, .msg--assistant")].map((n) => ({
      role: roleOf(n),
      text: (n.innerText ?? "").replace(/\s+/g, " ").slice(0, 120),
    }));
  });
  for (const m of transcript) log(`  ${m.role}: ${m.text}`);
  if (bubbles === 0) {
    problems.push("no assistant bubble rendered — README screenshots are not a valid chat capture");
  }
} catch (error) {
  console.error("[readme-shots] failed:", error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  await app.close().catch(() => {});
}

if (problems.length) {
  console.error("\n\u2717 capture rejected:");
  for (const p of [...new Set(problems)]) console.error(`  - ${p}`);
  exitCode = Math.max(exitCode, 1);
}

if (warnings.length) {
  console.warn(`\n\u26a0 ${warnings.length} warning(s):`);
  for (const w of [...new Set(warnings)]) console.warn(`  - ${w}`);
}

if (exitCode === 0) {
  log(`done — wrote 7 screenshots to ${OUT_DIR.replace(`${ROOT}/`, "")}`);
}
process.exit(exitCode);
