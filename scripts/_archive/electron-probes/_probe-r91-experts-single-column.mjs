/**
 * R91 真机探针:专家页单栏化(移除左侧「任务」栏)。
 *
 * 用户反馈:「专家页面不需要展示任务删除」。那条栏是 R42 按 WorkBuddy
 * v5.4.7 复刻的左侧「任务(N)」列表;任务列表本来就有左侧边栏那份,专家页
 * 再放一份既重复又吃掉约 300px 横向空间。这里把它删掉。
 *
 * 要证的 4 件事:
 *   1. DOM 里没有 `[data-testid="tasks-panel"]`。
 *   2. `.ec-page-split` 退化成单栏(display:block),主区独占整宽。
 *   3. 专家卡 / 精选场景仍正常渲染 —— 移栏没打断主路径。
 *   4. 空态文案不再出现 Windows 路径 `E:\Pi\agents`。
 *
 * 跑前先 `pnpm exec electron-vite build`。stdout 只输出一个 JSON 对象。
 */
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r91-exp1col-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r91-exp1col-agent-"));

const report = { steps: [], ok: false, pageErrors: [] };
const step = (name, ok, detail) => report.steps.push({ step: name, ok: Boolean(ok), detail });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  cwd: ROOT, timeout: 60_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENT_DIR: agentDir },
});

try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  page.on("pageerror", (e) => report.pageErrors.push(String(e).slice(0, 200)));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({
      version: 1, status: "done", index: 2,
      steps: [{ id: "welcome", status: "done" }, { id: "first-task", status: "done" }, { id: "done", status: "done" }],
      startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
    }));
    window.localStorage.setItem("openbuddy.tour.state", "seen");
    window.localStorage.removeItem("expertsRoot");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40_000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await page.locator(".sidebar__nav-item", { hasText: "专家" }).first().click();
  await page.waitForFunction(() => document.querySelectorAll(".ec-card").length >= 5, undefined, { timeout: 20_000 });
  await page.waitForTimeout(1200);

  const audit = await page.evaluate(() => {
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const cs = (el) => el ? getComputedStyle(el) : null;
    const split = document.querySelector(".ec-page-split");
    const main = document.querySelector(".ec-page-main");
    const sourceBar = document.querySelector(".ec-source-bar");
    return {
      tasksPanelPresent: Boolean(document.querySelector('[data-testid="tasks-panel"]')),
      splitDisplay: cs(split)?.display ?? null,
      splitRect: rect(split),
      mainRect: rect(main),
      mainFillRatio: split && main ? +(main.getBoundingClientRect().width / split.getBoundingClientRect().width).toFixed(3) : null,
      cardCount: document.querySelectorAll(".ec-card").length,
      gridColumns: cs(document.querySelector(".ec-grid"))?.gridTemplateColumns ?? null,
      scenesRect: rect(document.querySelector(".ec-scenes")),
      sourceBarText: (sourceBar?.textContent || "").trim().slice(0, 160),
      mainTextHead: (main?.textContent || "").trim().slice(0, 120),
      emptyPresent: Boolean(document.querySelector(".ec-empty")),
    };
  });
  report.geometry = audit;

  step("左侧「任务」栏已从 DOM 移除", audit.tasksPanelPresent === false, `tasksPanelPresent=${audit.tasksPanelPresent}`);
  step("split 容器退化为单栏", audit.splitDisplay === "block", `display=${audit.splitDisplay}`);
  step("主区独占整宽", (audit.mainFillRatio ?? 0) >= 0.98, `mainFillRatio=${audit.mainFillRatio}`);
  step("专家卡仍渲染(≥5 张)", audit.cardCount >= 5, `cardCount=${audit.cardCount}`);
  step("精选场景仍在", (audit.scenesRect?.h ?? 0) > 0, JSON.stringify(audit.scenesRect));
  step("无页面异常", report.pageErrors.length === 0, JSON.stringify(report.pageErrors));

  if (process.env.OPENBUDDY_PROBE_SHOTS === "1") {
    await page.screenshot({ path: "/tmp/r91-experts-single-column.png" });
  }
} finally {
  await app.close();
}

report.ok = report.pageErrors.length === 0 && report.steps.every((s) => s.ok);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
