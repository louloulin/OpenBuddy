import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExpertCatalogFixture } from "./_fixture-expert-catalog.mjs";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const expertRoot = join(tmpdir(), `ob-r84fx-${process.pid}`);
buildExpertCatalogFixture(expertRoot);
const userData = mkdtempSync(join(tmpdir(), "ob-r84s-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  cwd: ROOT, timeout: 60_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENTS_DIR: expertRoot },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.setViewportSize({ width: 1600, height: 1100 });
await page.waitForTimeout(2500);
await page.evaluate((r) => {
  window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({ version: 1, status: "done", index: 2, steps: [{ id: "welcome", status: "done" }, { id: "first-task", status: "done" }, { id: "done", status: "done" }], startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now() }));
  window.localStorage.setItem("openbuddy.tour.state", "seen");
  window.localStorage.setItem("expertsCatalogRoot", r);
}, expertRoot);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40_000 });
await page.waitForTimeout(3000);
await page.keyboard.press("Escape");
const nav = page.locator(".sidebar__nav-item", { hasText: "专家" }).first();
if (await nav.count() > 0) { await nav.click(); }
await page.waitForTimeout(6000);
const out = join(tmpdir(), "exp-settled.png");
await page.screenshot({ path: out });
console.log(JSON.stringify({
  shot: out,
  cards: await page.locator(".ec-card").count(),
  scenes: await page.locator(".ec-scene-card").count(),
  sceneRow: await page.evaluate(() => { const r = document.querySelector(".ec-scenes-row"); if (!r) return null; const cs = getComputedStyle(r); return { scrollW: r.scrollWidth, clientW: r.clientWidth, overflowX: cs.overflowX, h: Math.round(r.getBoundingClientRect().height) }; }),
  sceneCard: await page.evaluate(() => { const c = document.querySelector(".ec-scene-card"); if (!c) return null; const r = c.getBoundingClientRect(); const cs = getComputedStyle(c); return { w: Math.round(r.width), h: Math.round(r.height), display: cs.display, bg: cs.background.slice(0, 60) }; }),
  cs: await page.evaluate(() => { const c = document.querySelector(".ec-card"); if (!c) return null; const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }),
}));
await app.close();
process.exit(0);
