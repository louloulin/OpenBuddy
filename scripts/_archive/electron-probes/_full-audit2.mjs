import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-a2-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(4000);

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

// Click the home nav (or whatever brings us home)
const homeAudit = await page.evaluate(() => {
  // Find home button
  const homeBtn = document.querySelector("[class*='home-tab'], [aria-label*='home' i], [data-nav='home']");
  if (homeBtn) homeBtn.click();
  return { clickedHome: !!homeBtn };
});
await page.waitForTimeout(2000);

// Now audit the page
const audit = await page.evaluate(() => {
  const findText = (selector) => {
    const el = document.querySelector(selector);
    return el ? el.textContent?.trim().slice(0, 200) : null;
  };
  return {
    title: document.title,
    url: location.href,
    bodyText: document.body.textContent?.replace(/\s+/g, ' ').slice(0, 800),
    sceneTabsCount: document.querySelectorAll("[class*='scene-tab'], [class*='SceneTab'], [class*='scene__tab']").length,
    homeCardCount: document.querySelectorAll(".home-card, .home__card, [class*='home-card']").length,
    suggestionChips: document.querySelectorAll("[class*='suggest'], [class*='chip']").length,
    topbarTitle: findText(".main-topbar__title, [class*='topbar-title'], [class*='TopbarTitle']"),
    statusBar: findText("[class*='statusbar'], [class*='StatusBar'], [class*='status-bar']"),
    pageErrors: window.__pageErrors || [],
  };
});

console.log("HOME audit:", JSON.stringify(audit, null, 2));
console.log("\nPageErrors:", pageErrors.length);
for (const e of pageErrors.slice(0, 5)) console.log("  -", e.slice(0, 200));

await app.close();
