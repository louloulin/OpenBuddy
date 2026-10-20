/**
 * R46 真机探针:ThemeStudio 预览还原 + 保存即应用。
 *
 * 验证 4 件事:
 *   1. 进入设置 → 个性化后,ThemeStudio 渲染正常,初始 mount 不污染
 *      documentElement 的 data-theme-name(没动滑块就保持 active theme)。
 *   2. 调一个滑块后,inline --wb-bg-primary 被覆盖 → documentElement
 *      颜色立即变(实时预览)。
 *   3. 不保存 → 关闭 Studio → documentElement 还原到 active theme 的
 *      vars(inline --wb-* 清空,data-theme-name 改回 active theme 名)。
 *   4. 调滑块 + 保存 → documentElement 应用 custom theme 的 vars,
 *      data-theme-name=custom-xxx,关闭 Studio 后 vars 保留。
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

const userData = mkdtempSync(join(tmpdir(), "ob-r46-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r46-agent-"));

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

const readStateFn = () => {
  const html = document.documentElement;
  const sampleVar = (
    html.style.getPropertyValue("--wb-bg-primary") ||
    html.style.getPropertyValue("--wb-fg-primary") ||
    ""
  ).trim();
  return {
    dataTheme: html.getAttribute("data-theme"),
    dataThemeName: html.getAttribute("data-theme-name"),
    sampleVar,
    activeCustom: window.localStorage.getItem("openbuddy.theme.custom.active"),
  };
};

const clickTabByText = async (page, prefix) => {
  await page.evaluate((p) => {
    // R45 之后的 SettingsPanel 是嵌套导航:外层 group + 内层 item。
    // 先尝试 [role='tab'] / button / a,再退回 nav-item 文本精确匹配。
    const all = Array.from(document.querySelectorAll("button, a, [role='tab'], [class*='nav-item'], [class*='NavItem'], [class*='settings-nav'] button"));
    const found = all.find((el) => (el.textContent ?? "").trim() === p || (el.textContent ?? "").trim().startsWith(p + " "));
    if (found) found.click();
  }, prefix);
};

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

  // 进入设置 → 个性化
  const userBtn = page.locator(".sidebar__user").first();
  await userBtn.click();
  await page.waitForTimeout(400);
  const settingsBtn = page.locator(".sidebar__account-menu-item", { hasText: "设置" }).first();
  await settingsBtn.click();
  await page.waitForTimeout(800);
  await clickTabByText(page, "个性化");
  await page.waitForTimeout(1500);

  // 0. 记录 active theme 的初始 sample var(应该是 openbuddy 浅色主题的亮色)
  const initialState = await page.evaluate(readStateFn);
  step(
    "Studio mount 后 documentElement 不污染 data-theme-name(保持 active theme)",
    initialState.dataThemeName !== "custom",
    JSON.stringify(initialState),
  );

  // 1. Studio 有滑块
  const sliderCount = await page.locator("[data-testid='theme-studio'] input[type='range']").count();
  step("Studio 有 ≥ 1 个滑块(确认 Studio 真正渲染)", sliderCount > 0, `sliderCount=${sliderCount}`);

  // 2. 调一个滑块:实时预览 + data-theme-name 变 custom + sample var 变
  await page.evaluate(() => {
    const sliders = Array.from(document.querySelectorAll("[data-testid='theme-studio'] input[type='range']"));
    const input = sliders[0];
    const original = input.value;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, original === "0.5" ? "0.05" : "0.95");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(600);

  const afterEdit = await page.evaluate(readStateFn);
  step(
    "调滑块后:data-theme-name=custom,sample var 已被覆盖(实时预览)",
    afterEdit.dataThemeName === "custom" && afterEdit.sampleVar.length > 0 && afterEdit.sampleVar !== initialState.sampleVar,
    JSON.stringify(afterEdit),
  );

  if (SHOTS_ENABLED) {
    await page.screenshot({ path: "tests/screenshots/r46-theme-studio-preview.png" });
  }

  // 3. 不保存 → 切走分区触发 unmount → sample var 还原到 active theme
  await clickTabByText(page, "快捷键");
  await page.waitForTimeout(900);

  const afterUnmount = await page.evaluate(readStateFn);
  step(
    "未保存 → Studio unmount 后:sample var 还原到 active theme + data-theme-name ≠ custom",
    afterUnmount.dataThemeName !== "custom" && afterUnmount.sampleVar === initialState.sampleVar,
    JSON.stringify({ ...afterUnmount, expected: initialState.sampleVar }),
  );

  // 4. 调滑块 + 保存 → 应用 custom,unmount 后保留
  await clickTabByText(page, "个性化");
  await page.waitForTimeout(1200);

  const sliderCountAgain = await page.locator("[data-testid='theme-studio'] input[type='range']").count();
  step("重入个性化页后 Studio 仍渲染滑块", sliderCountAgain > 0, `sliderCountAgain=${sliderCountAgain}`);
  if (sliderCountAgain > 0) {
    await page.evaluate(() => {
      const sliders = Array.from(document.querySelectorAll("[data-testid='theme-studio'] input[type='range']"));
      const input = sliders[0];
      const original = input.value;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, original === "0.5" ? "0.05" : "0.95");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(500);

    // 点保存:用 evaluate 直接找 button[textContent=保存] 并 click()
    const saved = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("[data-testid='theme-studio'] button"));
      const target = buttons.find((b) => (b.textContent ?? "").trim() === "保存");
      if (target) {
        target.click();
        return true;
      }
      return false;
    });
    step("保存按钮可点击", saved, `saved=${saved}`);
    await page.waitForTimeout(900);
  }

  const afterSave = await page.evaluate(readStateFn);
  step(
    "保存后:data-theme-name=custom-*,sample var 不再是 active theme 值,ACTIVE_CUSTOM_KEY 已落地",
    (afterSave.dataThemeName ?? "").startsWith("custom-") &&
      afterSave.sampleVar !== initialState.sampleVar &&
      !!afterSave.activeCustom,
    JSON.stringify(afterSave),
  );

  // 关闭 Studio 后 vars 必须保留(saved 路径不能还原)
  await clickTabByText(page, "快捷键");
  await page.waitForTimeout(900);

  const afterCloseSaved = await page.evaluate(readStateFn);
  step(
    "已保存 → Studio unmount 后:custom vars 保留(data-theme-name 仍 custom-*,sample var 不被还原)",
    (afterCloseSaved.dataThemeName ?? "").startsWith("custom-") &&
      afterCloseSaved.sampleVar !== initialState.sampleVar,
    JSON.stringify(afterCloseSaved),
  );

  if (SHOTS_ENABLED) {
    await page.screenshot({ path: "tests/screenshots/r46-theme-studio-saved.png" });
  }

  report.ok = report.steps.every((s) => s.ok) && report.pageErrors.length === 0;
} catch (error) {
  report.error = String(error?.stack ?? error);
} finally {
  await app.close().catch(() => {});
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
