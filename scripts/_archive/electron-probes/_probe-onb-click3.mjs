import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-click3-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.evaluate(() => {
  window.__ev = [];
  const desc = (t) => {
    if (!t || typeof t.getAttribute !== "function") return String(t);
    return t.tagName + "." + (typeof t.className === "string" ? t.className.slice(0,60) : "") + "[" + (t.getAttribute("data-testid") ?? "") + "]";
  };
  for (const k of ["pointerdown","mousedown","click","keydown","pointerup","mouseup"]) {
    document.addEventListener(k, (e) => {
      window.__ev.push({
        k, trusted: e.isTrusted, x: e.clientX, y: e.clientY,
        target: desc(e.target), path: (e.composedPath?.() ?? []).slice(0,4).map(desc).join(" > "),
        stack: (new Error().stack || "").split("\n").slice(2, 12).map(s=>s.trim().replace(/file:\/\/[^ )]*\//,"")).join(" | "),
      });
    }, true);
  }
});
await page.waitForTimeout(15000);
const out = await page.evaluate(() => window.__ev);
for (const e of out) {
  console.log(`${e.k} trusted=${e.trusted} (${Math.round(e.x)},${Math.round(e.y)}) ${e.target}`);
  console.log(`   path: ${e.path}`);
  console.log(`   stack: ${e.stack}`);
}
await app.close();
process.exit(0);
