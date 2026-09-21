import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const APP_EXEC = "/Applications/OpenBuddy.app/Contents/MacOS/OpenBuddy";
const ROOT = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "openbuddy-installed-probe-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: {} }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({}, null, 2)}\n`, { mode: 0o600 });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT, "--disable-gpu", "--no-sandbox"],
  executablePath: APP_EXEC, cwd: ROOT, timeout: 30_000,
  env: { ...process.env, PI_CODING_AGENT_DIR: piAgentDir, OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_HARNESS_FILE: "", ELECTRON_ENABLE_LOGGING: "1" },
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
await window.waitForTimeout(5000);
// Skip wizard via storage seed + reload (same pattern as fixture)
await window.addInitScript((seed) => {
  try { globalThis.localStorage.setItem(seed.key, seed.value); } catch {}
}, { key: "openbuddy.onboarding.state", value: JSON.stringify({ version: 1, status: "done", index: 0, steps: [], updatedAt: 0, completedAt: 0 }) });
await window.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
await window.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
await window.waitForTimeout(3000);
const state = await window.evaluate(() => ({
  tourModalPresent: !!document.querySelector('[data-testid="tour-modal"]'),
  tourSpotlightPresent: !!document.querySelector('[data-testid="tour-spotlight"]'),
  onboardingWizardPresent: !!document.querySelector('[data-testid="onboarding-wizard"]'),
  tourState: window.localStorage.getItem("openbuddy.tour.state"),
  onboardingState: window.localStorage.getItem("openbuddy.onboarding.state"),
}));
console.log("STATE:", JSON.stringify(state, null, 2));
// Try clicking sidebar items
for (const text of ["对话", "工作台", "设置", "邮件", "插件", "市场", "协作"]) {
  try {
    const loc = window.locator(`text="${text}"`).first();
    if (await loc.isVisible({ timeout: 800 })) {
      await loc.click({ timeout: 4000 }).catch(() => {});
      await window.waitForTimeout(1000);
      console.log(`clicked: ${text}`);
    }
  } catch (e) { console.warn(`click ${text}: ${e.message.slice(0, 150)}`); }
}
console.log(`errors: ${consoleErrors.length}, warnings: ${consoleWarns.length}`);
if (consoleErrors.length) console.log(JSON.stringify(consoleErrors.slice(0, 10), null, 2));
if (consoleWarns.length) console.log(JSON.stringify(consoleWarns.slice(0, 10), null, 2));
await app.close();
