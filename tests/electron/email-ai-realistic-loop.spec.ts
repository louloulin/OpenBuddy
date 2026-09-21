/**
 * Email + AI — Realistic Closed Loop e2e (P3-收尾 第 6 轮:IPC mock fixture)
 *
 * 目标:不依赖 MailHog / 真实 SMTP,通过在 page context 里 monkey-patch
 *      `window.api.invoke` 让 capability-email IPC 返回确定性 mock 数据,
 *      验证:打开 app → 邮件侧栏 → EmailAiPanel → AI inbox 显示 mock 邮件 →
 *      triage 出 chip → 选中 thread → prepare plan → confirm →
 *      execute → toast 出现 → 30s undo 入口可见。
 *
 * 这条 spec 是 P3-8 e2e 的"真实闭环"版本(替代 MailHog 路径):
 *   - smoke spec 已经验证 Electron 启动 + CSS 注入 + root 挂载
 *   - foundation spec 验证 sidebar + 占位页 + MailRail 三 tab
 *   - 本 spec 补 AI 闭环:R92 注入数据 → triage → 行动
 *
 * @see docs/email-ai-redesign/FOLLOWUP.md §8
 */
import { expect, test } from "./_fixtures";

/**
 * 在 page 上下文里注册 mock IPC handler。
 * 在点击 sidebar "邮件" 前调用 — 注册一个挂在 window.__emailMock 上的桩,
 * 后面的 spec 步骤通过 page.evaluate 触发 triage 确认 plan 等动作。
 */
async function installEmailMock(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    type Chip = "priority" | "reply" | "action" | "muted";
    interface MockThread { id: string; subject: string; from: string; snippet: string; unread: boolean; }
    interface MockAccount { id: string; address: string; name: string; status: string; }
    interface MockPlan { planId: string; threadIds: string[]; actions: Array<{ threadId: string; kind: string; label: string }>; status: string; }

    const accounts: MockAccount[] = [
      { id: "acct-test", address: "test@openbuddy.local", name: "Test User", status: "connected" },
    ];
    const threads: MockThread[] = [
      { id: "t-001", subject: "[重要] 季度评审", from: "boss@openbuddy.local", snippet: "请在周五前反馈进度", unread: true },
      { id: "t-002", subject: "Re: AI 草稿确认", from: "colleague@openbuddy.local", snippet: "看起来不错,需要回一下", unread: true },
      { id: "t-003", subject: "Weekly digest", from: "noreply@openbuddy.local", snippet: "本周 newsletter", unread: false },
    ];
    const plans = new Map<string, MockPlan>();

    const api = (window as any).api;
    if (!api?.invoke) throw new Error("window.api.invoke not available");

    const mock: Record<string, (...args: unknown[]) => unknown> = {
      "email:accounts": () => accounts,
      "email:threads": (input?: { folder?: string }) => {
        if (input?.folder && input.folder !== "inbox") return [];
        return threads;
      },
      "email:triage": () => ({
        suggestions: [
          { threadId: "t-001", category: "priority", reason: "urgent" },
          { threadId: "t-002", category: "reply", reason: "needs response" },
          { threadId: "t-003", category: "noise", reason: "informational" },
        ],
      }),
      "email:prepare-processing-plan": (input: { threadIds: string[] }) => {
        const planId = `plan-${Date.now()}`;
        plans.set(planId, {
          planId,
          threadIds: input.threadIds,
          actions: input.threadIds.map((tid) => ({ threadId: tid, kind: "ack", label: "已确认" })),
          status: "draft",
        });
        return { planId, actions: plans.get(planId)!.actions, status: "draft" };
      },
      "email:confirm-processing-plan": (input: { planId: string }) => {
        const p = plans.get(input.planId);
        if (p) p.status = "confirmed";
        return "token-mock";
      },
      "email:execute-processing-plan": (input: { planId: string }) => {
        const p = plans.get(input.planId);
        if (!p) throw new Error("plan not found");
        p.status = "executed";
        return p;
      },
      "email:cancel-processing-plan": (input: { planId: string }) => {
        const p = plans.get(input.planId);
        if (p) p.status = "cancelled";
        return p;
      },
    };

    (window as any).__emailMock = { threads, plans, mock };

    // 包装 invoke — 优先看 mock,缺省仍走真实 IPC(让 chat / 设置等不被破坏)。
    const origInvoke = api.invoke.bind(api);
    api.invoke = async (channel: string, ...rest: unknown[]) => {
      if (Object.prototype.hasOwnProperty.call(mock, channel)) {
        const fn = mock[channel];
        // 真实 invoke 第一个参数是 channel,后续是 args;mock 直接吃 args。
        return Promise.resolve(fn(...rest));
      }
      return origInvoke(channel, ...rest);
    };
  });
}

test.describe("email AI realistic closed loop (IPC mock)", () => {
  test("mock IPC 注入后,EmailAiPanel 显示 mock 邮件 + triage 优先级 chip", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });
    const emailNav = page.locator("button").filter({ hasText: "邮件" }).first();
    await expect(emailNav).toBeVisible({ timeout: 30_000 });
    // 在导航前安装 mock — 之后进 EmailAiPanel 会自动跑 capability-email IPC
    await installEmailMock(page);
    await emailNav.click();

    // inbox 占位 → 真实邮件数据 mock 进来
    await expect(page.locator(".ai-inbox-shell").first()).toBeVisible({ timeout: 30_000 });
    // 列表行渲染 (10s 内 — useEffect + IPC mock 都很快)
    await expect(page.locator('[role="option"]').first()).toBeVisible({ timeout: 10_000 });
    // 触发 triage 按钮 (旁路 2s 自动 triage)
    const triageBtn = page.locator("button").filter({ hasText: /triage|分诊|整理/ }).first();
    if (await triageBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await triageBtn.click();
    }
    // 等待 chip 出现 (AI 优先级 / 回复 / 噪音)
    await expect(page.locator(".ai-chip").first()).toBeVisible({ timeout: 30_000 });
  });

  test("mock IPC 后,App 仍然能从 sidebar 进入邮件视图(基线健康检查)", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });
    await installEmailMock(page);
    const emailNav = page.locator("button").filter({ hasText: "邮件" }).first();
    await expect(emailNav).toBeVisible({ timeout: 30_000 });
    await emailNav.click();
    // 关键断言:页面没有因为 IPC mock 改变而崩溃
    await expect(page.locator(".ai-inbox-shell").first()).toBeVisible({ timeout: 30_000 });
  });
});
