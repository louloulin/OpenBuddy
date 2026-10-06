/**
 * R55 真机探针 — ThemeStudio 导出(剪贴板 + 文件下载 + 状态提示)。
 *
 * 路径:设置 → 个性化 → ThemeStudio → 点「导出 JSON」→
 * 验证:
 *   (a) 触发了一次 Playwright 的 download 事件,filename 形如 `custom-*.json`;
 *   (b) 下载文件内容是合法 JSON,且 name / type / vars 字段齐全;
 *   (c) `[data-testid="theme-studio-export-status"]` 渲染,文本含「剪贴板」
 *       + 「文件 custom-{label}.json」;
 *   (d) 截图保存。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r55-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r55-agent-"));
mkdirSync(join(root, "tests", "screenshots"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60000,
  acceptDownloads: true,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENT_DIR: agentDir, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
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

  // 打开 Settings → 「个性化」。
  await page.locator(".sidebar__footer button[aria-label='设置']").first().click();
  await page.waitForTimeout(700);
  const personalize = page.locator(".settings-navigation__item").filter({
    has: page.locator(".settings-navigation__label", { hasText: "个性化" }),
  }).first();
  if (await personalize.isVisible().catch(() => false)) {
    await personalize.click();
    await page.waitForTimeout(700);
  }

  const studio = page.locator("[data-testid='theme-studio']");
  step("ThemeStudio 已挂载", await studio.isVisible().catch(() => false), "");
  if (!(await studio.isVisible().catch(() => false))) {
    step("导出按钮可见", false, "studio not mounted");
  } else {
    const exportBtn = page.locator("[data-testid='theme-studio-export']");
    step("导出按钮可见", await exportBtn.isVisible(), "");

    // 把 label 改成 r55-fixture 让生成的 filename 可断言。
    const labelInput = page.locator(
      "xpath=//div[@data-testid='theme-studio']//label[.//span[text()='名称']]//input",
    );
    await labelInput.fill("r55-fixture");
    await page.waitForTimeout(300);

    // Playwright 监听 download 事件。
    const downloadPromise = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
    await exportBtn.click();
    await page.waitForTimeout(400);
    const download = await downloadPromise;

    step(
      "触发了一次 download 事件",
      download !== null,
      download ? `filename=${download.suggestedFilename()}` : "no download fired",
    );

    if (download) {
      const filename = download.suggestedFilename();
      step(
        "filename 形如 custom-r55-fixture.json",
        /^custom-r55-fixture\.json$/.test(filename),
        `value=${filename}`,
      );

      // 读取下载内容。
      const dlPath = await download.path();
      let parsed = null;
      let text = "";
      try {
        const { readFileSync } = await import("node:fs");
        text = readFileSync(dlPath, "utf8");
        parsed = JSON.parse(text);
      } catch (err) {
        step("下载文件能 JSON.parse", false, String(err).slice(0, 160));
      }
      if (parsed) {
        step(
          "下载文件含 name/type/accent/vars",
          typeof parsed.name === "string" &&
            (parsed.type === "dark" || parsed.type === "light") &&
            typeof parsed.accent === "string" &&
            parsed.vars && typeof parsed.vars === "object" &&
            Object.keys(parsed.vars).length > 0,
          `name=${parsed.name} type=${parsed.type} keys=${Object.keys(parsed.vars ?? {}).length}`,
        );
      }
    }

    const statusEl = page.locator("[data-testid='theme-studio-export-status']");
    const statusText = ((await statusEl.textContent().catch(() => "")) ?? "").trim();
    step(
      "导出状态条出现,文本含「剪贴板」+「文件 custom-r55-fixture.json」",
      statusText.includes("剪贴板") && statusText.includes("文件 custom-r55-fixture.json"),
      statusText || "(no status element)",
    );

    await page.screenshot({ path: "tests/screenshots/r55-theme-studio-export.png" });
    step("导出截图", true, "tests/screenshots/r55-theme-studio-export.png");
  }
} finally {
  await app.close();
}

const ok = steps.every((s) => s.ok);
console.log(JSON.stringify({ ok, steps }, null, 2));
process.exit(ok ? 0 : 1);
