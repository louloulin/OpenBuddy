import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-rz5-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });

const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 300)));
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") {
    errs.push(`[${msg.type()}] ${msg.text().slice(0, 300)}`);
  }
});

await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(3000);

console.log("ERRORS:", JSON.stringify(errs, null, 2));

// Take a screenshot to see what's rendered
await page.screenshot({ path: "/tmp/probe-rz5.png", fullPage: true });

// Check what's in #root
const root = await page.evaluate(() => {
  const rootEl = document.getElementById("root");
  if (!rootEl) return { found: false };
  const asideCount = rootEl.querySelectorAll("aside").length;
  const childTags = Array.from(rootEl.children).slice(0, 5).map(c => ({
    tag: c.tagName,
    cls: (c.className || "").toString().slice(0, 80),
  }));
  return { found: true, asideCount, childTags, innerHtml: rootEl.innerHTML.slice(0, 500) };
});
console.log("ROOT:", JSON.stringify(root, null, 2));

await app.close();
process.exit(0);
