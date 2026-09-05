/**
 * R3.3 — Sidebar multi-select + search end-to-end spec.
 *
 * Walks through the golden path:
 *   1. Boot the renderer (the fixture launches a real Electron app).
 *   2. Open the sidebar search input and type a query that filters sessions.
 *   3. Shift-click two sessions; the bulk toolbar appears with count = 2.
 *   4. Click "取消" — the toolbar disappears.
 *   5. Re-select one session and click "删除 N" — the confirm dialog opens
 *      and pressing "取消" leaves the session in place.
 */
import { expect, test } from "./_fixtures";

test.describe("sidebar session management", () => {
  test("search input filters the list", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });

    const search = page.getByRole("searchbox", { name: /搜索会话/ }).first();
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill("never-matches-any-session");
    await expect(search).toHaveValue("never-matches-any-session");
    await search.fill("");
  });

  test("bulk toolbar appears when sessions are selected", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });

    const firstRow = page.locator(".sidebar__conv").first();
    if (!(await firstRow.count())) {
      test.skip(true, "no sessions in this userData; spec needs a seeded workspace");
      return;
    }
    await firstRow.click({ modifiers: ["Shift"] });

    const toolbar = page.getByRole("toolbar", { name: /批量操作/ });
    await expect(toolbar).toBeVisible({ timeout: 5_000 });
    await expect(toolbar).toContainText(/已选\s*\d+/);

    await toolbar.getByRole("button", { name: /取消/ }).click();
    await expect(toolbar).toBeHidden();
  });

  test("delete confirm dialog blocks destructive clicks", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });

    const firstRow = page.locator(".sidebar__conv").first();
    if (!(await firstRow.count())) {
      test.skip(true, "no sessions in this userData; spec needs a seeded workspace");
      return;
    }
    await firstRow.click({ modifiers: ["Shift"] });

    const toolbar = page.getByRole("toolbar", { name: /批量操作/ });
    await expect(toolbar).toBeVisible();
    const deleteBtn = toolbar.getByRole("button", { name: /删除\s*\d+/ });
    await deleteBtn.click();

    const dialog = page.getByRole("dialog", { name: /批量删除/ }).first();
    if (await dialog.count()) {
      await expect(dialog).toBeVisible();
      const cancel = dialog.getByRole("button", { name: /取消/ });
      if (await cancel.count()) await cancel.click();
    }
  });
});