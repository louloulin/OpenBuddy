import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r15-sess-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(14_000);

// close onboarding
try { await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {}); } catch {}
await page.waitForTimeout(1500);

// Click "新建任务" via topbar
try {
  await page.click(".main-topbar__btn[aria-label='新建任务']");
  await page.waitForTimeout(4000);
} catch (e) { console.log('new task click failed:', String(e).slice(0, 100)); }

// Check session view state
const sessionState = await page.evaluate(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  return {
    pageErrors: window.__PAGE_ERRORS__ || [],
    title: document.querySelector(".main-topbar__title")?.textContent?.trim(),
    topbarActions: r(".main-topbar__action-menu, [data-tip='更多操作']"),
    composer: r(".composer, [data-composer], .composer-shell, [class*='Composer']"),
    chatView: r(".chatview, [data-chatview], .conversation, .chat, .chatview-host, [class*='ChatView']"),
    artifactTabsBar: r(".artifact-tabs-bar, [class*='ArtifactTabsBar'], .artifact-tabs"),
    artifactPreview: r(".artifact-preview, [class*='ArtifactPreview']"),
    activeSessionId: document.querySelector(".sidebar__conv--active")?.getAttribute("data-session-id"),
  };
});
console.log("SESSION:", JSON.stringify(sessionState, null, 2));

// Open theme picker
try {
  await page.click("[aria-label='切换主题']");
  await page.waitForTimeout(2000);
  const themePicker = await page.evaluate(() => {
    const picker = document.querySelector(".theme-picker, [class*='ThemePicker'], [class*='theme-menu']");
    if (!picker) return null;
    const r = picker.getBoundingClientRect();
    return { cls: picker.className.toString().slice(0, 60), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), items: Array.from(picker.querySelectorAll("[role='option'], button, [data-theme-name]")).length };
  });
  console.log("THEME PICKER:", JSON.stringify(themePicker, null, 2));
} catch (e) { console.log('theme picker click failed:', String(e).slice(0, 100)); }

await app.close();
process.exit(0);
