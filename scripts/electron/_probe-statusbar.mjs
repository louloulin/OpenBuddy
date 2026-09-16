import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-sb-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(14_000);

// Find any status bar element regardless of class
const out = await page.evaluate(() => {
  const r = (s) => { const el = typeof s === "string" ? document.querySelector(s) : s; if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  return {
    // Look for any element with status-bar class
    statusBarCandidates: Array.from(document.querySelectorAll(".status-bar, footer, [class*='status-bar'], [class*='status']"))
      .slice(0, 8).map((el) => {
        const rect = el.getBoundingClientRect();
        return { tag: el.tagName.toLowerCase(), cls: el.className.toString().slice(0, 60), role: el.getAttribute("role"), w: Math.round(rect.width), h: Math.round(rect.height), y: Math.round(rect.y) };
      }),
    // The AppShell renders <AppStatusBar>, let's find it
    bodyChildren: Array.from(document.body.children).map((c) => {
      const rect = c.getBoundingClientRect();
      return { tag: c.tagName.toLowerCase(), cls: c.className.toString().slice(0, 60), w: Math.round(rect.width), h: Math.round(rect.height), y: Math.round(rect.y) };
    }),
    // bottom-most elements
    bottomEls: Array.from(document.querySelectorAll("*"))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.bottom > window.innerHeight - 80;
      })
      .slice(0, 5)
      .map((el) => ({ tag: el.tagName.toLowerCase(), cls: el.className.toString().slice(0, 60), y: Math.round(el.getBoundingClientRect().y) })),
  };
});
console.log(JSON.stringify(out, null, 2));
await app.close();
process.exit(0);
