/**
 * R40 真机探针:「问过了」必须真的等答案 + 「已打开连接器目录」必须真的在连接器目录。
 *
 * 要证的两件事(都是代码级可复现的用户路径缺陷):
 *
 *   A. 市场子 tab 深链。
 *      R39 把侧栏「腾讯文档 / 乐享知识库」从死入口改成跳「专家·技能·连接器」,
 *      并提示"已打开连接器目录" —— 但面板 tab 是 `useState("experts")` 写死的,
 *      用户看到的仍是专家页。本探针断言:点完之后 **连接器 pill 是选中态**;
 *      并且"已经停在该页面时再点一次"也要切过去(事件通道,不重新挂载)。
 *
 *   B. 确认框的「等待」语义。
 *      `confirm()` 早已是异步的主题化 ConfirmDialog,但 `SettingsSections` 里两处
 *      毁灭性操作漏了 `await`(Promise 恒为真 → 弹窗弹出的同时动作已经执行),
 *      另外还有原生 `alert()` 与原生 `window.confirm` 残留。本探针断言:
 *      设置 → 数据管理 → 「清理本地会话缓存」先弹**主题化** alertdialog,
 *      取消之后**没有任何**"已清理"提示,确认之后才有。
 *
 * 截图默认不写盘;需要视觉资产时 OPENBUDDY_PROBE_SHOTS=1。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SHOTS_ENABLED = process.env.OPENBUDDY_PROBE_SHOTS === "1";
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const userData = mkdtempSync(join(tmpdir(), "ob-r40-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r40-agent-"));

const report = { steps: [], ok: false, pageErrors: [] };
const step = (name, ok, detail) => report.steps.push({ step: name, ok: Boolean(ok), detail });

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

const clickByText = (page, selector, text) =>
  page.evaluate(
    ([sel, needle]) => {
      const hit = Array.from(document.querySelectorAll(sel)).find((el) =>
        (el.textContent ?? "").includes(needle),
      );
      if (!(hit instanceof HTMLElement)) return false;
      hit.click();
      return true;
    },
    [selector, text],
  );

const selectedPill = (page) =>
  page.evaluate(() => {
    const el = document.querySelector(".um-pills [role='tab'][aria-selected='true']");
    return el?.textContent?.trim() ?? null;
  });

const confirmDialog = (page) =>
  page.evaluate(() => {
    const dialog = document.querySelector("[role='alertdialog']");
    if (!dialog) return null;
    const buttons = Array.from(dialog.querySelectorAll("button")).map((b) => b.textContent?.trim() ?? "");
    return {
      title: dialog.querySelector(".request-modal__title")?.textContent?.trim() ?? null,
      buttons,
    };
  });

const toastTexts = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll(".toast__message")).map((el) => el.textContent?.trim() ?? ""),
  );

try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => report.pageErrors.push(String(error?.message ?? error)));
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40000 });
  await page.waitForTimeout(2500);
  await page
    .click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 2000 })
    .catch(() => {});
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(600);

  // ── A1. 侧栏「更多」→「腾讯文档」→ 真的落在连接器 tab ──
  await page.hover(".sidebar__more-wrap");
  await page.waitForTimeout(400);
  const docsClicked = await clickByText(page, ".sidebar__more-item", "腾讯文档");
  await page.waitForTimeout(2600);
  const landedPill = await selectedPill(page);
  step("点「腾讯文档」可点", docsClicked, JSON.stringify({ docsClicked }));
  step(
    "点「腾讯文档」后**连接器** pill 是选中态(提示不再撒谎)",
    landedPill === "连接器",
    JSON.stringify({ selectedPill: landedPill }),
  );

  // ── A2. 已经停在该页面时再点一次:事件通道也要切过去 ──
  await clickByText(page, ".um-pills [role='tab']", "专家");
  await page.waitForTimeout(500);
  const afterManual = await selectedPill(page);
  // 鼠标先离开侧栏再 hover:停在同一个元素上不会重发 mouseenter,下拉不会重开。
  await page.mouse.move(900, 300);
  await page.waitForTimeout(500);
  await page.hover(".sidebar__more-wrap");
  await page.waitForTimeout(700);
  const secondClick = await clickByText(page, ".sidebar__more-item", "乐享知识库");
  await page.waitForTimeout(900);
  const secondPill = await selectedPill(page);
  step("先手动切回「专家」成功(对照)", afterManual === "专家", JSON.stringify({ afterManual }));
  step("面板已在屏幕上时,「乐享知识库」靠事件通道也能切到连接器", secondClick && secondPill === "连接器", JSON.stringify({ secondClick, secondPill }));

  if (SHOTS_ENABLED) await page.screenshot({ path: "tests/screenshots/r40-market-connector-tab.png" });

  // ── B1. 设置 → 数据管理 → 清理缓存:主题化确认框 + 取消真的取消 ──
  await page.click(".sidebar__footer [aria-label='设置']");
  await page.waitForTimeout(1500);
  const settingsOpen = await page.evaluate(() => Boolean(document.querySelector(".settings-modal")) || Boolean(document.querySelector(".settings-navigation")));
  step("左下角「设置」打得开设置面板", settingsOpen, JSON.stringify({ settingsOpen }));

  const navHit = await clickByText(page, ".settings-navigation__label", "数据管理");
  await page.waitForTimeout(900);
  const sectionTitle = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".settings-section__title")).map((el) => el.textContent?.trim() ?? ""),
  );
  step("导航到「数据管理」分区(渲染出真实分区,不是空壳)", navHit && sectionTitle.includes("数据管理"), JSON.stringify({ navHit, sectionTitle }));

  const clickedClear = await clickByText(page, ".settings-section button", "清理本地会话缓存");
  await page.waitForTimeout(900);
  const dialog = await confirmDialog(page);
  step(
    "点「清理本地会话缓存」弹出**主题化**确认框(role=alertdialog)",
    Boolean(dialog) && (dialog?.buttons ?? []).includes("清理") && (dialog?.buttons ?? []).includes("取消"),
    JSON.stringify(dialog),
  );

  // 取消:动作必须没有发生(旧的漏 await 版本此时已经清理完了)。
  const cancelled = await page.evaluate(() => {
    const dialog = document.querySelector("[role='alertdialog']");
    const button = Array.from(dialog?.querySelectorAll("button") ?? []).find(
      (b) => (b.textContent ?? "").trim() === "取消",
    );
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  });
  await page.waitForTimeout(1200);
  const afterCancel = await page.evaluate(() => ({
    dialog: Boolean(document.querySelector("[role='alertdialog']")),
    toasts: Array.from(document.querySelectorAll(".toast__message")).map((el) => el.textContent?.trim() ?? ""),
  }));
  step("取消后确认框关闭", cancelled && !afterCancel.dialog, JSON.stringify({ cancelled, ...afterCancel }));
  step(
    "取消后**没有**「已清理」提示(取消是真取消,不是装饰)",
    !afterCancel.toasts.some((t) => t.includes("已清理")),
    JSON.stringify(afterCancel.toasts),
  );

  // ── B2. 再点一次并确认:这时才真的清理 + 走 toast 而不是原生 alert ──
  await clickByText(page, ".settings-section button", "清理本地会话缓存");
  await page.waitForTimeout(900);
  const confirmedClick = await page.evaluate(() => {
    const dialog = document.querySelector("[role='alertdialog']");
    const button = Array.from(dialog?.querySelectorAll("button") ?? []).find(
      (b) => (b.textContent ?? "").trim() === "清理",
    );
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  });
  await page.waitForTimeout(1600);
  const toasts = await toastTexts(page);
  step("确认后出现 toast 反馈(不再是原生 alert 模态框)", confirmedClick && toasts.some((t) => t.includes("已清理")), JSON.stringify({ confirmedClick, toasts }));
  step("确认框已关闭(不是卡在 pending)", (await confirmDialog(page)) === null, "alertdialog gone");

  if (SHOTS_ENABLED) await page.screenshot({ path: "tests/screenshots/r40-confirm-and-toast.png" });

  report.ok = report.steps.every((item) => item.ok) && report.pageErrors.length === 0;
} catch (error) {
  report.error = String(error?.stack ?? error);
} finally {
  await app.close().catch(() => {});
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
