// Deep probe: drive packaged OpenBuddy.app through several UI flows and
// capture any console errors + screenshots. Goal: surface real bugs.
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = "/Users/louloulin/appx/OpenBuddy";
const APP_EXEC = join(ROOT, "release/mac-arm64/OpenBuddy.app/Contents/MacOS/OpenBuddy");
const SHOT_DIR = "/Users/louloulin/.codex/visualizations/2026/09/21/01a0c1f8-2ad3-7cb3-9840-907fe43f8964";

const userData = mkdtempSync(join(tmpdir(), "openbuddy-deep-probe-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: {} }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({}, null, 2)}\n`, { mode: 0o600 });

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
  if (msg.type() === "error") consoleErrors.push({ text: msg.text(), loc: msg.location() });
  if (msg.type() === "warning") consoleWarns.push({ text: msg.text().slice(0, 200) });
});
window.on("pageerror", (err) => consoleErrors.push({ text: `PAGE ERROR: ${err.message}` }));

await window.waitForLoadState("domcontentloaded", { timeout: 30_000 });
await window.locator("#root").waitFor({ state: "attached", timeout: 30_000 });

// Dismiss onboarding.
await window.addInitScript((seed) => {
  try { globalThis.localStorage.setItem(seed.key, seed.value); } catch {}
}, {
  key: "openbuddy.onboarding.state",
  value: JSON.stringify({ version: 1, status: "done", index: 0, steps: [], updatedAt: 0, completedAt: 0 }),
});
await window.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
await window.locator("#root").waitFor({ state: "attached", timeout: 30_000 });

const SHOT = (name) => window.screenshot({ path: `${SHOT_DIR}/deep-${name}.png`, fullPage: false });

// 1. Initial home view.
await window.waitForTimeout(2000);
await SHOT("01-home");

// 2. Survey interactive elements on the home page.
const homeDom = await window.evaluate(() => {
  const all = Array.from(document.querySelectorAll("[role=button], button, a[href], [data-testid]"));
  return {
    rootHasChildren: !!document.querySelector("#root")?.children.length,
    buttonCount: document.querySelectorAll("button").length,
    links: Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href") ?? a.textContent?.trim()).slice(0, 10),
    dataTestIds: Array.from(document.querySelectorAll("[data-testid]")).map((e) => e.getAttribute("data-testid")).slice(0, 20),
    titles: Array.from(document.querySelectorAll("h1,h2,h3,[role=heading]")).map((e) => e.textContent?.trim()).slice(0, 15),
    ariaLabels: Array.from(document.querySelectorAll("[aria-label]")).map((e) => e.getAttribute("aria-label")).slice(0, 20),
  };
});

console.log("=== home DOM survey ===");
console.log(JSON.stringify(homeDom, null, 2));

// 3. Try common sidebar / menu entries.
// The sidebar usually has nav items; click each by visible text if present.
const navTargets = [
  { text: "对话", name: "chat" },
  { text: "Chat", name: "chat-en" },
  { text: "工作台", name: "workbench" },
  { text: "Workbench", name: "workbench-en" },
  { text: "插件", name: "plugins" },
  { text: "Plugins", name: "plugins-en" },
  { text: "市场", name: "marketplace" },
  { text: "Marketplace", name: "marketplace-en" },
  { text: "邮件", name: "email" },
  { text: "Email", name: "email-en" },
  { text: "协作", name: "collab" },
  { text: "设置", name: "settings" },
  { text: "Settings", name: "settings-en" },
];

const visited = [];
for (const t of navTargets) {
  try {
    const loc = window.locator(`text="${t.text}"`).first();
    if (await loc.isVisible({ timeout: 1000 })) {
      await loc.click({ timeout: 3000 }).catch((e) => console.warn(`click ${t.name} failed:`, e.message));
      await window.waitForTimeout(1500);
      await SHOT(`02-${t.name}`);
      visited.push(t.name);
    }
  } catch (e) {
    /* not present */
  }
}
console.log("=== visited panels ===");
console.log(JSON.stringify(visited, null, 2));

// 4. Try opening the new chat composer / typing into it.
try {
  const composer = window.locator('textarea, [contenteditable="true"]').first();
  if (await composer.isVisible({ timeout: 1000 })) {
    await composer.click({ timeout: 3000 });
    await composer.fill("ping from packaged probe");
    await window.waitForTimeout(500);
    await SHOT("03-composer-text");
  }
} catch (e) {
  console.warn("composer interaction failed:", e.message);
}

// 5. Send an IPC ping + a real-world channel that should be cheap.
const ipcHealth = await window.evaluate(async () => {
  const api = (window).api;
  const tryInvoke = async (channel, args) => {
    try { return { ok: true, value: await api.invoke(channel, args) }; }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  };
  return {
    sessionsList: await tryInvoke("sessions:list", "/tmp"),
    workspaceList: await tryInvoke("workspace:list"),
    agentCommandsList: await tryInvoke("agent:commands-list"),
    agentAuthStatus: await tryInvoke("agent:auth-status"),
    mcpStatus: await tryInvoke("mcp:status"),
    sessionHistory: await tryInvoke("session-history", { limit: 5 }),
    settingsGet: await tryInvoke("settings:get", "appearance"),
  };
});

await SHOT("04-final");

console.log("=== IPC health ===");
console.log(JSON.stringify(ipcHealth, null, 2));
console.log("=== renderer errors ===");
console.log(`count=${consoleErrors.length}`);
console.log(JSON.stringify(consoleErrors.slice(0, 20), null, 2));
console.log("=== renderer warnings ===");
console.log(`count=${consoleWarns.length}`);
console.log(JSON.stringify(consoleWarns.slice(0, 10), null, 2));

await app.close();
console.log("[deep-probe] done");
