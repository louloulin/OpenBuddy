import { _electron as electron } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const root = "/Users/louloulin/appx/OpenBuddy";
const outDir = "/tmp/openbuddy-screenshots/audit";
mkdirSync(outDir, { recursive: true });
const app = await electron.launch({
  executablePath: join(root, "node_modules", ".bin", "electron"),
  args: [join(root, "dist/main/index.js")],
  cwd: root,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(2500);

async function snapshot(theme) {
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
    document.body.setAttribute("data-theme", t);
  }, theme);
  await page.waitForTimeout(300);

  // 真正填充 composer（不依赖 textarea 的 controlled value）
  const ta = await page.$("textarea");
  if (ta) {
    await ta.evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(el, "Hello OpenBuddy — 测一下品牌色");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.focus();
    });
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: join(outDir, `${theme}-active.png`), fullPage: false });

  const data = await page.evaluate(() => {
    const pick = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        color: s.color, bg: s.backgroundColor, border: s.borderColor, shadow: s.boxShadow?.slice(0,60) };
    };
    return {
      theme: document.documentElement.getAttribute("data-theme"),
      pillActive: getComputedStyle(document.documentElement).getPropertyValue("--wb-bg-pill-active").trim(),
      borderSoft: getComputedStyle(document.documentElement).getPropertyValue("--wb-border-soft").trim(),
      sendBtn: pick(document.querySelector(".wb-composer__send:not(:disabled), .wb-composer__send--empty")),
      sendBtnAny: pick(document.querySelector(".wb-composer__send")),
      composer: pick(document.querySelector(".composer, [class*='composer__root']")),
      statusPill: pick(document.querySelector(".chatview__status")),
      activeConv: pick(document.querySelector(".sidebar__conv--active")),
    };
  });
  return data;
}

const light = await snapshot("light");
writeFileSync(join(outDir, "audit-light.json"), JSON.stringify(light, null, 2));
const dark = await snapshot("dark");
writeFileSync(join(outDir, "audit-dark.json"), JSON.stringify(dark, null, 2));
console.log("LIGHT:", JSON.stringify(light, null, 2));
console.log("DARK:", JSON.stringify(dark, null, 2));
await app.close();
