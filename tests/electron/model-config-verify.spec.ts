/**
 * model-config-verify.spec.ts — Real Electron end-to-end test of the
 * model configuration flow on the current main branch.
 *
 * Reproduces the P0 bug (saveProvider not wired in the facade) by
 * driving the renderer to add the Orcarouter provider via the UI,
 * then asserting that the on-disk `~/.pi/agent/models.json` actually
 * contains the new entry. If the file is empty after Save, the bug
 * is reproduced in main; Phase 0 in the worktree is the fix.
 */
import { test, expect } from "./_fixtures";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

test.describe.serial("model configuration — real Electron end-to-end (main branch, P0 repro)", () => {
  test("saving a provider through the Settings UI persists to models.json (AC-0.1 / P0 bug repro)", async ({ page }) => {
    // Read the user-data dir from the harness-injected path. The fixture
    // launches Electron with --user-data-dir=$(mkdtempSync) so the
    // isolated ~/.pi/agent/models.json path is stable for this test.
    const userDataPath = await page.evaluate(() => {
      const a = (window as unknown as { openbuddy?: unknown }).openbuddy;
      // We don't have direct access from the renderer; instead, look
      // for the path via a side-channel: Electron's process.versions
      // and the userData are exposed via the chrome devtools URL.
      return null;
    });
    // The fixture creates `userData = mkdtempSync(...openbuddy-e2e-)`
    // which becomes $TMPDIR/openbuddy-e2e-XXXXXX/pi-agent/models.json.
    // We can grab it via `process.env.TMPDIR` since playwright runs in
    // the same Node process as the fixture's mkdtempSync.
    const tmpdir = process.env.TMPDIR ?? "/tmp";
    // Find the most recently created openbuddy-e2e- directory.
    const { readdirSync, statSync } = await import("node:fs");
    const candidates = readdirSync(tmpdir)
      .filter((n: string) => n.startsWith("openbuddy-e2e-"))
      .map((n: string) => ({ name: n, mtime: statSync(join(tmpdir, n)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (candidates.length === 0) throw new Error("could not find fixture's user-data dir");
    const latest = join(tmpdir, candidates[0].name);
    const modelsPath = join(latest, "pi-agent", "models.json");
    console.log("DEBUG models.json path:", modelsPath);

    // Open Settings → 模型
    const settingsBtn = page.getByRole("button", { name: /设置|preferences/i }).first();
    await settingsBtn.click();
    await page.waitForTimeout(500);
    const modelNav = page.getByRole("button", { name: /^模型$/ }).first();
    await modelNav.click();
    await page.waitForTimeout(500);

    // Open the 添加厂商 dialog
    const addProviderBtn = page.getByRole("button", { name: /添加厂商/ }).first();
    await addProviderBtn.click();
    await page.waitForTimeout(500);

    // Pick Orcarouter from the select. The PRESETS table contains it.
    const kindSelect = page.locator("select").first();
    await kindSelect.selectOption("orcarouter");
    await page.waitForTimeout(300);

    // The base URL is pre-filled by the preset for Orcarouter; the API
    // key field needs filling for canSave to be true. The field uses
    // a placeholder ("sk-orca-...") rather than a real <label>, so
    // target by placeholder instead of getByLabel.
    const apiKeyInput = page.getByPlaceholder(/^sk-orca/);
    await apiKeyInput.waitFor({ state: "visible" });
    await apiKeyInput.fill("e2e-verify-key");

    const beforeExists = existsSync(modelsPath);
    console.log("DEBUG before-save file exists:", beforeExists);

    // Click 保存 — use the class selector to bypass the click-detach
    // race (the button re-renders when canSave flips from false to true).
    const saveBtn = page.locator(".models-settings-panel__editor-save");
    await saveBtn.waitFor({ state: "visible" });
    // Ensure it is enabled.
    const isDisabled = await saveBtn.isDisabled();
    console.log("DEBUG save button disabled:", isDisabled);
    await saveBtn.click();
    await page.waitForTimeout(2500);

    const afterExists = existsSync(modelsPath);
    console.log("DEBUG after-save file exists:", afterExists);
    if (afterExists) {
      const content = readFileSync(modelsPath, "utf8");
      console.log("DEBUG models.json (first 400 chars):", content.slice(0, 400));
      try {
        const parsed = JSON.parse(content) as { providers?: Record<string, unknown> };
        console.log("DEBUG providers keys:", Object.keys(parsed.providers ?? {}));
      } catch (err) {
        console.log("DEBUG models.json parse failed:", (err as Error).message);
      }
    } else {
      console.log("DEBUG models.json DOES NOT EXIST after Save — P0 BUG REPRODUCED");
    }

    // The assertion: Orcarouter must be present in providers map.
    if (!afterExists) {
      throw new Error("P0 bug reproduced: models.json was NOT created by the Save action. The saveProvider IPC handler is unwired in the AgentHostFacade (declared but not implemented).");
    }
    const content = readFileSync(modelsPath, "utf8");
    const parsed = JSON.parse(content) as { providers?: Record<string, unknown> };
    expect(parsed.providers, "providers map should be present").toBeDefined();
    expect(
      Object.keys(parsed.providers ?? {}).some((k) => k === "orcarouter"),
      "orcarouter must appear in providers map (main branch has the unwired facade bug)",
    ).toBe(true);
  });
});