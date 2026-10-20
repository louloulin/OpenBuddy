/**
 * R48 真机探针:左下角「登录」入口 → Casdoor 登录对话框。
 *
 * 验证 5 件事:
 *   1. 左下角账户菜单主按钮是「登录」(不再是「配置企业登录」);
 *   2. 点「登录」—— 对话框必须真的弹出来(用户三次反馈"点登录没弹出");
 *   3. 未配置时框内直接给出 issuer / clientId 输入,而不是把人送去设置;
 *   4. 填完点「保存并登录」→ Casdoor 配置落到主进程(casdoor:config-get 可读回),
 *      且发起了一次 casdoor:login;
 *   5. 对话框底部保留「账户设置」入口(设置 = 历史功能之一)。
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

const userData = mkdtempSync(join(tmpdir(), "ob-r48-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r48-agent-"));

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

  try {
    const c = page.locator("[data-testid='onboarding-close']").first();
    if (await c.isVisible({ timeout: 2000 })) { await c.click(); await page.waitForTimeout(500); }
  } catch { /* not shown */ }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);

  // 1. 账户菜单主按钮
  await page.locator(".sidebar__user").first().click();
  await page.waitForTimeout(600);
  const menu = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".sidebar__account-menu-item"));
    return items.map((i) => (i.textContent ?? "").trim());
  });
  step(
    "左下角账户菜单主按钮是「登录」",
    menu.includes("登录") && !menu.some((m) => m.includes("配置企业登录")),
    JSON.stringify(menu),
  );
  step("账户菜单保留「打开设置」", menu.includes("打开设置"), JSON.stringify(menu));

  if (SHOTS_ENABLED) {
    await page.screenshot({ path: "tests/screenshots/r48-account-menu.png" });
  }

  // 2. 点「登录」→ 对话框必须弹出
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".sidebar__account-menu-item"));
    const f = items.find((i) => (i.textContent ?? "").trim() === "登录");
    if (f) f.click();
  });
  await page.waitForTimeout(1500);

  const dialogState = await page.evaluate(() => {
    const dialog = document.querySelector("[role='dialog'][aria-label='登录']")
      ?? Array.from(document.querySelectorAll("[role='dialog']")).find((d) => /登录/.test(d.getAttribute("aria-label") ?? ""));
    return {
      open: Boolean(dialog),
      hasForm: Boolean(document.querySelector("[data-testid='casdoor-signin-form']")),
      hasIssuer: Boolean(document.querySelector("[data-testid='casdoor-signin-issuer']")),
      hasClientId: Boolean(document.querySelector("[data-testid='casdoor-signin-client-id']")),
      hasSaveAndLogin: Boolean(document.querySelector("[data-testid='casdoor-signin-enterprise']")),
      buttonLabel: document.querySelector("[data-testid='casdoor-signin-enterprise']")?.textContent?.trim(),
    };
  });
  step("点「登录」对话框真的弹出", dialogState.open, JSON.stringify(dialogState));
  step(
    "未配置时框内直接给 issuer / clientId 输入(不用跳设置)",
    dialogState.hasIssuer && dialogState.hasClientId && dialogState.hasSaveAndLogin,
    JSON.stringify(dialogState),
  );

  if (SHOTS_ENABLED) {
    await page.screenshot({ path: "tests/screenshots/r48-signin-dialog.png" });
  }

  // 3. 填配置 + 点「保存并登录」
  if (dialogState.hasIssuer) {
    await page.locator("[data-testid='casdoor-signin-issuer']").fill("https://casdoor.probe.local");
    await page.locator("[data-testid='casdoor-signin-client-id']").fill("probe-client-id");
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const btn = document.querySelector("[data-testid='casdoor-signin-enterprise']");
      if (btn) btn.click();
    });
    // 4. 配置是否真的落盘(主进程可读回)。saveConfig 是异步 IPC,这里轮询
    //    到 configured 或超时,避免和设备速度赛跑。
    let persisted = null;
    for (let i = 0; i < 20; i += 1) {
      await page.waitForTimeout(500);
      persisted = await page.evaluate(async () => {
        try {
          const cfg = await window.api.invoke("casdoor:config-get");
          return { issuer: cfg?.issuer, clientId: cfg?.clientId, configured: cfg?.configured };
        } catch (error) {
          return { error: String(error) };
        }
      });
      if (persisted?.configured === true) break;
    }
    step(
      "「保存并登录」把 Casdoor 配置落到主进程",
      persisted?.issuer === "https://casdoor.probe.local" && persisted?.configured === true,
      JSON.stringify(persisted),
    );

    // 5. 登录结果在框内有反馈(探测一个不存在的 issuer:必然失败,但必须
    //    把「连不上」讲清楚,而不是静默)。
    let message = "";
    for (let i = 0; i < 24; i += 1) {
      await page.waitForTimeout(500);
      message = await page.evaluate(
        () => document.querySelector("[data-testid='casdoor-signin-message']")?.textContent?.trim() ?? "",
      );
      if (message.length > 0) break;
    }
    step(
      "登录结果在对话框内有可见反馈",
      message.length > 0 && /Casdoor|连不上|issuer|配置/i.test(message),
      message,
    );

    const labelAfter = await page.evaluate(
      () => document.querySelector("[data-testid='casdoor-signin-enterprise']")?.textContent?.trim() ?? "",
    );
    step(
      "配置落盘后按钮切换成「企业账号登录」",
      labelAfter === "企业账号登录",
      labelAfter,
    );
  }

  // 6. 账户设置入口仍在
  const hasSettingsLink = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button")).some((b) => (b.textContent ?? "").includes("账户设置")),
  );
  step("对话框保留「账户设置」入口", hasSettingsLink, `hasSettingsLink=${hasSettingsLink}`);

  report.ok = report.steps.every((s) => s.ok) && report.pageErrors.length === 0;
} catch (error) {
  report.error = String(error?.stack ?? error);
} finally {
  await app.close().catch(() => {});
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
