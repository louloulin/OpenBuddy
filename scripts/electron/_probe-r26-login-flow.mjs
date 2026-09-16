/**
 * R26 探针:未配置企业身份服务时,左下角账户菜单点「登录」会发生什么。
 *
 * 用户的原始反馈是"点击登录没有弹出"。根因不是按钮没接线,而是当时无论配置
 * 与否都硬拉 Casdoor 登录页 —— 未配置环境下必然失败,用户拿到的只有一句
 * 「Casdoor 配置无效：请检查 issuer、client ID、…」。
 *
 * 现在断言的是**修好之后**的行为:
 *   1. 菜单主按钮是「配置企业登录」(不是一个点一下必失败的「企业登录」);
 *   2. 点击后打开设置 → 账户管理(用户能在这里把 issuer / client ID 填上);
 *   3. toast 是人话(指出"去哪儿填什么"),而不是原样抛出运维文案;
 *   4. 没有新窗口弹出(未配置时不该假装能登录)。
 */
import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-login-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});

const report = { ok: false, steps: [], pageErrors: [] };

try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => report.pageErrors.push(String(e?.message ?? e)));
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40000 });
  await page.waitForTimeout(2500);
  await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
  await page.waitForTimeout(600);

  report.windowsBefore = app.windows().length;
  report.accountStatus = await page.evaluate(async () => {
    try {
      return await window.api.invoke("casdoor:status", undefined);
    } catch (error) {
      return { error: String(error?.message ?? error) };
    }
  });

  // 打开账户菜单
  await page.click(".sidebar__user", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  const items = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".sidebar__account-menu .sidebar__account-menu-item")).map(
      (el) => el.textContent?.trim() ?? "",
    ),
  );
  report.menuItems = items;

  const target = "配置企业登录";
  const clicked = await page.evaluate((label) => {
    const items = Array.from(document.querySelectorAll(".sidebar__account-menu .sidebar__account-menu-item"));
    const el = items.find((n) => n.textContent?.trim() === label);
    if (!el) return false;
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  }, target);
  report.steps.push({ step: `菜单项「${target}」存在且被点击`, ok: clicked });

  await page.waitForTimeout(4000);

  report.windowsAfter = app.windows().length;
  report.windowUrls = app.windows().map((w) => {
    try {
      return w.url();
    } catch {
      return "<closed>";
    }
  });
  report.after = await page.evaluate(() => {
    const toast = document.querySelector("[class*='toast']");
    const dialog = document.querySelector("[role='dialog']");
    return {
      toastText: toast?.textContent?.trim() ?? null,
      settingsOpen: Boolean(dialog),
      settingsText: dialog?.textContent?.trim().slice(0, 200) ?? null,
      casdoorWindowFlag: Boolean(document.querySelector("[data-casdoor-window]")),
    };
  });

  report.steps.push({
    step: "未配置时不假装能登录(没有新窗口)",
    ok: report.windowsAfter === report.windowsBefore,
    detail: { before: report.windowsBefore, after: report.windowsAfter },
  });
  report.steps.push({
    step: "点击后落到账户设置(用户能在这里补齐配置)",
    ok: report.after.settingsOpen === true && (report.after.settingsText ?? "").includes("账户"),
    detail: { settingsText: (report.after.settingsText ?? "").slice(0, 80) },
  });
  report.steps.push({
    step: "界面上不出现运维术语(不再甩 casdoor://localhost/callback)",
    ok: !(report.after.toastText ?? "").includes("casdoor://localhost/callback") &&
      !(report.after.settingsText ?? "").includes("casdoor://localhost/callback"),
    detail: { toastText: report.after.toastText },
  });

  report.ok = report.pageErrors.length === 0;
} catch (error) {
  report.error = String(error?.message ?? error);
} finally {
  await app.close().catch(() => {});
  console.log(JSON.stringify(report, null, 2));
}
