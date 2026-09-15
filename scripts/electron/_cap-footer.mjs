import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-foot-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(3000);
await page.setViewportSize({ width: 1728, height: 1091 });
await page.waitForTimeout(1500);

const ta = await page.$('textarea');
if (ta) {
  await ta.click();
  await ta.type('test');
  await page.keyboard.press('Meta+Enter');
  await page.waitForTimeout(3000);
}

const m = await page.evaluate(() => {
  const cv = document.querySelector('.chatview');
  const footer = cv?.querySelector('.chatview__footer');
  if (!footer) return { error: 'no footer' };
  return {
    footerCls: footer.className,
    childCount: footer.children.length,
    children: Array.from(footer.children).map(c => ({
      tag: c.tagName.toLowerCase(),
      cls: c.className?.toString().slice(0, 80),
      text: c.textContent?.trim().slice(0, 60),
    })),
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
