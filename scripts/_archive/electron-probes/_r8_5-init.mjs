import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-r85-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "1" },
});
const page = await app.firstWindow({ timeout: 60000 });
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(3500);
await page.setViewportSize({ width: 1600, height: 1000 });
await page.waitForTimeout(1500);

// Dump shallow DOM structure to find where topbar lives.
const tree = await page.evaluate(() => {
  function walk(el, depth = 0, maxDepth = 3) {
    if (depth > maxDepth) return null;
    return {
      tag: el.tagName?.toLowerCase(),
      cls: el.className?.toString().slice(0, 80) ?? "",
      id: el.id || undefined,
      kids: Array.from(el.children).slice(0, 12).map((c) => walk(c, depth + 1, maxDepth)),
    };
  }
  const bodyTree = walk(document.body);
  const appBody = document.querySelector('.app__body');
  return {
    bodyTree,
    appBodyHTML: appBody ? appBody.outerHTML.slice(0, 1500) : null,
    appBodyChildCount: appBody?.children.length ?? 0,
    appBodyChildTags: appBody ? Array.from(appBody.children).map((c) => ({ tag: c.tagName, cls: c.className?.toString().slice(0, 80) })) : [],
    appBodyInner: appBody?.innerHTML?.slice(0, 1500),
  };
});
console.log(JSON.stringify(tree, null, 2));
await app.close();
