import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-tbc-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(2500);
const win = await app.browserWindow(page);
await win.evaluate((w) => { w.setContentSize(1728, 1031); });
await page.waitForTimeout(2500);

const r = await page.evaluate(() => {
  const tb = document.querySelector(".main-topbar");
  if (!tb) return { error: "no topbar" };
  const t = tb.querySelector(".main-topbar__title");
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  return {
    title: t ? t.textContent.trim() : null,
    titleRect: b(".main-topbar__title"),
    titleArea: b(".main-topbar__title-area"),
    topbarRect: b(".main-topbar"),
    breadcrumb: tb.querySelector(".main-topbar__breadcrumb") ? tb.querySelector(".main-topbar__breadcrumb").textContent.trim() : null,
    allButtons: Array.from(tb.querySelectorAll("button")).map(b => ({ aria: b.getAttribute("aria-label") || "", text: b.textContent.trim().slice(0, 30) })),
  };
});
console.log(JSON.stringify(r, null, 2));
await app.close();
