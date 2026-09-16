import { _electron as electron } from "playwright";
import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
await page.waitForTimeout(3000);

// Focus composer to capture focus halo
const composer = page.locator("textarea, [contenteditable='true']").first();
try { await composer.focus({ timeout: 1500 }); } catch {}

// Take 3 screenshots: full / sidebar-focused / composer-focused
await page.screenshot({ path: join(outDir, "after-01-full.png"), fullPage: false });
const sidebar = page.locator(".sidebar, [class*='sidebar']").first();
try { await sidebar.screenshot({ path: join(outDir, "after-02-sidebar.png") }); } catch {}
try { await composer.screenshot({ path: join(outDir, "after-03-composer.png") }); } catch {}

// Dump brand-related runtime values
const report = await page.evaluate(() => {
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const root2 = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      background: cs.backgroundColor,
      color: cs.color,
      borderColor: cs.borderColor,
      boxShadow: cs.boxShadow,
      outline: cs.outline,
    };
  };
  return {
    tokens: {
      "--wb-brand": css("--wb-brand"),
      "--wb-brand-primary": css("--wb-brand-primary"),
      "--wb-accent": css("--wb-accent"),
      "--wb-status-info": css("--wb-status-info"),
    },
    bodyBg: getComputedStyle(document.body).backgroundColor,
    sidebarActiveRow: root2(".sidebar__conv--active, [class*='sidebar__conv--active']"),
    composer: root2(".composer, [class*='composer']"),
    mentionPickerActive: root2(".ob-mention-picker__item--active, [class*='mention-picker'][class*='active']"),
    statusPill: root2(".chatview__status, [class*='chatview__status']"),
  };
});

writeFileSync(join(outDir, "after-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await app.close();
