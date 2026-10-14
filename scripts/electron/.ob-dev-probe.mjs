import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { _electron as electron } from "playwright";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const env = {};
for (const line of (await readFile("/tmp/ob-e2e.env", "utf8")).split("\n")) {
  const m = /^(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const root = "/Users/louloulin/appx/OpenBuddy";
// 起 vite dev server(渲染层非压缩,能拿到 React 完整报错)
const dev = spawn("npx", ["vite", "--port", "5199", "--strictPort"], { cwd: root, stdio: "pipe" });
let devUrl = "";
dev.stdout.on("data", (d) => {
  const m = /http:\/\/localhost:(\d+)\//.exec(String(d));
  if (m && !devUrl) devUrl = m[0];
  process.stderr.write(String(d));
});
for (let i = 0; i < 60 && !devUrl; i += 1) await new Promise((r) => setTimeout(r, 500));
if (!devUrl) { console.error("dev server failed to start"); process.exit(1); }
console.log("[dev-probe] url:", devUrl);

const agentHome = await mkdtemp(join(tmpdir(), "ob-dev-"));
const piAgentDir = join(agentHome, "pi-agent");
const { mkdirSync, writeFileSync } = await import("node:fs");
mkdirSync(piAgentDir, { recursive: true });
const modelId = env.OPENBUDDY_E2E_MODEL_ID || "glm-5.3-flash";
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: { custom_anthropic: { name: "Probe", baseUrl: env.OPENBUDDY_E2E_BASE_URL, api: "anthropic-messages", authHeader: false, models: [{ id: modelId, name: modelId, contextWindow: 128000, maxTokens: 16384 }] } } }, null, 2)}\n`, "utf8");
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({ custom_anthropic: { type: "api_key", key: env.OPENBUDDY_E2E_API_KEY } }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
const userData = await mkdtemp(join(tmpdir(), "ob-dev-ud-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  cwd: root,
  timeout: 30_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: devUrl, PI_HOME: agentHome, PI_CODING_AGENT_DIR: piAgentDir, ...env },
});
const page = await app.firstWindow();
page.on("console", (m) => {
  const text = m.text();
  if (m.type() === "error") console.log("[dev-probe] err:", text.slice(0, 500));
});
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(6000);
const ws = join(userData, "ws");
mkdirSync(ws, { recursive: true });
const session = await page.evaluate(([cwd]) => window.api.invoke("agent:new-session", { cwd }), [ws]);
await page.waitForTimeout(1500);
await page.evaluate(([sessionId]) => window.api.invoke("agent:prompt", { sessionId, text: "在当前工作区创建 probe-a.txt,内容写第一行;再把它改成第二行。只用文件工具,不要解释。" }), [session.sessionId]);
for (let i = 0; i < 40; i += 1) await page.waitForTimeout(2000);
await app.close();
dev.kill("SIGTERM");
console.log("[dev-probe] done");
