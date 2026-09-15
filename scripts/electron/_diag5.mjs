import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-d5-"));
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
await page.waitForTimeout(3500);
const win = await app.browserWindow(page);
await win.evaluate((w) => { w.setContentSize(1728, 1091); });
await page.waitForTimeout(2500);

const m = await page.evaluate(() => {
  // Get every direct child of home with computed styles
  const home = document.querySelector('.home');
  if (!home) return {error: "no .home"};
  const result = [];
  for (const child of home.children) {
    const cs = getComputedStyle(child);
    const r = child.getBoundingClientRect();
    result.push({
      tag: child.tagName,
      cls: child.className.toString().slice(0, 60),
      y: Math.round(r.y),
      h: Math.round(r.height),
      display: cs.display,
      pt: cs.paddingTop,
      mt: cs.marginTop,
      position: cs.position,
      text: child.textContent ? child.textContent.slice(0, 60) : ''
    });
  }
  // Also check text nodes / pseudo content
  const beforeContent = window.getComputedStyle(home, '::before').content;
  const afterContent = window.getComputedStyle(home, '::after').content;
  return {children: result, beforeContent, afterContent};
});
console.log(JSON.stringify(m, null, 2));
await app.close();
