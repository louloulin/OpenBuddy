import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r90-audit-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r90-audit-agent-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  cwd: ROOT, timeout: 60_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENT_DIR: agentDir },
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1963, height: 1248 });  // match the user's image
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
  await page.waitForTimeout(2000);
  await page.keyboard.press("Escape");
  await page.locator(".sidebar__nav-item", { hasText: "专家" }).first().click();
  await page.waitForFunction(() => document.querySelectorAll(".ec-card").length > 0, undefined, { timeout: 15_000 });
  await page.waitForTimeout(800);

  const audit = await page.evaluate(() => {
    const r = (el) => { if (!el) return null; const x = el.getBoundingClientRect(); return { x: Math.round(x.x), y: Math.round(x.y), w: Math.round(x.width), h: Math.round(x.height), scrollW: el.scrollWidth, clientW: el.clientWidth, scrollH: el.scrollHeight, clientH: el.clientHeight }; };
    const csel = (el) => el ? getComputedStyle(el) : null;
    const dump = (sel) => { const el = document.querySelector(sel); if (!el) return null; return { rect: r(el), cs: { overflow: csel(el)?.overflow, padding: csel(el)?.padding, display: csel(el)?.display, gap: csel(el)?.gap, flexWrap: csel(el)?.flexWrap, gridTemplateColumns: csel(el)?.gridTemplateColumns, fontSize: csel(el)?.fontSize, lineHeight: csel(el)?.lineHeight, whiteSpace: csel(el)?.whiteSpace, textOverflow: csel(el)?.textOverflow }, text: (el.textContent || "").trim().slice(0, 80) }; };
    const chips = Array.from(document.querySelectorAll(".ec-chips .um-chip, .ec-chips button")).map((b, i) => {
      const x = b.getBoundingClientRect();
      return { i, text: (b.textContent || "").trim(), x: Math.round(x.x), y: Math.round(x.y), w: Math.round(x.width) };
    });
    const cards = Array.from(document.querySelectorAll(".ec-card")).slice(0, 6).map((c, i) => {
      const x = c.getBoundingClientRect();
      return { i, title: c.querySelector(".ec-card-title")?.textContent?.trim(), rect: { x: Math.round(x.x), y: Math.round(x.y), w: Math.round(x.width), h: Math.round(x.height) } };
    });
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      docScrollW: document.documentElement.scrollWidth,
      docScrollH: document.documentElement.scrollHeight,
      sourceBar: dump(".ec-source-bar"),
      sourceLabel: dump(".ec-source-label"),
      search: dump(".um-search-input"),
      topbarSearch: dump(".topbar__search-input") || dump(".topbar__search"),
      chipsContainer: dump(".ec-chips"),
      chips,
      tasksPanel: dump('[data-testid="tasks-panel"]') || dump(".tasks-panel"),
      mainPane: dump(".ec-page-main"),
      pageSplit: dump(".ec-page-split"),
      scenesRow: dump(".ec-scenes-row"),
      grid: dump(".ec-grid"),
      firstRowCardRects: cards.slice(0, 4),
      allCardTops: Array.from(document.querySelectorAll(".ec-card")).map((c) => Math.round(c.getBoundingClientRect().y)),
    };
  });
  console.log(JSON.stringify(audit, null, 2));
} finally { await app.close(); }
