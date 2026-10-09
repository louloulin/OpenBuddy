import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-dom-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const electronApp = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT, "--enable-logging"],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});

const page = await electronApp.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(8_000);

const data = await page.evaluate(() => {
  // Find any tab-related elements
  const allTabs = document.querySelectorAll('[role="tab"], [role="tablist"], .ob-tabs, .scene-tab, [data-tab-id]');
  // Find scene-tabs specifically
  const sceneTabs = document.querySelector(".scene-tabs-wrap");
  const sceneTabsInner = sceneTabs?.innerHTML?.slice(0, 800);
  // Sidebar nav
  const navs = document.querySelectorAll('button, a');
  const sidebarItems = Array.from(navs).slice(0, 30).map(b => ({
    tag: b.tagName,
    text: b.textContent?.trim().slice(0, 30),
    cls: b.className?.slice(0, 60),
  }));
  return {
    tabCount: allTabs.length,
    tabClasses: Array.from(allTabs).slice(0, 5).map(t => ({
      tag: t.tagName,
      cls: t.className?.slice(0, 80),
      text: t.textContent?.trim().slice(0, 40),
    })),
    sceneTabsExists: !!sceneTabs,
    sceneTabsInner: sceneTabsInner,
    sidebarItems,
  };
});

console.log(JSON.stringify(data, null, 2));
await electronApp.close();
