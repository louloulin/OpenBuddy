/**
 * Phase B/C/D 真实 Electron 探针：
 * 主题系统 / Topbar+状态栏 / 市场 / 编辑器 / 引导 的 DOM 落地校验。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-bcd-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT, "--enable-logging"],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const pageErrors = [];
const page = await app.firstWindow({ timeout: 30_000 });
page.on("pageerror", (err) => pageErrors.push(String(err.message)));
await page.waitForTimeout(14_000);

const snap = () => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const all = (s) => Array.from(document.querySelectorAll(s));
  const txt = (s) => (q(s)?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
  return {
    errorBoundary: !!q(".error-boundary"),
    theme: {
      attr: document.documentElement.getAttribute("data-theme"),
      name: document.documentElement.getAttribute("data-theme-name"),
    },
    statusBar: { present: !!q('[data-testid="status-bar"]'), text: txt('[data-testid="status-bar"]') },
    themeMenu: !!q('[data-testid="theme-menu-button"]') || !!q('[data-testid="theme-menu-fallback"]'),
    marketplace: { tab: !!q('[data-testid="marketplace-tab"]'), search: !!q('[data-testid="marketplace-search"]') },
    onboarding: all('[role="dialog"]').map((d) => (d.textContent || "").replace(/\s+/g, " ").slice(0, 100)),
    editor: { proseMirror: !!q(".ProseMirror"), toolbar: !!q('[class*="toolbar"]') },
    artifact: { tabs: !!q('[aria-label="关闭标签"]'), breadcrumb: !!q('[aria-label="面包屑"]'), viewer: !!q('[aria-label="查看器工具"]') },
    navLabels: all("nav button, .sidebar button, aside button").map((b) => (b.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 20),
    mainText: txt("main"),
  };
});

const results = { initial: await snap() };
const click = async (label) => {
  const ok = await page.evaluate((t) => {
    const btns = Array.from(document.querySelectorAll("button"));
    const hit = btns.find((b) => (b.textContent || "").replace(/\s+/g, " ").trim() === t)
      || btns.find((b) => (b.textContent || "").includes(t));
    if (hit) { hit.click(); return true; }
    return false;
  }, label);
  if (!ok) return { clicked: false };
  await page.waitForTimeout(3000);
  return { clicked: true, ...(await snap()) };
};

for (const label of ["更多", "插件", "项目", "专家·技能·连接器", "设置"]) {
  results[`tab:${label}`] = await click(label);
}

results.pageErrors = pageErrors;
console.log(JSON.stringify(results, null, 2));
await app.close();
process.exit(0);
