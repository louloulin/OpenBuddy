import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExpertCatalogFixture } from "./_fixture-expert-catalog.mjs";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const expertRoot = join(tmpdir(), `ob-r84p-${process.pid}`);
buildExpertCatalogFixture(expertRoot);
const userData = mkdtempSync(join(tmpdir(), "ob-r84p-"));
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

const main = page.locator("main.app__main").first();
const mb = await main.boundingBox();
if (mb) await page.screenshot({ path: join(tmpdir(), "part-main.png"), clip: mb });

await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll(".ec-list-tabs .um-segment-item"));
  const team = tabs.find((t) => (t.textContent || "").includes("专家团"));
  if (team) team.click();
});
await page.waitForTimeout(2500);
const m2 = await page.locator("main.app__main").first().boundingBox();
if (m2) await page.screenshot({ path: join(tmpdir(), "part-teams.png"), clip: m2 });

const info = await page.evaluate(() => {
  const qa = (s) => Array.from(document.querySelectorAll(s));
  return {
    cardCount: qa(".ec-card").length,
    scenesRow: (() => { const r = document.querySelector(".ec-scenes-row"); if (!r) return null; const cs = getComputedStyle(r); return { overflowX: cs.overflowX, display: cs.display, gap: cs.gap, scrollW: r.scrollWidth, clientW: r.clientWidth }; })(),
    sceneCards: qa(".ec-scene-card").map((c) => { const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), title: c.querySelector(".ec-scene-name")?.textContent?.trim(), rows: c.querySelectorAll(".ec-scene-expert").length, hasBg: !!c.querySelector(".ec-scene-bg") }; }),
    teamCards: qa(".ec-card").slice(0, 3).map((c) => ({
      title: c.querySelector(".ec-card-title")?.textContent?.trim(),
      sub: c.querySelector(".ec-card-sub")?.textContent?.trim(),
      tags: Array.from(c.querySelectorAll(".ec-card-tag")).map((t) => t.textContent.trim()),
      avatarCls: c.querySelector(".um-thumb-wrap")?.className ?? null,
      avatarSvg: c.querySelector(".um-thumb-wrap svg") ? "svg" : (c.querySelector(".um-thumb-wrap img") ? "img" : "none"),
      h: Math.round(c.getBoundingClientRect().height),
    })),
  };
});
console.log(JSON.stringify({ main: join(tmpdir(), "part-main.png"), teams: join(tmpdir(), "part-teams.png"), info }, null, 1).slice(0, 4000));
await app.close();
process.exit(0);
