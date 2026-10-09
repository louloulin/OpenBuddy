/** 打开一个会话后检查 Phase B 顶栏能力：主题入口 / 快捷键提示 / 产物标签 / 编辑器。 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-sess-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const pageErrors = [];
const page = await app.firstWindow({ timeout: 30_000 });
page.on("pageerror", (e) => pageErrors.push(String(e.message)));
await page.waitForTimeout(14_000);

const snap = () => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const all = (s) => Array.from(document.querySelectorAll(s));
  return {
    errorBoundary: !!q(".error-boundary"),
    themeMenuBtn: !!q('[data-testid="theme-menu-button"]') || !!q('[data-testid="theme-menu-fallback"]'),
    topbarRight: !!q("#ob-topbar-tools"),
    shortcutHint: all("[aria-label^='快捷键']").length,
    artifactTabs: !!q('[aria-label="关闭标签"]'),
    artifactBreadcrumb: !!q('[aria-label="面包屑"]'),
    viewerToolbar: !!q('[aria-label="查看器工具"]'),
    proseMirror: !!q(".ProseMirror"),
    editorToolbar: !!q('[class*="EditorToolbar"], [class*="toolbar"]'),
    dialogCount: all('[role="dialog"]').length,
  };
});

// 打开侧栏第一个任务
const clicked = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll("button, a, li, div[role='button']"));
  const hit = els.find((el) => /R8\.5 probe/.test(el.textContent || ""));
  if (hit) { hit.click(); return true; }
  return false;
});
await page.waitForTimeout(6000);
const after = await snap();

// 尝试打开主题菜单
const menuOpened = await page.evaluate(() => {
  const b = document.querySelector('[data-testid="theme-menu-button"]') || document.querySelector('[data-testid="theme-menu-fallback"]');
  if (b) { b.click(); return true; }
  return false;
});
await page.waitForTimeout(1500);
const afterMenu = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll("button, [role='menuitem'], [role='option']"));
  return {
    visibleLabels: all.map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()).filter((t) => t && t.length < 30).slice(0, 40),
  };
});

console.log(JSON.stringify({ clicked, after, menuOpened, afterMenu, pageErrors }, null, 2));
await app.close();
process.exit(0);
