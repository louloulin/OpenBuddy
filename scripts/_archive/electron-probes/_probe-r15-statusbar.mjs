import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r15-sb-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(14_000);

const out = await page.evaluate(() => {
  // Find any element that looks like the AppStatusBar
  const all = Array.from(document.querySelectorAll("*"));
  const candidates = all.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.height >= 20 && r.height <= 30 && r.bottom > window.innerHeight - 50 && el.tagName !== "HTML" && el.tagName !== "BODY";
  });
  return {
    pageErrors: window.__PAGE_ERRORS__ || [],
    window: { w: innerWidth, h: innerHeight },
    bottomBarCandidates: candidates.slice(0, 8).map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), cls: el.className.toString().slice(0, 60), w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y) };
    }),
    // Look for the AppStatusBar's specific class
    statusBarEls: Array.from(document.querySelectorAll("footer[class*='bar'], div[class*='bar']"))
      .slice(0, 8).map((el) => {
        const r = el.getBoundingClientRect();
        return { tag: el.tagName.toLowerCase(), cls: el.className.toString().slice(0, 60), w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y) };
      }),
  };
});
console.log(JSON.stringify(out, null, 2));
await app.close();
process.exit(0);
