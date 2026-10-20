import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-css-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(14_000);
const out = await page.evaluate(() => {
  const get = (s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      computed: { height: cs.height, minHeight: cs.minHeight, maxHeight: cs.maxHeight, flex: cs.flex, display: cs.display },
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  };
  return {
    titleBar: get(".app-titlebar"),
    appBody: get(".app__body"),
    main: get(".app__main"),
    topbar: get(".main-topbar"),
    topbarLeft: get(".main-topbar__left"),
    topbarRight: get(".main-topbar__right"),
    sidebar: get(".sidebar"),
    sidebarContent: get(".sidebar__content"),
    sidebarFooter: get(".sidebar__footer"),
  };
});
console.log(JSON.stringify(out, null, 2));
await app.close();
process.exit(0);
