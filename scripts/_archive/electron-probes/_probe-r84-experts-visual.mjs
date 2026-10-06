/**
 * R84 —— 专家页视觉基线(用参考图同构的 fixture 驱动)。
 * 截图 + DOM 结构导出,用于与参考图逐项对照。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExpertCatalogFixture } from "./_fixture-expert-catalog.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SHOTS = process.env.OPENBUDDY_PROBE_SHOTS === "1";
const outDir = SHOTS ? join(ROOT, "tests", "screenshots", "r84-experts") : tmpdir();
mkdirSync(outDir, { recursive: true });

const expertRoot = join(tmpdir(), `ob-r84-fixture-${process.pid}`);
const built = buildExpertCatalogFixture(expertRoot);
const userData = mkdtempSync(join(tmpdir(), "ob-r84-expv-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const report = { fixture: built, problems: [], pageErrors: [] };
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  cwd: ROOT,
  timeout: 60_000,
  env: {
    ...process.env,
    ELECTRON_RENDERER_URL: "",
    OPENBUDDY_DEBUG_UI: "0",
    OPENBUDDY_AGENTS_DIR: expertRoot,
  },
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.waitForTimeout(2500);
  page.on("pageerror", (e) => report.pageErrors.push(String(e).slice(0, 200)));

  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({
      version: 1, status: "done", index: 2,
      steps: [{ id: "welcome", status: "done" }, { id: "first-task", status: "done" }, { id: "done", status: "done" }],
      startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
    }));
    window.localStorage.setItem("openbuddy.tour.state", "seen");
    window.localStorage.setItem("expertsCatalogRoot", "REPLACE_ME");
  });
  await page.evaluate((r) => window.localStorage.setItem("expertsCatalogRoot", r), expertRoot);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40_000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");

  const nav = page.locator(".sidebar__nav-item", { hasText: "专家" }).first();
  if (await nav.count() > 0) { await nav.click(); await page.waitForTimeout(3500); }

  const snap = async () => page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const qa = (s) => Array.from(document.querySelectorAll(s));
    const grid = q(".ec-grid");
    const gs = grid ? getComputedStyle(grid) : null;
    const cols = gs ? gs.gridTemplateColumns.split(" ").filter(Boolean).length : 0;
    return {
      cards: qa(".ec-card").length,
      columns: cols,
      gridWidth: grid ? Math.round(grid.getBoundingClientRect().width) : 0,
      cardWidth: q(".ec-card") ? Math.round(q(".ec-card").getBoundingClientRect().width) : 0,
      cardHeight: q(".ec-card") ? Math.round(q(".ec-card").getBoundingClientRect().height) : 0,
      scenes: qa(".ec-scene-card").length,
      chips: qa(".ec-chips *").map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 20),
      listTabs: qa(".ec-list-tabs .um-segment-item").map((b) => (b.textContent || "").trim()),
      sortTabs: qa(".ec-sort .um-segment-item").map((b) => (b.textContent || "").trim()),
      searchPlaceholder: q(".um-search-input")?.getAttribute("placeholder") ?? null,
      topbarRight: qa(".um-topbar-right button").map((b) => (b.textContent || "").trim()),
      firstCard: q(".ec-card") ? {
        title: q(".ec-card .ec-card-title")?.textContent?.trim(),
        sub: q(".ec-card .ec-card-sub")?.textContent?.trim(),
        tagCount: qa(".ec-card .ec-card-tag").length,
        ribbon: q(".ec-card .ec-card-ribbon span")?.textContent?.trim() ?? null,
        hasAvatar: !!q(".ec-card .um-thumb-wrap"),
      } : null,
      // 网格是否溢出容器(参考图是 4 列且不横向滚动)
      horizontalOverflow: grid ? grid.scrollWidth > grid.clientWidth + 2 : false,
      pageScrollH: document.documentElement.scrollHeight,
      viewportH: window.innerHeight,
      innerScrollIsScoped: (() => {
        const el = q(".um-scroll");
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { overflowY: cs.overflowY, clientH: el.clientHeight, scrollH: el.scrollHeight, scrolls: el.scrollHeight > el.clientHeight + 2 };
      })(),
    };
  });

  report.center = await snap();
  await page.screenshot({ path: join(outDir, "experts-center.png") });

  // 切到「专家团」
  const teamTab = page.locator(".ec-list-tabs .um-segment-item", { hasText: "专家团" }).first();
  if (await teamTab.count() > 0) { await teamTab.click(); await page.waitForTimeout(1500); report.teams = await snap(); await page.screenshot({ path: join(outDir, "experts-teams.png") }); }
  // 切回专家,点最新排序
  const expertTab = page.locator(".ec-list-tabs .um-segment-item", { hasText: "专家" }).first();
  if (await expertTab.count() > 0) await expertTab.click();
  const newest = page.locator(".ec-sort .um-segment-item", { hasText: "最新" }).first();
  if (await newest.count() > 0) { await newest.click(); await page.waitForTimeout(800); report.newestSort = await snap(); }
  const popular = page.locator(".ec-sort .um-segment-item", { hasText: "综合" }).first();
  if (await popular.count() > 0) await popular.click();

  // 打开第一张卡片详情
  const firstCard = page.locator(".ec-card").first();
  if (await firstCard.count() > 0) {
    await firstCard.click();
    await page.waitForTimeout(1200);
    report.detailModal = await page.evaluate(() => {
      const m = document.querySelector('[role="dialog"]');
      return m ? { present: true, text: (m.textContent || "").replace(/\s+/g, " ").slice(0, 160) } : { present: false };
    });
    await page.screenshot({ path: join(outDir, "experts-detail.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }

  if (report.center.cards === 0) report.problems.push("fixture 已注入但网格 0 卡片 —— 目录没被加载");
  if (report.center.columns !== 4) report.problems.push(`预期 4 列(参考图),实际 ${report.center.columns} 列`);
  if (report.center.horizontalOverflow) report.problems.push("网格横向溢出");
  if (!report.teams || report.teams.cards === 0) report.problems.push("「专家团」tab 没有卡片");
  report.screenshotDir = outDir;
} catch (e) {
  report.error = String(e?.stack ?? e).slice(0, 800);
} finally {
  console.log(JSON.stringify(report, null, 2).slice(0, 6000));
  await app.close();
}
process.exit(0);
