import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-asb-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(14_000);

const out = await page.evaluate(() => {
  // AppStatusBar uses ui-shell StatusBar which renders as <footer className="_bar_...">
  // Just find any element with footer tag inside .app
  const appEl = document.querySelector(".app");
  const footerInsideApp = appEl ? appEl.querySelector("footer") : null;
  return {
    pageErrors: window.__PAGE_ERRORS__ || [],
    window: { w: innerWidth, h: innerHeight },
    appClass: appEl?.className,
    appChildren: appEl ? Array.from(appEl.children).map((c) => {
      const r = c.getBoundingClientRect();
      return { tag: c.tagName.toLowerCase(), cls: c.className.toString().slice(0, 50), w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y) };
    }) : [],
    footerInsideApp: footerInsideApp ? {
      tag: footerInsideApp.tagName.toLowerCase(),
      cls: footerInsideApp.className.toString().slice(0, 50),
      ...(() => { const r = footerInsideApp.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y) }; })(),
    } : null,
  };
});
console.log(JSON.stringify(out, null, 2));
await app.close();
process.exit(0);
