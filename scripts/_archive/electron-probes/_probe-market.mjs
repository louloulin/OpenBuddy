/** 校验「专家·技能·连接器 → 插件·市场」与向导类 UI 的真实渲染。 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-mkt-"));
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

const clickText = async (t, exact = false) => page.evaluate(({ t, exact }) => {
  const els = Array.from(document.querySelectorAll("button, [role='tab'], a"));
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const hit = exact ? els.find((e) => norm(e.textContent) === t) : els.find((e) => norm(e.textContent).includes(t));
  if (hit) { hit.click(); return true; }
  return false;
}, { t, exact });

const ok1 = await clickText("专家·技能·连接器");
await page.waitForTimeout(3500);
const pillOk = await clickText("插件·市场");
await page.waitForTimeout(4000);

const state = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const txt = (s) => (q(s)?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 220);
  return {
    errorBoundary: !!q(".error-boundary"),
    marketplaceTab: !!q('[data-testid="marketplace-tab"]'),
    marketplaceSearch: !!q('[data-testid="marketplace-search"]'),
    marketMainText: txt("main"),
    dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map((d) => (d.textContent || "").replace(/\s+/g, " ").slice(0, 80)),
  };
});
console.log(JSON.stringify({ ok1, pillOk, state, pageErrors }, null, 2));
await app.close();
process.exit(0);
