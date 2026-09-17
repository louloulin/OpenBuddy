/**
 * R54 真机探针 — ThemeStudio JSON 导入端到端。
 *
 * 路径:左下角「设置」齿轮 → 左侧导航点「个性化」→ ThemeStudio 出现 →
 * 点「导入 JSON」→ 用 Playwright `setInputFiles()` 把主题 JSON 喂到 hidden
 * input → 验证 label / type / 滑块按导入值更新。
 *
 * Playwright `setInputFiles` 对 hidden input(`position: absolute; clip:
 * rect(0,0,0,0)`)走 ElementHandle.setInputFiles 路径,不要求 visibility
 * 检查,所以即便 file-input 是「视觉隐藏」,真正喂文件这一步仍然能成。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r54-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r54-agent-"));
mkdirSync(join(root, "tests", "screenshots"), { recursive: true });

const tmpImportDir = mkdtempSync(join(tmpdir(), "ob-r54-import-"));
const goodPath = join(tmpImportDir, "good.json");
writeFileSync(goodPath, JSON.stringify({
  name: "probe-import",
  label: "Probe Imported",
  type: "light",
  accent: "#ff5500",
  vars: {
    "--wb-bg-primary": "oklch(0.94 0.01 0)",
    "--wb-bg-secondary": "oklch(0.88 0.02 0)",
    "--wb-fg-primary": "oklch(0.10 0.01 0)",
    "--wb-accent": "oklch(0.68 0.18 30)",
    "--wb-border": "oklch(0.78 0.01 0)",
  },
}, null, 2), "utf8");

const badPath = join(tmpImportDir, "bad.json");
writeFileSync(badPath, "{ this is not valid json", "utf8");

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
  } catch {}
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // 打开 Settings → 点「个性化」。
  await page.locator(".sidebar__footer button[aria-label='设置']").first().click();
  await page.waitForTimeout(700);
  const personalize = page.locator(".settings-navigation__item").filter({
    has: page.locator(".settings-navigation__label", { hasText: "个性化" }),
  }).first();
  step("设置面板的「个性化」导航项可见", await personalize.isVisible().catch(() => false), "");
  if (await personalize.isVisible().catch(() => false)) {
    await personalize.click();
    await page.waitForTimeout(600);
  }

  const studio = page.locator("[data-testid='theme-studio']");
  step("ThemeStudio 已挂载", await studio.isVisible().catch(() => false), "");
  if (!(await studio.isVisible().catch(() => false))) {
    step("导入按钮可见", false, "ThemeStudio not mounted;stop probe");
  } else {
    const importBtn = page.locator("[data-testid='theme-studio-import']");
    step("「导入 JSON」按钮可见", await importBtn.isVisible(), "");

    const fileInput = page.locator("[data-testid='theme-studio-file-input']").first();
    // 1) 灌 bad.json
    await fileInput.setInputFiles(badPath);
    await page.waitForTimeout(400);
    const errEl = page.locator("[data-testid='theme-studio-import-error']");
    const errVisible = await errEl.isVisible().catch(() => false);
    const errText = errVisible ? ((await errEl.textContent()) ?? "").trim() : "";
    step(
      "非法 JSON 文件触发错误提示",
      errVisible && errText.includes("JSON 解析失败"),
      errText || "(no error element rendered)",
    );
    await page.screenshot({ path: "tests/screenshots/r54-theme-studio-bad.png" });

    // 2) 灌 good.json
    await fileInput.setInputFiles(goodPath);
    await page.waitForTimeout(500);

    const labelValue = await page.locator(
      "xpath=//div[@data-testid='theme-studio']//label[.//span[text()='名称']]//input",
    ).inputValue().catch(() => "");
    step(
      "合法 JSON 后 label 输入框变成「Probe Imported」",
      labelValue === "Probe Imported",
      `value=${JSON.stringify(labelValue)}`,
    );

    const typeValue = await page.locator(
      "xpath=//div[@data-testid='theme-studio']//label[.//span[text()='类型']]//select",
    ).inputValue().catch(() => "");
    step(
      "合法 JSON 后类型选择器是 light",
      typeValue === "light",
      `value=${JSON.stringify(typeValue)}`,
    );

    const sliderVal = await page.locator(
      "xpath=(//div[@data-testid='theme-studio']//input[@type='range'])[1]",
    ).inputValue().catch(() => "");
    step(
      "第一个 token(--wb-bg-primary)滑块 L 值=0.94",
      Math.abs(parseFloat(sliderVal) - 0.94) < 1e-3,
      `value=${sliderVal}`,
    );

    const errAfterGood = await errEl.isVisible().catch(() => false);
    step("合法导入后错误条消失", !errAfterGood, "");

    await page.screenshot({ path: "tests/screenshots/r54-theme-studio-good.png" });
    step("合法导入截图", true, "tests/screenshots/r54-theme-studio-good.png");
  }
} finally {
  await app.close();
}

const ok = steps.every((s) => s.ok);
console.log(JSON.stringify({ ok, steps }, null, 2));
process.exit(ok ? 0 : 1);
