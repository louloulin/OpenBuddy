import { _electron } from "/home/devbox/OpenBuddy/node_modules/playwright/index.mjs";
import { scrubProviderCredentials } from "/home/devbox/OpenBuddy/scripts/lib/e2e-credentials.mjs";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = "/home/devbox/OpenBuddy";
const OUT = process.env.SHOTS;
const step = process.argv[2] ?? "probe";

const model = spawn(process.execPath, [join(process.env.SCRATCH, "demo-model.mjs")], { stdio: ["ignore", "pipe", "inherit"] });
const port = await new Promise((resolve) => model.stdout.on("data", (d) => { const m = String(d).match(/PORT=(\d+)/); if (m) resolve(m[1]); }));
const baseUrl = `http://127.0.0.1:${port}`;

const userData = mkdtempSync(join(tmpdir(), "ob-shot-"));
const app = await _electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT, "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  cwd: ROOT,
  timeout: 60_000,
  env: { ...scrubProviderCredentials(process.env), ELECTRON_RENDERER_URL: "", PI_CODING_AGENT_DIR: join(userData, "pi-agent"), OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_HARNESS_FILE: "" },
});
const page = await app.firstWindow();
const log = (...a) => console.log("[shot]", ...a);
page.on("requestfailed", (r) => log("reqfail", r.url().slice(0, 160), r.failure()?.errorText));
page.on("pageerror", (e) => log("pageerror", String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") log("console", m.type(), m.text().slice(0, 300)); });
try {
  await page.waitForLoadState("domcontentloaded");
  await page.addInitScript(() => localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({ version: 1, status: "done", index: 0, steps: [], updatedAt: 0, completedAt: 0 })));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.setViewportSize({ width: 1360, height: 860 }).catch(() => undefined);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1360, 860); w.center(); });
  await page.waitForTimeout(4000);

  const invoke = (channel, args) => page.evaluate(({ channel, args }) => window.api.invoke(channel, args), { channel, args });
  await invoke("agent:providers-save-provider", { provider: { id: "demo", label: "Demo", providerKind: "custom_anthropic", apiKey: "k", baseUrl, apiBackend: "messages", authScheme: "x_api_key" } });
  await invoke("agent:providers-save-model", { model: { providerId: "demo", modelId: "demo-model", name: "Demo Model", contextWindow: 32000 } });
  const cwd = mkdtempSync(join(tmpdir(), "ob-shot-ws-"));
  const s = await invoke("agent:new-session", { cwd, modelId: "demo/demo-model" });
  log("session", JSON.stringify(s).slice(0, 200));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(OUT, `${step}-00-home.png`) });

  const mod = await import(join(process.env.SCRATCH, `steps-${step}.mjs`)).catch((e) => { log("no steps", String(e)); return null; });
  if (mod) await mod.default({ page, app, invoke, log, OUT, join, cwd, sessionId: s?.sessionId });
} catch (e) {
  log("ERROR", String(e?.stack ?? e).slice(0, 800));
  await page.screenshot({ path: join(OUT, `${step}-error.png`) }).catch(() => undefined);
} finally {
  await app.close().catch(() => undefined);
  model.kill();
}
