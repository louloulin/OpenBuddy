// 全量扫描：所有「前景白 / 背景品牌色」的元素，计算真实对比度。
import { _electron as electron } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const root = "/Users/louloulin/appx/OpenBuddy";
const app = await electron.launch({
  executablePath: join(root, "node_modules", ".bin", "electron"),
  args: [join(root, "out/main/index.js")], cwd: root,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(2500);

async function scan(theme) {
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
    document.body.setAttribute("data-theme", t);
  }, theme);
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const rgb = (s) => { const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/); if (!m) return null;
      return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }; };
    const lum = (c) => { if (!c) return null; const f = (v) => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
      return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); };
    const ratio = (a,b) => { const la=lum(a), lb=lum(b); if (la===null||lb===null) return null;
      const [hi,lo] = la>lb?[la,lb]:[lb,la]; return +((hi+0.05)/(lo+0.05)).toFixed(2); };
    const bgOf = (el) => { let n = el; while (n) { const c = rgb(getComputedStyle(n).backgroundColor); if (c && c.a > 0.5) return c; n = n.parentElement; }
      return rgb(getComputedStyle(document.body).backgroundColor); };
    const brandish = (c) => c && c.g > 120 && c.g > c.r + 60 && c.g > c.b && c.b > c.r;
    const out = [];
    document.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") return;
      const own = rgb(cs.backgroundColor);
      if (!own || own.a < 0.5 || !brandish(own)) return;
      // this element has a brand-ish bg; check its own color + descendants
      const fgC = rgb(cs.color);
      const t = (el.textContent || "").trim().slice(0, 30);
      out.push({
        cls: (el.className||"").toString().slice(0,60), text: t,
        bg: `rgb(${own.r},${own.g},${own.b})`, fg: cs.color,
        ratio: ratio(fgC, own), fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        isIcon: !!el.querySelector("svg") || el.tagName === "SVG",
      });
    });
    return out;
  });
}
const light = await scan("light");
const dark = await scan("dark");
writeFileSync("/tmp/openbuddy-screenshots/onbrand.json", JSON.stringify({ light, dark }, null, 2));
console.log("LIGHT brand-fill elements:", light.length);
light.forEach(o => console.log("  ", JSON.stringify(o)));
console.log("DARK brand-fill elements:", dark.length);
dark.forEach(o => console.log("  ", JSON.stringify(o)));
await app.close();
