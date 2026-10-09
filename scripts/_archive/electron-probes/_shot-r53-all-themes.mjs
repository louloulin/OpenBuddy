/**
 * R53 真机视觉 —— 19 套主题全量截图。
 *
 * 上一轮 R52 已经验证 ThemePicker 在真机里**真的**暴露了 19 套主题卡,
 * 也证明了 claude / openbuddy 两套的切换路径。卡 17 套全量截图的是
 * Google Fonts 字重联网加载(每套新主题都要 fetch 一遍 Space Grotesk /
 * Playfair Display / Cardo / JetBrains Mono),单套 ~30s 量级。
 *
 * R53 一次性把 4 套 Google Font 家族在切换开始前全部 preload 进文档,等
 * `document.fonts.ready`,再走 ThemePicker。字重已经在浏览器缓存里,后面
 * 任何主题切换都是毫秒级。
 *
 * 输出:tests/screenshots/r53-themes/<name>.png(19 张)。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const THEMES = [
  "claude", "openbuddy", "openbuddy-dark", "white", "black",
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
const outDir = join(root, "tests", "screenshots", "r53-themes");
mkdirSync(outDir, { recursive: true });

const userData = mkdtempSync(join(tmpdir(), "ob-r53-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r53-agent-"));

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENT_DIR: agentDir },
});

const steps = [];
const step = (name, ok, detail) => steps.push({ step: name, ok: Boolean(ok), detail });

try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(2500);

  try {
    const c = page.locator("[data-testid='onboarding-close']").first();
    if (await c.isVisible({ timeout: 2000 })) { await c.click(); await page.waitForTimeout(400); }
  } catch { /* not shown */ }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // ── 预加载 Google Fonts ─────────────────────────────────────
  await page.evaluate((families) => {
    const head = document.head;
    for (const f of families) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${f}&display=swap`;
      head.appendChild(link);
    }
  }, GOOGLE_FONTS);

  // 等字体准备好;如果 fonts.googleapis.com 不通,Promise 也不会 reject,
  // 它只是 resolve 后状态不完整。我们用 timeout 兜底,避免在离线环境
  // 把这一轮拖死。
  try {
    await Promise.race([
      page.evaluate(() => document.fonts.ready),
      page.waitForTimeout(8000),
    ]);
    step("Google Fonts preload 完成(或 8s 兜底超时)", true, "");
  } catch (err) {
    step("Google Fonts preload 完成(或 8s 兜底超时)", false, String(err).slice(0, 160));
  }

  // ── 打开 ThemePicker,跑全量截图 ──────────────────────────────
  const trigger = page.locator("[data-testid='theme-menu-button']").first();
  step("ThemeMenuButton 触发器可见", await trigger.isVisible().catch(() => false), "");

  const failed = [];
  const switched = [];
  for (const name of THEMES) {
    try {
      await trigger.click();
      await page.waitForTimeout(220);
      const card = page.locator(`[data-theme-name='${name}']`).first();
      await card.scrollIntoViewIfNeeded().catch(() => {});
      await card.click({ timeout: 3000 });
      await page.waitForFunction(
        (target) => document.documentElement.getAttribute("data-theme-name") === target,
        name,
        { timeout: 4000 },
      );
      await page.waitForTimeout(350);
      await page.screenshot({ path: join(outDir, `${name}.png`) });
      switched.push(name);
    } catch (err) {
      failed.push({ name, error: String(err).slice(0, 160) });
    }
  }
  step(
    `19 套主题全部截图成功(${switched.length}/${THEMES.length})`,
    failed.length === 0,
    failed.length ? `failed=${JSON.stringify(failed).slice(0, 400)} dir=${outDir}` : `dir=${outDir}`,
  );

  // 收尾切回 openbuddy。
  try {
    await trigger.click();
    await page.waitForTimeout(220);
    await page.locator("[data-theme-name='openbuddy']").first().click({ timeout: 3000 });
    await page.waitForFunction(
      () => document.documentElement.getAttribute("data-theme-name") === "openbuddy",
      null,
      { timeout: 3000 },
    );
    step("收尾切回 openbuddy 主题", true, "");
  } catch (err) {
    step("收尾切回 openbuddy 主题", false, String(err).slice(0, 160));
  }
} finally {
  await app.close();
}

const ok = steps.every((s) => s.ok);
console.log(JSON.stringify({ ok, steps }, null, 2));
process.exit(ok ? 0 : 1);
