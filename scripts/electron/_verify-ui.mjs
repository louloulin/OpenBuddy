import { _electron as electron } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = "/Users/louloulin/appx/OpenBuddy";
const outDir = "/tmp/openbuddy-screenshots";
mkdirSync(outDir, { recursive: true });

const electronPath = join(root, "node_modules", ".bin", "electron");
const app = await electron.launch({
  executablePath: electronPath,
  args: [join(root, "out/main/index.js")],
  cwd: root,
});

const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(2500);

// Screenshot 1: empty/initial state
await page.screenshot({ path: join(outDir, "01-empty.png"), fullPage: false });

// Inspect DOM structure
const structure = await page.evaluate(() => {
  const get = (sel) => Array.from(document.querySelectorAll(sel)).slice(0, 5).map(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      sel,
      tag: el.tagName,
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      text: (el.textContent || "").trim().slice(0, 60),
    };
  });
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    bodyClass: document.body.className,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    sidebar: get(".sidebar, [class*='sidebar']"),
    main: get(".chatview, [class*='chatview']"),
    messages: get(".msg, [class*='msg']"),
    composer: get(".composer, [class*='composer'], textarea"),
    statusPill: get(".chatview__status, [class*='status']"),
    quickPrompts: get(".chatview__quick-prompt, [class*='quick-prompt']"),
    emptyState: get(".chatview__empty-state, [class*='empty-state']"),
  };
});

writeFileSync(join(outDir, "01-structure.json"), JSON.stringify(structure, null, 2));
console.log(JSON.stringify(structure, null, 2));
await app.close();
