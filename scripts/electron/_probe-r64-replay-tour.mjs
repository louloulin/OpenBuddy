/**
 * R64 探针:设置 → 关于 → 「重新观看引导」按钮真实可用。
 */
import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = "/Users/louloulin/appx/OpenBuddy";
const report = { steps: [], ok: false, pageErrors: [], debug: {} };
const step = (name, ok, detail) =>
  report.steps.push({ step: name, ok: Boolean(ok), detail });

const userData = mkdtempSync(join(tmpdir(), "ob-r64-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});

try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => report.pageErrors.push(String(e?.message ?? e)));
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
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
  // 同上:写完 onboarding / tour 状态必须 reload,否则遮罩仍在(R77 排查)。
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40000 });
  await page.waitForTimeout(2000);
  report.onboardingCleared = await page.evaluate(
    () => !document.querySelector("[data-testid='onboarding-wizard']"),
  );

  // 用 evaluate 直接派发 click,因为 page.click 受 sidebar 折叠态影响
  const clickedSettings = await page.evaluate(() => {
    const btn = document.querySelector(".sidebar__icon-btn[aria-label='设置']");
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  });
  step("设置按钮存在且被点击", clickedSettings);

  // 等设置对话框在 DOM 里出现(最长 8s)
  let settingsOpen = false;
  for (let i = 0; i < 16; i += 1) {
    await page.waitForTimeout(500);
    settingsOpen = await page.evaluate(() => Boolean(document.querySelector("[role='dialog'][aria-label='设置']")));
    if (settingsOpen) break;
  }
  step("设置对话框可打开", settingsOpen);

  if (!settingsOpen) {
    report.debug.diag = await page.evaluate(() => ({
      dialogs: Array.from(document.querySelectorAll("[role='dialog']")).map((d) => d.getAttribute("aria-label")),
      sidebarFooter: Boolean(document.querySelector(".sidebar__footer")),
    }));
    throw new Error("settings dialog did not open");
  }

  const navItems = await page.evaluate(() => {
    const dialog = document.querySelector("[role='dialog'][aria-label='设置']");
    if (!dialog) return [];
    return Array.from(dialog.querySelectorAll("button")).map((b) => b.textContent?.trim()).filter(Boolean);
  });
  report.debug.navItems = navItems;

  const navToHelp = await page.evaluate(() => {
    const dialog = document.querySelector("[role='dialog'][aria-label='设置']");
    if (!dialog) return false;
    const button = Array.from(dialog.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("关于 OpenBuddy"),
    );
    if (!button) return false;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  });
  step("「关于」section 入口可点开", navToHelp);
  await page.waitForTimeout(700);

  const replayBtnExists = await page
    .waitForSelector("[data-testid='replay-tour']", { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  step("「重新观看引导」按钮存在", replayBtnExists);

  if (!replayBtnExists) {
    report.debug.afterNav = await page.evaluate(() => {
      const dialog = document.querySelector("[role='dialog'][aria-label='设置']");
      const activeBtn = dialog?.querySelector("button.settings-navigation__item--active");
      const sectionTitle = dialog?.querySelector(".settings-section__title")?.textContent?.trim();
      return {
        activeNav: activeBtn?.textContent?.trim(),
        sectionTitle,
        bodyTextSnippet: dialog?.querySelector(".settings-modal__content")?.textContent?.slice(0, 200),
      };
    });
    throw new Error("replay-tour button not found");
  }

  await page.click("[data-testid='replay-tour']").catch(() => {});
  await page.waitForTimeout(1500);

  const after = await page.evaluate(() => {
    const dialog = document.querySelector("[role='dialog'][aria-label='设置']");
    const tour = document.querySelector("[data-testid='tour-spotlight']")
      ?? document.querySelector("[role='dialog'][aria-label*='漫游']")
      ?? Array.from(document.querySelectorAll("[role='dialog']")).find((d) => /漫游|tour|介绍/i.test(d.getAttribute("aria-label") ?? ""));
    return {
      settingsStillOpen: Boolean(dialog),
      tourVisible: Boolean(tour),
      onboardingCleared: window.localStorage.getItem("openbuddy.onboarding.state") === null,
      tourState: window.localStorage.getItem("openbuddy.tour.state"),
    };
  });
  step("点击后设置对话框被关掉(replayTour 路径)", !after.settingsStillOpen);
  step("点击后 TourModal 在 DOM 里出现", after.tourVisible, after);
  step("点击后首启向导持久化被清掉", after.onboardingCleared);
  step("点击后漫游 seen 标记被清掉", after.tourState === null || after.tourState !== "seen", after);

  report.ok = report.pageErrors.length === 0 && report.steps.every((s) => s.ok);
} catch (error) {
  report.error = String(error?.message ?? error);
} finally {
  await app.close().catch(() => {});
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
