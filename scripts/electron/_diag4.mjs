import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-d4-"));
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
  const getStyle = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {sel, y: Math.round(r.y), x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height), 
            display: cs.display, position: cs.position, pt: cs.paddingTop, pb: cs.paddingBottom,
            mt: cs.marginTop, mb: cs.marginBottom, ml: cs.marginLeft, mr: cs.marginRight,
            pl: cs.paddingLeft, pr: cs.paddingRight, top: cs.top, justify: cs.justifyContent,
            align: cs.alignItems, direction: cs.flexDirection};
  };
  return {
    body: getStyle('body'),
    app: getStyle('.app'),
    appBody: getStyle('.app__body'),
    mainArea: getStyle('.app__body > *:not(.sidebar):not(.toast-stack)'),
    home: getStyle('.home'),
    homeInner: getStyle('.home__inner'),
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
