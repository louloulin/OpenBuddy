import { _electron as electron } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
mkdirSync("/tmp/openbuddy-screenshots/r861", { recursive: true });
const app = await electron.launch({
  executablePath: join(process.cwd(), "node_modules", ".bin", "electron"),
  args: [join(process.cwd(), "dist/main/index.js"), "--no-sandbox"],
  cwd: process.cwd(),
  timeout: 90000,
});
const page = await app.firstWindow({ timeout: 60000 });
await page.waitForLoadState("domcontentloaded", { timeout: 60000 });
await page.waitForTimeout(4500);
await page.evaluate(() => {
  const all = document.querySelectorAll("button, a");
  for (const el of all) {
    const t = (el.textContent || "").trim();
    if (t.includes("新建") || t.includes("Home")) { el.click(); return; }
  }
});
await page.waitForTimeout(1500);

async function focusAndClear() {
  const c = await page.evaluate(() => {
    const ta = document.querySelector(".wb-composer__input");
    if (!ta) return null;
    const r = ta.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  await page.mouse.click(c.x + c.w / 2, c.y + c.h / 2);
  await page.waitForTimeout(150);
  await page.keyboard.press("Control+a");
  await page.waitForTimeout(80);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(200);
  return c;
}

async function probe(theme, triggerChar, pickerSelector) {
  await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, theme);
  await page.waitForTimeout(300);
  await focusAndClear();
  await page.keyboard.type(triggerChar, { delay: 80 });
  await page.waitForTimeout(900);
  return await page.evaluate((sel) => {
    const ta = document.querySelector(".wb-composer__input");
    const el = document.querySelector(sel);
    if (!el) return { found: false, value: ta?.value };
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const composer = document.querySelector(".wb-composer");
    const footer = document.querySelector(".wb-composer__footer");
    return {
      found: true,
      value: ta?.value,
      parent: el.parentElement?.tagName?.toLowerCase(),
      parentClass: (el.parentElement?.className || "").toString().slice(0, 60),
      isInComposer: composer?.contains(el) ?? false,
      position: s.position,
      zIndex: s.zIndex,
      top: s.top,
      left: s.left,
      width: s.width,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      composerRect: (() => { const c = document.querySelector(".wb-composer"); if(!c) return null; const cr = c.getBoundingClientRect(); return { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height) }; })(),
      footerRect: (() => { const c = footer; if(!c) return null; const cr = c.getBoundingClientRect(); return { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height) }; })(),
    };
  }, pickerSelector);
}

const mentionLight = await probe("light", "@", ".mention-picker");
const mentionDark  = await probe("dark",  "@", ".mention-picker");
const slashLight = await probe("light", "/", ".slash-commands");
const slashDark  = await probe("dark",  "/", ".slash-commands");

await focusAndClear();
await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, "light");
await page.keyboard.type("/");
await page.waitForTimeout(700);
await page.screenshot({ path: "/tmp/openbuddy-screenshots/r861/slash-light-portal.png" });
await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, "dark");
await page.waitForTimeout(400);
await page.screenshot({ path: "/tmp/openbuddy-screenshots/r861/slash-dark-portal.png" });

await focusAndClear();
await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, "light");
await page.keyboard.type("@");
await page.waitForTimeout(900);
await page.screenshot({ path: "/tmp/openbuddy-screenshots/r861/mention-light-portal.png" });

console.log("=== MENTION @ (LIGHT) ===");
console.log(JSON.stringify(mentionLight, null, 2));
console.log("=== MENTION @ (DARK) ===");
console.log(JSON.stringify(mentionDark, null, 2));
console.log("=== SLASH / (LIGHT) ===");
console.log(JSON.stringify(slashLight, null, 2));
console.log("=== SLASH / (DARK) ===");
console.log(JSON.stringify(slashDark, null, 2));
await app.close();
