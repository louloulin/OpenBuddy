/**
 * 校验侧栏（左侧菜单栏）宽度：默认值、拖拽、min/max clamp、localStorage 持久化、
 * 重启后恢复，以及 footer / 会话滚动是否仍然成立。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-width-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.waitForTimeout(15000);
const strip = () => page.evaluate(() => { for (const el of [...document.querySelectorAll("*")]) { const cs = getComputedStyle(el); if (cs.backdropFilter && cs.backdropFilter !== "none") el.remove(); } });
await strip();
await page.waitForTimeout(400);
const width = () => page.evaluate(() => Math.round(document.querySelector(".sidebar").getBoundingClientRect().width));
const stored = () => page.evaluate(() => localStorage.getItem("openbuddy.sidebar.width"));
const drag = async (delta) => {
  const h = await page.$('[role="separator"][aria-label="调整侧栏宽度"]');
  const b = await h.boundingBox();
  const x = Math.round(b.x) + 2;
  await page.mouse.move(x, 400);
  await page.mouse.down();
  await page.mouse.move(Math.max(5, x + delta), 400, { steps: 10 });
  const dragging = await h.getAttribute("data-dragging");
  await page.mouse.up();
  await page.waitForTimeout(350);
  return { dragging, width: await width(), stored: await stored() };
};
const handle = await page.$('[role="separator"][aria-label="调整侧栏宽度"]');
const box = await handle.boundingBox();
const hit = await page.evaluate(([x, y]) => {
  const el = document.elementFromPoint(x, y);
  return el ? `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 44)}` : "none";
}, [Math.round(box.x) + 2, 400]);
const result = { defaultWidth: await width(), handleBox: box, handleHit: hit };
result.dragWider = await drag(72);
result.dragToMax = await drag(900);
result.dragToMin = await drag(-900);
// 重启（同一 profile）后应恢复上次落库宽度
result.afterRestart = null;
const persisted = await stored();
await app.close();
const app2 = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page2 = await app2.firstWindow({ timeout: 30_000 });
page2.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page2.waitForTimeout(15000);
await page2.evaluate(() => { for (const el of [...document.querySelectorAll("*")]) { const cs = getComputedStyle(el); if (cs.backdropFilter && cs.backdropFilter !== "none") el.remove(); } });
await page2.waitForTimeout(400);
result.persistedBeforeRestart = persisted;
result.afterRestart = await page2.evaluate(() => Math.round(document.querySelector(".sidebar").getBoundingClientRect().width));
// 回到默认宽度后检查布局
await page2.evaluate(() => localStorage.removeItem("openbuddy.sidebar.width"));
await page2.reload();
await page2.waitForTimeout(9000);
await page2.evaluate(() => { for (const el of [...document.querySelectorAll("*")]) { const cs = getComputedStyle(el); if (cs.backdropFilter && cs.backdropFilter !== "none") el.remove(); } });
await page2.waitForTimeout(600);
result.afterReset = await page2.evaluate(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const content = document.querySelector(".sidebar__content");
  return {
    sidebarWidth: Math.round(document.querySelector(".sidebar").getBoundingClientRect().width),
    footer: r(".sidebar__footer"),
    contentScrollable: (content?.scrollHeight ?? 0) > (content?.clientHeight ?? 0),
    nav: r(".sidebar__nav"),
    viewport: { w: innerWidth, h: innerHeight },
  };
});
result.errors = errors;
await page2.screenshot({ path: "/tmp/ob-menubar-wider.png" });
console.log(JSON.stringify(result, null, 2));
await app2.close();
process.exit(0);
