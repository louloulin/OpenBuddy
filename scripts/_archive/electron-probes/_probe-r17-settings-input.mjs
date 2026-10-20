import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r17si-"));
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

// Dark mode
await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(1200);
await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".settings-navigation__item"));
    const t = items.find((el) => (el.textContent ?? "").includes("个性化"));
    if (t) t.click();
  });
await page.waitForTimeout(900);
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll(".theme-toggle__btn"));
  const target = buttons.find((b) => (b.textContent ?? "").includes("深色"));
  if (target) target.click();
});
await page.waitForTimeout(800);
await page.keyboard.press("Escape");
await page.waitForTimeout(600);

// Now check audit page input (which we explicitly added to the dark rule)
await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".settings-navigation__item"));
  const t = items.find((el) => (el.textContent ?? "").includes("审计追踪"));
  if (t) t.click();
});
await page.waitForTimeout(2000);

const auditInputs = await page.evaluate(() => {
  const panel = document.querySelector(".audit-trail");
  if (!panel) return { found: false };
  const inputs = Array.from(panel.querySelectorAll("input, button"));
  return {
    found: true,
    inputs: inputs.slice(0, 4).map((el) => ({ tag: el.tagName, type: (el).type ?? null, bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color })),
  };
});
console.log("AUDIT INPUTS:", JSON.stringify(auditInputs, null, 2));

await app.close();
process.exit(0);
