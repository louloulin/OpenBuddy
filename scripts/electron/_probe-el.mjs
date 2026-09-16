import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-el-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

// Apply matrix theme
await page.evaluate(() => {
  window.localStorage.setItem("openbuddy.theme", "dark");
  window.localStorage.setItem("openbuddy.theme.name", "matrix");
  window.localStorage.setItem("openbuddy.theme.mode", "manual");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(800);

// Walk down from documentElement and report bg of each
const trace = await page.evaluate(() => {
  const root = document.documentElement;
  const result = [];
  function walk(el, depth) {
    if (!el || depth > 6) return;
    const cs = getComputedStyle(el);
    result.push({
      depth,
      tag: el.tagName?.toLowerCase(),
      cls: el.className?.toString().slice(0, 80),
      id: el.id,
      bg: cs.backgroundColor,
      bgImg: cs.backgroundImage.slice(0, 40),
      bgVar: cs.getPropertyValue("background-color").trim(),
    });
    for (const child of el.children ?? []) walk(child, depth + 1);
  }
  walk(root, 0);
  return result.filter((r) => r.bg !== "rgba(0, 0, 0, 0)" || r.depth === 0).slice(0, 25);
});
console.log("TRACE:");
for (const t of trace) {
  console.log(`  d=${t.depth} ${t.tag}#${t.id}.${t.cls} bg=${t.bg}`);
}

await app.close();
process.exit(0);
