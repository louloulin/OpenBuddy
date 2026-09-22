// Probe the FRESHLY REBUILT DMG's app to verify the brace-expansion fix
// is shipped and the app stays healthy through deeper UI interactions.
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP_EXEC = "/Volumes/OpenBuddy 0.16.0-arm64/OpenBuddy.app/Contents/MacOS/OpenBuddy";
const ROOT = "/Users/louloulin/appx/OpenBuddy";
const SHOT_DIR = "/Users/louloulin/.codex/visualizations/2026/09/21/01a0c1f8-2ad3-7cb3-9840-907fe43f8964";

const userData = mkdtempSync(join(tmpdir(), "openbuddy-dmg-probe-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: {} }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({}, null, 2)}\n`, { mode: 0o600 });

console.log(`[dmg-probe] launching: ${APP_EXEC}`);
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT, "--disable-gpu", "--no-sandbox"],
  executablePath: APP_EXEC,
  cwd: ROOT,
  timeout: 30_000,
  env: {
    ...process.env,
    PI_CODING_AGENT_DIR: piAgentDir,
    OPENBUDDY_DEBUG_UI: "0",
    OPENBUDDY_HARNESS_FILE: "",
    ELECTRON_ENABLE_LOGGING: "1",
  },
});

const consoleErrors = [];
const consoleWarns = [];
const window = await app.firstWindow();
window.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push({ text: msg.text().slice(0, 500) });
  if (msg.type() === "warning") consoleWarns.push({ text: msg.text().slice(0, 300) });
});
window.on("pageerror", (err) => consoleErrors.push({ text: `PAGE ERROR: ${err.message.slice(0, 500)}` }));

await window.waitForLoadState("domcontentloaded", { timeout: 30_000 });
await window.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
await window.addInitScript((seed) => {
  try { globalThis.localStorage.setItem(seed.key, seed.value); } catch {}
}, {
  key: "openbuddy.onboarding.state",
  value: JSON.stringify({ version: 1, status: "done", index: 0, steps: [], updatedAt: 0, completedAt: 0 }),
});
await window.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
await window.locator("#root").waitFor({ state: "attached", timeout: 30_000 });

await window.screenshot({ path: `${SHOT_DIR}/dmg-01-home.png` });

// Click through every visible nav item; capture screenshot after each.
const navTargets = [
  "对话", "工作台", "插件", "市场", "邮件", "协作", "设置",
  "Chat", "Workbench", "Plugins", "Marketplace", "Email", "Collab", "Settings",
];
const visited = [];
for (const text of navTargets) {
  try {
    const loc = window.locator(`text="${text}"`).first();
    if (await loc.isVisible({ timeout: 800 })) {
      await loc.click({ timeout: 4000 }).catch((e) => console.warn(`click ${text} failed: ${e.message.slice(0,120)}`));
      await window.waitForTimeout(1200);
      visited.push(text);
    }
  } catch {}
}
console.log("=== visited panels ===");
console.log(JSON.stringify(visited, null, 2));

// Probe key IPC channels.
const ipc = await window.evaluate(async () => {
  const api = (window).api;
  const tryInvoke = async (channel, args) => {
    try { return { ok: true, value: await api.invoke(channel, args) }; }
    catch (e) { return { ok: false, error: String(e?.message ?? e).slice(0, 200) }; }
  };
  return {
    sessionsList: await tryInvoke("sessions:list", "/tmp"),
    workspaceList: await tryInvoke("workspace:list"),
    agentCommandsList: await tryInvoke("agent:commands-list"),
    agentAuthStatus: await tryInvoke("agent:auth-status"),
    mcpStatus: await tryInvoke("mcp:status"),
    agentToolsList: await tryInvoke("agent:tools-list"),
    harnessRecoveryStatus: await tryInvoke("harness:recovery-status"),
    subagentsGetConfig: await tryInvoke("subagents:get-config"),
  };
});
console.log("=== IPC health ===");
console.log(JSON.stringify(ipc, null, 2));

// Check tour overlay state in DOM.
const tourState = await window.evaluate(() => {
  return {
    tourModalPresent: !!document.querySelector('[data-testid="tour-modal"]'),
    tourSpotlightPresent: !!document.querySelector('[data-testid="tour-spotlight"]'),
    onboardingWizardPresent: !!document.querySelector('[data-testid="onboarding-wizard"]'),
    tourState: window.localStorage.getItem("openbuddy.tour.state"),
    onboardingState: window.localStorage.getItem("openbuddy.onboarding.state"),
  };
});
console.log("=== tour/onboarding state ===");
console.log(JSON.stringify(tourState, null, 2));

await window.screenshot({ path: `${SHOT_DIR}/dmg-99-final.png` });

console.log(`=== renderer errors: ${consoleErrors.length} ===`);
if (consoleErrors.length) console.log(JSON.stringify(consoleErrors.slice(0, 10), null, 2));
console.log(`=== renderer warnings: ${consoleWarns.length} ===`);
if (consoleWarns.length) console.log(JSON.stringify(consoleWarns.slice(0, 10), null, 2));

await app.close();
console.log("[dmg-probe] done");
