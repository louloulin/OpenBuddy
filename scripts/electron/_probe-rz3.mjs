import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-rz3-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

// Find anything sidebar-like
const found = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll("*"));
  const sb = all.find((el) => {
    const cls = (el.className || "").toString();
    return cls === "sidebar" || cls.startsWith("sidebar ");
  });
  return {
    sidebarCount: all.filter(el => (el.className || "").toString().includes("sidebar")).length,
    sidebarFound: !!sb,
    classes: all.filter(el => (el.className || "").toString().includes("sidebar")).slice(0, 5).map(el => el.className.toString().slice(0, 80)),
    handles: Array.from(document.querySelectorAll("[role='separator'], [class*='resize'], [class*='handle']")).map(el => ({
      role: el.getAttribute("role"),
      cls: el.className.toString().slice(0, 80),
      visible: getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden",
    })),
  };
});
console.log("FOUND:", JSON.stringify(found, null, 2));

await app.close();
process.exit(0);
