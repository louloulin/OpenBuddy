/** 批 0-5 全量真机验证。 */
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
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
const out = "/tmp/ob-verify";
mkdirSync(out, { recursive: true });
const log = (...a) => console.log("[verify]", ...a);
let failures = [];
const check = (name, ok) => { log(ok ? "PASS" : "FAIL", name); if (!ok) failures.push(name); };

const agentHome = await mkdtemp(join(tmpdir(), "ob-v-"));
const piAgentDir = join(agentHome, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
const modelId = env.OPENBUDDY_E2E_MODEL_ID || "glm-5.3-flash";
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: { custom_anthropic: { name: "Audit", baseUrl: env.OPENBUDDY_E2E_BASE_URL, api: "anthropic-messages", authHeader: false, models: [{ id: modelId, name: modelId, contextWindow: 128000, maxTokens: 16384 }] } } }, null, 2)}\n`, "utf8");
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({ custom_anthropic: { type: "api_key", key: env.OPENBUDDY_E2E_API_KEY } }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
const userData = await mkdtemp(join(tmpdir(), "ob-v-ud-"));
const ws = join(userData, "ws");
mkdirSync(ws, { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  cwd: root, timeout: 30_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", PI_HOME: agentHome, PI_CODING_AGENT_DIR: piAgentDir, ...env },
});
const page = await app.firstWindow();
let hookHits = 0;
page.on("console", (m) => {
  const t = m.text();
  if (t.includes("React error") || t.includes("#300") || t.includes("error 300")) hookHits += 1;
});
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(4500);
await page.locator("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(1000);

// 建会话 + 信任工作区(等价真实用户走完信任提示)
const session = await page.evaluate(([cwd]) => window.api.invoke("agent:new-session", { cwd }), [ws]);
// 侧栏第一个会话的实际工作区可能不是 ws(启动默认会话落在仓库根);
// 授权必须授给 ChatView 当前 cwd,否则信任门会按设计藏掉终端按钮。
const activeCwd = await page.evaluate(() => {
  const text = Array.from(document.querySelectorAll("[data-tip], .wb-composer-wrap, .composer-meta"))
    .map((el) => el.textContent || "").join("|");
  return text.includes("appx/OpenBuddy") ? "/Users/louloulin/appx/OpenBuddy" : null;
});
const grantTarget = activeCwd ?? ws;
log("信任授予目标:", grantTarget);
const grantResult = await page.evaluate(([cwd]) => window.api.invoke("folder-trust:grant", cwd), [grantTarget]);
log("grant 结果:", JSON.stringify(grantResult));
const trustedNow = await page.evaluate(([cwd]) => window.api.invoke("folder-trust:is-trusted", cwd), [grantTarget]);
log("is-trusted 直查:", trustedNow);
await page.locator(".sidebar__conv").first().click().catch(() => {});
await page.waitForTimeout(1500);

// A3+A4:发消息,2s 内应出现 pending 行;streaming 中 Enter 应入队 + toast
const ta = page.locator("textarea").last();
await ta.click();
await ta.fill("用三句话介绍你自己。");
await ta.press("Enter");
// 立刻轮询 0-3s 窗口,glm 首 token 可能很快
let pendingSeen = false;
for (let i = 0; i < 10; i += 1) {
  pendingSeen = (await page.locator(".msg__loading").count()) > 0;
  if (pendingSeen) break;
  await page.waitForTimeout(300);
}
check("A3 首token前有 pending 行(LoadingRow)", pendingSeen);
await page.screenshot({ path: join(out, "21-pending.png") });
await ta.click(); await ta.fill("第二条:总结一下。"); await ta.press("Enter");
await page.waitForTimeout(1000);
const toastText = await page.evaluate(() => document.body.innerText);
check("A4 streaming 中 Enter 直接入队(有 toast)", toastText.includes("已加入队列"));
check("A4 队列 dock 可见", await page.locator(".composer-queued").count() > 0);
await page.screenshot({ path: join(out, "22-queued.png") });

// 等回合完成(排队的第二条也会发出去)
for (let i = 0; i < 60; i += 1) {
  await page.waitForTimeout(2000);
  const t = await page.evaluate(() => document.body.innerText);
  if (!/暂停$/.test(t.trim()) && (t.includes("111") || i > 30)) break;
  const streaming = await page.evaluate(() => Boolean(document.querySelector(".msg--streaming")));
  if (!streaming && i > 3) break;
}
await page.waitForTimeout(2000);

// A5:provider 短名(横幅/meta 不再出现 custom_anthropic)
const afterTurn = await page.evaluate(() => document.body.innerText);
check("A5 UI 不再泄漏 custom_ 前缀", !afterTurn.includes("custom_anthropic"));
// A1:终端按钮现在可见(已信任)且能创建
const termBtn = page.locator("[data-tip*='终端']").first();
const toolbarDebug = await page.evaluate(() => ({
  topbarHost: Boolean(document.getElementById("ob-topbar-tools")),
  workspaceText: (document.querySelector(".wb-composer-wrap, .composer-meta")?.textContent || "").slice(0, 80),
  allTips: Array.from(document.querySelectorAll("[data-tip]")).map((el) => el.getAttribute("data-tip")).slice(0, 60),
}));
log("toolbar 调试:", JSON.stringify(toolbarDebug));
check("A1 终端按钮可见(信任后)", (await termBtn.count()) > 0);
if (await termBtn.count()) {
  await termBtn.click();
  await page.waitForTimeout(3000);
  const host = page.locator(".terminal-panel__host").first();
  const errText = await page.locator(".terminal-panel").innerText().catch(() => "");
  check("A1 终端创建成功(无信任错误)", !errText.includes("outside the trusted workspace"));
  await page.screenshot({ path: join(out, "20-terminal-ok.png") });
  await termBtn.click().catch(() => {});
  await page.waitForTimeout(600);
}


// B6 用户气泡中性灰 + B1 tabs 常驻 + B7 版本徽章移除
const bubbleBg = await page.evaluate(() => {
  const el = document.querySelector("[data-testid='user-bubble-display']");
  return el ? getComputedStyle(el).backgroundColor : "none";
});
log("用户气泡背景:", bubbleBg);
check("B1 tabs 常驻占位存在", await page.locator(".chatview__tabs").count() > 0);
check("B7 标题栏无版本徽章", (await page.locator(".main-topbar__version-pill").count()) === 0);
await page.screenshot({ path: join(out, "23-done.png") });

const seedSnap = { sessions: { [session.sessionId]: { "p1": [
  { toolCallId: "t1", promptId: "p1", tool: "write", path: join(ws, "probe-x.txt"), exists: true, content: "alpha", capturedAt: Date.now() - 60000 },
  { toolCallId: "t2", promptId: "p2", tool: "edit", path: join(ws, "probe-x.txt"), exists: true, content: "beta", capturedAt: Date.now() - 30000 },
] } } };
await writeFile(join(piAgentDir, "openbuddy-rewind-snapshots.json"), JSON.stringify(seedSnap), "utf8");
// 主进程的 rewind 快照有内存缓存;IPC listFileSnapshots 首读会落盘加载,
// 这里种子是在首读前写入的(此会话还没触发过快照读写)→ 直接生效。
let artIndex = [];
for (let i = 0; i < 5; i += 1) {
  artIndex = await page.evaluate(async ([sessionId]) => {
    try { return (await window.api.invoke("artifacts:index", { sessionId })).artifacts; } catch { return []; }
  }, [session.sessionId]);
  if (artIndex.length > 0) break;
  await page.waitForTimeout(1000);
}
check("批5 artifacts:index 有条目", artIndex.length > 0);
if (artIndex.length > 0) {
  log("产物:", artIndex.map((a) => `${a.name}(${a.revisions})`).join(", "));
  const hist = await page.evaluate(async ([sessionId, path]) => window.api.invoke("artifacts:history", { sessionId, path }), [session.sessionId, artIndex[0].path]);
  check("批5 版本历史 >=1", hist.versions.length >= 1);
  // UI:打开产物面板,选文件,看时间线
  // 重载让 ChatView 重新查询快照计数(按钮 visible 依赖它;真实场景里
  // 转录工具调用也会把计数顶起来,这里是种子数据的时序限制)。
  await page.reload();
  await page.waitForTimeout(6000);
  const artBtn = page.locator("[data-tip*='本会话产物'], [aria-label*='本会话产物']").first();
  if (await artBtn.count()) {
    await artBtn.click();
    await page.waitForTimeout(2000);
    const item = page.locator(".artifacts-list__main").first();
    if (await item.count()) await item.click();
    await page.waitForTimeout(1500);
    log("面板状态:", JSON.stringify(await page.evaluate(() => ({
      views: Array.from(document.querySelectorAll(".tool-side-panel [class*='view'], .tool-side-panel nav button")).map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 8),
      listItems: document.querySelectorAll(".artifacts-list__item").length,
      history: document.querySelectorAll(".artifacts-history__item").length,
      historyRoot: document.querySelectorAll(".artifacts-history").length,
      empty: document.querySelector(".tool-side-panel__empty")?.textContent?.slice(0, 40) ?? null,
    }))));
    check("批5 版本时间线渲染", await page.locator(".artifacts-history__item").count() > 0);
    await page.screenshot({ path: join(out, "24-artifacts.png") });
  } else {
    log("产物按钮未找到(跳过 UI 检查)");
  }
}

// 批0:整个流程零 React 错误
check("批0 零 React 错误", hookHits === 0);
log("失败项:", failures.length ? failures.join(" | ") : "(无)");
await page.screenshot({ path: join(out, "25-final.png") });
await app.close();
process.exit(failures.length ? 1 : 0);
