/**
 * R49 真机视觉:侧栏底部身份条(参考 WorkBuddy 左下角:头像 + 名字 + 铃铛 + 设置)。
 *
 * 输出 tests/screenshots/r49-leftbottom-{light,dark}.png(2x 缩放的元素截图)。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r49-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r49-agent-"));
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
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(2500);
  try {
    const c = page.locator("[data-testid='onboarding-close']").first();
    if (await c.isVisible({ timeout: 2000 })) { await c.click(); await page.waitForTimeout(400); }
  } catch { /* not shown */ }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  const footer = page.locator(".sidebar__footer").first();
  const box = await footer.boundingBox();

  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => {
      document.documentElement.setAttribute("data-theme", t);
    }, theme);
    await page.waitForTimeout(350);
    const path = `tests/screenshots/r49-leftbottom-${theme}.png`;
    await page.screenshot({ path, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
    step(`截图 ${theme}`, true, path);
  }

  const shape = await page.evaluate(() => {
    const wrap = document.querySelector(".sidebar__user");
    if (!wrap) return null;
    const dot = wrap.querySelector(".sidebar__user-dot");
    return {
      text: (wrap.querySelector(".sidebar__user-name")?.textContent ?? "").trim(),
      hasSub: Boolean(wrap.querySelector(".sidebar__user-sub")),
      hasChevron: Boolean(wrap.querySelector(".sidebar__user-chevron")),
      dotState: dot?.getAttribute("data-state") ?? null,
      dotDisplay: dot ? getComputedStyle(dot).display : null,
      rowCount: wrap.querySelectorAll("span").length,
    };
  });
  step("左下角是单行身份条", shape && !shape.hasSub && !shape.hasChevron, JSON.stringify(shape));
  step(
    "默认形态与参考图一致(多出的状态点不渲染)",
    shape?.dotDisplay === "none",
    JSON.stringify(shape),
  );
  step("保留铃铛入口", await page.locator(".sidebar__footer button[aria-label='通知']").count() > 0, "");
  step("保留设置入口", await page.locator(".sidebar__footer button[aria-label='设置']").count() > 0, "");
} finally {
  await app.close();
}

const ok = steps.every((s) => s.ok);
console.log(JSON.stringify({ ok, steps }, null, 2));
process.exit(ok ? 0 : 1);
