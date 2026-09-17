import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r90s-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r90s-agent-"));
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
  await page.waitForTimeout(2000);
  await page.keyboard.press("Escape");
  await page.locator(".sidebar__nav-item", { hasText: "专家" }).first().click();
  await page.waitForFunction(() => document.querySelectorAll(".ec-card").length > 0, undefined, { timeout: 15_000 });
  await page.waitForTimeout(800);
  // Take a tight shot of the experts pane
  await page.screenshot({ path: "/tmp/r90-shot.png", clip: { x: 230, y: 60, width: 1370, height: 940 } });
  // Also dump computed style + bbox of suspicious elements
  const audit = await page.evaluate(() => {
    const $ = (s) => document.querySelector(s);
    const rect = (s) => { const el = $(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const cs = (s) => { const el = $(s); if (!el) return null; const c = getComputedStyle(el); return { overflow: c.overflow, padding: c.padding, display: c.display, gap: c.gap }; };
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      chipsWrap: cs(".ec-chips"),
      chipsCount: document.querySelectorAll(".ec-chips .um-chip, .ec-chips button").length,
      sourceBar: rect(".ec-source-bar"),
      scenesRect: rect(".ec-scenes"),
      listHead: rect(".ec-list-head"),
      gridRect: rect(".ec-grid"),
      firstCard: rect(".ec-card"),
      splitRect: rect(".ec-page-split"),
      tasksPanelRect: rect(".tasks-panel") || rect('[data-testid="tasks-panel"]'),
      mainPane: rect(".ec-page-main"),
      // look for elements that overflow horizontally
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    };
  });
  console.log("AUDIT:", JSON.stringify(audit, null, 2));
} finally { await app.close(); }
