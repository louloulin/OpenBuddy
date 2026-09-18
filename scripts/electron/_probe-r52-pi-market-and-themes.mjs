/**
 * R52 真机探针 —— 同时验证两件 Phase D 不同的事:
 *
 *   (a) Pi Extension Bridge 端到端走通:从渲染端通过 `agent:pi-market-*` 拉到一份
 *       registry(空 registry 也算可观测)。
 *   (b) ThemePicker 在真机里**真的**暴露了 19 套主题卡,并能把 documentElement
 *       上的 data-theme-name 切到指定值;claude 与 openbuddy 各拍一张作为本轮
 *       视觉资产。后续 17 套全量截图因为每套主题都要等 Google Fonts 字重
 *       联网加载,单套 ~30s 量级,在不显著优化 picker / 字体策略前不适合
 *       一起塞进同一次探针;留给 R53 单独立项做"按主题预加载 + 一次性扫"。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_THEMES = [
  "claude", "openbuddy", "openbuddy-dark", "white", "black",
  "midnight-ocean", "aurora", "ember", "forest", "cyber",
  "paper", "sakura", "meadow", "sky", "lavender",
  "win95", "winxp", "matrix", "apple",
];

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
mkdirSync(join(root, "tests", "screenshots"), { recursive: true });

const userData = mkdtempSync(join(tmpdir(), "ob-r52-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r52-agent-"));

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
  page.on("pageerror", (e) => console.error("[pageerror]", String(e)));
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(2500);

  try {
    const c = page.locator("[data-testid='onboarding-close']").first();
    if (await c.isVisible({ timeout: 2000 })) { await c.click(); await page.waitForTimeout(400); }
  } catch { /* not shown */ }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // ── (a) Pi Extension Bridge 端到端 ───────────────────────────────
  const invoke = (channel, args) => page.evaluate(
    async ({ channel, args }) => {
      const win = /** @type {any} */ (window);
      const fn = win.openbuddy?.api?.invoke ?? win.api?.invoke;
      if (!fn) throw new Error("renderer bridge unavailable");
      return fn(channel, args);
    },
    { channel, args },
  );

  let piList = null;
  try {
    piList = await invoke("agent:pi-market-list");
    step("agent:pi-market-list 返回成功", piList !== undefined && piList !== null, `keys=${Object.keys(piList ?? {}).join(",")}`);
  } catch (err) {
    step("agent:pi-market-list 返回成功", false, String(err).slice(0, 200));
  }
  try {
    const refresh = await invoke("agent:pi-market-refresh");
    step("agent:pi-market-refresh 返回成功", refresh !== undefined && refresh !== null, `keys=${Object.keys(refresh ?? {}).join(",")}`);
  } catch (err) {
    step("agent:pi-market-refresh 返回成功", false, String(err).slice(0, 200));
  }
  try {
    const sources = await invoke("agent:pi-market-sources-get");
    step("agent:pi-market-sources-get 返回成功", sources !== undefined && sources !== null, `keys=${Object.keys(sources ?? {}).join(",")}`);
  } catch (err) {
    step("agent:pi-market-sources-get 返回成功", false, String(err).slice(0, 200));
  }

  // ── (b) ThemePicker 真机覆盖 ──────────────────────────────────
  const trigger = page.locator("[data-testid='theme-menu-button']").first();
  step("ThemeMenuButton 触发器可见", await trigger.isVisible().catch(() => false), "");

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
  const missing = EXPECTED_THEMES.filter((n) => !visibleNames.includes(n));
  step(
    "ThemePicker 暴露全部 19 套主题卡",
    missing.length === 0,
    `missing=${missing.join(",") || "none"}`,
  );

  // 拍 claude。
  const claudeCard = page.locator("[data-theme-name='claude']").first();
  await claudeCard.scrollIntoViewIfNeeded().catch(() => {});
  await claudeCard.click();
  await page.waitForFunction(
    () => document.documentElement.getAttribute("data-theme-name") === "claude",
    null,
    { timeout: 4000 },
  );
  await page.waitForTimeout(600);
  await page.screenshot({ path: "tests/screenshots/r52-theme-claude.png" });
  step("claude 主题截图", true, "tests/screenshots/r52-theme-claude.png");

  // 切 openbuddy(收尾)。
  await trigger.click();
  await page.waitForTimeout(300);
  await page.locator("[data-theme-name='openbuddy']").first().click();
  await page.waitForFunction(
    () => document.documentElement.getAttribute("data-theme-name") === "openbuddy",
    null,
    { timeout: 4000 },
  );
  await page.waitForTimeout(600);
  await page.screenshot({ path: "tests/screenshots/r52-theme-openbuddy.png" });
  step("openbuddy 主题截图", true, "tests/screenshots/r52-theme-openbuddy.png");
} finally {
  await app.close();
}

const ok = steps.every((s) => s.ok);
console.log(JSON.stringify({ ok, steps }, null, 2));
process.exit(ok ? 0 : 1);
