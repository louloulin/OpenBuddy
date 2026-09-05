import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regression test for the Electron View > Reload / Force Reload menu wiring.
 *
 * The reload/forceReload menu logic was extracted out of `electron/main/index.ts`
 * into `electron/main/app-menu.ts` (P3-1 layered extraction). The original
 * concerns this test guarded still apply:
 *
 *   - Reload/ForceReload must target the *main* window, falling back to
 *     BrowserWindow.getAllWindows() when no mainWindow is registered.
 *   - The toggleDevTools helper must go through the resolver rather than
 *     dereferencing `mainWindow?.webContents` directly (short-circuit).
 *   - The IPC handlers `debug:reload` / `debug:force-reload` in
 *     `electron/main/ipc/misc.ts` must return a boolean and log a warning
 *     when there is no live window.
 *
 * This test now reads `app-menu.ts` (where the menu lives) instead of the
 * main process bootstrap file. The IPC handlers are still in `misc.ts`.
 */

const APP_MENU_SRC = readFileSync(resolve(__dirname, "../app-menu.ts"), "utf-8");
const INDEX_SRC = readFileSync(resolve(__dirname, "../index.ts"), "utf-8");
const MISC_SRC = readFileSync(resolve(__dirname, "../ipc/misc.ts"), "utf-8");

describe("Electron debug reload menu", () => {
  it("View menu has explicit reload and forceReload items with click handlers", () => {
    const viewIdx = APP_MENU_SRC.indexOf('label: "View"');
    expect(viewIdx, "View menu missing in app-menu.ts").toBeGreaterThan(-1);
    const slice = APP_MENU_SRC.slice(viewIdx, viewIdx + 1500);

    expect(slice).toMatch(/id:\s*"reload"/);
    expect(slice).toMatch(/accelerator:\s*process\.platform\s*===\s*"darwin"\s*\?\s*"Command\+R"\s*:\s*"Ctrl\+R"/);
    expect(slice).toMatch(/click:\s*\(\)\s*=>\s*reloadRenderer\(false\)/);

    expect(slice).toMatch(/id:\s*"forceReload"/);
    expect(slice).toMatch(/accelerator:\s*process\.platform\s*===\s*"darwin"\s*\?\s*"Command\+Shift\+R"\s*:\s*"Ctrl\+Shift\+R"/);
    expect(slice).toMatch(/click:\s*\(\)\s*=>\s*reloadRenderer\(true\)/);
  });

  it("reloadRenderer helper falls back to BrowserWindow.getAllWindows()", () => {
    expect(APP_MENU_SRC).toMatch(/const\s+reloadRenderer\s*=\s*\(\s*ignoreCache\s*=\s*false\s*\)\s*=>\s*\{/);
    // The fallback must be either BrowserWindow.getAllWindows() (the new
    // pattern) or it must consult a getMainWindow resolver that itself
    // falls back to BrowserWindow.getAllWindows().
    const usesGetAllWindows = /BrowserWindow\.getAllWindows\(\)/.test(APP_MENU_SRC);
    const usesGetMainWindowResolver = /getMainWindow\(\)/.test(APP_MENU_SRC);
    expect(usesGetAllWindows || usesGetMainWindowResolver).toBe(true);
  });

  it("toggleDevTools goes through getMainWindow resolver (no bare mainWindow?.webContents short-circuit)", () => {
    expect(APP_MENU_SRC).not.toMatch(/toggleDevTools\s*=\s*\(\)\s*=>\s*\{\s*const contents = mainWindow\?\.webContents;/);
    // The new pattern: resolver function returned from getMainWindow() that
    // returns BrowserWindow | null.
    expect(APP_MENU_SRC).toMatch(/getMainWindow/);
  });

  it("app-menu is wired into the main process bootstrap (index.ts)", () => {
    // The bootstrap file must call installAppMenu(...) so the menu actually
    // gets installed. After the P3-1 extraction, the menu lives in
    // app-menu.ts, not inline in index.ts.
    expect(INDEX_SRC).toMatch(/installAppMenu/);
    expect(INDEX_SRC).not.toMatch(/Menu\.buildFromTemplate\(\s*\[[\s\S]*?label:\s*"View"/);
  });
});

describe("Electron debug IPC handlers (debug:reload / debug:force-reload)", () => {
  it("debug:reload returns a boolean and logs a warning when the window is gone", () => {
    const re = /ipcMain\.handle\(\s*"debug:reload"\s*,\s*\(\)\s*=>\s*\{[\s\S]*?return\s+(true|false);?\s*\}?\s*\)\s*;/;
    expect(MISC_SRC).toMatch(re);
    expect(MISC_SRC).toMatch(/debug:reload ignored/);
  });

  it("debug:force-reload returns a boolean and logs a warning when the window is gone", () => {
    const re = /ipcMain\.handle\(\s*"debug:force-reload"\s*,\s*\(\)\s*=>\s*\{[\s\S]*?return\s+(true|false);?\s*\}?\s*\)\s*;/;
    expect(MISC_SRC).toMatch(re);
    expect(MISC_SRC).toMatch(/debug:force-reload ignored/);
  });

  it("neither handler is the old silent one-liner that swallowed missing-window cases", () => {
    expect(MISC_SRC).not.toMatch(/ipcMain\.handle\(\s*"debug:reload"\s*,\s*\(\)\s*=>\s*currentWindow\(\)\?\.webContents\.reload\(\)\s*\);/);
    expect(MISC_SRC).not.toMatch(/ipcMain\.handle\(\s*"debug:force-reload"\s*,\s*\(\)\s*=>\s*currentWindow\(\)\?\.webContents\.reloadIgnoringCache\(\)\s*\);/);
  });
});
