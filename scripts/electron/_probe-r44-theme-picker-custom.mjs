/**
 * R44 真机探针:ThemePicker 自定义主题闭环。
 *
 * 验证 4 件事:
 *   1. 写入一个 fake custom theme 到 localStorage,打开 picker 后能在
 *      dark 列表里看到它的 label。
 *   2. 点击 custom theme → documentElement 上的 --wb-bg-primary 被
 *      inline 覆盖,data-theme 切换到 "dark"。
 *   3. ACTIVE_CUSTOM_KEY 写入 → 重新打开 picker,custom card 处于
 *      active 状态(data-active 或 aria-pressed)。
 *   4. ThemeStudio 保存后 dispatch 事件 → 同 tab picker 自动出现新
 *      custom theme(无需刷新页面)。
 *
 * 截图默认不写盘;OPENBUDDY_PROBE_SHOTS=1 时输出。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SHOTS_ENABLED = process.env.OPENBUDDY_PROBE_SHOTS === "1";
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const userData = mkdtempSync(join(tmpdir(), "ob-r44-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r44-agent-"));

const report = { steps: [], ok: false, pageErrors: [] };
const step = (name, ok, detail) =>
  report.steps.push({ step: name, ok: Boolean(ok), detail });

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

try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(2500);

  page.on("pageerror", (err) => report.pageErrors.push(String(err)));

  // 关掉 onboarding 干扰
  try {
    const closeBtn = page.locator("[data-testid='onboarding-close']").first();
    if (await closeBtn.isVisible({ timeout: 2000 })) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    }
  } catch {
    /* not shown */
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // 探测所有主题相关按钮的真实存在 + aria-label 实际值
  const themeBtnInfo = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    return {
      total: buttons.length,
      matches: buttons
        .filter((b) => {
          const al = b.getAttribute("aria-label") ?? "";
          const t = b.getAttribute("title") ?? "";
          return /主题|theme/i.test(al) || /主题|theme/i.test(t);
        })
        .map((b) => ({
          ariaLabel: b.getAttribute("aria-label"),
          title: b.getAttribute("title"),
          dataTestId: b.getAttribute("data-testid"),
          visible: b.getBoundingClientRect().width > 0,
        })),
    };
  });
  report.themeBtnInfo = themeBtnInfo;

  // 写入 1 个 fake custom theme 到 localStorage(模拟 ThemeStudio 保存)
  await page.evaluate(() => {
    const custom = {
      name: "custom-probe-mine",
      label: "Probe Mine",
      type: "dark",
      accent: "oklch(0.7 0.15 30)",
      vars: {
        "--wb-bg-primary": "oklch(0.18 0.06 30)",
        "--wb-fg-primary": "oklch(0.92 0.04 30)",
        "--wb-accent": "oklch(0.7 0.15 30)",
      },
    };
    window.localStorage.setItem(
      "openbuddy.theme.custom",
      JSON.stringify([custom]),
    );
  });
  // 触发 storage 事件让 picker 重新读
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("openbuddy:custom-themes-updated"));
  });

  // 找到 ThemePicker 触发按钮 — sidebar 顶部的 SunMoonIcon 按钮
  const pickerBtn = page.locator("[data-testid='theme-menu-button'] button[aria-label='切换主题']").first();
  await pickerBtn.waitFor({ state: "visible", timeout: 5000 });
  await pickerBtn.click();
  await page.waitForTimeout(300);

  // 1. custom theme 出现在菜单里
  const customVisible = await page.evaluate(() => {
    const menus = document.querySelectorAll("[role='menu']");
    if (!menus.length) return { ok: false, reason: "no menu open" };
    // 合并所有 menu 的 text(portal 在 document.body 上)
    const all = Array.from(menus).map((m) => m.textContent ?? "").join("|");
    return {
      ok: all.includes("Probe Mine"),
      menuCount: menus.length,
      firstClassNames: Array.from(menus).map((m) => m.className).slice(0, 3),
      labels: Array.from(menus).map((m) => Array.from(m.querySelectorAll("*")).slice(0, 5).map((el) => el.textContent?.trim()).filter(Boolean)),
    };
  });
  step(
    "写入 custom theme 后,ThemePicker 菜单里能看到「Probe Mine」",
    customVisible.ok,
    JSON.stringify(customVisible),
  );

  // 2. 点击 custom theme → vars 写入 + data-theme 切换
  const customCard = page.locator("button", { hasText: "Probe Mine" }).first();
  const clickable = await customCard.isVisible().catch(() => false);
  if (clickable) {
    await customCard.click();
    await page.waitForTimeout(400);
  }

  const applied = await page.evaluate(() => {
    const html = document.documentElement;
    return {
      bg: html.style.getPropertyValue("--wb-bg-primary"),
      fg: html.style.getPropertyValue("--wb-fg-primary"),
      accent: html.style.getPropertyValue("--wb-accent"),
      dataTheme: html.getAttribute("data-theme"),
      dataThemeName: html.getAttribute("data-theme-name"),
      activeKey: window.localStorage.getItem("openbuddy.theme.custom.active"),
    };
  });
  step(
    "点击 custom theme 后:--wb-* vars 写到 documentElement",
    applied.bg === "oklch(0.18 0.06 30)" &&
      applied.fg === "oklch(0.92 0.04 30)" &&
      applied.accent === "oklch(0.7 0.15 30)",
    JSON.stringify(applied),
  );
  step(
    "data-theme 兼容属性 = dark;data-theme-name = custom;ACTIVE_CUSTOM_KEY 已写入",
    applied.dataTheme === "dark" &&
      applied.dataThemeName === "custom-probe-mine" &&
      applied.activeKey === "custom-probe-mine",
    JSON.stringify(applied),
  );

  // 3. 重新打开 picker,custom card 高亮
  await page.waitForTimeout(400);
  const pickerBtn2 = pickerBtn;
  await pickerBtn.click().catch(() => {});
  await page.waitForTimeout(300);
  const activeHighlight = await page.evaluate(() => {
    const menus = document.querySelectorAll("[role='menu']");
    let foundActive = false;
    for (const m of menus) {
      const cards = m.querySelectorAll(
        "[data-active='true'], [aria-pressed='true'], [data-selected='true']",
      );
      if (cards.length > 0) foundActive = true;
    }
    return { foundActive, menuCount: menus.length };
  });
  step(
    "activeCustom 持久化 → 重新打开 picker 时 custom card 处于 active 状态",
    activeHighlight.foundActive,
    JSON.stringify(activeHighlight),
  );

  // 4. ThemeStudio 事件路径:在 picker 已打开时模拟一次保存,菜单立即出现新主题
  // 先关闭 picker
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // 写入第二个 custom theme
  await page.evaluate(() => {
    const existing = JSON.parse(
      window.localStorage.getItem("openbuddy.theme.custom") ?? "[]",
    );
    const next = [
      ...existing,
      {
        name: "custom-probe-extra",
        label: "Probe Extra",
        type: "light",
        accent: "oklch(0.8 0.1 200)",
        vars: { "--wb-bg-primary": "oklch(0.95 0.02 200)" },
      },
    ];
    window.localStorage.setItem(
      "openbuddy.theme.custom",
      JSON.stringify(next),
    );
    window.dispatchEvent(new CustomEvent("openbuddy:custom-themes-updated"));
  });
  // 重新打开 picker
  const pickerBtn3 = pickerBtn;
  await pickerBtn.click();
  await page.waitForTimeout(300);
  const liveRefresh = await page.evaluate(() => {
    const menus = document.querySelectorAll("[role='menu']");
    const all = Array.from(menus).map((m) => m.textContent ?? "").join("|");
    return {
      ok: all.includes("Probe Extra"),
      hasProbeMine: all.includes("Probe Mine"),
    };
  });
  step(
    "Studio 保存事件触发后,picker 立即显示新 custom theme(无需刷新页面)",
    liveRefresh.ok && liveRefresh.hasProbeMine,
    JSON.stringify(liveRefresh),
  );

  if (SHOTS_ENABLED) {
    await page.screenshot({ path: "tests/screenshots/r44-theme-picker-custom.png" });
  }

  report.ok = report.steps.every((s) => s.ok) && report.pageErrors.length === 0;
} catch (error) {
  report.error = String(error?.stack ?? error);
} finally {
  await app.close().catch(() => {});
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
