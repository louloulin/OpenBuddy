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
  const rgb = (s) => {
    const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  };
  const lum = (c) => {
    if (!c) return null;
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const contrast = (a, b) => {
    const la = lum(a), lb = lum(b);
    if (la === null || lb === null) return null;
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
  };
  const bgOf = (el) => {
    let node = el;
    while (node) {
      const c = rgb(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.5) return c;
      node = node.parentElement;
    }
    return rgb(getComputedStyle(document.body).backgroundColor);
  };

  // Collect every visible text node + its computed contrast
  const issues = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const tn = walker.currentNode;
    const txt = (tn.textContent || "").trim();
    if (!txt || txt.length < 1) continue;
    const el = tn.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (parseFloat(cs.opacity) < 0.3) continue;
    const fg = rgb(cs.color);
    const bg = bgOf(el);
    const ratio = contrast(fg, bg);
    if (ratio !== null && ratio < 4.5) {
      issues.push({
        cls: el.className && typeof el.className === "string" ? el.className.slice(0, 60) : el.tagName,
        text: txt.slice(0, 40),
        fg: cs.color,
        bg: `rgb(${bg.r},${bg.g},${bg.b})`,
        ratio,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      });
    }
  }

  // Layout overflow detection
  const overflows = [];
  document.querySelectorAll("*").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)) {
      const cs = getComputedStyle(el);
      if (cs.position === "fixed") return;
      overflows.push({
        cls: typeof el.className === "string" ? el.className.slice(0, 60) : el.tagName,
        left: Math.round(r.left), right: Math.round(r.right),
        w: Math.round(r.width),
      });
    }
  });

  // Zero-height / collapsed interactive elements
  const collapsed = [];
  document.querySelectorAll("button, [role=button], a, input, textarea").forEach((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    if (r.width < 1 || r.height < 1) {
      collapsed.push({
        tag: el.tagName,
        cls: typeof el.className === "string" ? el.className.slice(0, 60) : "",
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30),
      });
    }
  });

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    theme: document.documentElement.getAttribute("data-theme") || "(none)",
    bodyBg: getComputedStyle(document.body).backgroundColor,
    lowContrastCount: issues.length,
    lowContrast: issues.slice(0, 25),
    overflowCount: overflows.length,
    overflows: overflows.slice(0, 15),
    collapsedCount: collapsed.length,
    collapsed: collapsed.slice(0, 15),
  };
});

writeFileSync(join(outDir, "02-analysis.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await app.close();
