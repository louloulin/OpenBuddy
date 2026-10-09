import { _electron as electron } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
mkdirSync("/tmp/openbuddy-screenshots/r861/active", { recursive: true });
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
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(200);
  return c;
}

async function measureActive(theme, triggerChar, pickerSel, activeSel) {
  await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, theme);
  await page.waitForTimeout(300);
  await focusAndClear();
  await page.keyboard.type(triggerChar);
  await page.waitForTimeout(900);
  return await page.evaluate(({picker, active}) => {
    const pop = document.querySelector(picker);
    if (!pop) return { found: false };
    const a = pop.querySelector(active);
    if (!a) return { found: true, activeFound: false };
    const s = getComputedStyle(a);
    return {
      found: true,
      activeFound: true,
      bg: s.backgroundColor,
      fg: s.color,
      boxShadow: s.boxShadow.slice(0, 120),
      border: s.borderTopColor,
    };
  }, { picker: pickerSel, active: activeSel });
}

const slashActiveLight = await measureActive("light", "/", ".slash-commands", ".slash-commands__item--active");
const slashActiveDark  = await measureActive("dark",  "/", ".slash-commands", ".slash-commands__item--active");
const mentionActiveLight = await measureActive("light", "@", ".mention-picker", ".mention-picker__item--active");
const mentionActiveDark  = await measureActive("dark",  "@", ".mention-picker", ".mention-picker__item--active");

// Capture final screenshots showing the neutral active state
await focusAndClear();
await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, "light");
await page.keyboard.type("/");
await page.waitForTimeout(900);
await page.screenshot({ path: "/tmp/openbuddy-screenshots/r861/active/slash-active-light.png" });
await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, "dark");
await page.waitForTimeout(400);
await page.screenshot({ path: "/tmp/openbuddy-screenshots/r861/active/slash-active-dark.png" });

await focusAndClear();
await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, "light");
await page.keyboard.type("@");
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/openbuddy-screenshots/r861/active/mention-active-light.png" });

console.log("=== SLASH ACTIVE (LIGHT) ===");
console.log(JSON.stringify(slashActiveLight, null, 2));
console.log("=== SLASH ACTIVE (DARK) ===");
console.log(JSON.stringify(slashActiveDark, null, 2));
console.log("=== MENTION ACTIVE (LIGHT) ===");
console.log(JSON.stringify(mentionActiveLight, null, 2));
console.log("=== MENTION ACTIVE (DARK) ===");
console.log(JSON.stringify(mentionActiveDark, null, 2));
await app.close();
