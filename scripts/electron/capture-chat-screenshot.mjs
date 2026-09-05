/**
 * capture-chat-screenshot.mjs — drive a REAL MiniMax conversation through the
 * Electron UI and screenshot the chat transcript for the README.
 *
 * This is deliberately built on the same real-model path the verification specs
 * use (shared credential resolver, real provider registration over IPC, typing
 * into the actual composer). The screenshot therefore shows a genuine model
 * turn rendered by the production renderer — not a mock, not a hand-made
 * mockup. If the chat pipeline regressed, this script would capture the
 * regression rather than hide it.
 *
 * Usage:
 *   node scripts/electron/capture-chat-screenshot.mjs
 *   node scripts/electron/capture-chat-screenshot.mjs --out docs/screenshots/chat-minimax.png
 *
 * Credentials resolve through scripts/lib/e2e-credentials.mjs
 * (env -> .env.e2e.local -> ~/.pi/agent/auth.json). Exits non-zero with a
 * clear message when none are available.
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DEFAULT_MODEL_ID,
  REPO_ROOT as ROOT,
  describeSource,
  resolveE2ECredentials,
  scrubProviderCredentials,
} from "../lib/e2e-credentials.mjs";

function parseArgs(argv) {
  const out = {
    out: join(ROOT, "docs", "screenshots", "chat-minimax.png"),
    providerId: "custom_anthropic",
    // Two turns that show off the transcript: a normal answer + a reasoning
    // turn (thinking:high) so the collapsible 深度思考 block is visible.
    timeoutSec: 180,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") out.out = argv[++i];
    else if (arg === "--timeout") out.timeoutSec = Number(argv[++i]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
const creds = resolveE2ECredentials({ provider: "minimax" });
if (!creds.apiKey) {
  console.error(`[capture-chat] ${describeSource(creds)}`);
  console.error("[capture-chat] set OPENBUDDY_E2E_API_KEY, add it to .env.e2e.local, or run `pi auth login minimax`.");
  process.exit(1);
}
const modelId = creds.modelId ?? DEFAULT_MODEL_ID;
console.log(`[capture-chat] ${describeSource(creds)}`);

const userData = mkdtempSync(join(tmpdir(), "openbuddy-shot-"));
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

const COMPOSER = "textarea.wb-composer__input";
const ASSISTANT = ".msg--assistant";
const deadline = Date.now() + opts.timeoutSec * 1000;

let app;
let page;

async function invoke(channel, args) {
  return page.evaluate(({ channel, args }) => window.api.invoke(channel, args), { channel, args });
}

async function sendAndWait(prompt, marker, { thinking } = {}) {
  const before = await page.locator(ASSISTANT).count();
  await page.locator(COMPOSER).first().fill(prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  // Wait for a NEW assistant bubble that contains the marker.
  await page.waitForFunction(
    ({ sel, count, needle }) => {
      const nodes = [...document.querySelectorAll(sel)];
      if (nodes.length <= count) return false;
      const last = nodes[nodes.length - 1];
      return (last.innerText ?? "").includes(needle);
    },
    { sel: ASSISTANT, count: before, needle: marker },
    { timeout: Math.max(5_000, deadline - Date.now()) },
  );
  // Let the turn settle (stop button gone) so the screenshot isn't mid-stream.
  await page.waitForFunction(() => !document.querySelector('[aria-label="停止生成"]'), undefined, {
    timeout: Math.max(5_000, deadline - Date.now()),
  }).catch(() => {});
  if (thinking) {
    // Expand the 深度思考 block so the reasoning is visible in the shot.
    await page.evaluate(() => {
      const d = [...document.querySelectorAll("details.msg__thought")].pop();
      if (d) d.open = true;
    });
  }
}

try {
  console.log("[capture-chat] launching Electron…");
  app = await electron.launch({
    args: [`--user-data-dir=${userData}`, ROOT],
    executablePath: process.env.OPENBUDDY_ELECTRON_PATH ?? join(ROOT, "node_modules", ".bin", "electron"),
    cwd: ROOT,
    timeout: 60_000,
    env: childEnv,
  });
  page = await app.firstWindow();
  await page.locator("#root").waitFor({ state: "attached", timeout: 60_000 });
  await page.setViewportSize({ width: 1280, height: 860 });

  console.log("[capture-chat] configuring MiniMax provider…");
  await invoke("agent:providers-save-provider", {
    provider: {
      id: opts.providerId,
      label: "MiniMax",
      providerKind: "custom_anthropic",
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      apiBackend: "messages",
      authScheme: "x_api_key",
    },
  });
  await invoke("agent:providers-save-model", {
    model: { providerId: opts.providerId, modelId, name: modelId, contextWindow: 128000, reasoning: true },
  });
  await invoke("agent:new-session", { cwd: workspace, modelId: `${opts.providerId}/${modelId}` });
  await invoke("agent:set-thinking-level", { level: "high" }).catch(() => {});

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });
  await page.locator(COMPOSER).first().waitFor({ state: "visible", timeout: 30_000 });

  // Prompts are phrased as knowledge/explanation questions, not tasks — an
  // agent workspace otherwise tempts the model into file-read/skill tool
  // detours that make a hero shot messy. These reliably render clean markdown
  // + a fenced code block (showcasing the transcript renderer) with no tools.
  console.log("[capture-chat] turn 1 (intro)…");
  await sendAndWait(
    "用一句话介绍你自己，并说明你能帮我做什么。不要调用任何工具，直接用文字回答。",
    "", // any content; wait for a new settled bubble
  ).catch(async () => {
    await page.locator(ASSISTANT).first().waitFor({ timeout: Math.max(5_000, deadline - Date.now()) });
  });

  console.log("[capture-chat] turn 2 (markdown + code)…");
  await sendAndWait(
    "请用 Markdown 简要解释 Python 的列表推导式，并给出一个代码示例。不要调用任何工具，直接回答。",
    "```",
    { thinking: true },
  ).catch(() => console.warn("[capture-chat] turn 2 marker wait timed out; capturing whatever rendered"));

  // Scroll the transcript to the top so the shot leads with the conversation.
  await page.evaluate(() => {
    const scroller = document.querySelector(".chatview__scroll, .msg-list, [data-testid='chatview-scroll']");
    if (scroller) scroller.scrollTop = 0;
  });
  await page.waitForTimeout(400);

  mkdirSync(dirname(opts.out), { recursive: true });
  await page.screenshot({ path: opts.out });
  console.log(`[capture-chat] wrote ${opts.out}`);

  const bubbles = await page.locator(ASSISTANT).count();
  const thoughts = await page.locator("details.msg__thought").count();
  console.log(`[capture-chat] assistant bubbles=${bubbles} thought-blocks=${thoughts}`);
  // Print the rendered transcript so the capture is auditable without opening
  // the PNG: a real conversation vs. an error/empty state is visible here.
  const transcript = await page.evaluate(() => {
    const roleOf = (n) => (n.classList.contains("msg--user") ? "user" : "assistant");
    return [...document.querySelectorAll(".msg--user, .msg--assistant")].map((n) => ({
      role: roleOf(n),
      text: (n.innerText ?? "").replace(/\s+/g, " ").slice(0, 220),
    }));
  });
  for (const m of transcript) console.log(`[capture-chat]   ${m.role}: ${m.text}`);
  if (bubbles === 0) {
    console.error("[capture-chat] no assistant bubble rendered — screenshot is not a valid chat capture");
    process.exitCode = 2;
  }
} catch (error) {
  console.error("[capture-chat] failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
}
