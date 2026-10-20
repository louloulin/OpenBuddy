/**
 * _probe-theme-fonts.mjs — 真机验证「主题字体真的作用到 UI」。
 *
 * 背景:19 套主题的 `font` / `headingFont` 曾经只喂给 ThemePicker 的预览卡片,
 * 真实 UI 从不消费 —— 换主题只换颜色。修复后这里做端到端确认:
 *   1. 打开 设置 → 个性化 → ThemePicker;
 *   2. 选 claude → body 的 computed fontFamily 必须含 "Space Grotesk",
 *      标题 token 必须含 "Playfair Display";
 *   3. 选 win95  → body 必须含 "Pixelated MS Sans Serif"(字体随主题切换);
 *   4. 内联 `--wb-font` 不能出现 `var(--wb-font`(自引用会让整条声明失效)。
 *
 * 输出单行 JSON,由 _probe-theme-fonts.test.mjs 解析断言。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-fonts-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 200)));

await page.waitForTimeout(15_000);
// 关掉首启引导,避免遮挡设置入口。
await page
  .click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 })
  .catch(() => {});
await page.waitForTimeout(1200);

await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".settings-navigation__item"));
  const target = items.find((el) => (el.textContent ?? "").includes("个性化"));
  if (target) target.click();
});
await page.waitForTimeout(1200);

/** 打开 ThemePicker 浮层并点某套主题;返回是否真的点到。 */
async function pickTheme(name) {
  const opened = await page.evaluate(() => {
    const trigger = document.querySelector("button[aria-label='Theme']");
    if (!trigger) return false;
    trigger.click();
    return true;
  });
  if (!opened) return false;
  await page.waitForTimeout(700);
  const clicked = await page.evaluate((themeName) => {
    const card = document.querySelector(`button[data-theme-name='${themeName}']`);
    if (!card) return false;
    card.click();
    return true;
  }, name);
  await page.waitForTimeout(900);
  return clicked;
}

/** 读取当前生效字体 + 关键 token。 */
const readFonts = () =>
  page.evaluate(() => ({
    bodyFont: getComputedStyle(document.body).fontFamily,
    headingToken: document.documentElement.style.getPropertyValue("--wb-font-heading"),
    fontToken: document.documentElement.style.getPropertyValue("--wb-font"),
    themeName: document.documentElement.getAttribute("data-theme-name"),
  }));

const result = { picked: {}, fonts: {}, pageErrors, ok: true };

for (const name of ["claude", "win95"]) {
  result.picked[name] = await pickTheme(name);
  result.fonts[name] = await readFonts();
}

result.ok =
  result.picked.claude === true &&
  result.picked.win95 === true &&
  result.fonts.claude.bodyFont.includes("Space Grotesk") &&
  result.fonts.claude.headingToken.includes("Playfair Display") &&
  result.fonts.claude.fontToken.includes("Space Grotesk") &&
  !result.fonts.claude.fontToken.includes("var(--wb-font") &&
  result.fonts.win95.bodyFont.includes("Pixelated MS Sans Serif") &&
  result.fonts.win95.fontToken !== result.fonts.claude.fontToken &&
  pageErrors.length === 0;

console.log(JSON.stringify(result, null, 2));
await app.close();
process.exit(result.ok ? 0 : 1);
