import { _electron as electron } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
mkdirSync("/tmp/openbuddy-screenshots/r860", { recursive: true });
const app = await electron.launch({
  executablePath: join(process.cwd(), "node_modules", ".bin", "electron"),
  args: [join(process.cwd(), "dist/main/index.js"), "--no-sandbox"],
  cwd: process.cwd(),
  timeout: 90000,
});
const page = await app.firstWindow({ timeout: 60000 });
await page.waitForLoadState("domcontentloaded", { timeout: 60000 });
await page.waitForTimeout(4500);

// Navigate to home (click 新建任务 or sidebar home)
await page.evaluate(() => {
  const candidates = [
    "[data-testid*='new-task']",
    "[data-testid*='home']",
    "button[aria-label*='新建']",
    ".sidebar__brand",
    ".sidebar__logo",
    "button[class*='new-task']",
  ];
  for (const sel of candidates) { const el = document.querySelector(sel); if (el) { el.click(); return sel; } }
  // fallback: click first sidebar item with 新建
  const all = document.querySelectorAll("button, a");
  for (const el of all) {
    const t = (el.textContent||"").trim();
    if (t.includes("新建") || t.includes("Home")) { el.click(); return t; }
  }
  return null;
});
await page.waitForTimeout(1800);

async function cap(theme, name) {
  await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, theme);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/tmp/openbuddy-screenshots/r860/${name}.png`, fullPage: false });
}
await cap("light", "home-final-light");
await cap("dark", "home-final-dark");

// Targeted crops: segmented control (home__scenes) and composer hint area
const targets = await page.evaluate(() => {
  const seg = document.querySelector(".home__scenes");
  const composer = document.querySelector(".wb-composer");
  const hint = document.querySelector(".wb-composer__hint");
  const wsPick = document.querySelector(".workspace-picker__trigger");
  const cost = document.querySelector(".wb-composer__cost");
  const sidebarActive = document.querySelector(".sidebar__conv--active, .sidebar__item--active, [aria-current='page']");
  const pick = el => { if(!el) return null; const r=el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  return { scenes: pick(seg), composer: pick(composer), hint: pick(hint), wsPick: pick(wsPick), cost: pick(cost), sidebarActive: pick(sidebarActive) };
});
console.log("TARGETS:", JSON.stringify(targets, null, 2));

for (const [theme, suffix] of [["light","l"],["dark","d"]]) {
  await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, theme);
  await page.waitForTimeout(400);
  for (const [k, target] of Object.entries(targets)) {
    if (!target) continue;
    const pad = 12;
    await page.screenshot({
      path: `/tmp/openbuddy-screenshots/r860/crop-${k}-${suffix}.png`,
      clip: {
        x: Math.max(0, target.x - pad),
        y: Math.max(0, target.y - pad),
        width: target.w + 2 * pad,
        height: target.h + 2 * pad,
      },
    });
  }
}
await app.close();
