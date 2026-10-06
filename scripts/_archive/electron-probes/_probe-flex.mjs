import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-flex-"));
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
      computed: { height: cs.height, minHeight: cs.minHeight, flex: cs.flex, display: cs.display, flexDirection: cs.flexDirection, overflow: cs.overflow, inline: el.getAttribute("style") || "" },
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  };
  return {
    app: get(".app"),
    appBody: get(".app__body"),
    appSidebar: get(".app__sidebar-shell"),
    main: get(".app__main"),
    mainTopbar: get(".main-topbar"),
    topbarInner: (() => {
      // Walk up to check parents
      const el = document.querySelector(".main-topbar");
      if (!el) return null;
      const path = [];
      let cur = el.parentElement;
      while (cur && path.length < 5) {
        const cs = getComputedStyle(cur);
        path.push({ tag: cur.tagName.toLowerCase(), cls: cur.className.toString().slice(0, 30), height: cs.height, display: cs.display, flexDirection: cs.flexDirection, minHeight: cs.minHeight });
        cur = cur.parentElement;
      }
      return path;
    })(),
  };
});
console.log(JSON.stringify(out, null, 2));
await app.close();
process.exit(0);
