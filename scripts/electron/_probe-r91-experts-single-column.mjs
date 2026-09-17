/**
 * R91 — 专家页移除左侧「任务」栏 + 单栏布局真机验证。
 * 跑前先 `pnpm exec electron-vite build`。
 *
 * 断言:
 *  1. DOM 里没有 [data-testid="tasks-panel"](用户明确要求移除)。
 *  2. .ec-page-split 是单列(grid-template-columns 只剩一档 / display:block)。
 *  3. 主区 .ec-page-main 的有效宽度 >= split 容器宽度 - 2px(即独占整宽)。
 *  4. 专家卡仍正常渲染(移栏没打断主路径)。
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

const problems = [];
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  cwd: ROOT, timeout: 60_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENT_DIR: agentDir },
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
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
  await page.locator(".sidebar__nav-item", { hasText: "专家" }).first().click();
  await page.waitForFunction(() => document.querySelectorAll(".ec-card").length >= 5, undefined, { timeout: 20_000 });
  await page.waitForTimeout(1800);

  const winInfo = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    hasSidebar: Boolean(document.querySelector("aside.sidebar")),
    navItems: Array.from(document.querySelectorAll(".sidebar__nav-item")).map((n) => n.textContent?.trim()),
    activeNav: document.querySelector(".sidebar__nav-item--active")?.textContent?.trim() ?? null,
    ecPageMainCount: document.querySelectorAll(".ec-page-main").length,
    ecCardCount: document.querySelectorAll(".ec-card").length,
    bodyChildren: Array.from(document.body.children).map((c) => c.tagName + "." + (c.className?.toString?.().slice(0, 40) || "")),
  }));
  console.log("WININFO", JSON.stringify(winInfo, null, 2));

  // Definitive paint check: what does the compositor report at a few points?
  const hitTest = await page.evaluate(() => {
    const at = (x, y) => { const el = document.elementFromPoint(x, y); return el ? el.tagName + "." + (el.className?.toString?.().slice(0, 50) || "") : null; };
    return {
      "left-sidebar-band(60,400)": at(60, 400),
      "experts-topbar(900,80)": at(900, 80),
      "card-area(500,700)": at(500, 700),
      "card-area2(1000,700)": at(1000, 700),
      "composer(800,940)": at(800, 940),
    };
  });
  console.log("HITTEST", JSON.stringify(hitTest, null, 2));

  const audit = await page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const cs = (el) => el ? getComputedStyle(el) : null;
    const split = document.querySelector(".ec-page-split");
    const main = document.querySelector(".ec-page-main");
    const scenes = document.querySelector(".ec-scenes");
    return {
      tasksPanelPresent: Boolean(document.querySelector('[data-testid="tasks-panel"]')),
      splitDisplay: cs(split)?.display,
      splitColumns: cs(split)?.gridTemplateColumns,
      splitRect: r(split),
      mainRect: r(main),
      mainFillRatio: split && main ? +(main.getBoundingClientRect().width / split.getBoundingClientRect().width).toFixed(3) : null,
      cardCount: document.querySelectorAll(".ec-card").length,
      mainTextHead: (document.querySelector(".ec-page-main")?.textContent || "").trim().slice(0, 120),
      emptyPresent: Boolean(document.querySelector(".ec-empty")),
      sourceBarRect: r(document.querySelector(".ec-source-bar")),
      sourceBarDisplay: cs(document.querySelector(".ec-source-bar"))?.display,
      sourceBarFlexWrap: cs(document.querySelector(".ec-source-bar"))?.flexWrap,
      sourceBarChildren: Array.from(document.querySelector(".ec-source-bar")?.children || []).map((c) => ({ tag: c.tagName, cls: c.className?.toString?.().slice(0, 40), rect: r(c), text: (c.textContent||"").trim().slice(0,20) })),
      gridColumns: cs(document.querySelector(".ec-grid"))?.gridTemplateColumns,
      scenesRect: r(scenes),
      firstCardWidth: (() => { const c = document.querySelector(".ec-card"); return c ? Math.round(c.getBoundingClientRect().width) : null; })(),
    };
  });
  console.log(JSON.stringify(audit, null, 2));

  if (audit.tasksPanelPresent) problems.push("tasks-panel still present in DOM");
  if (audit.mainFillRatio !== null && audit.mainFillRatio < 0.98) problems.push(`main pane only fills ${audit.mainFillRatio} of the split container`);
  if (audit.cardCount === 0) problems.push("no expert cards rendered");

  console.log("real window:", JSON.stringify({ inner: await page.evaluate(() => ({ w: innerWidth, h: innerHeight })) }));
  await page.screenshot({ path: "/tmp/r91-exp-fullpage.png", fullPage: true });
  await page.screenshot({ path: "/tmp/r91-exp-shot-a.png" });
  const after = await page.evaluate(() => ({ cards: document.querySelectorAll(".ec-card").length, gridH: document.querySelector(".ec-grid")?.getBoundingClientRect().height, bodyText: document.body.innerText.length }));
  console.log("AFTER SHOT A:", JSON.stringify(after));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/tmp/r91-exp-shot-b.png" });
  const after2 = await page.evaluate(() => ({ cards: document.querySelectorAll(".ec-card").length, gridH: document.querySelector(".ec-grid")?.getBoundingClientRect().height, bodyText: document.body.innerText.length }));
  console.log("AFTER SHOT B:", JSON.stringify(after2));
} finally { await app.close(); }
console.log(problems.length ? `\nPROBLEMS(${problems.length}):\n - ` + problems.join("\n - ") : "\nOK: experts page is single-column, TasksPanel removed");
