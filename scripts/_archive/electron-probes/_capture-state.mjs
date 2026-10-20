/**
 * Capture OpenBuddy state after Phase 1-4 refactor.
 * Takes screenshot + dumps DOM structure for verification.
 */
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-capture-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const electronApp = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT, "--enable-logging"],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});

const page = await electronApp.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(8_000);

const structure = await page.evaluate(() => {
  const tabs = document.querySelectorAll(".ob-tabs__btn");
  const skills = document.querySelectorAll(".home__skill-chip");
  const practices = document.querySelectorAll(".home__practice-card");
  const sidebarNav = document.querySelectorAll(".sidebar-nav__item");
  return {
    tabs: Array.from(tabs).map((b) => b.textContent?.trim()),
    skills: Array.from(skills).map((b) => b.textContent?.trim()),
    practicesCount: practices.length,
    sidebarNavCount: sidebarNav.length,
    activeTab: document.querySelector(".ob-tabs__btn.is-active")?.textContent?.trim(),
    skillBarTitle: document.querySelector(".home__skills-bar-title")?.textContent,
    sceneTabsExists: !!document.querySelector(".scene-tabs-wrap"),
  };
});

await page.screenshot({ path: "/tmp/ob-after-refactor.png", fullPage: false });

console.log("===== UI STRUCTURE AFTER REFACTOR =====");
console.log(JSON.stringify(structure, null, 2));
console.log("\nScreenshot saved to /tmp/ob-after-refactor.png");

await electronApp.close();
process.exit(0);
