/**
 * test-connection-ui.spec.ts — R2.7 — Real Electron end-to-end test
 * for the renderer-side "Test connection" button in
 * ModelsSettingsPanel. Spins up the real Electron app, opens the
 * provider editor, picks Orcarouter, fills the API key, clicks
 * Test connection, and asserts the inline status indicator flips to
 * a non-idle / non-testing state.
 *
 * Locks in the **wiring** between the UI button and the
 * agent:providers-test IPC handler (already covered by
 * tests/electron/provider-test-ipc.spec.ts). Uses the real
 * orcarouter.ai host; any non-2xx response or network error is
 * accepted as long as the editor surfaces it.
 */
import { test, expect } from "./_fixtures";

test.describe("Test connection button — real Electron e2e", () => {
  test("clicking Test connection in the editor surfaces a non-idle status", async ({ page }) => {
    // Open Settings → 模型 → 添加厂商.
    await page.getByRole("button", { name: /设置|preferences/i }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /^模型$/ }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /添加厂商/ }).first().click();
    await page.waitForTimeout(500);

    // Pick Orcarouter. The baseUrl is pre-filled and disabled (the
    // preset has one); leave it as the default api.orcarouter.ai.
    await page.locator("select").first().selectOption("orcarouter");
    await page.waitForTimeout(300);
    await page.getByPlaceholder(/^sk-orca/).fill("ui-e2e-key");

    // The new Test connection button must be present and enabled.
    const testBtn = page.getByTestId("provider-test-button");
    await expect(testBtn).toBeVisible();
    await expect(testBtn).toBeEnabled();

    // Click it. Wait for transient "testing" to settle (IPC has a
    // 10s server-side timeout).
    await testBtn.click();
    const result = page.getByTestId("provider-test-result");
    await expect(result).toBeVisible({ timeout: 5_000 });
    await expect
      .poll(
        async () => result.getAttribute("data-status"),
        { timeout: 20_000, intervals: [500, 1000, 2000] },
      )
      .not.toBe("testing");
    const status = await result.getAttribute("data-status");
    console.log("DEBUG ui test status:", status, "text:", await result.textContent());
    expect(status).not.toBeNull();
    expect(status).not.toBe("idle");
    expect(["ok", "degraded", "unreachable", "error"]).toContain(status);
  });
});
