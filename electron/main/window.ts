/**
 * Custom titlebar helpers.
 *
 * Electron + the current OpenBuddy shell rely on `decorations: false` + a hand-drawn titlebar
 * (see `data-openbuddy.conf.json` + `src/components/Titlebar.tsx`). Electron's `titleBarStyle: "hidden"`
 * is the closest match, but we also need a `-webkit-app-region: drag` CSS hook so the existing
 * React titlebar component can opt parts of itself into dragging.
 *
 * `installDragRegion()` injects a `<style>` tag into the renderer that:
 *  1. Targets `[data-openbuddy-drag]` — the React titlebar root — with `drag` app-region
 *  2. Targets `[data-openbuddy-nodrag]` — child buttons / inputs — with `no-drag`
 *  3. Provides a CSS variable `--ob-titlebar-height` for the React side to consume
 *
 * The macOS overlay (traffic-light buttons) is handled by Electron's `titleBarOverlay`
 * option in `BrowserWindow` constructor; this function only adds the region CSS.
 */
import type { BrowserWindow } from "electron";

const DRAG_REGION_CSS = `
:root {
  --ob-titlebar-height: 32px;
}
[data-openbuddy-drag] {
  -webkit-app-region: drag;
  app-region: drag;
  height: var(--ob-titlebar-height);
}
[data-openbuddy-nodrag],
[data-openbuddy-nodrag] * {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}
`;

export function installDragRegion(win: BrowserWindow): void {
  win.webContents.on("did-finish-load", () => {
    win.webContents
      .executeJavaScript(
        `(() => {
          const id = "openbuddy-drag-region";
          if (document.getElementById(id)) return;
          const style = document.createElement("style");
          style.id = id;
          style.textContent = ${JSON.stringify(DRAG_REGION_CSS)};
          document.head.appendChild(style);
        })()`,
        true,
      )
      .catch((err) => {
        // Inject failed (renderer not ready, or contextIsolation blocked); the titlebar
        // still works via the native titleBarOverlay, just without the extra drag region CSS.
        console.warn("[openbuddy-pi] drag region injection failed:", err);
      });
  });
}