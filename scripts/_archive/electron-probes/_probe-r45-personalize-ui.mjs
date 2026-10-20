/**
 * R45 真机探针:Settings 个性化页 UI 简化。
 *
 * 验证 4 件事:
 *   1. 进入个性化分区后,ThemePicker 可见(走 settings.appearance.theme 槽)。
 *   2. Theme Studio 始终可见(不再藏在「打开/收起」按钮后)。
 *   3. 旧的「浅色 / 深色」基础 toggle 已移除(ThemePicker 已覆盖全部 19 套)。
 *   4. 字号拆出独立 settings-row。
 *
 * 截图默认不写盘;OPENBUDDY_PROBE_SHOTS=1 时输出到 tests/screenshots/。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SHOTS_ENABLED = process.env.OPENBUDDY_PROBE_SHOTS === "1";
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const userData = mkdtempSync(join(tmpdir(), "ob-r45-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r45-agent-"));

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

  // 1. 打开 Settings:点击侧栏底部 user 按钮 → 弹出账户菜单 → 点击「设置」
  const userBtn = page.locator(".sidebar__user").first();
  await userBtn.waitFor({ state: "visible", timeout: 5000 });
  await userBtn.click();
  await page.waitForTimeout(400);

  const accountMenu = document => page.locator(".sidebar__account-menu").first();
  const accountMenuExists = await page.locator(".sidebar__account-menu").count();
  step("账户菜单弹出", accountMenuExists > 0, `count=${accountMenuExists}`);

  // 找账户菜单里的「设置」按钮
  const settingsBtn = page.locator(".sidebar__account-menu-item", { hasText: "设置" }).first();
  await settingsBtn.waitFor({ state: "visible", timeout: 3000 });
  await settingsBtn.click();
  await page.waitForTimeout(800);

  // 2. 应该已经在 Settings 页 — 找「个性化」分区入口(可能是 tab / button / link)
  const personalizeNav = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("button, a, [role='tab'], [role='button']"));
    const found = all.find((el) => {
      const t = (el.textContent ?? "").trim();
      return t === "个性化" || t.startsWith("个性化");
    });
    if (!found) return { found: false };
    found.click();
    return { found: true, tag: found.tagName };
  });
  step("点击「个性化」分区入口", personalizeNav.found, JSON.stringify(personalizeNav));
  await page.waitForTimeout(800);

  // 3. ThemePicker 在个性化页可见
  const pickerVisible = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const triggers = buttons.filter((b) => {
      const al = b.getAttribute("aria-label") ?? "";
      return al.includes("Theme") || al.includes("主题");
    });
    return {
      triggerCount: triggers.length,
      firstAriaLabel: triggers[0]?.getAttribute("aria-label"),
    };
  });
  step(
    "ThemePicker 触发按钮可见",
    pickerVisible.triggerCount > 0,
    JSON.stringify(pickerVisible),
  );

  // 4. Theme Studio 始终可见:data-testid="theme-studio" 直接渲染
  const studioVisible = await page.evaluate(() => {
    const studio = document.querySelector("[data-testid='theme-studio']");
    if (!studio) return { found: false };
    const rect = studio.getBoundingClientRect();
    return {
      found: true,
      visible: rect.width > 0 && rect.height > 0,
      height: Math.round(rect.height),
      hasSliders: studio.querySelectorAll("input[type='range']").length,
    };
  });
  step(
    "Theme Studio 始终可见(data-testid=theme-studio 渲染,有 sliders)",
    studioVisible.found && studioVisible.visible && studioVisible.hasSliders > 0,
    JSON.stringify(studioVisible),
  );

  // 5. 旧的「浅色 / 深色」基础 toggle 已移除(.theme-toggle 不存在)
  const oldToggleGone = await page.evaluate(() => {
    const tts = document.querySelectorAll(".theme-toggle");
    const oldToggleBtns = document.querySelectorAll(".theme-toggle__btn");
    return {
      themeToggleContainers: tts.length,
      oldToggleBtns: oldToggleBtns.length,
    };
  });
  step(
    "旧的「浅色 / 深色」基础 toggle 已移除(theme-toggle 容器数 = 0)",
    oldToggleGone.themeToggleContainers === 0 && oldToggleGone.oldToggleBtns === 0,
    JSON.stringify(oldToggleGone),
  );

  // 6. 字号独立成 settings-row,有自己的 input[type=range]
  const fontSizeRow = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input[type='range']"));
    const fontInputs = inputs.filter((i) => {
      const row = i.closest(".settings-row");
      const text = (row?.textContent ?? "").trim();
      return text.includes("字号");
    });
    return {
      fontInputs: fontInputs.length,
      firstMin: fontInputs[0]?.min,
      firstMax: fontInputs[0]?.max,
    };
  });
  step(
    "字号拆出独立 settings-row(有自己的 range input)",
    fontSizeRow.fontInputs >= 1,
    JSON.stringify(fontSizeRow),
  );

  if (SHOTS_ENABLED) {
    await page.screenshot({ path: "tests/screenshots/r45-personalize-ui.png" });
  }

  report.ok = report.steps.every((s) => s.ok) && report.pageErrors.length === 0;
} catch (error) {
  report.error = String(error?.stack ?? error);
} finally {
  await app.close().catch(() => {});
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
