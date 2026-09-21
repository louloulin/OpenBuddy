// One-shot probe: drive the PACKAGED OpenBuddy.app via Playwright.
// Mirrors tests/electron/_fixtures.ts but points at the packaged binary so
// we exercise the same code path real users hit.
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = "/Users/louloulin/appx/OpenBuddy";
const APP_EXEC = join(
  ROOT,
  "release/mac-arm64/OpenBuddy.app/Contents/MacOS/OpenBuddy",
);

if (!process.env.OPENBUDDY_PROBE_NO_LAUNCH) {
  console.log(`[probe] launching packaged app: ${APP_EXEC}`);
  const userData = mkdtempSync(join(tmpdir(), "openbuddy-probe-"));
  const piAgentDir = join(userData, "pi-agent");
  mkdirSync(piAgentDir, { recursive: true });
  writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: {} }, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({}, null, 2)}\n`, { mode: 0o600 });

  const app = await electron.launch({
    args: [
      `--user-data-dir=${userData}`,
      ROOT,
      "--disable-gpu",
      "--no-sandbox",
    ],
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
  const window = await app.firstWindow();
  window.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({ text: msg.text(), location: msg.location() });
    }
  });
  window.on("pageerror", (err) => {
    consoleErrors.push({ text: `PAGE ERROR: ${err.message}`, location: { stack: err.stack } });
  });

  await window.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  await window.locator("#root").waitFor({ state: "attached", timeout: 30_000 });

  // Dismiss onboarding like the fixture does.
  await window.addInitScript((seed) => {
    try { globalThis.localStorage.setItem(seed.key, seed.value); } catch {}
  }, {
    key: "openbuddy.onboarding.state",
    value: JSON.stringify({ version: 1, status: "done", index: 0, steps: [], updatedAt: 0, completedAt: 0 }),
  });
  await window.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  await window.locator("#root").waitFor({ state: "attached", timeout: 30_000 });

  await window.screenshot({ path: "/Users/louloulin/.codex/visualizations/2026/09/21/01a0c1f8-2ad3-7cb3-9840-907fe43f8964/probe-onboarded.png", fullPage: false });

  // Probe renderer-side IPC bridge health (mirrors agent-workbench-core.spec.ts).
  const probe = await window.evaluate(async () => {
    const api = (window).api;
    const out = { hasApi: !!api, channels: {} };
    if (!api?.invoke) return out;
    const tryInvoke = async (channel, args) => {
      try { return { ok: true, value: await api.invoke(channel, args) }; }
      catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
    };
    out.channels["sessions:list"] = await tryInvoke("sessions:list", "/tmp");
    out.channels["workspace:list"] = await tryInvoke("workspace:list");
    out.channels["mcp:list"] = await tryInvoke("mcp:list");
    out.channels["agent:auth-status"] = await tryInvoke("agent:auth-status");
    out.channels["agent:commands-list"] = await tryInvoke("agent:commands-list");
    out.channels["agent:tools-list"] = await tryInvoke("agent:tools-list");
    out.channels["harness:recovery-status"] = await tryInvoke("harness:recovery-status");
    return out;
  });

  await window.screenshot({ path: "/Users/louloulin/.codex/visualizations/2026/09/21/01a0c1f8-2ad3-7cb3-9840-907fe43f8964/probe-final.png", fullPage: false });

  console.log("=== probe result ===");
  console.log(JSON.stringify(probe, null, 2));
  console.log("=== renderer errors ===");
  console.log(JSON.stringify(consoleErrors, null, 2));

  await app.close();
  console.log("[probe] done");
}
