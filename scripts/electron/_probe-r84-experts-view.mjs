/**
 * R84 —— 专家页真实渲染审计(为「对齐参考图」提供基线)。
 * 真机导航到专家页,导出:顶栏结构、精选场景、列表头(专家/专家团 + 排序)、
 * chips、卡片网格的列数/卡片数/卡片内部结构,以及截图。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SHOTS = process.env.OPENBUDDY_PROBE_SHOTS === "1";
const userData = mkdtempSync(join(tmpdir(), "ob-r84-exp-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r84-exp-agent-"));

const report = { steps: [], problems: [], pageErrors: [] };
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  cwd: ROOT,
  timeout: 60_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENT_DIR: agentDir },
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(2500);
  page.on("pageerror", (e) => report.pageErrors.push(String(e).slice(0, 200)));

  // 首启引导落盘 + 关掉
  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({
      version: 1, status: "done", index: 2,
      steps: [{ id: "welcome", status: "done" }, { id: "first-task", status: "done" }, { id: "done", status: "done" }],
      startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
    }));
    window.localStorage.setItem("openbuddy.tour.state", "seen");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40_000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");

  const nav = page.locator(".sidebar__nav-item", { hasText: "专家" }).first();
  report.steps.push({ step: "sidebar 专家入口", ok: (await nav.count()) > 0 });
  if (await nav.count() > 0) {
    await nav.click();
    await page.waitForTimeout(3000);
  }

  report.dom = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const qa = (s) => Array.from(document.querySelectorAll(s));
    const rect = (el) => (el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null);
    const grid = q(".ec-grid");
    const gridStyle = grid ? getComputedStyle(grid) : null;
    const card = q(".ec-card");
    return {
      pagePresent: !!q(".um-page"),
      pills: qa(".um-pill").map((b) => (b.textContent || "").trim()),
      activePill: q(".um-pill--active")?.textContent?.trim() ?? null,
      searchPlaceholder: q(".um-search-input")?.getAttribute("placeholder") ?? null,
      topbarButtons: qa(".um-topbar-right button").map((b) => (b.textContent || "").trim()),
      sourceBar: {
        present: !!q(".ec-source-bar"),
        label: q(".ec-source-label")?.textContent?.trim() ?? null,
      },
      scenes: { present: !!q(".ec-scenes"), count: qa(".ec-scene-card").length, title: q(".ec-section-title")?.textContent?.trim() ?? null },
      listHead: {
        present: !!q(".ec-list-head"),
        tabs: qa(".ec-list-tabs .um-segment-item").map((b) => (b.textContent || "").trim()),
        activeTab: q(".ec-list-tabs .um-segment-item--active")?.textContent?.trim() ?? null,
        sort: qa(".ec-sort .um-segment-item").map((b) => (b.textContent || "").trim()),
        activeSort: q(".ec-sort .um-segment-item--active")?.textContent?.trim() ?? null,
      },
      chips: qa(".ec-chips .um-chip, .ec-chips button").map((b) => (b.textContent || "").trim()).slice(0, 12),
      grid: grid ? {
        present: true,
        columns: gridStyle.gridTemplateColumns,
        columnCount: gridStyle.gridTemplateColumns.split(" ").filter(Boolean).length,
        cardCount: qa(".ec-card").length,
        rect: rect(grid),
      } : { present: false, cardCount: 0 },
      firstCard: card ? {
        title: card.querySelector(".ec-card-title")?.textContent?.trim() ?? null,
        sub: card.querySelector(".ec-card-sub")?.textContent?.trim() ?? null,
        desc: (card.querySelector(".ec-card-desc")?.textContent ?? "").slice(0, 60),
        tags: Array.from(card.querySelectorAll(".ec-card-tag")).map((t) => t.textContent.trim()),
        ribbon: card.querySelector(".ec-card-ribbon span")?.textContent?.trim() ?? null,
        rect: rect(card),
      } : null,
      split: { present: !!q('[data-testid="experts-page-split"]'), columns: q(".ec-page-split") ? getComputedStyle(q(".ec-page-split")).gridTemplateColumns : null },
      tasksPanel: { present: !!q('[data-testid="tasks-panel"]') || !!q(".tasks-panel") },
      emptyState: q(".ec-empty")?.textContent?.trim() ?? null,
      loadingState: q(".ec-loading")?.textContent?.trim() ?? null,
      bodyText: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300),
    };
  });

  if (SHOTS) {
    mkdirSync(join(ROOT, "tests", "screenshots", "r84-experts"), { recursive: true });
    await page.screenshot({ path: join(ROOT, "tests", "screenshots", "r84-experts", "experts-page.png") });
  } else {
    await page.screenshot({ path: join(tmpdir(), "r84-experts-page.png") });
    report.screenshot = join(tmpdir(), "r84-experts-page.png");
  }

  if (!report.dom.pagePresent) report.problems.push("专家页容器 .um-page 不存在 —— 页面没渲染出来");
  if (report.dom.grid.present && report.dom.grid.cardCount === 0) report.problems.push("专家网格存在但 0 张卡片(catalog 未加载)");
  if (report.dom.emptyState) report.problems.push(`空状态:${report.dom.emptyState}`);
  if (report.dom.loadingState) report.problems.push(`一直 loading:${report.dom.loadingState}`);
  if (report.dom.listHead.present && report.dom.listHead.sort.length !== 2) report.problems.push(`排序项应 2 个(综合/最新),实际 ${JSON.stringify(report.dom.listHead.sort)}`);
} finally {
  report.pageErrors = report.pageErrors;
  console.log(JSON.stringify(report, null, 2).slice(0, 7000));
  await app.close();
}
process.exit(0);
