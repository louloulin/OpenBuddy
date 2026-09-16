import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-themes-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const outDir = join(ROOT, "tests/screenshots/themes");
mkdirSync(outDir, { recursive: true });
// Wipe stale screenshots
try {
  for (const f of (await import("node:fs")).readdirSync(outDir)) {
    if (f.endsWith(".png")) rmSync(join(outDir, f));
  }
} catch {}

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15_000);
// Dismiss onboarding once
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

// Theme list extracted from packages/ui/openbuddy-ui-theme/src/themes.ts
const THEMES = [
  ["openbuddy", "light", "OpenBuddy"],
  ["openbuddy-dark", "dark", "OpenBuddy Dark"],
  ["claude", "light", "Claude"],
  ["black", "dark", "Black"],
  ["white", "light", "White"],
  ["midnight-ocean", "dark", "Midnight Ocean"],
  ["aurora", "dark", "Aurora"],
  ["ember", "dark", "Ember"],
  ["forest", "dark", "Forest"],
  ["cyber", "dark", "Cyber"],
  ["matrix", "dark", "Matrix"],
  ["paper", "light", "Paper"],
  ["sakura", "light", "Sakura"],
  ["meadow", "light", "Meadow"],
  ["sky", "light", "Sky"],
  ["lavender", "light", "Lavender"],
  ["apple", "light", "Apple"],
  ["win95", "light", "Windows 95"],
  ["winxp", "light", "Windows XP"],
];

async function applyTheme(name, pref) {
  await page.evaluate(
    ([n, p]) => {
      window.localStorage.setItem("openbuddy.theme", p);
      window.localStorage.setItem("openbuddy.theme.name", n);
      window.localStorage.setItem("openbuddy.theme.mode", "manual");
    },
    [name, pref],
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8_000); // allow React mount + theme apply
  // Dismiss onboarding again (it shows on reload until dismissed)
  await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function snapTheme(name, label) {
  const info = await page.evaluate(() => {
    const root = document.documentElement;
    const composer = document.querySelector(".wb-composer");
    const cs = composer ? getComputedStyle(composer) : null;
    return {
      dataTheme: root.getAttribute("data-theme"),
      dataThemeName: root.getAttribute("data-theme-name"),
      composerBg: cs?.backgroundColor,
      composerColor: cs?.color,
    };
  });
  const path = join(outDir, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return { name, label, ...info, path };
}

const results = [];
for (const [name, pref, label] of THEMES) {
  console.log(`--- ${label} (${name}, ${pref}) ---`);
  try {
    await applyTheme(name, pref);
    const info = await snapTheme(name, label);
    console.log(`  data-theme=${info.dataTheme} data-theme-name=${info.dataThemeName} composer=${info.composerBg}`);
    results.push(info);
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    results.push({ name, label, error: String(e.message) });
  }
}
console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(results, null, 2));
await app.close();
process.exit(0);
