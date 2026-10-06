import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExpertCatalogFixture } from "./_fixture-expert-catalog.mjs";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const expertRoot = join(tmpdir(), `ob-r84dom-${process.pid}`);
buildExpertCatalogFixture(expertRoot);
const userData = mkdtempSync(join(tmpdir(), "ob-r84d-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({ args: [`--user-data-dir=${userData}`, ROOT], executablePath: join(ROOT, "node_modules", ".bin", "electron"), cwd: ROOT, timeout: 60_000, env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENTS_DIR: expertRoot } });
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.setViewportSize({ width: 1600, height: 1000 });
await page.waitForTimeout(2500);
await page.evaluate((r) => {
  window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({ version: 1, status: "done", index: 2, steps: [], startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now() }));
  window.localStorage.setItem("openbuddy.tour.state", "seen");
  window.localStorage.setItem("expertsCatalogRoot", r);
}, expertRoot);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40_000 });
await page.waitForTimeout(3000);
await page.keyboard.press("Escape");
const nav = page.locator(".sidebar__nav-item", { hasText: "专家" }).first();
if (await nav.count() > 0) await nav.click();
await page.waitForTimeout(5000);
const dump = await page.evaluate(() => {
  const desc = (el, d = 0) => {
    const r = el.getBoundingClientRect();
    const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 3).join(".") : "";
    return `${"  ".repeat(d)}${el.tagName.toLowerCase()}${cls ? "." + cls : ""} [${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}]`;
  };
  const lines = [];
  const walk = (el, d) => {
    if (d > 4) return;
    if (el.getBoundingClientRect().width < 40) return;
    lines.push(desc(el, d));
    for (const c of el.children) walk(c, d + 1);
  };
  walk(document.body, 0);
  return {
    structure: lines.slice(0, 70),
    sidebarHasScenes: !!document.querySelector(".sidebar__scroll .ec-scenes, .sidebar .ec-scenes"),
    scenesContainers: Array.from(document.querySelectorAll(".ec-scenes")).map((e) => {
      const r = e.getBoundingClientRect();
      const p = e.closest(".sidebar") ? "sidebar" : e.closest(".app__main") ? "main" : "other";
      return { parent: p, x: Math.round(r.x), w: Math.round(r.width) };
    }),
    grids: Array.from(document.querySelectorAll(".ec-grid")).map((e) => {
      const r = e.getBoundingClientRect();
      return { parent: e.closest(".sidebar") ? "sidebar" : e.closest(".app__main") ? "main" : "other", x: Math.round(r.x), w: Math.round(r.width), cards: e.children.length };
    }),
    umPages: Array.from(document.querySelectorAll(".um-page")).map((e) => {
      const r = e.getBoundingClientRect();
      return { parent: e.closest(".sidebar") ? "sidebar" : e.closest(".app__main") ? "main" : "other", x: Math.round(r.x), w: Math.round(r.width) };
    }),
    lsRoot: window.localStorage.getItem("expertsCatalogRoot"),
  };
});
console.log(JSON.stringify(dump, null, 1).slice(0, 6000));
await app.close();
process.exit(0);
