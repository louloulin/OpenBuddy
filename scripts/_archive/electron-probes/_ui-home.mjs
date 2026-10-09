// 首页（Home）详查 —— 这是用户启动后第一眼看到的界面。
import { _electron as electron } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const root = "/Users/louloulin/appx/OpenBuddy";
const outDir = "/tmp/openbuddy-screenshots/home";
mkdirSync(outDir, { recursive: true });
const app = await electron.launch({
  executablePath: join(root, "node_modules", ".bin", "electron"),
  args: [join(root, "dist/main/index.js")], cwd: root,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(3000);

const r = await page.evaluate(() => {
  const pick = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return {
      cls: (el.className || "").toString().slice(0, 60),
      box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
      color: s.color, bg: s.backgroundColor, fontSize: s.fontSize, fontWeight: s.fontWeight,
      radius: s.borderRadius, border: s.borderColor, padding: s.padding, gap: s.gap,
      text: el.textContent?.trim().slice(0, 70),
    };
  };
  const qa = (sel) => Array.from(document.querySelectorAll(sel)).slice(0, 12).map(pick);
  return {
    home: pick(document.querySelector(".home")),
    inner: pick(document.querySelector(".home__inner")),
    hero: pick(document.querySelector(".home__hero")),
    header: pick(document.querySelector(".home__header")),
    headerTitle: pick(document.querySelector(".home__title, .home__header h1, .home__header h2")),
    scenes: pick(document.querySelector(".home__scenes")),
    sceneItems: qa(".home__scene"),
    composerArea: pick(document.querySelector(".home__composer-area")),
    composer: pick(document.querySelector(".home__composer, .home__composer-box, [class*='home__composer']")),
    practices: pick(document.querySelector(".home__practices")),
    practicesHeader: pick(document.querySelector(".home__practices-header")),
    practiceCards: qa(".home__practice, [class*='home__practice']"),
    grid: pick(document.querySelector(".home__practices-grid")),
  };
});
console.log(JSON.stringify(r, null, 2));
writeFileSync(join(outDir, "home.json"), JSON.stringify(r, null, 2));
await page.screenshot({ path: join(outDir, "home-full.png") });
try { await page.locator(".home__hero").screenshot({ path: join(outDir, "home-hero.png") }); } catch (e) { console.log("hero shot err", e.message); }
try { await page.locator(".home__practices").screenshot({ path: join(outDir, "home-practices.png") }); } catch (e) { console.log("practices shot err", e.message); }
await app.close();
