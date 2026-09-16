import { _electron as electron } from "playwright";
import { join } from "node:path";
const root = "/Users/louloulin/appx/OpenBuddy";
const app = await electron.launch({
  executablePath: join(root, "node_modules", ".bin", "electron"),
  args: [join(root, "out/main/index.js")], cwd: root,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(2500);
const r = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const composer = document.querySelector(".wb-composer");
  const active = document.querySelector(".sidebar__conv--active");
  const toRgb = (v) => {
    const d = document.createElement("div");
    d.style.color = v; document.body.appendChild(d);
    const out = getComputedStyle(d).color; d.remove(); return out;
  };
  return {
    tokenBrand: cs.getPropertyValue("--wb-brand").trim(),
    tokenBrandResolved: toRgb("var(--wb-brand)"),
    tokenBrandPrimary: cs.getPropertyValue("--wb-brand-primary").trim(),
    composerBoxShadow: composer ? getComputedStyle(composer).boxShadow.slice(0, 90) : null,
    composerBorderColor: composer ? getComputedStyle(composer).borderColor : null,
    activeRowShadow: active ? getComputedStyle(active).boxShadow : null,
    activeRowBg: active ? getComputedStyle(active).backgroundColor : null,
  };
});
console.log(JSON.stringify(r, null, 2));
await app.close();
