import { _electron as electron } from "playwright";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
const root = "/Users/louloulin/appx/OpenBuddy";
const outDir = "/tmp/openbuddy-screenshots/onbrand";
mkdirSync(outDir, { recursive: true });
const app = await electron.launch({
  executablePath: join(root, "node_modules", ".bin", "electron"),
  args: [join(root, "dist/main/index.js")], cwd: root,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(2500);

async function check(theme) {
  await page.evaluate((t) => { document.documentElement.setAttribute("data-theme", t); document.body.setAttribute("data-theme", t); }, theme);
  await page.waitForTimeout(200);
  const ta = await page.$("textarea");
  if (ta) {
    await ta.evaluate(el => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      set.call(el, "测试品牌对比度"); el.dispatchEvent(new Event("input", { bubbles: true })); el.focus();
    });
    await page.waitForTimeout(250);
  }
  return page.evaluate(() => {
    const lum = (c) => { const f = (v) => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
      return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); };
    const parse = (s) => { const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? [+m[1],+m[2],+m[3]] : null; };
    const ratio = (a,b) => { const la=lum(a), lb=lum(b); const [hi,lo]= la>lb?[la,lb]:[lb,la]; return +((hi+0.05)/(lo+0.05)).toFixed(2); };
    const btn = document.querySelector(".wb-composer__send, [class*='composer__send']");
    const scene = document.querySelector(".home__scene--active");
    const t = (el) => el ? { cls: (el.className||"").toString().slice(0,50), bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color } : null;
    const b = t(btn), s = t(scene);
    const out = {};
    if (b) { const bg = parse(b.bg), fg = parse(b.fg); out.sendBtn = { ...b, ratio: bg && fg ? ratio(fg, bg) : null }; }
    if (s) { const bg = parse(s.bg), fg = parse(s.fg); out.scene = { ...s, ratio: bg && fg ? ratio(fg, bg) : null }; }
    out.tokenOnBrand = getComputedStyle(document.documentElement).getPropertyValue("--wb-on-brand").trim();
    out.theme = document.documentElement.getAttribute("data-theme");
    return out;
  });
}
const light = await check("light");
await page.screenshot({ path: join(outDir, "light.png") });
const dark = await check("dark");
await page.screenshot({ path: join(outDir, "dark.png") });
console.log("LIGHT:", JSON.stringify(light, null, 2));
console.log("DARK:", JSON.stringify(dark, null, 2));
await app.close();
