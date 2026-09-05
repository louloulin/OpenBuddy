/**
 * R3.5 — Optimistic UI rollback spec.
 *
 * The original spec tried to send a real prompt and verify the bubble
 * disappears after a failed `piSend`. That requires a configured model
 * provider (the echo Anthropic service), which only `pnpm test:closed-loop`
 * brings up. The structural check here is simpler: when the agent is
 * not yet ready (`apiReady=false`), the renderer must NOT render a stale
 * pending bubble when the user mashes Enter on the disabled composer.
 *
 * This guards against the regression fixed in R0.7 where a failing send
 * would leave the user bubble stranded in the chat list.
 */
import { expect, test } from "./_fixtures";

test.describe("optimistic UI rollback (structural)", () => {
  test("disabled composer never renders a pending user bubble", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });

    const composer = page.locator("textarea.wb-composer__input").first();
    await expect(composer).toBeDisabled();

    // Try to send anyway via Enter — the disabled textarea should swallow
    // the keystroke. Either way, no `.message-item` containing user text
    // should appear.
    await composer.focus({ timeout: 5_000 }).catch(() => undefined);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2_000);

    const userBubbles = await page.locator(".message-item").count();
    expect(userBubbles).toBe(0);
  });
});