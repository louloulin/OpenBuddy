/**
 * R77 — 19 主题 × light/dark × Match-system 真机视觉基线
 *
 * 输出:tests/screenshots/r77-themes/<slug>.png
 *   manual/<name>.png         — manual 模式,name 自己决定类型
 *   manual-dark/<name>.png    — manual 模式,强制 system=dark
 *   match-system-light/<name>.png — Match system + system=light + pair.light=<name>
 *   match-system-dark/<name>.png  — Match system + system=dark  + pair.dark =<name>
 *
 * 总张数 ≈ 76
 *
 * 复用 R53 的 Google Fonts preload 逻辑。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const THEMES = [
  "openbuddy", "openbuddy-dark", "claude", "white", "black",
  "midnight-ocean", "aurora", "ember", "forest", "cyber",
  "paper", "sakura", "meadow", "sky", "lavender",
  "win95", "winxp", "matrix", "apple",
];

const GOOGLE_FONTS = [
  "Space+Grotesk:wght@400;500;600;700",
  "Playfair+Display:wght@400;500;600;700",
  "JetBrains+Mono:wght@400;500;700",
  "Cardo:wght@400;700",
];

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const outDir = join(root, "tests", "screenshots", "r77-themes");
mkdirSync(join(outDir, "manual"), { recursive: true });
mkdirSync(join(outDir, "manual-dark"), { recursive: true });
mkdirSync(join(outDir, "match-system-light"), { recursive: true });
mkdirSync(join(outDir, "match-system-dark"), { recursive: true });

const userData = mkdtempSync(join(tmpdir(), "ob-r77-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r77-agent-"));

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENT_DIR: agentDir },
});

const steps = [];
const step = (name, ok, detail) => steps.push({ step: name, ok: Boolean(ok), detail });

const setLs = async (page, key, value) => {
  await page.evaluate(([k, v]) => {
    if (v === null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  }, [key, value]);
};

const setColorScheme = async (page, scheme) => {
  await page.emulateMedia({ colorScheme: scheme });
};

const reload = async (page) => {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
};

const switchTo = async (page, name, variant, pairOther) => {
  if (variant === "manual-light") {
    await setLs(page, "openbuddy.theme.mode", "manual");
    await setLs(page, "openbuddy.theme.name", name);
    await setLs(page, "openbuddy.theme", name);
    await setColorScheme(page, "light");
  } else if (variant === "manual-dark") {
    await setLs(page, "openbuddy.theme.mode", "manual");
    await setLs(page, "openbuddy.theme.name", name);
    await setLs(page, "openbuddy.theme", name);
    await setColorScheme(page, "dark");
  } else if (variant === "match-light") {
    await setLs(page, "openbuddy.theme.mode", "system");
    await setLs(page, "openbuddy.theme.pair.light", name);
    if (pairOther) await setLs(page, "openbuddy.theme.pair.dark", pairOther);
    await setColorScheme(page, "light");
  } else if (variant === "match-dark") {
    await setLs(page, "openbuddy.theme.mode", "system");
    await setLs(page, "openbuddy.theme.pair.dark", name);
    if (pairOther) await setLs(page, "openbuddy.theme.pair.light", pairOther);
    await setColorScheme(page, "dark");
  }
  await reload(page);
  await page.waitForFunction(
    (target) => document.documentElement.getAttribute("data-theme-name") === target,
    name,
    { timeout: 6000 },
  ).catch(() => {});
  await page.waitForTimeout(300);
};

const closeOnboarding = async (page) => {
  try {
    const c = page.locator("[data-testid='onboarding-close']").first();
    if (await c.isVisible({ timeout: 2000 })) { await c.click(); await page.waitForTimeout(400); }
  } catch { /* not shown */ }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
};

try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(2200);

  await closeOnboarding(page);

  await page.evaluate((families) => {
    const head = document.head;
    for (const f of families) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${f}&display=swap`;
      head.appendChild(link);
    }
  }, GOOGLE_FONTS);
  try {
    await Promise.race([
      page.evaluate(() => document.fonts.ready),
      page.waitForTimeout(8000),
    ]);
    step("Google Fonts preload 完成(或 8s 兜底超时)", true, "");
  } catch (err) {
    step("Google Fonts preload 完成(或 8s 兜底超时)", false, String(err).slice(0, 160));
  }

  // 1) manual + system=light
  const a = [];
  for (const name of THEMES) {
    try {
      await switchTo(page, name, "manual-light", null);
      await page.screenshot({ path: join(outDir, "manual", `${name}.png`) });
    } catch (err) { a.push({ name, error: String(err).slice(0, 160) }); }
  }
  step(`manual-light 19 张完成 (${19 - a.length}/19)`, a.length === 0, a.length ? JSON.stringify(a).slice(0, 400) : "");

  // 2) manual + system=dark
  const b = [];
  for (const name of THEMES) {
    try {
      await switchTo(page, name, "manual-dark", null);
      await page.screenshot({ path: join(outDir, "manual-dark", `${name}.png`) });
    } catch (err) { b.push({ name, error: String(err).slice(0, 160) }); }
  }
  step(`manual-dark 19 张完成 (${19 - b.length}/19)`, b.length === 0, b.length ? JSON.stringify(b).slice(0, 400) : "");

  // 3) Match system + system=light
  const c = [];
  for (const name of THEMES) {
    try {
      await switchTo(page, name, "match-light", "openbuddy-dark");
      await page.screenshot({ path: join(outDir, "match-system-light", `${name}.png`) });
    } catch (err) { c.push({ name, error: String(err).slice(0, 160) }); }
  }
  step(`match-system-light 19 张完成 (${19 - c.length}/19)`, c.length === 0, c.length ? JSON.stringify(c).slice(0, 400) : "");

  // 4) Match system + system=dark
  const d = [];
  for (const name of THEMES) {
    try {
      await switchTo(page, name, "match-dark", "openbuddy");
      await page.screenshot({ path: join(outDir, "match-system-dark", `${name}.png`) });
    } catch (err) { d.push({ name, error: String(err).slice(0, 160) }); }
  }
  step(`match-system-dark 19 张完成 (${19 - d.length}/19)`, d.length === 0, d.length ? JSON.stringify(d).slice(0, 400) : "");

  await switchTo(page, "openbuddy", "manual-light", null);
  step("收尾切回 openbuddy", true, `outDir=${outDir}`);
} finally {
  await app.close();
}

const ok = steps.every((s) => s.ok);
console.log(JSON.stringify({ ok, steps }, null, 2));
process.exit(ok ? 0 : 1);
