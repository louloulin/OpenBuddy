import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-sb-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForFunction(() => window.api?.apiVersion === 1);
await page.waitForTimeout(2500);
const win = await app.browserWindow(page);
await win.evaluate((w) => w.setContentSize(1728, 1091));
await page.waitForTimeout(2500);
const out = process.argv[2] || "/Users/louloulin/Downloads/cur-sidebar-deep.png";
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 264, height: 1091 } });
const m = await page.evaluate(() => {
  const g = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  const cs = (s, p) => { const el = document.querySelector(s); return el ? getComputedStyle(el)[p] : null; };
  return {
    newTask: g('.sidebar__nav-item--active'),
    newTaskBg: cs('.sidebar__nav-item--active', 'backgroundColor'),
    moreSub: g('.sidebar__nav-sub'),
    moreSubText: document.querySelector('.sidebar__nav-sub')?.textContent,
    sectionLabel: g('.sidebar__section-label'),
    sectionLabelBg: cs('.sidebar__section-label', 'backgroundColor'),
    sectionLabelColor: cs('.sidebar__section-label', 'color'),
    sectionLabelPad: cs('.sidebar__section-label', 'padding'),
    chevron: g('.sidebar__chevron'),
    chevronTransform: cs('.sidebar__chevron', 'transform'),
    chevronColor: cs('.sidebar__chevron', 'color'),
    chevronCollapsed: g('.sidebar__chevron--collapsed'),
    sectionGroups: [...document.querySelectorAll('.sidebar__group')].map(el => ({
      rect: (() => { const r = el.getBoundingClientRect(); return {y: Math.round(r.y), h: Math.round(r.height)}; })(),
      childCount: el.children.length,
      firstChildCls: el.children[0]?.className?.slice(0, 40),
    })),
    footer: g('.sidebar__footer'),
    footerItems: [...document.querySelectorAll('.sidebar__footer > *, .sidebar__footer button, .sidebar__footer [role]')].map(el => el.textContent.trim().slice(0, 20)),
    header: g('.sidebar__logo-row'),
  };
});
console.log(JSON.stringify(m, null, 1));
await app.close();
