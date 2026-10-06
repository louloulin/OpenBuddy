/**
 * Capture real electron+MiniMax AI chat screenshots into docs/screenshots/.
 * Mirrors chat-ui-minimax-real.spec.ts flow: save provider/model, click the
 * actual composer button, drive multi-turn through the real renderer.
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = "/Users/louloulin/appx/openBuddy";
const apiKey = process.env.OPENBUDDY_E2E_API_KEY ?? "";
const baseUrl = process.env.OPENBUDDY_E2E_BASE_URL ?? "https://api.minimaxi.com/anthropic";
const modelId = process.env.OPENBUDDY_E2E_MODEL_ID ?? "MiniMax-M3";
const providerId = "minimax_real_shot";

const outDir = join(root, "docs", "screenshots");
mkdirSync(outDir, { recursive: true });

const userData = mkdtempSync(join(tmpdir(), "openbuddy-shot-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
writeFileSync(join(piAgentDir, "models.json"), JSON.stringify({ providers: {} }, null, 2));
writeFileSync(join(piAgentDir, "auth.json"), JSON.stringify({}, null, 2));

console.log("[shot] launching electron...");
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  timeout: 60_000,
  env: { ...process.env },
});

const page = await app.firstWindow();
await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
await page.waitForTimeout(2500);

const invoke = (channel, args) => page.evaluate(({ c, a }) => window.api.invoke(c, a), { c: channel, a: args });
const safe = async (channel, args) => {
  try { return { ok: true, value: await invoke(channel, args) }; }
  catch (error) { return { ok: false, error: String(error?.message ?? error) }; }
};

await page.screenshot({ path: join(outDir, "01-home-cold-start.png"), fullPage: false });
console.log("[shot] 01-home-cold-start.png");

// Wire provider+model BEFORE the renderer auto-bootstraps any session.
const sp = await safe("agent:providers-save-provider", {
  provider: {
    id: providerId,
    label: "MiniMax Real",
    providerKind: "custom_anthropic",
    apiKey,
    baseUrl,
    apiBackend: "messages",
    authScheme: "x_api_key",
  },
});
const sm = await safe("agent:providers-save-model", {
  model: { providerId, modelId, name: modelId, contextWindow: 128000 },
});
console.log("[shot] provider/model saved:", sp.ok, sm.ok);

// Trigger renderer reload so it picks up provider/model and creates the session.
await page.reload();
await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
await page.waitForTimeout(3000);

await page.waitForFunction(() => {
  const ta = document.querySelector("textarea");
  return ta && !ta.disabled;
}, undefined, { timeout: 60_000 });
await page.waitForTimeout(800);
await page.screenshot({ path: join(outDir, "02-composer-ready.png"), fullPage: false });
console.log("[shot] 02-composer-ready.png");

const composer = page.locator("textarea.wb-composer__input").first();
const sendButton = page.getByRole("button", { name: "发送", exact: true });

const shotTurn = async (prompt, file, { waitFor = 90_000, midStreamWait = 1500 } = {}) => {
  await composer.fill(prompt);
  await sendButton.click({ noWaitAfter: true });
  await page.waitForFunction(() => {
    const bubbles = document.querySelectorAll(".msg--assistant");
    if (bubbles.length === 0) return false;
    const text = bubbles[bubbles.length - 1]?.textContent ?? "";
    return text.length > 8 && !text.includes("等待中");
  }, undefined, { timeout: waitFor });
  await page.waitForTimeout(midStreamWait);
  await page.screenshot({ path: join(outDir, file), fullPage: false });
  console.log("[shot]", file);
  await page.waitForFunction(() => !document.querySelector('[aria-label="停止生成"]'), undefined, { timeout: 90_000 });
};

// Turn 1: identity question — fills the assistant bubble with text
await shotTurn("用一句话介绍你自己：你是谁？", "03-turn1-mid-stream.png");
await page.waitForTimeout(800);
await page.screenshot({ path: join(outDir, "04-turn1-settled.png"), fullPage: false });
console.log("[shot] 04-turn1-settled.png");

// Turn 2
await shotTurn("用一句话解释：'Hello world' 中文怎么说？", "05-turn2-settled.png");

// Turn 3: a real multi-line task
await shotTurn("用三行中文写一个买菜做饭洗碗的待办清单。", "06-turn3-settled.png");

// Final full-page shot of the three-turn transcript
await page.screenshot({ path: join(outDir, "07-three-turns-full.png"), fullPage: true });
console.log("[shot] 07-three-turns-full.png");

console.log("[shot] DONE");
await app.close();
process.exit(0);
