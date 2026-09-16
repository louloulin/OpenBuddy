import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-shape-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(14_000);
const out = await page.evaluate(() => {
  const tree = (el, depth = 0, max = 3) => {
    if (!el || depth > max) return null;
    const kids = Array.from(el.children).map((c) => tree(c, depth + 1, max)).filter(Boolean);
    return { tag: el.tagName.toLowerCase(), cls: (el.className || "").toString().slice(0, 90), kids };
  };
  const root = document.querySelector("#root");
  const testids = Array.from(document.querySelectorAll("[data-testid]")).map((e) => e.getAttribute("data-testid"));
  return {
    rootTree: tree(root),
    testids,
    ariaLabels: Array.from(document.querySelectorAll("[aria-label]")).map((e) => e.getAttribute("aria-label")).slice(0, 40),
    bodyText: (document.body.textContent || "").replace(/\s+/g, " ").slice(0, 500),
  };
});
console.log(JSON.stringify(out, null, 2));
await app.close();
process.exit(0);
