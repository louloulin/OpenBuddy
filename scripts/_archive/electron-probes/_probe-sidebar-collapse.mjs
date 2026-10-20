/** 折叠/展开侧栏在加宽 + handle 提层后是否仍然正常。 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-collapse-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15000);
await page.evaluate(() => { for (const el of [...document.querySelectorAll("*")]) { const cs = getComputedStyle(el); if (cs.backdropFilter && cs.backdropFilter !== "none") el.remove(); } });
await page.waitForTimeout(400);
const mainBox = () => page.evaluate(() => { const m = document.querySelector(".app__main").getBoundingClientRect(); return { x: Math.round(m.x), w: Math.round(m.width) }; });
const shell = () => page.evaluate(() => { const s = document.querySelector(".app__sidebar-shell"); return s ? { display: getComputedStyle(s).display, w: Math.round(s.getBoundingClientRect().width) } : null; });
const labels = await page.evaluate(() => [...document.querySelectorAll(".sidebar__logo-row button")].map((b) => b.getAttribute("aria-label")));
const before = { main: await mainBox(), shell: await shell() };
await page.evaluate(() => document.querySelector(".sidebar__logo-row button").click());
await page.waitForTimeout(700);
const collapsed = { main: await mainBox(), shell: await shell(), float: await page.evaluate(() => !!document.querySelector(".main-topbar-float")) };
await page.screenshot({ path: "/tmp/ob-collapsed.png" });
const expand = await page.$('.main-topbar-float button[aria-label="展开侧边栏"]');
if (expand) { await expand.click(); await page.waitForTimeout(800); }
const expanded = { main: await mainBox(), shell: await shell() };
console.log(JSON.stringify({ labels, before, collapsed, expanded }, null, 2));
await app.close();
process.exit(0);
