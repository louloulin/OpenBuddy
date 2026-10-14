/** 非 minify 生产包跑 automation 导航,抓 #300 完整栈。 */
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { _electron as electron } from "playwright";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = {};
for (const line of (await readFile("/tmp/ob-e2e.env", "utf8")).split("\n")) {
  const m = /^(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const root = "/Users/louloulin/appx/OpenBuddy";
const log = (...a) => console.log("[hook]", ...a);
const agentHome = await mkdtemp(join(tmpdir(), "ob-hook-"));
const piAgentDir = join(agentHome, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
const userData = await mkdtemp(join(tmpdir(), "ob-hook-ud-"));
const modelId = env.OPENBUDDY_E2E_MODEL_ID || "glm-5.3-flash";
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: { custom_anthropic: { name: "Probe", baseUrl: env.OPENBUDDY_E2E_BASE_URL, api: "anthropic-messages", authHeader: false, models: [{ id: modelId, name: modelId, contextWindow: 128000, maxTokens: 16384 }] } } }, null, 2)}\n`, "utf8");
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({ custom_anthropic: { type: "api_key", key: env.OPENBUDDY_E2E_API_KEY } }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
const ws = join(userData, "ws");
mkdirSync(ws, { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  cwd: root, timeout: 30_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", PI_HOME: agentHome, PI_CODING_AGENT_DIR: piAgentDir, ...env },
});
const page = await app.firstWindow();
let hit = 0;
page.on("console", (m) => {
  const t = m.text();
  if (t.includes("#300") || t.includes("fewer hooks")) {
    hit += 1;
    log(`#${hit} ===\n`, t.slice(0, 4000));
  }
});
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(4500);
await page.locator("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(1000);
const session = await page.evaluate(([cwd]) => window.api.invoke("agent:new-session", { cwd }), [ws]);
await page.waitForTimeout(1500);
// 复刻 automation 探针触发的路径:打开会话
await page.locator(".sidebar__conv").first().click().catch(() => {});
await page.waitForTimeout(2500);
// 复刻 artifacts 探针:prompt 一轮
await page.evaluate(([sessionId]) => window.api.invoke("agent:prompt", { sessionId, text: "只回复 ok" }), [session.sessionId]);
for (let i = 0; i < 15; i += 1) await page.waitForTimeout(1500);
// 打开自动化面板
const nav = page.locator(".sidebar__nav-item", { hasText: "自动化" }).first();
if (await nav.count()) { await nav.click(); await page.waitForTimeout(3000); }
log("done, hits:", hit);
await app.close();
