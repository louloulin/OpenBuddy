/**
 * email-unsubscribe-dialog — visual regression for the workbuddy-style
 * confirmation surface.
 *
 * Before this test, the unsanctioned `email:unsubscribe` IPC handler
 * unconditionally called `dialog.showMessageBox`, which produced the
 * unsightly native macOS / GTK confirmation dialog (heavy black frame,
 * system font, generic icon). The renderer-side `ConfirmDialog` was
 * already in place but the user still saw two stacked dialogs.
 *
 * This test pins the post-fix contract:
 *   - The renderer-side workbuddy `ConfirmDialog` opens with the
 *     `request-modal` class hierarchy and the Chinese eyebrow text.
 *   - The native Electron message box never appears.
 *   - Invoking `email:unsubscribe` without `confirmed: true` returns a
 *     structured `confirmation_required` error from the IPC handler.
 */
import { expect, test } from "./_fixtures";

async function invoke<T>(page: import("@playwright/test").Page, channel: string, args?: unknown): Promise<T> {
  return page.evaluate(
    async ({ channel, args }: { channel: string; args?: unknown }) => {
      const api = (window as unknown as { api?: { invoke: (channel: string, args?: unknown) => Promise<unknown> } }).api;
      if (!api?.invoke) throw new Error(`renderer bridge unavailable for ${channel}`);
      return api.invoke(channel, args) as unknown;
    },
    { channel, args },
  ) as Promise<T>;
}

async function invokeOrReject(page: import("@playwright/test").Page, channel: string, args?: unknown): Promise<{ ok: boolean; value: unknown }> {
  try {
    const value = await invoke<unknown>(page, channel, args);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, value: error instanceof Error ? error.message : String(error) };
  }
}

test.describe("email unsubscribe dialog UI", () => {
  test("email:unsubscribe without confirmed flag surfaces confirmation_required error", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    // The handler must reject any unsanctioned call with a structured
    // error code instead of opening the legacy native dialog.
    const result = await invokeOrReject(page, "email:unsubscribe", { accountId: "a1", messageId: "m1", threadId: "t1" });
    expect(result.ok).toBe(false);
    expect(String(result.value)).toMatch(/confirmation_required|必须经过确认/);
  });

  test("legacy native dialog channels are retired (no handler)", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    // dialog:ask / dialog:confirm / dialog:message previously routed to
    // `dialog.showMessageBox` and produced the ugly native popup. They
    // were retired; the renderer now owns confirmation through the
    // workbuddy `ConfirmDialog`. Each retired channel must therefore be
    // missing from the IPC registry.
    for (const channel of ["dialog:ask", "dialog:confirm", "dialog:message"]) {
      const result = await invokeOrReject(page, channel, { message: "x" });
      expect(result.ok, `expected ${channel} to reject; got ${JSON.stringify(result.value)}`).toBe(false);
      expect(String(result.value)).toMatch(/no handler|not found|removed/i);
    }
  });

  test("workbuddy ConfirmDialog class hierarchy is mounted by the renderer", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    // Trigger the global confirm store directly through the same code
    // path `await confirm(...)` uses. We can't easily trigger the email
    // unsubscribe flow without an account, but we can verify the host
    // mounts and renders the workbuddy `ConfirmDialog` for any pending
    // request.
    const initialCount = await page.locator(".request-modal").count();
    expect(initialCount).toBe(0);
    await page.evaluate(async () => {
      const { useGlobalConfirmStore } = await import("/src/stores/global-confirm-store.ts");
      // Fire-and-forget so the renderer paints the dialog before we
      // resolve it on the next microtask.
      void useGlobalConfirmStore.getState().show({ title: "测试弹框" });
    });
    const dialog = page.locator(".request-modal").first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // The dialog must use the workbuddy style hook — the same one the
    // rest of the openbuddy UI uses for confirmations.
    const classNames = await dialog.evaluate((el) => (el as HTMLElement).className);
    expect(classNames).toMatch(/request-modal--confirm/);
    await expect(page.locator(".request-modal__title").first()).toHaveText("测试弹框");
    await expect(page.locator(".request-modal__eyebrow").first()).toBeVisible();
  });
});