import { _electron as electron } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
mkdirSync("/tmp/openbuddy-screenshots/r860/verify", { recursive: true });
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

async function measure(theme) {
  await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, theme);
  await page.waitForTimeout(400);
  return await page.evaluate(() => {
    const out = {};
    const css = (el, label) => {
      if (!el) { out[label] = null; return; }
      const s = getComputedStyle(el);
      out[label] = {
        bg: s.backgroundColor,
        fg: s.color,
        border: s.borderTopColor + " / " + s.borderWidth,
      };
    };
    css(document.querySelector(".wb-composer__send"), "sendBtn");
    css(document.querySelector(".wb-composer__hint"), "hint");
    css(document.querySelector(".wb-composer__hint-key"), "hintKey");
    css(document.querySelector(".home__scenes"), "scenes");
    const scenesActive = document.querySelector(".home__scenes .is-active, .home__scenes [aria-selected='true'], .home__scenes button[class*='active']");
    css(scenesActive, "scenesActive");
    css(document.querySelector(".workspace-picker__trigger"), "wsPick");
    const root = getComputedStyle(document.documentElement);
    out.tokens = {
      buttonPrimaryBg: root.getPropertyValue("--wb-button-primary-bg").trim(),
      bgPillActive:    root.getPropertyValue("--wb-bg-pill-active").trim(),
      toggleKnob:      root.getPropertyValue("--wb-toggle-knob").trim(),
      brandPrimary:    root.getPropertyValue("--wb-brand-primary").trim(),
    };
    return out;
  });
}

async function findGreen() {
  return await page.evaluate(() => {
    const greenish = (rgb) => {
      const m = rgb.match(/rgba?\(([^)]+)\)/);
      if (!m) return false;
      const parts = m[1].split(",").map(s => parseFloat(s.trim()));
      if (parts.length < 3) return false;
      const [r, g, b] = parts;
      return g > 150 && g > r + 30 && g > b + 30;
    };
    const hits = [];
    for (const el of document.querySelectorAll("*")) {
      const s = getComputedStyle(el);
      const props = ["backgroundColor", "color", "borderTopColor", "outlineColor"];
      for (const prop of props) {
        const v = s[prop] || "";
        if (greenish(v)) {
          hits.push({ tag: el.tagName.toLowerCase(), cls: (el.className || "").toString().slice(0, 80), prop, val: v.slice(0, 80) });
          break;
        }
      }
      if (hits.length >= 30) break;
    }
    return hits;
  });
}

const light = await measure("light");
const dark  = await measure("dark");
const greenLight = await findGreen();
await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, "light");
await page.waitForTimeout(300);
await page.screenshot({ path: "/tmp/openbuddy-screenshots/r860/verify/home-light.png" });
await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, "dark");
await page.waitForTimeout(300);
await page.screenshot({ path: "/tmp/openbuddy-screenshots/r860/verify/home-dark.png" });

console.log("=== LIGHT ===");
console.log(JSON.stringify(light, null, 2));
console.log("=== DARK ===");
console.log(JSON.stringify(dark, null, 2));
console.log("=== GREEN HITS ===");
console.log(JSON.stringify(greenLight, null, 2));
await app.close();
