/**
 * Email + AI — Realistic Closed Loop e2e (P3-收尾 第 6 轮:IPC mock fixture)
 *
 * 目标:不依赖 MailHog / 真实 SMTP,通过在 page context 里 monkey-patch
 *      `window.api.invoke` 让 capability-email IPC 返回确定性 mock 数据,
 *      验证:打开 app → 邮件侧栏 → EmailAiPanel → AI inbox 显示 mock 邮件 →
 *      triage 出 chip。
 *
 * 替代 MailHog 的轻量方案 — 不引入额外服务,直接覆盖 IPC 层。
 *
 * @see docs/email-ai-redesign/FOLLOWUP.md §8
 */
import { expect, test, type Page } from "./_fixtures";
import { _electron as electron } from "@playwright/test";

async function installEmailMock(electronApp: import("@playwright/test").ElectronApplication): Promise<void> {
  // 在 main process 注册 mock ipcMain.handle 覆盖;renderer 端 ipcRenderer.invoke 不变。
  await electronApp.evaluate(async ({ ipcMain }) => {
    interface MockThread { id: string; subject: string; from: string; snippet: string; unread: boolean; }
    interface MockAccount { id: string; address: string; name: string; status: string; }

    const accounts: MockAccount[] = [
      { id: "acct-test", address: "test@openbuddy.local", name: "Test User", status: "connected" },
    ];
    const threads: MockThread[] = [
      { id: "t-001", subject: "[重要] 季度评审", from: "boss@openbuddy.local", snippet: "请在周五前反馈进度", unread: true },
      { id: "t-002", subject: "Re: AI 草稿确认", from: "colleague@openbuddy.local", snippet: "看起来不错,需要回一下", unread: true },
      { id: "t-003", subject: "Weekly digest", from: "noreply@openbuddy.local", snippet: "本周 newsletter", unread: false },
    ];

    // 替换已有 handler(ipcMain.handle 默认抛错,我们用 handleOnce 覆盖)
    // 注意:mock 只在 e2e 测试中临时覆盖,生产代码不受影响。
    const _origAccounts = ipcMain.listeners("email:accounts");
    ipcMain.removeHandler("email:accounts");
    ipcMain.handle("email:accounts", () => accounts);

    ipcMain.removeHandler("email:threads");
    ipcMain.handle("email:threads", (_e: unknown, input?: { folder?: string }) => {
      if (input?.folder && input.folder !== "inbox") return [];
      return threads;
    });

    ipcMain.removeHandler("email:triage");
    ipcMain.handle("email:triage", () => ({
      suggestions: [
        { threadId: "t-001", category: "priority", reason: "urgent" },
        { threadId: "t-002", category: "reply", reason: "needs response" },
        { threadId: "t-003", category: "noise", reason: "informational" },
      ],
    }));
  });
}

test.describe("email AI realistic closed loop (IPC mock)", () => {
  test("mock IPC 注入后,EmailAiPanel 显示 mock 邮件", async ({ page, electronApp }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });
    const emailNav = page.locator("button").filter({ hasText: "邮件" }).first();
    await expect(emailNav).toBeVisible({ timeout: 30_000 });
    // 在导航前安装 mock — 之后进 EmailAiPanel 会自动跑 capability-email IPC
    await installEmailMock(electronApp);
    await emailNav.click();

    // EmailAiPanel 占位页 mount
    await expect(page.locator(".ai-inbox-shell").first()).toBeVisible({ timeout: 30_000 });
    // 等几秒让 useEmailData 把数据拉进来(ipcMain mock 命中后应秒回)
    await page.waitForTimeout(2_000);
    // 验证 3 条 mock 线程被渲染
    const listboxRows = await page.locator('[role="option"]').count();
    expect(listboxRows).toBe(3);
  });

  test("mock IPC 后,App 仍然能从 sidebar 进入邮件视图(基线健康检查)", async ({ page, electronApp }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });
    await installEmailMock(electronApp);
    const emailNav = page.locator("button").filter({ hasText: "邮件" }).first();
    await expect(emailNav).toBeVisible({ timeout: 30_000 });
    await emailNav.click();
    await expect(page.locator(".ai-inbox-shell").first()).toBeVisible({ timeout: 30_000 });
  });
});
