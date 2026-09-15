import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-pj-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const electronApp = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT, "--enable-logging"],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});

const page = await electronApp.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(6_000);

// Click 项目 tab
const projectTab = await page.locator('.sidebar button:has-text("项目")').first();
await projectTab.click();
await page.waitForTimeout(2_000);

const data = await page.evaluate(() => {
  const tplSection = document.querySelector('[class*="template"], .from-template, [class*="Template"]');
  const allCards = document.querySelectorAll('.projects-panel__template-card, .project-template-card, [class*="template-card"], [class*="templateCard"]');
  const allTexts = Array.from(document.querySelectorAll('button, .projects-panel__card, [role="button"]'))
    .map((b) => (b.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50))
    .filter((t) => t && t.length > 0);
  return {
    templateSectionExists: !!tplSection,
    templateSectionClass: tplSection?.className?.slice(0, 100),
    cardCount: allCards.length,
    cardClasses: Array.from(allCards).slice(0, 6).map((c) => c.className?.slice(0, 80)),
    cardTexts: allTexts.filter((t) => t.includes("模板") || t.includes("需求") || t.includes("调研") || t.includes("知识库") || t.includes("交付") || t.includes("Bug")).slice(0, 10),
  };
});

console.log(JSON.stringify(data, null, 2));
await electronApp.close();
