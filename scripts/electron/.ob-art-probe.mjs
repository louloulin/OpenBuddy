/**
 * 阶段 5 产物中心探针:版本时间线 + 恢复。
 * 先造一次真实的文件写入(走 chat 会话),再打开侧栏产物视图看时间线。
 */
import { readFile, writeFile } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { _electron as electron } from "playwright";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = {};
for (const line of (await readFile("/tmp/ob-e2e.env", "utf8")).split("\n")) {
  const m = /^(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const root = "/Users/louloulin/appx/OpenBuddy";
const agentHome = await mkdtemp(join(tmpdir(), "ob-art-"));
const piAgentDir = join(agentHome, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
const log = (...a) => console.log("[art]", ...a);
const modelId = env.OPENBUDDY_E2E_MODEL_ID || "glm-5.3-flash";
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: { custom_anthropic: { name: "Probe", baseUrl: env.OPENBUDDY_E2E_BASE_URL, api: "anthropic-messages", authHeader: false, models: [{ id: modelId, name: modelId, contextWindow: 128000, maxTokens: 16384 }] } } }, null, 2)}\n`, "utf8");
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({ custom_anthropic: { type: "api_key", key: env.OPENBUDDY_E2E_API_KEY } }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
const userData = await mkdtemp(join(tmpdir(), "ob-art-ud-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  cwd: root,
  timeout: 30_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", PI_HOME: agentHome, PI_CODING_AGENT_DIR: piAgentDir, ...env },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(5000);
page.on("console", (m) => { if (m.type() === "error") log("console error:", m.text().slice(0, 160)); });
const mark = (tag) => log("== 步骤:", tag);

const ws = join(userData, "ws");
mkdirSync(ws, { recursive: true });
const session = await page.evaluate(([cwd]) => window.api.invoke("agent:new-session", { cwd }), [ws]);
log("会话:", session.sessionId.slice(0, 8));

// ① 真跑一轮:让 agent 写两个文件(产出快照)
await page.evaluate(([sessionId]) => window.api.invoke("agent:prompt", {
  sessionId,
  text: "在当前工作区创建 probe-a.txt,内容写第一行;再把它改成第二行。只用文件工具,不要解释。",
}), [session.sessionId]);
let settled = false;
for (let i = 0; i < 40; i += 1) {
  await page.waitForTimeout(2000);
  const snap = await page.evaluate(async ([sessionId]) => (await window.api.invoke("artifacts:index", { sessionId })).artifacts.length, [session.sessionId]);
  if (snap > 0) { log("artifacts:index 已产出条目:", snap); settled = true; break; }
}
if (!settled) log("artifacts:index 仍为空(该轮没有产生快照)");

const idx = await page.evaluate(async ([sessionId]) => window.api.invoke("artifacts:index", { sessionId }), [session.sessionId]);
log("索引:", JSON.stringify(idx.artifacts).slice(0, 300));
if (idx.artifacts[0]) {
  const hist = await page.evaluate(async ([sessionId, path]) => window.api.invoke("artifacts:history", { sessionId, path }), [session.sessionId, idx.artifacts[0].path]);
  log("版本历史:", JSON.stringify(hist.versions).slice(0, 300));
}

// ② 打开侧栏产物视图
mark("开始点助理");
const artBtn = page.locator(".sidebar__nav-item, [class*='nav-item']").filter({ hasText: "助理" }).first();
if (await artBtn.count()) await artBtn.click().catch(() => {});
await page.waitForTimeout(1500);
mark("已点助理");
const conv = page.locator(".sidebar__conv").first();
if (await conv.count()) await conv.click().catch(() => {});
await page.waitForTimeout(2000);
mark("已开会话");
const artifactsBtn = page.locator("[data-tip*='产物'], [aria-label*='产物'], [title*='产物']").first();
log("产物按钮:", await artifactsBtn.count());
if (await artifactsBtn.count()) {
  await artifactsBtn.click();
  await page.waitForTimeout(2500);
  log("历史区块:", await page.locator(".artifacts-history").count(), "| 版本行:", await page.locator(".artifacts-history__item").count());
  const first = page.locator(".artifacts-history__item").first();
  if (await first.count()) {
    await first.click();
    await page.waitForTimeout(1200);
    log("恢复按钮可用:", !(await page.locator(".artifacts-history__restore").isDisabled()));
    await page.screenshot({ path: "/tmp/ob-artifacts.png" });
    log("截图 /tmp/ob-artifacts.png");
  }
}
await app.close();
log("done");
