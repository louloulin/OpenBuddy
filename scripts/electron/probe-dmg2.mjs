// DMG probe v2 — no reload, longer wait, more channels
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP_EXEC = "/Volumes/OpenBuddy 0.15.0-arm64/OpenBuddy.app/Contents/MacOS/OpenBuddy";
const ROOT = "/Users/louloulin/appx/OpenBuddy";
const SHOT_DIR = "/Users/louloulin/.codex/visualizations/2026/09/21/01a0c1f8-2ad3-7cb3-9840-907fe43f8964";

const userData = mkdtempSync(join(tmpdir(), "openbuddy-dmg2-probe-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: {} }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({}, null, 2)}\n`, { mode: 0o600 });

console.log(`[dmg-probe2] launching: ${APP_EXEC}`);
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

// Wait long enough for any async failures to surface.
await window.waitForTimeout(8000);

await window.screenshot({ path: `${SHOT_DIR}/dmg2-01-home.png` });

const tourState = await window.evaluate(() => {
  return {
    tourModalPresent: !!document.querySelector('[data-testid="tour-modal"]'),
    tourSpotlightPresent: !!document.querySelector('[data-testid="tour-spotlight"]'),
    onboardingWizardPresent: !!document.querySelector('[data-testid="onboarding-wizard"]'),
    tourState: window.localStorage.getItem("openbuddy.tour.state"),
    onboardingState: window.localStorage.getItem("openbuddy.onboarding.state"),
    bodyClass: document.body.className,
    rootHtmlSample: document.querySelector("#root")?.innerHTML?.slice(0, 300),
  };
});
console.log("=== tour/onboarding state ===");
console.log(JSON.stringify(tourState, null, 2));

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
  };
});
console.log("=== IPC health ===");
console.log(JSON.stringify(ipc, null, 2));

// Click "邮件" / "Email" sidebar item if present.
for (const text of ["邮件", "Email", "对话", "设置", "插件"]) {
  try {
    const loc = window.locator(`text="${text}"`).first();
    if (await loc.isVisible({ timeout: 1000 })) {
      console.log(`clicking "${text}"...`);
      await loc.click({ timeout: 5000 });
      await window.waitForTimeout(2000);
      await window.screenshot({ path: `${SHOT_DIR}/dmg2-click-${text}.png` });
    }
  } catch (e) {
    console.warn(`click "${text}" failed: ${e.message.slice(0, 200)}`);
  }
}

await window.screenshot({ path: `${SHOT_DIR}/dmg2-99-final.png` });

console.log(`=== renderer errors: ${consoleErrors.length} ===`);
if (consoleErrors.length) console.log(JSON.stringify(consoleErrors.slice(0, 10), null, 2));
console.log(`=== renderer warnings: ${consoleWarns.length} ===`);
if (consoleWarns.length) console.log(JSON.stringify(consoleWarns.slice(0, 10), null, 2));

await app.close();
console.log("[dmg-probe2] done");
