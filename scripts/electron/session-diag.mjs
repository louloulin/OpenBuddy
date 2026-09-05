// Session lifecycle diagnostic — drives real Electron + IPC and reports
// what actually happens for the core session/chat path the user asked about:
//   1. agent:init
//   2. sessions:list
//   3. agent:new-session
//   4. agent:prompt (with a trivial prompt)
//   5. listen for agent_message_chunk / agent_message_complete via window.api.events
//   6. agent:abort
// Each step is logged with status (ok/err/timeout) and key payload excerpts.

import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "openbuddy-session-diag-"));
writeFileSync(join(userData, "pi-env.json"), JSON.stringify({ model: "smoke" }, null, 2));

const electronBin = join(root, "node_modules", ".bin", "electron");

function fmt(v) {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "string") return v.length > 200 ? v.slice(0, 200) + "…[+ " + (v.length - 200) + " chars]" : JSON.stringify(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

const results = [];
async function step(name, fn) {
  const start = Date.now();
  try {
    const out = await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout after 20s")), 20000)),
    ]);
    results.push({ step: name, status: "ok", durationMs: Date.now() - start, output: out });
    console.log(`[OK] ${name} (${Date.now() - start}ms)`);
    return out;
  } catch (e) {
    results.push({ step: name, status: "err", durationMs: Date.now() - start, error: e.message });
    console.log(`[ERR] ${name}: ${e.message}`);
    throw e;
  }
}

const app = await electron.launch({
  executablePath: electronBin,
  args: ["out/main/index.js"],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1", OPENBUDDY_USER_DATA: userData },
});

const window = await app.firstWindow();
await window.waitForLoadState("domcontentloaded");

// Capture ALL renderer console output early
window.on("console", (msg) => {
  const text = msg.text();
  if (text.length > 500) return; // skip huge dumps
  console.log(`[renderer:${msg.type()}] ${text}`);
});
window.on("pageerror", (err) => console.log(`[renderer:pageerror] ${err.message}`));

const collectedEvents = [];
await window.exposeFunction("__diagCapture", (label, data) => {
  collectedEvents.push({ label, data: typeof data === "object" ? JSON.stringify(data).slice(0, 400) : String(data).slice(0, 400), at: Date.now() });
  console.log(`[event:${label}] ${typeof data === "object" ? JSON.stringify(data).slice(0, 300) : String(data).slice(0, 300)}`);
});

await window.evaluate(() => {
  window.__diagSelfTest = "self-test-ok";
  window.__diagCounter = 0;
  window.__diagLog = (label, data) => {
    window.__diagCounter += 1;
    console.log(`__diagLog[${window.__diagCounter}] ${label}: ${typeof data === "object" ? JSON.stringify(data).slice(0, 300) : String(data).slice(0, 300)}`);
  };
  if (window.api?.events) {
    const subs = ["pi://update", "pi://complete", "pi://event", "pi://error", "pi://turn-error", "pi://summary"];
    for (const ev of subs) {
      try {
        window.api.events.on(ev, (data) => {
          window.__diagLog(ev, data);
          try { window.__diagCapture(ev, data); } catch (e) { console.log(`capture err ${ev}: ${e.message}`); }
        });
      } catch (e) {
        console.warn(`event subscribe failed ${ev}: ${e.message}`);
      }
    }
  } else {
    console.error("window.api.events missing");
  }
  console.log(`__diagSelfTest=${window.__diagSelfTest}`);
});

try {
  await step("agent:init", () => window.evaluate(() => window.api.invoke("agent:init", { cwd: "/" })));
  await step("sessions:list", () => window.evaluate(() => window.api.invoke("sessions:list", "/")));
  const newSession = await step("agent:new-session", () => window.evaluate(() => window.api.invoke("agent:new-session", { cwd: "/" })));
  const sessionId = newSession?.sessionId;
  console.log(`sessionId = ${sessionId}`);
  if (!sessionId) throw new Error("No sessionId returned");
  await step("agent:prompt", () => window.evaluate((sid) => window.api.invoke("agent:prompt", { sessionId: sid, text: "只回复 SESSION-DIAG-OK，不要调用工具。" }), sessionId));

  // wait up to 25s for streaming events (LLM call may take time)
  await new Promise((r) => setTimeout(r, 25000));
  await step("agent:abort", () => window.evaluate((sid) => window.api.invoke("agent:abort", { sessionId: sid }), sessionId));
} catch (e) {
  console.log(`fatal: ${e.message}`);
}

console.log("\n=== collected events ===");
for (const e of collectedEvents) console.log(`[${new Date(e.at).toISOString()}] ${e.label}: ${e.data}`);

const diagCounter = await window.evaluate(() => window.__diagCounter ?? -1);
console.log(`\n=== diagCounter (renderer log counter): ${diagCounter} ===`);

await app.close();
console.log("\n=== summary ===");
console.log(JSON.stringify(results, null, 2));
process.exit(0);