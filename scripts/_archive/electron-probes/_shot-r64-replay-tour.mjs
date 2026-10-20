/**
 * R64 视觉:设置 → 关于 → 「重新观看引导」按钮 + 点击后 TourModal 截图。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-r64-shot-"));
mkdirSync("tests/screenshots", { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});

try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40000 });

  await page.evaluate(() => {
    try {
      const done = JSON.stringify({
        version: 1,
        status: "done",
        index: 0,
        steps: [],
        startedAt: Date.now(),
        updatedAt: Date.now(),
        completedAt: Date.now(),
      });
      window.localStorage.setItem("openbuddy.onboarding.state", done);
      window.localStorage.setItem("openbuddy.tour.state", "seen");
    } catch {
      /* */
    }
  }).catch(() => {});
  await page.waitForTimeout(3000);

  // 打开设置 → 关于
  await page.evaluate(() => {
    document.querySelector(".sidebar__icon-btn[aria-label='设置']")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const dialog = document.querySelector("[role='dialog'][aria-label='设置']");
    const button = Array.from(dialog?.querySelectorAll("button") ?? []).find((b) =>
      b.textContent?.includes("关于 OpenBuddy"),
    );
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: "tests/screenshots/r64-about-replay-button.png" });

  // 点击按钮
  await page.evaluate(() => {
    document.querySelector("[data-testid='replay-tour']")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "tests/screenshots/r64-tour-modal.png" });

  console.log(JSON.stringify({ ok: true, shots: [
    "tests/screenshots/r64-about-replay-button.png",
    "tests/screenshots/r64-tour-modal.png",
  ] }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
} finally {
  await app.close().catch(() => {});
  process.exit(0);
}
