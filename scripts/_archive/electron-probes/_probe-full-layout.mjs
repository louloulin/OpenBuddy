import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-full-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
await page.waitForTimeout(3000);
const layout = await page.evaluate(() => {
  const vis = (els) => els.filter(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
  }).map(el => ({
    tag: el.tagName.toLowerCase(),
    cls: (el.className || "").toString().slice(0, 200),
    x: Math.round(el.getBoundingClientRect().x),
    y: Math.round(el.getBoundingClientRect().y),
    w: Math.round(el.getBoundingClientRect().width),
    h: Math.round(el.getBoundingClientRect().height),
  }));
  return {
    mainKids: vis(Array.from(document.querySelector(".app__main")?.children || [])),
    asides: vis(Array.from(document.querySelectorAll("aside"))),
    wideKids: vis(Array.from(document.querySelectorAll(".app__main *"))).filter(e => e.w > 100 && e.x > 700).slice(0, 20),
  };
});
console.log(JSON.stringify(layout, null, 2));
await page.screenshot({ path: "/tmp/ob-home.png" });
await app.close();
