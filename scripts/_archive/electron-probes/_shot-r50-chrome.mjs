/**
 * R50 真机视觉:全 chrome 截图(顶栏 + 左下角身份条 + 状态栏 + 复合视图)
 *
 * 在 light / dark 两个主题下各截一张,作为 WorkBuddy-class 视觉基线。
 *
 * 输出:
 *   tests/screenshots/r50-chrome-light.png  (1280×800 元素截图)
 *   tests/screenshots/r50-chrome-dark.png
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r50-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r50-agent-"));
mkdirSync(join(root, "tests", "screenshots"), { recursive: true });

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
  await page.waitForTimeout(700);

  // 顶栏 / 侧栏 / 状态栏 / 复合可见性
  // StatusBar 走 CSS Modules,class 是哈希后的 `_bar_xxx`,统一用
  // [data-testid='status-bar'] 探测。
  const presence = await page.evaluate(() => ({
    topbar: Boolean(document.querySelector(".main-topbar")),
    leftFooter: Boolean(document.querySelector(".sidebar__footer")),
    statusBar: Boolean(document.querySelector("[data-testid='status-bar']")),
    themeBtn: Boolean(document.querySelector(".theme-menu-button") || document.querySelector("[aria-label*='主题' i]") || document.querySelector("[aria-label*='theme' i]")),
    version: (document.querySelector(".main-topbar__version-pill")?.textContent ?? "").trim(),
    bell: Boolean(document.querySelector(".sidebar__footer button[aria-label='通知']")),
    gear: Boolean(document.querySelector(".sidebar__footer button[aria-label='设置']")),
  }));
  step("顶栏已渲染", presence.topbar, JSON.stringify(presence));
  step("左下角身份条已渲染", presence.leftFooter, JSON.stringify(presence));
  step("状态栏已渲染", presence.statusBar, JSON.stringify(presence));
  step("主题菜单按钮已渲染", presence.themeBtn, JSON.stringify(presence));
  step("顶栏版本徽标显示", presence.version.length > 0, JSON.stringify(presence));
  step("铃铛入口", presence.bell, JSON.stringify(presence));
  step("设置入口", presence.gear, JSON.stringify(presence));

  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => {
      document.documentElement.setAttribute("data-theme", t);
    }, theme);
    await page.waitForTimeout(400);
    const path = `tests/screenshots/r50-chrome-${theme}.png`;
    await page.screenshot({ path });
    step(`截图 ${theme}`, true, path);
  }
} finally {
  await app.close();
}

const ok = steps.every((s) => s.ok);
console.log(JSON.stringify({ ok, steps }, null, 2));
process.exit(ok ? 0 : 1);
