/**
 * R52 真机视觉:遍历 17+ 主题,每套都拍一张全 chrome 截图,作为
 * 主题系统的真机回归基线。
 *
 * 验证:
 *   1. ThemeMenuButton 在顶栏可点开;
 *   2. ThemePicker 弹层里能看到每一套主题;
 *   3. 点每一套之后,documentElement 上的 data-theme-name 真的切到对应值;
 *   4. 截图存在 tests/screenshots/r52-themes/<name>.png。
 *
 * ThemePicker 在 onSelect 之后会 close 弹层,所以每次点主题都得重开。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const THEMES = [
  "claude",
  "openbuddy",
  "openbuddy-dark",
  "white",
  "black",
  "midnight-ocean",
  "aurora",
  "ember",
  "forest",
  "cyber",
  "paper",
  "sakura",
  "meadow",
  "sky",
  "lavender",
  "win95",
  "winxp",
  "matrix",
  "apple",
];

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const outDir = join(root, "tests", "screenshots", "r52-themes");
mkdirSync(outDir, { recursive: true });

const userData = mkdtempSync(join(tmpdir(), "ob-r52-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r52-agent-"));

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60000,
  env: {
    ...process.env,
    ELECTRON_RENDERER_URL: "",
    OPENBUDDY_DEBUG_UI: "0",
    OPENBUDDY_AGENT_DIR: agentDir,
  },
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

  const trigger = page.locator("[data-testid='theme-menu-button']").first();
  step("ThemeMenuButton 触发器可见", await trigger.isVisible().catch(() => false), "");

  // 先开一次 picker,确认数据齐全。
  await trigger.click();
  await page.waitForTimeout(400);
  const visibleNames = await page.evaluate(() => {
    const seen = new Set();
    for (const n of document.querySelectorAll("[data-theme-name]")) {
      const name = n.getAttribute("data-theme-name");
      if (name) seen.add(name);
    }
    return Array.from(seen);
  });
  const missing = THEMES.filter((n) => !visibleNames.includes(n));
  step(
    "ThemePicker 暴露全部 19 套主题卡",
    missing.length === 0,
    `missing=${missing.join(",") || "none"} visible=${visibleNames.join(",")}`,
  );

  // 点完主题 picker 会关闭,所以每次都重开。
  const failed = [];
  const switched = [];
  for (const name of THEMES) {
    try {
      // 重新打开 picker。
      await trigger.click();
      await page.waitForTimeout(300);
      const card = page.locator(`[data-theme-name='${name}']`).first();
      await card.scrollIntoViewIfNeeded().catch(() => {});
      await card.click({ timeout: 4000 });
      // 等主题名真的落到 documentElement(react state update + service apply)。
      await page.waitForFunction(
        (target) => document.documentElement.getAttribute("data-theme-name") === target,
        name,
        { timeout: 4000 },
      );
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(outDir, `${name}.png`) });
      switched.push(name);
    } catch (err) {
      failed.push({ name, error: String(err).slice(0, 160) });
    }
  }

  step(
    `每套主题截图成功(${switched.length}/${THEMES.length})`,
    failed.length === 0,
    failed.length ? `failed=${JSON.stringify(failed).slice(0, 400)} dir=${outDir}` : `dir=${outDir}`,
  );

  // 收尾:切回 openbuddy 主题。
  try {
    await trigger.click();
    await page.waitForTimeout(300);
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
