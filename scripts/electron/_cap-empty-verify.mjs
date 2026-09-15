import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ev-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(3000);
await page.setViewportSize({ width: 1728, height: 1091 });
await page.waitForTimeout(1500);

// Try to create a fresh session directly via API/store
// Use the sidebar's create new session flow
const sessionCreated = await page.evaluate(async () => {
  // Try invoking the IPC API
  if (window.api?.sessions?.create) {
    try {
      const r = await window.api.sessions.create();
      return { ok: true, result: r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  return { ok: false, error: 'no api' };
});
console.log("sessionCreated:", JSON.stringify(sessionCreated));

await page.waitForTimeout(2000);

// Now check if chatview exists and has empty state
const m = await page.evaluate(() => {
  const cv = document.querySelector('.chatview');
  if (!cv) return { chatviewExists: false };
  return {
    chatviewExists: true,
    chatviewRect: (() => { const r = cv.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; })(),
    emptyState: !!document.querySelector('.chatview__empty-state'),
    emptyStateRect: (() => { const el = document.querySelector('.chatview__empty-state'); if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; })(),
    timelineLen: cv.querySelector('.chatview__inner')?.children.length || 0,
  };
});
console.log(JSON.stringify(m, null, 2));
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-chat-empty-verify.png" });
await app.close();
