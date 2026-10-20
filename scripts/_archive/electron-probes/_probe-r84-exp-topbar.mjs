import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExpertCatalogFixture } from "./_fixture-expert-catalog.mjs";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const expertRoot = join(tmpdir(), `ob-r84tb-${process.pid}`);
buildExpertCatalogFixture(expertRoot);
const userData = mkdtempSync(join(tmpdir(), "ob-r84tb-"));
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
const info = await page.evaluate(() => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: cs.display, vis: cs.visibility, op: cs.opacity, ov: cs.overflow }; };
  const topbar = document.querySelector(".um-topbar");
  const search = document.querySelector(".um-search");
  const input = document.querySelector(".um-search-input");
  const btn = document.querySelector(".um-topbar-right .um-btn");
  const right = document.querySelector(".um-topbar-right");
  const left = document.querySelector(".um-topbar-left");
  return {
    umPage: R(document.querySelector(".um-page")),
    topbar: R(topbar),
    left: R(left), right: R(right),
    searchWrap: R(search), input: R(input), btn: R(btn),
    topbarChildren: topbar ? Array.from(topbar.children).map((c) => ({ cls: String(c.className), ...R(c) })) : [],
    rightChildren: right ? Array.from(right.children).map((c) => ({ cls: String(c.className), tag: c.tagName, text: (c.textContent || "").slice(0, 20), ...R(c) })) : [],
    inputStyles: input ? { fontSize: getComputedStyle(input).fontSize, color: getComputedStyle(input).color, bg: getComputedStyle(input).backgroundColor, border: getComputedStyle(input).borderTopWidth, pad: getComputedStyle(input).paddingLeft } : null,
  };
});
console.log(JSON.stringify(info, null, 1).slice(0, 4000));
await app.close();
process.exit(0);
