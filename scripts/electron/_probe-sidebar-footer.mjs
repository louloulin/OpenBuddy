/** 侧栏底部（用户 + 设置）几何探针：是否存在、是否在可视区内、会话列表是否可滚动。 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-foot-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(14_000);
const out = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const sidebar = q(".sidebar, aside, [class*='sidebar']");
  const footer = q(".sidebar__footer");
  const user = q(".sidebar__user");
  const settingsBtn = Array.from(document.querySelectorAll("button")).find((b) => (b.getAttribute("aria-label") || "") === "设置");
  const scroller = Array.from(document.querySelectorAll(".sidebar *")).filter((el) => {
    const cs = getComputedStyle(el);
    return /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4;
  }).slice(0, 6).map((el) => ({ cls: (el.className || "").toString().slice(0, 60), scrollH: el.scrollHeight, clientH: el.clientHeight, rect: rect(el) }));
  void scroller;
  const allScrollers = Array.from(document.querySelectorAll(".sidebar *")).filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY)).map((el) => ({ cls: (el.className || "").toString().slice(0, 60), scrollH: el.scrollHeight, clientH: el.clientHeight }));
  return {
    viewport: { w: innerWidth, h: innerHeight },
    sidebarRect: rect(sidebar),
    footerRect: rect(footer),
    userRect: rect(user),
    userText: (user?.textContent || "").replace(/\s+/g, " ").trim(),
    settingsBtnRect: rect(settingsBtn),
    footerVisibleInViewport: footer ? rect(footer).y + rect(footer).h <= innerHeight + 1 : null,
    overflowingScrollers: scroller,
    allScrollers,
  };
});
console.log(JSON.stringify(out, null, 2));
await app.close();
process.exit(0);
