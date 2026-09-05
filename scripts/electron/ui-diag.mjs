// Real UI launch diagnostic — boots Electron, captures screenshots of every
// reachable surface, and reports renderer-side errors / warnings.

import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "openbuddy-ui-diag-"));
mkdirSync(join(userData, "pi-env.json") ? userData : userData, { recursive: true });

const electronBin = join(root, "node_modules", ".bin", "electron");
const outDir = "/tmp/openbuddy-ui-diag";

const consoleMessages = [];
const pageErrors = [];
const networkFailures = [];

const app = await electron.launch({
  executablePath: electronBin,
  args: ["out/main/index.js"],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1", OPENBUDDY_USER_DATA: userData },
});

const window = await app.firstWindow();
await window.waitForLoadState("domcontentloaded");
window.on("console", (msg) => {
  const text = msg.text();
  if (text.length > 800) return;
  consoleMessages.push({ type: msg.type(), text, at: Date.now() });
});
window.on("pageerror", (err) => {
  pageErrors.push({ message: err.message, stack: err.stack?.slice(0, 800), at: Date.now() });
});

await new Promise((r) => setTimeout(r, 4000)); // let renderer mount
mkdirSync(outDir, { recursive: true });
await window.screenshot({ path: join(outDir, "01-launch.png"), fullPage: true });
console.log("[01] launch captured");

// Sidebar entries (text)
const sidebarText = await window.locator("body").innerText();
console.log("[sidebar] sample:", sidebarText.slice(0, 500).replace(/\n/g, " | "));

// Try to click visible sidebar items
const candidates = ["新建会话", "New Session", "会话", "聊天", "自动化", "Automation", "设置", "Settings", "插件", "Plugins", "MCP"];
for (const label of candidates) {
  const el = window.locator(`text=${label}`).first();
  try {
    if (await el.count() > 0 && await el.isVisible()) {
      await el.click({ trial: true, timeout: 500 }).catch(() => {});
    }
  } catch {}
}

// Click sidebar items one by one and capture
const sidebarBtns = await window.locator(".sidebar button, nav button, [role='button']").all();
console.log(`[sidebar] found ${sidebarBtns.length} nav buttons`);
for (let i = 0; i < Math.min(sidebarBtns.length, 12); i++) {
  try {
    const btn = sidebarBtns[i];
    if (!(await btn.isVisible())) continue;
    const text = (await btn.innerText()).slice(0, 30);
    await btn.click({ timeout: 1000 }).catch((e) => console.log(`[click ${i}] ${text}: ${e.message.slice(0, 80)}`));
    await new Promise((r) => setTimeout(r, 600));
    await window.screenshot({ path: join(outDir, `02-sidebar-${i}-${text.replace(/[^a-z0-9]/gi, "_")}.png`) });
  } catch (e) {
    console.log(`[sidebar ${i}] err: ${e.message.slice(0, 80)}`);
  }
}

// Open the chat composer
const textarea = window.locator("textarea").first();
try {
  if (await textarea.count() > 0) {
    await textarea.click({ timeout: 2000 });
    await window.screenshot({ path: join(outDir, "03-composer-focused.png") });
  }
} catch (e) {
  console.log(`[composer] ${e.message.slice(0, 80)}`);
}

// Settings panel
for (const label of ["设置", "Settings"]) {
  const btn = window.locator(`button:has-text("${label}"), [role='tab']:has-text("${label}")`).first();
  if (await btn.count() > 0) {
    await btn.click().catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    await window.screenshot({ path: join(outDir, `04-settings.png`) });
  }
}

await new Promise((r) => setTimeout(r, 2000));

console.log("\n=== console messages (last 80) ===");
for (const m of consoleMessages.slice(-80)) {
  console.log(`[${m.type}] ${m.text.slice(0, 250)}`);
}
console.log("\n=== page errors ===");
for (const e of pageErrors) {
  console.log(`[pageerror] ${e.message}`);
}
console.log("\n=== network failures (probe) ===");

await app.close();
console.log(`\nscreenshots saved to ${outDir}`);
process.exit(0);