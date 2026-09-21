/**
 * R10 — Email + AI closed loop driven against the **packaged production**
 * OpenBuddy.app (release/mac-arm64 or release/mac). Companion fixture lives
 * in `_prod-fixtures.ts`; this file holds the assertions.
 *
 * Goal: prove that every round 1–9 UI fix actually runs in the bundled
 * binary, not just `out/` dev artifacts. CSP, file:// resource loading,
 * packaged IPC bindings, and prod-only env paths are the typical silent
 * failure modes this spec catches.
 *
 * On non-mac hosts or when the .app artifact is missing, every test in this
 * file is skipped (see `_prod-fixtures.ts:skipIfNoProdBuild`). On mac with a
 * fresh `npm run electron:build:mac` and a running echo provider it should
 * be 10/10 green.
 *
 * Note on the AI layer: triage / plan / execute go through `bindings.routePrompt`
 * — a JS function on the renderer side, not an `ipcMain.handle` channel.
 * The IPC mocks in `installProdEmailMock` cover the capability-email list /
 * counts / undo / summary endpoints. The AI routing layer is exercised via
 * the local echo provider at `OPENBUDDY_ECHO_URL` (default
 * http://localhost:8787/v1). When the echo server isn't reachable, the four
 * AI-loop tests skip with a clear message — that's a precondition, not a bug.
 *
 * @see docs/email-ai-redesign/FOLLOWUP.md §12
 */
import { test, expect } from "./_prod-fixtures";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SHOTS = join(process.cwd(), "tests", "electron", "__screenshots__");
mkdirSync(SHOTS, { recursive: true });

const ECHO_URL = process.env.OPENBUDDY_ECHO_URL ?? "http://localhost:8787/v1";

/** Cheap probe — `/v1/models` is the OpenAI-compatible health check. */
async function isEchoReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${ECHO_URL.replace(/\/v1$/, "")}/v1/models`, {
      method: "GET",
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Mock the capability-email IPC channels the EmailAiPanel talks to. Runs in
 * the **main process** via `electronApp.evaluate()`, so the bundled handlers
 * are removed and replaced with deterministic test fixtures. The renderer
 * never sees the swap — it just observes fast, in-memory responses.
 *
 * Note: this does NOT mock the AI layer (`routePrompt`). That runs through
 * the echo provider — see the file-level docstring.
 */
async function installProdEmailMock(
  electronApp: import("@playwright/test").ElectronApplication,
): Promise<void> {
  await electronApp.evaluate(async ({ ipcMain }) => {
    interface MockAccount {
      id: string;
      address: string;
      name: string;
      status: string;
    }
    interface MockThread {
      id: string;
      subject: string;
      from: { name: string; address: string };
      snippet: string;
      unread: boolean;
      labels: string[];
      receivedAt: string;
    }

    const accounts: MockAccount[] = [
      { id: "acct-prod", address: "demo@openbuddy.local", name: "Demo User", status: "connected" },
    ];
    const threads: MockThread[] = [
      {
        id: "t-prod-1",
        subject: "[重要] 季度评审 deadline",
        from: { name: "Boss", address: "boss@openbuddy.local" },
        snippet: "周五前请把进度表发过来",
        unread: true,
        labels: ["inbox", "important"],
        receivedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      },
      {
        id: "t-prod-2",
        subject: "Re: AI 草稿确认",
        from: { name: "同事", address: "colleague@openbuddy.local" },
        snippet: "看起来不错,需要回一下确认",
        unread: true,
        labels: ["inbox"],
        receivedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
      },
      {
        id: "t-prod-3",
        subject: "Weekly digest",
        from: { name: "Newsletter", address: "noreply@openbuddy.local" },
        snippet: "本周 newsletter,内容概要",
        unread: false,
        labels: ["inbox"],
        receivedAt: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
      },
    ];

    function rebind(channel: string, handler: (...args: unknown[]) => unknown): void {
      try { ipcMain.removeHandler(channel); } catch { /* not registered yet */ }
      ipcMain.handle(channel, handler);
    }

    rebind("email:accounts", () => accounts);
    rebind("email:threads", (_e: unknown, input?: { folder?: string }) => {
      if (input?.folder && input.folder !== "inbox") return [];
      return threads;
    });
    rebind("email:counts", () => ({ inbox: 3, unread: 2, snoozed: 0, done: 0 }));
    rebind("email:plan", () => ({
      planId: "plan-prod-1",
      actions: [
        { kind: "archive", threadIds: ["t-prod-3"] },
        { kind: "draft-reply", threadId: "t-prod-2", body: "好的,我确认下。" },
      ],
    }));
    rebind("email:execute", () => ({
      results: [
        { threadId: "t-prod-3", ok: true },
        { threadId: "t-prod-2", ok: true, draftId: "draft-prod-2" },
      ],
    }));
    rebind("email:undo", () => ({ restored: ["t-prod-2", "t-prod-3"] }));
    rebind("email:summary", (_e: unknown, input?: { threadId?: string }) => {
      const tid = input?.threadId ?? "t-prod-1";
      return {
        threadId: tid,
        summary: `${tid} 的 AI 摘要:关键事项已列出。`,
        nextSteps: ["确认 deadline", "回复 draft"],
      };
    });
  });
}

/** Capture a console-line buffer so failed assertions have something to point at. */
function attachConsoleSink(page: import("@playwright/test").Page): string[] {
  const buf: string[] = [];
  page.on("console", (msg) => {
    buf.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    buf.push(`[pageerror] ${err.message}`);
  });
  return buf;
}

async function snapOnFailure(
  testInfo: import("@playwright/test").TestInfo,
  page: import("@playwright/test").Page,
): Promise<void> {
  if (testInfo.status !== "passed" && testInfo.status !== "skipped") {
    const shot = join(SHOTS, `${testInfo.title.replace(/[^a-z0-9-]+/gi, "_")}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {
      /* window may already be down */
    });
    testInfo.attachments.push({
      name: shot,
      path: shot,
      contentType: "image/png",
    });
  }
}

/** Click sidebar → email slot → wait for the shell to mount. Idempotent. */
async function enterEmailSlot(
  page: import("@playwright/test").Page,
  electronApp: import("@playwright/test").ElectronApplication,
): Promise<void> {
  await installProdEmailMock(electronApp);
  if (await page.locator(".ai-inbox-shell").count() === 0) {
    const emailNav = page.locator("button").filter({ hasText: "邮件" }).first();
    await expect(emailNav).toBeVisible({ timeout: 30_000 });
    await emailNav.click();
  }
  await expect(page.locator(".ai-inbox-shell").first()).toBeVisible({ timeout: 30_000 });
  // Give useEmailData a tick to drain the (mocked) capability-email IPC.
  await page.waitForTimeout(800);
}

test.describe("email AI closed loop (production build)", () => {
  test.afterEach(async ({ page }, testInfo) => {
    await snapOnFailure(testInfo, page);
  });

  test("1) .app 进程存活且 renderer 已 mount", async ({ page, electronApp }) => {
    const consoleBuf = attachConsoleSink(page);
    const ver = await electronApp.evaluate(() => process.versions.electron);
    expect(typeof ver).toBe("string");
    expect(ver.length).toBeGreaterThan(0);
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    // Surface any unexpected console errors in the test output (informational).
    expect(consoleBuf.filter((l) => l.startsWith("[error]") || l.startsWith("[pageerror]"))).toEqual([]);
  });

  test("2) onboarding 种子生效,wizard 不可见", async ({ page }) => {
    // The fixture already seeds localStorage before this test runs. We just
    // verify the wizard is gone — it's aria-modal in production and would
    // swallow pointer events aimed at the sidebar if it weren't.
    const wizard = page.locator('[data-testid="onboarding-wizard"]');
    await expect(wizard).toHaveCount(0);
  });

  test("3) sidebar 进入邮件 slot → EmailAiPanel(不是旧 EmailPanel)挂载", async ({ page, electronApp }) => {
    await enterEmailSlot(page, electronApp);
    // The new shell renders .ai-inbox-shell. The old EmailPanel uses a
    // different className (".email-panel") so this selector is a deliberate
    // regression guard against the slot accidentally re-binding the old panel.
    await expect(page.locator(".ai-inbox-shell").first()).toBeVisible({ timeout: 30_000 });
  });

  test("4) mock IPC threads 渲染 ≥ 3 行", async ({ page, electronApp }) => {
    await enterEmailSlot(page, electronApp);
    const rows = await page.locator('[data-testid^="thread-row-"]').count();
    expect(rows).toBeGreaterThanOrEqual(3);
  });

  test("5) 启动 2s 后自动 triage:chip 出现在行内", async ({ page, electronApp }) => {
    if (!(await isEchoReachable())) {
      test.skip(true, `echo provider not reachable at ${ECHO_URL} — triage runs through bindings.routePrompt, not IPC. Start with scripts/electron/launch-real-evals-echo.mjs`);
      return;
    }
    await enterEmailSlot(page, electronApp);
    // P2-2 contract: triage fires 2s after mount. Echo adds ~1s; give it 6s ceiling.
    await expect(page.locator(".ai-chip").first()).toBeVisible({ timeout: 6_000 });
    const chipCount = await page.locator(".ai-chip").count();
    expect(chipCount).toBeGreaterThan(0);
  });

  test("6) 多选两条:Cmd+click 触发 batch bar(纯 UI 状态)", async ({ page, electronApp }) => {
    // batch bar visibility is gated on `multi.selectedCount > 0` — pure UI state,
    // so this works WITHOUT the echo provider. Useful regression guard for the
    // multiselect hook even on hosts without the AI layer.
    await enterEmailSlot(page, electronApp);
    const checks = page.locator('[data-testid^="thread-check-"]');
    await checks.nth(0).click({ modifiers: ["Meta"] });
    await checks.nth(1).click({ modifiers: ["Meta"] });
    await expect(page.locator(".ai-inbox-shell__batch-bar")).toBeVisible({ timeout: 5_000 });
    const count = await page.locator(".ai-inbox-shell__batch-count").textContent();
    expect(count ?? "").toContain("2");
  });

  test("7) 点 batch-plan → AiActionPlanStrip 渲染 + 接受按钮 enabled", async ({ page, electronApp }) => {
    if (!(await isEchoReachable())) {
      test.skip(true, `echo provider not reachable at ${ECHO_URL} — handleBatchPlan → routePrompt. Start with scripts/electron/launch-real-evals-echo.mjs`);
      return;
    }
    await enterEmailSlot(page, electronApp);
    const checks = page.locator('[data-testid^="thread-check-"]');
    await checks.nth(0).click({ modifiers: ["Meta"] });
    await checks.nth(1).click({ modifiers: ["Meta"] });
    await page.locator('[data-testid="batch-plan"]').click();
    await expect(page.locator(".ai-action-strip").first()).toBeVisible({ timeout: 15_000 });
    const acceptBtn = page.locator(".ai-action-strip__btn-primary").first();
    await expect(acceptBtn).toBeEnabled({ timeout: 5_000 });
  });

  test("8) 接受 plan → ReceiptToast 出现 + 倒计时", async ({ page, electronApp }) => {
    if (!(await isEchoReachable())) {
      test.skip(true, `echo provider not reachable at ${ECHO_URL} — execute action runs via AI routePrompt. Start with scripts/electron/launch-real-evals-echo.mjs`);
      return;
    }
    await enterEmailSlot(page, electronApp);
    const checks = page.locator('[data-testid^="thread-check-"]');
    await checks.nth(0).click({ modifiers: ["Meta"] });
    await checks.nth(1).click({ modifiers: ["Meta"] });
    await page.locator('[data-testid="batch-plan"]').click();
    await expect(page.locator(".ai-action-strip").first()).toBeVisible({ timeout: 15_000 });
    await page.locator(".ai-action-strip__btn-primary").first().click();
    const toast = page.locator(".ai-receipt-toast").first();
    await expect(toast).toBeVisible({ timeout: 15_000 });
    // Countdown text — ReceiptToast renders a "30s 内可撤销" hint in zh-CN.
    const toastText = await toast.textContent();
    expect(toastText ?? "").toMatch(/\d+s|撤销|undo/i);
  });

  test("9) 点撤销 → 行回到收件箱", async ({ page, electronApp }) => {
    if (!(await isEchoReachable())) {
      test.skip(true, `echo provider not reachable at ${ECHO_URL} — undo path requires executed plan. Start with scripts/electron/launch-real-evals-echo.mjs`);
      return;
    }
    await enterEmailSlot(page, electronApp);
    const before = await page.locator('[data-testid^="thread-row-"]').count();
    expect(before).toBeGreaterThanOrEqual(3);

    const checks = page.locator('[data-testid^="thread-check-"]');
    await checks.nth(0).click({ modifiers: ["Meta"] });
    await checks.nth(1).click({ modifiers: ["Meta"] });
    await page.locator('[data-testid="batch-plan"]').click();
    await expect(page.locator(".ai-action-strip").first()).toBeVisible({ timeout: 15_000 });
    await page.locator(".ai-action-strip__btn-primary").first().click();
    await expect(page.locator(".ai-receipt-toast").first()).toBeVisible({ timeout: 15_000 });

    // Undo via the dedicated button — must come back to 3 rows.
    await page.locator('[data-testid="receipt-undo"]').click();
    await expect
      .poll(async () => page.locator('[data-testid^="thread-row-"]').count(), { timeout: 15_000 })
      .toBe(before);
  });

  test("10) .app 健康指标:windows / process / version 都正常", async ({ electronApp }) => {
    // 0-source-change friendly exit check: confirm a single healthy window,
    // a non-zero Electron version, and that the main process is still
    // responsive. We deliberately do NOT call electronApp.close() here —
    // the fixture handles teardown via its `afterEach`-equivalent, and a
    // double-close races with the snap-on-failure screenshot.
    const windows = electronApp.windows();
    expect(windows.length).toBeGreaterThan(0);
    const ver = await electronApp.evaluate(() => process.versions.electron);
    expect(ver.length).toBeGreaterThan(0);
    // Main process still answers evaluate() — proves no stuck helper process
    // is the only thing keeping the .app alive.
    const pid = await electronApp.evaluate(() => process.pid);
    expect(typeof pid).toBe("number");
    expect(pid).toBeGreaterThan(0);
  });
});
