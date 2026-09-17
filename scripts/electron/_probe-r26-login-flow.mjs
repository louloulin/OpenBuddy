/**
 * R26 探针(R62+ 适配版):「左下角账户菜单点『登录』后真正发生什么」的当前契约。
 *
 * 历史:
 *   - R26 把未配置时的主按钮改成「配置企业登录」,点完把人送进设置表单 ——
 *     用户拿到的体验是"点登录没弹出任何东西",所以本探针最初是测这个 bug 的。
 *   - R48 又把它改回 git 历史(R15 / 536dc0e)的形态:菜单主按钮就是「登录」,
 *     点一下必弹出 overlay.sign-in(Casdoor 登录对话框)。未配置时框内直接
 *     给 issuer / clientId 输入,已配置时直接拉起 Casdoor 授权页。
 *   - R62 修了 onboarding 重复弹出,所以这里再预写 onboarding 状态避免被向导
 *     抢焦点。
 *
 * 当下断言的契约:
 *   1. 菜单主按钮叫「登录」(历史正确的形态),不再叫「配置企业登录」;
 *   2. 点「登录」→ overlay.sign-in 对话框在 DOM 里出现(用户可见的反馈);
 *   3. 对话框里有 issuer / clientId 输入框(未配置时不必跳设置);
 *   4. 没有弹新窗口(未配置时不能假装能登录);
 *   5. 设置入口(「打开设置」)仍然在菜单里,以兼容历史功能。
 */
import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = "/Users/louloulin/appx/OpenBuddy";
const report = { steps: [], ok: false, pageErrors: [] };
const step = (name, ok, detail) =>
  report.steps.push({ step: name, ok: Boolean(ok), detail });

const userData = mkdtempSync(join(tmpdir(), "ob-login-"));
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

  // R62 — onboarding 关闭状态先写好,免得首启引导抢 composer/账户菜单的焦点。
  // 与 real-chat-multiturn.mjs 同样的策略:WhatsNewGate 故意不写,
  // 因为首次安装应静默。
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
      /* localStorage unavailable */
    }
  }).catch(() => {});

  // 给 React 树把 onboarding 完成态从 localStorage 读回去、关掉浮层的时间。
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

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
  step("账户菜单主按钮叫「登录」(不再叫「配置企业登录」)", items.includes("登录") && !items.includes("配置企业登录"), JSON.stringify(items));
  step("账户菜单保留「打开设置」入口(兼容历史功能)", items.includes("打开设置"), JSON.stringify(items));
  step("账户菜单含「发送反馈」(R23 feedback 入口)", items.includes("发送反馈"), JSON.stringify(items));
  step("未配置时 casdoor:status 返回 configuration_needed", report.accountStatus.status === "configuration_needed", JSON.stringify(report.accountStatus));

  const target = "登录";
  const clicked = await page.evaluate((label) => {
    const items = Array.from(document.querySelectorAll(".sidebar__account-menu .sidebar__account-menu-item"));
    const el = items.find((n) => n.textContent?.trim() === label);
    if (!el) return false;
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  }, target);
  step(`菜单项「${target}」存在且被点击`, clicked);

  await page.waitForTimeout(1500);

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
    const dialog = document.querySelector("[role='dialog'][aria-label='登录']")
      ?? Array.from(document.querySelectorAll("[role='dialog']")).find((d) => /登录/.test(d.getAttribute("aria-label") ?? ""));
    return {
      toastText: toast?.textContent?.trim() ?? null,
      dialogOpen: Boolean(dialog),
      hasForm: Boolean(document.querySelector("[data-testid='casdoor-signin-form']")),
      hasIssuer: Boolean(document.querySelector("[data-testid='casdoor-signin-issuer']")),
      hasClientId: Boolean(document.querySelector("[data-testid='casdoor-signin-client-id']")),
      hasEnterprise: Boolean(document.querySelector("[data-testid='casdoor-signin-enterprise']")),
      casdoorWindowFlag: Boolean(document.querySelector("[data-casdoor-window]")),
    };
  });

  step("未配置时不假装能登录(没有新窗口)", report.windowsAfter === report.windowsBefore, { before: report.windowsBefore, after: report.windowsAfter });
  step("点「登录」后 overlay.sign-in 对话框真的弹出", report.after.dialogOpen, JSON.stringify(report.after));
  step("对话框里有 issuer / clientId 输入框(未配置时不跳设置)", report.after.hasIssuer && report.after.hasClientId && report.after.hasEnterprise, JSON.stringify(report.after));
  step("界面上不出现运维术语 casdoor://localhost/callback", !(report.after.toastText ?? "").includes("casdoor://localhost/callback"), { toastText: report.after.toastText });

  report.ok = report.pageErrors.length === 0 && report.steps.every((s) => s.ok);
} catch (error) {
  report.error = String(error?.message ?? error);
} finally {
  await app.close().catch(() => {});
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
