/**
 * R23 真机探针:三个此前"注册了却零消费"的 onboarding 槽位现在都能被用户看到。
 *
 *   onboarding.whats-new  → 升版本后自动弹的「本次更新」摘要(右下角浮动)
 *   onboarding.feedback   → 左下角账户菜单「发送反馈」→ 本地审计日志
 *   onboarding.data-dir   → 设置 → 数据管理「更改数据目录」的宿主侧通道
 *
 * 只看三件事:卡片真的出现在 DOM 里、点得动、副作用落在预期的地方
 * (localStorage / 本地 JSONL / userData 之外的指针文件)。
 */
import { _electron as electron } from "playwright";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-r23-"));
const targetDir = mkdtempSync(join(tmpdir(), "ob-r23-data-"));

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});

const report = { steps: [], ok: false, pageErrors: [] };

try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => report.pageErrors.push(String(error?.message ?? error)));
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40000 });
  await page.waitForTimeout(2500);

  // 首启:关掉向导,免得浮层叠在一起干扰点击。
  await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
  await page.waitForTimeout(500);

  // ── 1. onboarding.whats-new:把"上次看过的版本"改成一个更老的版本,重载 ──
  await page.evaluate(() => {
    localStorage.setItem("openbuddy.whats-new.lastSeen", "0.0.1-older");
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40000 });
  await page.waitForTimeout(3000);

  const whatsNewVisible = await page
    .waitForSelector("[data-testid='whats-new-gate']", { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  report.steps.push({ step: "whats-new 卡片出现", ok: whatsNewVisible });

  // 重载后向导可能又盖上来(它只在本地状态里记"关过"),先关掉再做后面的点击。
  await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
  await page.waitForTimeout(500);

  const whatsNew = await page.evaluate(() => {
    const gate = document.querySelector("[data-testid='whats-new-gate']");
    if (!gate) return null;
    return {
      version: gate.querySelector("[data-testid='whats-new-version']")?.textContent ?? null,
      itemCount: gate.querySelectorAll("[data-testid='whats-new-item']").length,
      firstTitle: gate.querySelector("[data-testid='whats-new-item']")?.textContent?.slice(0, 60) ?? null,
    };
  });
  report.whatsNew = whatsNew;
  report.steps.push({
    step: "whats-new 有版本号与条目",
    ok: Boolean(whatsNew?.version?.includes("0.15")) && (whatsNew?.itemCount ?? 0) > 0,
    detail: whatsNew,
  });

  await page.click("[data-testid='whats-new-close']").catch(() => {});
  await page.waitForTimeout(600);
  const afterDismiss = await page.evaluate(() => ({
    stillThere: Boolean(document.querySelector("[data-testid='whats-new-gate']")),
    lastSeen: localStorage.getItem("openbuddy.whats-new.lastSeen"),
  }));
  report.steps.push({
    step: "关闭后卡片消失 + 记录版本",
    ok: afterDismiss.stillThere === false && afterDismiss.lastSeen === "0.15.0",
    detail: afterDismiss,
  });

  // ── 2. onboarding.feedback:左下角账户菜单 → 发送反馈 → 本地审计日志 ──
  const menuOpened = await page
    .click(".sidebar__user", { timeout: 5000 })
    .then(() => true)
    .catch((error) => {
      report.accountMenuClickError = String(error?.message ?? error).slice(0, 200);
      return false;
    });
  report.steps.push({ step: "账户菜单可点开", ok: menuOpened });
  await page.waitForTimeout(500);
  const menuItems = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".sidebar__account-menu .sidebar__account-menu-item")).map(
      (el) => el.textContent?.trim() ?? "",
    ),
  );
  report.accountMenu = menuItems;
  report.steps.push({ step: "账户菜单含「发送反馈」", ok: menuItems.includes("发送反馈") });

  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".sidebar__account-menu .sidebar__account-menu-item"));
    const target = items.find((el) => el.textContent?.trim() === "发送反馈");
    target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.waitForTimeout(800);
  const feedbackVisible = await page
    .waitForSelector("[data-testid='feedback-gate'] [data-testid='feedback-popup']", { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  report.steps.push({ step: "反馈卡出现", ok: feedbackVisible });

  if (feedbackVisible) {
    await page.click("[data-testid='feedback-up']").catch(() => {});
    await page.fill("[data-testid='feedback-comment']", "R23 探针:本地审计日志落盘验证").catch(() => {});
    await page.click("[data-testid='feedback-submit']").catch(() => {});
    await page.waitForTimeout(1200);
  }

  const auditFile = join(userData, "audit.jsonl");
  const auditDump = existsSync(auditFile) ? readFileSync(auditFile, "utf8") : "";
  report.auditFile = { path: auditFile, exists: existsSync(auditFile), hasFeedback: auditDump.includes("user-feedback") };
  report.steps.push({
    step: "反馈落到本地 audit.jsonl",
    ok: auditDump.includes("user-feedback") && auditDump.includes("thumbs-up"),
  });

  // ── 3. onboarding.data-dir:读 → 写指针 → 复位 ──
  const dataDirDescribe = await page.evaluate(() => window.api.invoke("host:data-dir", undefined));
  report.dataDir = { describe: dataDirDescribe };
  report.steps.push({
    step: "host:data-dir 能读到当前目录",
    ok: typeof dataDirDescribe?.path === "string" && dataDirDescribe.path.length > 0,
    detail: dataDirDescribe,
  });

  const setResult = await page.evaluate(
    (dir) => window.api.invoke("host:data-dir-set", { path: dir }),
    targetDir,
  );
  report.dataDir.setResult = setResult;
  report.steps.push({
    step: "host:data-dir-set 写入成功且要求重启",
    ok: setResult?.ok === true && setResult?.requiresRestart === true && setResult?.path === targetDir,
    detail: setResult,
  });

  const resetResult = await page.evaluate(() => window.api.invoke("host:data-dir-reset", undefined));
  report.dataDir.resetResult = resetResult;
  report.steps.push({ step: "host:data-dir-reset 复位成功", ok: resetResult?.ok === true });

  // ── 4. 设置 → 数据管理:「更改数据目录」入口 + 真的能打开宿主选择器 ──
  await page.click(".sidebar__footer .sidebar__icon-btn[aria-label='设置']", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const dataNav = await page.$("[role='dialog'] button:has-text('数据管理')");
  await dataNav?.click().catch(() => {});
  await page.waitForTimeout(900);
  const dirRow = await page.evaluate(() => {
    const dialog = document.querySelector("[role='dialog']");
    const button = Array.from(dialog?.querySelectorAll("button") ?? []).find((b) =>
      b.textContent?.includes("更改数据目录"),
    );
    return {
      hasButton: Boolean(button),
      rowText: dialog?.textContent?.includes("数据目录") ?? false,
    };
  });
  report.settingsEntry = dirRow;
  report.steps.push({ step: "设置→数据管理有「更改数据目录」入口", ok: dirRow.hasButton });

  if (dirRow.hasButton) {
    await page.evaluate(() => {
      const dialog = document.querySelector("[role='dialog']");
      const button = Array.from(dialog?.querySelectorAll("button") ?? []).find((b) =>
        b.textContent?.includes("更改数据目录"),
      );
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await page.waitForTimeout(1200);
    const pickerVisible = await page
      .waitForSelector("[data-testid='data-dir-gate'] [data-testid='data-dir-prompt']", { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    report.steps.push({ step: "数据目录选择器(内核槽位)打开", ok: pickerVisible });
    if (pickerVisible) {
      const pickerInfo = await page.evaluate(() => {
        const prompt = document.querySelector("[data-testid='data-dir-prompt']");
        const input = prompt?.querySelector("input");
        return { value: input?.value ?? null, defaults: prompt?.querySelectorAll("[data-testid='data-dir-defaults'] button").length ?? 0 };
      });
      report.dataDirPicker = pickerInfo;
      report.steps.push({
        step: "选择器回填了当前目录",
        ok: (pickerInfo.value ?? "").startsWith("/"),
        detail: pickerInfo,
      });
    }
  }

  report.ok = report.steps.every((s) => s.ok) && report.pageErrors.length === 0;
} catch (error) {
  report.error = String(error?.message ?? error);
} finally {
  await app.close().catch(() => {});
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
