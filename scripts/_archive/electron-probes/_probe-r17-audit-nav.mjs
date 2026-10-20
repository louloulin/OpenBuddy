import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r17an-"));
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

await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(2500);

// List nav items with their bounding boxes
const navList = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll(".settings-navigation__item"));
  return buttons.map((el) => {
    const r = el.getBoundingClientRect();
    return { text: (el.textContent ?? "").trim(), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });
});
console.log("NAV:", JSON.stringify(navList, null, 2));

// Find and click audit
const auditIdx = navList.findIndex((n) => n.text === "审计追踪");
console.log("AUDIT_IDX:", auditIdx);

if (auditIdx >= 0) {
  // Click via mouse coords
  const nav = navList[auditIdx];
  await page.mouse.click(nav.x + 30, nav.y + nav.h / 2);
  await page.waitForTimeout(2500);
}

const panel = await page.evaluate(() => {
  const p = document.querySelector(".settings-modal__panel");
  return {
    title: p?.querySelector("h2, h3")?.textContent?.trim() ?? null,
    activeNav: document.querySelector(".settings-navigation__item--active")?.textContent?.trim() ?? null,
    hasAuditTable: !!p?.querySelector(".audit-trail__table"),
  };
});
console.log("AFTER:", JSON.stringify(panel, null, 2));

await app.close();
process.exit(0);
