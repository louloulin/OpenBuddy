import { _electron as electron } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = "/Users/louloulin/appx/OpenBuddy";
const outDir = "/tmp/openbuddy-screenshots";
mkdirSync(outDir, { recursive: true });

const app = await electron.launch({
  executablePath: join(root, "node_modules", ".bin", "electron"),
  args: [join(root, "out/main/index.js")],
  cwd: root,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(2500);

const report = await page.evaluate(() => {
  const out = {};

  // 1. Dump the assistant message DOM tree
  const asst = document.querySelector(".msg--assistant");
  if (asst) {
    out.assistantHTML = asst.outerHTML.slice(0, 2000);
    out.assistantChildren = Array.from(asst.children).map((c) => ({
      tag: c.tagName,
      cls: typeof c.className === "string" ? c.className : "",
      w: Math.round(c.getBoundingClientRect().width),
      h: Math.round(c.getBoundingClientRect().height),
    }));
  }

  // 2. Composer border investigation — walk the cascade
  const composer = document.querySelector(".wb-composer, .composer");
  if (composer) {
    const cs = getComputedStyle(composer);
    out.composerStyle = {
      border: cs.border,
      borderColor: cs.borderColor,
      boxShadow: cs.boxShadow,
      outline: cs.outline,
      cls: typeof composer.className === "string" ? composer.className : "",
      tag: composer.tagName,
    };
    // Walk up to find the actual bordered element
    out.composerParents = [];
    let n = composer;
    for (let i = 0; i < 4 && n; i++) {
      const pcs = getComputedStyle(n);
      out.composerParents.push({
        tag: n.tagName,
        cls: typeof n.className === "string" ? n.className.slice(0, 80) : "",
        border: pcs.border,
        borderColor: pcs.borderColor,
        boxShadow: pcs.boxShadow.slice(0, 80),
      });
      n = n.parentElement;
    }
  }

  // 3. Brand token resolution
  const rootCs = getComputedStyle(document.documentElement);
  out.tokens = {
    brand: rootCs.getPropertyValue("--wb-brand").trim(),
    brandPrimary: rootCs.getPropertyValue("--wb-brand-primary").trim(),
    brandRgb: rootCs.getPropertyValue("--wb-brand-rgb").trim(),
    accent: rootCs.getPropertyValue("--wb-accent").trim(),
    bgPrimary: rootCs.getPropertyValue("--wb-bg-primary").trim(),
    bgSecondary: rootCs.getPropertyValue("--wb-bg-secondary").trim(),
    bgTertiary: rootCs.getPropertyValue("--wb-bg-tertiary").trim(),
    textStrong: rootCs.getPropertyValue("--wb-text-strong").trim(),
    textMedium: rootCs.getPropertyValue("--wb-text-medium").trim(),
    statusError: rootCs.getPropertyValue("--wb-status-error").trim(),
    statusSuccess: rootCs.getPropertyValue("--wb-status-success").trim(),
  };

  // 4. Find any element still referencing the OLD blue brand
  const blueish = [];
  document.querySelectorAll("*").forEach((el) => {
    const cs = getComputedStyle(el);
    ["color", "backgroundColor", "borderColor", "boxShadow", "outlineColor"].forEach((prop) => {
      const v = cs[prop];
      if (!v || v === "none") return;
      // look for the legacy blue #5b5fc7 family: r<130, g<130, b>150
      const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) {
        const r = +m[1], g = +m[2], b = +m[3];
        if (r > 60 && r < 130 && g > 60 && g < 130 && b > 150 && b < 230) {
          blueish.push({
            cls: typeof el.className === "string" ? el.className.slice(0, 70) : el.tagName,
            prop,
            val: v.slice(0, 60),
          });
        }
      }
      if (/5b5fc7|5b67f1|0,\s*122,\s*255/.test(v)) {
        blueish.push({ cls: typeof el.className === "string" ? el.className.slice(0, 70) : el.tagName, prop, val: v.slice(0, 60) });
      }
    });
  });
  out.legacyBlueHits = blueish.slice(0, 30);
  out.legacyBlueCount = blueish.length;

  return out;
});

writeFileSync(join(outDir, "04-deep.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await app.close();
