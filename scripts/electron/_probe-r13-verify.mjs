import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-r13-"));

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, projectRoot],
  executablePath: join(projectRoot, "node_modules", ".bin", "electron"),
  cwd: projectRoot, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(2500);

const win = await app.browserWindow(page);
await win.evaluate((w) => { w.setContentSize(1728, 1031); });
await page.waitForTimeout(2500);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
await page.waitForTimeout(800);

// 1) Check page errors (R12.4 + R13.1 guard should prevent any white screen)
const errs = await page.evaluate(() => window.__PAGE_ERRORS__ || []);
console.log("PAGE ERRORS:", errs.length, errs.length > 0 ? errs.slice(0, 3) : "none");

// 2) Navigate to 专家·技能·连接器 → 插件·市场 (this renders OpenBuddyPluginPanel which uses usePluginSnapshot/usePluginReadiness)
await page.click("text=专家·技能·连接器");
await page.waitForTimeout(1000);

const pluginPanel = await page.evaluate(() => {
  const mcp = document.querySelector(".openbuddy-plugin-panel, [class*='plugin-panel']");
  const tabs = Array.from(document.querySelectorAll("[role='tab']")).map(t => t.textContent?.trim().slice(0, 20));
  return {
    pluginPanelVisible: !!mcp,
    tabs: tabs.slice(0, 10),
  };
});
console.log("Plugin panel state:", JSON.stringify(pluginPanel, null, 2));

// 3) Try clicking 插件·市场 tab if present
const marketplaceTab = await page.locator("text=插件·市场").first();
if (await marketplaceTab.count() > 0) {
  await marketplaceTab.click();
  await page.waitForTimeout(1500);
  const mktState = await page.evaluate(() => ({
    hasCards: document.querySelectorAll(".marketplace-card, [class*='marketplace']").length,
    bodySnippet: (document.querySelector(".openbuddy-plugin-panel, [class*='plugin-panel']")?.textContent || "").replace(/\s+/g, " ").slice(0, 200),
  }));
  console.log("Marketplace tab state:", JSON.stringify(mktState, null, 2));
}

await page.screenshot({ path: "/tmp/ob-r13-plugin-panel.png" });

await app.close();
