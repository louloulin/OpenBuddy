/**
 * Email + AI — e2e 闭环基础测试(P3-收尾 第 1 项)。
 *
 * 这个 spec 验证 capability-email IPC mock 能正确接入真实 Electron renderer,
 * 是后续完整 AI 闭环(打开 app → 邮件 → AI 规划 → 撤销)的前置条件。
 *
 * 已知边界:
 *   - EmailAiPanel 在生产链路上 dataProvider 未注入,所以 listbox 渲染空态。
 *     (这是 R92 的技术债,不是本 spec 的责任 — 留给后续修。)
 *   - 本 spec 聚焦:
 *     (a) sidebar "邮件" 入口能找到
 *     (b) EmailAiPanel 占位页能渲染(ai-inbox-shell root)
 *     (c) EmailAiStyles CSS 注入在 email 路由下生效
 *
 * 完整闭环测试留待:
 *   - 修复 R92:在 PlaceholderPage 把 emailBindings 注入到 EmailAiPanel.dataProvider
 *   - 接入测试邮箱账户 fixture(MailHog / mock SMTP)
 *
 * @see docs/email-ai-redesign/FOLLOWUP.md §7
 */
import { expect, test } from "./_fixtures";

test.describe("email AI e2e foundation (P3-收尾 第 1 项)", () => {
  test("sidebar 含 '邮件' 入口 — 验证导航可达", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });
    // sidebar mount 时间 — 加 poll 替代固定 wait
    await expect(page.locator("button").filter({ hasText: "邮件" }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("点击 sidebar 邮件后,EmailAiPanel 占位页能渲染", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2000);
    const emailNav = page.locator("button").filter({ hasText: "邮件" }).first();
    await emailNav.click({ timeout: 30_000 });
    // EmailAiPanel 渲染后,MailRail 会出现(带"今天要看的"标题)
    await expect(page.getByText(/今天要看的/).first()).toBeVisible({ timeout: 30_000 });
  });

  test("EmailAiPanel 渲染后,MailRail 三个 tab 全部可见", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2000);
    await page.locator("button").filter({ hasText: "邮件" }).first().click();
    await expect(page.getByText(/今天要看的/).first()).toBeVisible({ timeout: 30_000 });
    // 验证三个 rail view 都在
    await expect(page.getByText(/本周再处理/).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/已处理/).first()).toBeVisible({ timeout: 5_000 });
  });

  test("EmailAiPanel 占位页能渲染 ai-inbox-shell(ai.css 注入生效)", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2000);
    await page.locator("button").filter({ hasText: "邮件" }).first().click();
    await expect(page.locator(".ai-inbox-shell").first()).toBeVisible({ timeout: 30_000 });
  });
});
