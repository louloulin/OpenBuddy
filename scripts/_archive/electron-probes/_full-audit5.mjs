import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-a5-"));
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

// Look for topbar in main content area
const audit = await page.evaluate(() => {
  const main = document.querySelector(".app__main, main");
  const mainChildren = main ? Array.from(main.children).map(el => ({
    tag: el.tagName.toLowerCase(),
    cls: (el.className ?? "").toString().slice(0, 80),
    text: el.textContent?.trim().slice(0, 60),
    y: Math.round(el.getBoundingClientRect().y),
    h: Math.round(el.getBoundingClientRect().height),
  })) : [];
  return { mainChildren };
});

console.log(JSON.stringify(audit, null, 2));

await app.close();
