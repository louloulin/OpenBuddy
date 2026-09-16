// 捕获欢迎空态并测量其样式。
import { _electron as electron } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const root = "/Users/louloulin/appx/OpenBuddy";
const outDir = "/tmp/openbuddy-screenshots/welcome";
mkdirSync(outDir, { recursive: true });
const app = await electron.launch({
  executablePath: join(root, "node_modules", ".bin", "electron"),
  args: [join(root, "out/main/index.js")], cwd: root,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(2500);

// 点「新建任务」
const newTask = page.locator(".sidebar__nav-item", { hasText: "新建任务" }).first();
console.log("newTask count:", await newTask.count());
try {
  await newTask.click();
  await page.waitForTimeout(1200);
} catch (e) { console.log("click err:", e.message); }

const empty = await page.evaluate(() => {
  const el = document.querySelector(".chatview__empty-state");
  if (!el) return { found: false, bodyHasEmpty: document.body.innerHTML.includes("empty-state"), timelineHint: document.querySelectorAll(".msg").length };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const hero = el.querySelector(".chatview__empty-state-hero");
  const halo = el.querySelector(".chatview__empty-state-halo");
  const icon = el.querySelector(".chatview__empty-state-icon");
  const title = el.querySelector(".chatview__empty-state-title");
  const sub = el.querySelector(".chatview__empty-state-subtitle");
  const hint = el.querySelector(".chatview__empty-state-hint");
  const tag = el.querySelector(".chatview__empty-state-tag");
  const pick = (n) => n ? (() => { const s = getComputedStyle(n); const b = n.getBoundingClientRect(); return {
    box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
    color: s.color, bg: s.backgroundColor, fontSize: s.fontSize, fontWeight: s.fontWeight,
    radius: s.borderRadius, border: s.borderColor, opacity: s.opacity, text: n.textContent?.trim().slice(0,50),
  }; })() : null;
  return {
    found: true,
    root: { box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, padding: cs.padding, gap: cs.gap, align: cs.alignItems, justify: cs.justifyContent, bg: cs.backgroundColor },
    hero: pick(hero), halo: pick(halo), icon: pick(icon),
    title: pick(title), subtitle: pick(sub), hint: pick(hint), tag: pick(tag),
  };
});
console.log("EMPTY STATE:", JSON.stringify(empty, null, 2));
await page.screenshot({ path: join(outDir, "welcome.png") });
try { await page.locator(".chatview__empty-state").screenshot({ path: join(outDir, "welcome-zoom.png") }); } catch {}
await app.close();
