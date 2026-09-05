// Real harness launcher for OpenBuddy AI-Agent evals.
//
// Usage:
//   OPENBUDDY_E2E_API_KEY=... OPENBUDDY_E2E_BASE_URL=... OPENBUDDY_E2E_MODEL_ID=... \
//   node scripts/electron/launch-harness.mjs -- node evals/node/run_regression.mjs
//
// Reads OPENBUDDY_HARNESS_FILE (defaults to /tmp/openbuddy-harness.json) for
// { baseUrl, token } that the Electron Main process writes via an env-loaded
// preload hook.  This script then execs the eval command with those values
// exported as OPENBUDDY_HARNESS_URL and OPENBUDDY_HARNESS_TOKEN.
//
// Real harness URL/token are written by Electron Main on first listen using
// OPENBUDDY_HARNESS_FILE (added by the change below). No mocks.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// EPIPE-safe: child stdio pipes close during teardown, and Node surfaces the
// resulting EPIPE as an uncaughtException that crashes the launcher even
// though the underlying work has already finished. Swallow those errors
// gracefully.
process.on("uncaughtException", (error) => {
  if (error && (error.code === "EPIPE" || /EPIPE/.test(String(error?.message)))) return;
  console.error("[launcher] uncaught exception:", error);
  process.exit(1);
});
process.stdout.on("error", (error) => {
  if (error && (error.code === "EPIPE" || /EPIPE/.test(String(error?.message)))) return;
  throw error;
});
process.stderr.on("error", (error) => {
  if (error && (error.code === "EPIPE" || /EPIPE/.test(String(error?.message)))) return;
  throw error;
});


const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(dirname(here));

if (!process.env.OPENBUDDY_E2E_API_KEY || !process.env.OPENBUDDY_E2E_BASE_URL || !process.env.OPENBUDDY_E2E_MODEL_ID) {
  console.error("OPENBUDDY_E2E_API_KEY / BASE_URL / MODEL_ID are required");
  process.exit(2);
}

const harnessFile = process.env.OPENBUDDY_HARNESS_FILE ?? "/tmp/openbuddy-harness.json";
try { writeFileSync(harnessFile, "{}", { flag: "w" }); } catch { /* ignore */ }

const userData = mkdtempSync(join(tmpdir(), "openbuddy-harness-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
const providerId = "custom_anthropic";
const mcpServerPath = process.env.OPENBUDDY_E2E_MCP_SERVER_PATH;
const mcpConfigPath = process.env.OPENBUDDY_E2E_MCP_CONFIG_PATH;
let child;
const cleanup = () => {
  try { child?.kill("SIGTERM"); } catch { /* ignore */ }
  try { if (existsSync(userData)) rmSync(userData, { recursive: true, force: true }); } catch { /* ignore */ }
  try { if (existsSync(harnessFile)) rmSync(harnessFile, { force: true }); } catch { /* ignore */ }
};
writeFileSync(join(piAgentDir, "models.json"), JSON.stringify({
  providers: {
    [providerId]: {
      name: "MiniMax Anthropic",
      baseUrl: process.env.OPENBUDDY_E2E_BASE_URL,
      api: "anthropic-messages",
      authHeader: false,
      models: [{ id: process.env.OPENBUDDY_E2E_MODEL_ID, name: process.env.OPENBUDDY_E2E_MODEL_ID, contextWindow: 128000, maxTokens: 16384 }],
    },
  },
}, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), JSON.stringify({
  [providerId]: { type: "api_key", key: process.env.OPENBUDDY_E2E_API_KEY },
}, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
if (mcpServerPath || mcpConfigPath) {
  let config;
  if (mcpConfigPath) {
    config = JSON.parse(readFileSync(mcpConfigPath, "utf8"));
    if (!config || typeof config !== "object" || !config.mcpServers || typeof config.mcpServers !== "object") {
      throw new Error("OPENBUDDY_E2E_MCP_CONFIG_PATH must contain an mcpServers object");
    }
  } else {
    config = {
      mcpServers: {
        "mail-e2e": { command: process.execPath, args: [mcpServerPath], reconnect: { enabled: false } },
      },
    };
  }
  const mcpPayload = JSON.stringify(config, null, 2) + "\n";
  // Mirror to both the legacy root (PI_CODING_AGENT_DIR) and the workbench
  // scope root that piRoot() resolves to in default casdoor config. See
  // electron/main/agent-home.ts for the shared resolver.
  writeFileSync(join(piAgentDir, "mcp.json"), mcpPayload, { encoding: "utf8", mode: 0o600 });
  const launchWorkbenchRoot = join(userData, "workspaces", "signed-out", "pi-agent");
  mkdirSync(launchWorkbenchRoot, { recursive: true });
  writeFileSync(join(launchWorkbenchRoot, "mcp.json"), mcpPayload, { encoding: "utf8", mode: 0o600 });
}
const extensionDir = join(piAgentDir, "extensions");
mkdirSync(extensionDir, { recursive: true });
writeFileSync(join(extensionDir, "openbuddy-e2e-tool.ts"), `import { Type } from "@earendil-works/pi-ai";

export default function (pi) {
  pi.registerTool({
    name: "openbuddy_e2e_tool",
    label: "OpenBuddy E2E tool",
    description: "Return the exact verification marker supplied by the user.",
    parameters: Type.Object({ marker: Type.String() }),
    execute: async (_toolCallId, params) => ({
      content: [{ type: "text", text: params.marker }],
      details: { source: "openbuddy-e2e-pi-extension" },
    }),
  });
}
`, "utf8");
const skillSource = join(userData, "openbuddy-e2e-skill");
mkdirSync(skillSource, { recursive: true });
writeFileSync(join(skillSource, "SKILL.md"), "---\nname: openbuddy-e2e-skill\ndescription: Temporary real capability audit skill\n---\n\nTemporary skill used only by the real Electron capability audit.\n", "utf8");
const {
  OPENBUDDY_E2E_API_KEY: _e2eApiKey,
  OPENBUDDY_E2E_BASE_URL: _e2eBaseUrl,
  OPENBUDDY_E2E_MODEL_ID: _e2eModelId,
  ...electronParentEnv
} = process.env;
const childEnv = {
  ...electronParentEnv,
  PI_CODING_AGENT_DIR: piAgentDir,
  OPENBUDDY_E2E_PI_AGENT_DIR: piAgentDir,
  ELECTRON_RENDERER_URL: "",
  ELECTRON_ENABLE_LOGGING: "1",
  OPENBUDDY_DEBUG_UI: "1",
  OPENBUDDY_HARNESS_FILE: harnessFile,
  OPENBUDDY_E2E_SKILL_SOURCE: skillSource,
  OPENBUDDY_E2E_EXTERNAL: "1",
  OPENBUDDY_E2E_EVIDENCE_LEVEL: "real-external",
};

const electronPath = process.env.OPENBUDDY_ELECTRON_PATH ?? join(root, "node_modules", ".bin", "electron");
child = spawn(electronPath, [root, `--user-data-dir=${userData}`], {
  cwd: root,
  env: childEnv,
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout.on("data", (chunk) => process.stdout.write(`[electron-stdout] ${chunk}`));
child.stderr.on("data", (chunk) => process.stderr.write(`[electron-stderr] ${chunk}`));

const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  try {
    const data = JSON.parse(readFileSync(harnessFile, "utf8"));
    if (data?.baseUrl && data?.token) break;
  } catch { /* not yet */ }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
const final = JSON.parse(readFileSync(harnessFile, "utf8") || "{}");
if (!final?.baseUrl || !final?.token) {
  console.error("harness URL/token not captured within 30s");
  cleanup();
  process.exit(2);
}
console.log(`[launcher] harness ready url=${final.baseUrl}`);

const evalArgs = process.argv.slice(2).filter((arg) => arg !== "--");
if (evalArgs.length === 0) {
  console.error("usage: launch-harness.mjs -- <eval command...>");
  cleanup();
  process.exit(2);
}
const evalChild = spawn(evalArgs[0], evalArgs.slice(1), {
  cwd: root,
  env: {
    ...process.env,
    OPENBUDDY_HARNESS_URL: final.baseUrl,
    OPENBUDDY_HARNESS_TOKEN: final.token,
    OPENBUDDY_E2E_PI_AGENT_DIR: piAgentDir,
    OPENBUDDY_E2E_EXTERNAL: "1",
    OPENBUDDY_E2E_EVIDENCE_LEVEL: "real-external",
  },
  stdio: "inherit",
});

evalChild.on("exit", (code) => { cleanup(); process.exit(code ?? 1); });
child.on("exit", () => { cleanup(); });
