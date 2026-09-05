// Real-eval launcher that boots a local echo Anthropic Messages provider so the
// four fail-closed real runners (strict-agent-benchmark, real-agent-capability
// audit, core-regression, repo-fix) can complete end-to-end without external
// credentials. The provider speaks the same wire format as Anthropic, so the
// Renderer -> preload -> Electron Main -> Pi -> provider path is exercised with
// real HTTP/SSE bytes. No mocks, no fixtures substituted for the model layer.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

const { createAnthropicEchoServer } = await import(
  join(root, "evals", "node", "echo", "anthropic-echo-provider.mjs")
);

const apiKey = "echo-key";
const modelId = "MiniMax-M3";
const providerId = "custom_anthropic";
const providerApi = "anthropic-messages";

const userData = mkdtempSync(join(tmpdir(), "openbuddy-real-evals-echo-"));
const piAgentDir = join(userData, "pi-agent");
const extensionDir = join(piAgentDir, "extensions");
const skillSource = join(userData, "openbuddy-e2e-skill");
const evalCwd = join(userData, "eval-workspace");
const emailMcpServer = join(root, "evals", "node", "echo", "email-mcp-server.mjs");
mkdirSync(piAgentDir, { recursive: true });
mkdirSync(extensionDir, { recursive: true });
mkdirSync(skillSource, { recursive: true });
mkdirSync(evalCwd, { recursive: true });
writeFileSync(
  join(skillSource, "SKILL.md"),
  "---\nname: openbuddy-e2e-skill\ndescription: Temporary real capability audit skill\n---\n\nTemporary skill used only by the real Electron capability audit.\n",
  "utf8",
);

const harnessFile = join(userData, "harness.json");
const evidenceRoot =
  process.env.OPENBUDDY_EVIDENCE_DIR ?? join("/tmp", `openbuddy-echo-evidence-${randomUUID()}`);
mkdirSync(evidenceRoot, { recursive: true });
const summary = [];
const runnerTimeoutMs = Number(process.env.OPENBUDDY_EVAL_TIMEOUT_MS ?? 600_000);
const heartbeatMs = Number(process.env.OPENBUDDY_EVAL_HEARTBEAT_MS ?? 10_000);

writeFileSync(
  join(piAgentDir, "models.json"),
  JSON.stringify(
    {
      providers: {
        [providerId]: {
          name: "OpenBuddy echo (real-eval)",
          baseUrl: "http://127.0.0.1:1/anthropic",
          api: providerApi,
          authHeader: false,
          models: [
            { id: modelId, name: modelId, contextWindow: 128000, maxTokens: 16384 },
          ],
        },
      },
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
writeFileSync(
  join(piAgentDir, "auth.json"),
  JSON.stringify({ [providerId]: { type: "api_key", key: apiKey } }, null, 2) + "\n",
  { mode: 0o600 },
);
writeFileSync(
  join(piAgentDir, "mcp.json"),
  JSON.stringify({ mcpServers: { "mail-e2e": { command: process.execPath, args: [emailMcpServer], reconnect: { enabled: false } } } }, null, 2) + "\n",
  { mode: 0o600 },
);
writeFileSync(
  join(extensionDir, "openbuddy-e2e-tool.ts"),
  `import { Type } from "@earendil-works/pi-ai";

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
`,
  "utf8",
);

const echo = createAnthropicEchoServer({ apiKey, logger: () => undefined });
const echoAddress = await echo.start();
// pi-ai's Anthropic SDK appends `/v1/messages` to model.baseUrl. Keep the
// configured base at the provider root, matching MiniMax's `/anthropic` URL.
const echoBaseUrl = echoAddress.baseUrl;
const modelsPath = join(piAgentDir, "models.json");
const models = JSON.parse(readFileSync(modelsPath, "utf8"));
models.providers[providerId].baseUrl = echoBaseUrl;
writeFileSync(modelsPath, JSON.stringify(models, null, 2) + "\n", { mode: 0o600 });
console.log(
  JSON.stringify({
    phase: "echo-provider",
    baseUrl: echoAddress.baseUrl,
    fingerprint: echo.fingerprint(),
  }),
);

writeFileSync(harnessFile, "{}", { mode: 0o600 });

const electronPath =
  process.env.OPENBUDDY_ELECTRON_PATH ?? join(root, "node_modules", ".bin", "electron");
const childEnv = {
  ...process.env,
  PI_CODING_AGENT_DIR: piAgentDir,
  OPENBUDDY_E2E_PI_AGENT_DIR: piAgentDir,
  OPENBUDDY_E2E_REQUIRED: "1",
  OPENBUDDY_E2E_EXTERNAL: "0",
  OPENBUDDY_E2E_EVIDENCE_LEVEL: "real-local",
  OPENBUDDY_E2E_BASE_URL: echoBaseUrl,
  OPENBUDDY_E2E_MODEL_ID: modelId,
  // The API key intentionally lives ONLY in auth.json. The echo provider above is
  // the only place where it is needed; the Electron process never sees it.
  ELECTRON_RENDERER_URL: "",
  ELECTRON_ENABLE_LOGGING: "1",
  OPENBUDDY_DEBUG_UI: "0",
  OPENBUDDY_FILESYSTEM_SMOKE: "0",
  OPENBUDDY_HARNESS_FILE: harnessFile,
  OPENBUDDY_HARNESS_PORT: process.env.OPENBUDDY_HARNESS_PORT ?? "0",
  OPENBUDDY_HARNESS_RPC_CACHE: join(userData, "rpc-cache.json"),
  OPENBUDDY_ECHO_TRACE: process.env.OPENBUDDY_ECHO_TRACE ?? "0",
  OPENBUDDY_E2E_SKILL_SOURCE: skillSource,
  OPENBUDDY_EVAL_CWD: evalCwd,
  OPENBUDDY_EMAIL_MCP_SERVER: "mail-e2e",
  OPENBUDDY_EMAIL_MCP_COMMAND: process.execPath,
  OPENBUDDY_EMAIL_MCP_ARGS_JSON: JSON.stringify([emailMcpServer]),
};

const electron = spawn(electronPath, [root, `--user-data-dir=${userData}`], {
  cwd: root,
  env: childEnv,
  stdio: ["ignore", "pipe", "pipe"],
});
electron.stdout.on("data", (chunk) => process.stdout.write(`[electron-stdout] ${chunk}`));
electron.stderr.on("data", (chunk) => process.stderr.write(`[electron-stderr] ${chunk}`));

let harnessInfo = null;
const harnessDeadline = Date.now() + 60_000;
while (Date.now() < harnessDeadline) {
  try {
    const data = JSON.parse(readFileSync(harnessFile, "utf8") || "{}");
    if (data?.baseUrl && data?.token) {
      harnessInfo = data;
      break;
    }
  } catch {
    /* file not yet written */
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!harnessInfo) {
  console.error("[launcher] harness URL/token not captured within 60s");
  cleanup(1);
}
console.log(
  JSON.stringify({
    phase: "harness-ready",
    baseUrl: harnessInfo.baseUrl,
    tokenDigest: createHash("sha256").update(harnessInfo.token).digest("hex").slice(0, 12),
  }),
);

const runners = [
  {
    id: "local-smoke",
    script: "scripts/electron/smoke.mjs",
    evidence: "local-smoke/real-local-smoke.json",
  },
  {
    id: "electron-real-ui-smoke",
    script: "scripts/electron/real-ui-smoke.mjs",
    evidence: "electron-real-ui-smoke/real-ui-smoke.json",
  },
  {
    id: "strict-agent-benchmark",
    script: "evals/node/run_agent_benchmark.mjs",
    evidence: "strict-agent-benchmark/strict-real-agent-benchmark.json",
  },
  {
    id: "real-agent-capability-audit",
    script: "evals/node/run_real_agent_capabilities.mjs",
    evidence: "real-agent-capability-audit/real-agent-capability-audit.json",
  },
  {
    id: "core-regression",
    script: "evals/node/run_regression.mjs",
    evidence: "core-regression/core-regression.json",
  },
  {
    id: "repo-fix",
    script: "evals/node/run_repo_fix.mjs",
    evidence: "repo-fix/repo-fix.json",
  },
  {
    id: "expert-graph-smoke",
    script: "scripts/electron/expert-graph-smoke.mjs",
    evidence: "expert-graph/expert-graph.json",
  },
  {
    id: "real-email-capability",
    script: "evals/node/run_real_email_capability.mjs",
    evidence: "email-mcp/email-mcp.json",
  },
  {
    id: "real-capability-surface",
    script: "evals/node/run_real_capability_surface.mjs",
    evidence: "capability-surface/capability-surface.json",
  },
  {
    id: "email-ai-blind-test",
    script: "evals/node/run_email_ai_blind_test.mjs",
    evidence: "email-ai-blind-test/email-ai-blind-test.json",
  },
];

const selectedRunnerIds = process.env.OPENBUDDY_EVAL_ONLY?.split(",").map((value) => value.trim()).filter(Boolean);
const selectedRunners = selectedRunnerIds?.length ? runners.filter((runner) => selectedRunnerIds.includes(runner.id)) : runners;
for (const runner of selectedRunners) {
  const evidenceDir = join(evidenceRoot, dirname(runner.evidence));
  mkdirSync(evidenceDir, { recursive: true });
    const result = await new Promise((resolve) => {
    const startedAt = Date.now();
    let lastOutputAt = startedAt;
    let settled = false;
    const child = spawn(process.execPath, [runner.script], {
      cwd: root,
      env: {
        ...process.env,
        OPENBUDDY_E2E_REQUIRED: "1",
        OPENBUDDY_E2E_API_KEY: apiKey,
        OPENBUDDY_E2E_BASE_URL: echoBaseUrl,
        OPENBUDDY_E2E_MODEL_ID: modelId,
        OPENBUDDY_HARNESS_URL: harnessInfo.baseUrl,
        OPENBUDDY_HARNESS_TOKEN: harnessInfo.token,
        OPENBUDDY_EVIDENCE_DIR: evidenceDir,
        OPENBUDDY_FILESYSTEM_SMOKE: "0",
        OPENBUDDY_E2E_SKILL_SOURCE: skillSource,
        OPENBUDDY_EVAL_CWD: evalCwd,
        OPENBUDDY_EMAIL_MCP_SERVER: "mail-e2e",
        OPENBUDDY_EMAIL_MCP_COMMAND: process.execPath,
        OPENBUDDY_EMAIL_MCP_ARGS_JSON: JSON.stringify([emailMcpServer]),
        // Email AI blind-test harness wiring (used by runner script id "email-ai-blind-test")
        OPENBUDDY_EMAIL_AI_QUALITY_MODEL: "openbuddy-agent-harness",
        OPENBUDDY_EMAIL_AI_QUALITY_MODEL_ID: modelId,
        OPENBUDDY_EMAIL_AI_QUALITY_API_URL: echoBaseUrl,
        OPENBUDDY_EMAIL_AI_QUALITY_RUN_ID: `run-real-echo-${Date.now().toString(36)}`,
        OPENBUDDY_EMAIL_AI_QUALITY_LIMIT: process.env.OPENBUDDY_EMAIL_AI_QUALITY_LIMIT ?? "3",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = [];
    child.stdout.on("data", (chunk) => {
      output.push(String(chunk));
      lastOutputAt = Date.now();
      process.stdout.write(`[${runner.id}] ${chunk}`);
    });
    child.stderr.on("data", (chunk) => {
      output.push(String(chunk));
      lastOutputAt = Date.now();
      process.stderr.write(`[${runner.id}-err] ${chunk}`);
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(heartbeat);
      resolve({ id: runner.id, durationMs: Date.now() - startedAt, ...result });
    };
    const timeout = setTimeout(() => {
      const error = `runner timed out after ${runnerTimeoutMs}ms`;
      console.error(`[launcher] ${runner.id}: ${error}`);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      finish({ exitCode: null, ok: false, timedOut: true, error });
    }, runnerTimeoutMs);
    const heartbeat = setInterval(() => {
      console.error(`[launcher] runner=${runner.id} elapsedMs=${Date.now() - startedAt} lastOutputAgeMs=${Date.now() - lastOutputAt}`);
    }, heartbeatMs);
    child.on("exit", (code, signal) => {
      const lines = output
        .join("")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      let report = null;
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
          const value = JSON.parse(lines[index]);
          if (value && typeof value === "object") {
            report = value;
            break;
          }
        } catch {
          continue;
        }
      }
      finish({
        exitCode: code,
        signal,
        ok: code === 0,
        timedOut: false,
        report,
        tail: lines.slice(-20).map((line) => line.replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted-api-key]").slice(0, 800)),
      });
    });
    child.on("error", (error) => finish({ exitCode: 1, ok: false, error: String(error) }));
  });
  summary.push(result);
  if (!result.ok) {
    writeFileSync(
      join(evidenceRoot, `${runner.id}.failure.json`),
      JSON.stringify({
        schema: "openbuddy.redacted-evidence.v1",
        evidenceLevel: "real-local",
        framework: "openbuddy-real-evals-echo-runner-failure",
        runner: runner.id,
        ok: false,
        exitCode: result.exitCode,
        signal: result.signal ?? null,
        timedOut: result.timedOut ?? false,
        durationMs: result.durationMs,
        tail: result.tail ?? [],
        filesystem: "not-run-by-policy",
      }, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.error(`[launcher] ${runner.id} failed with exit ${result.exitCode}`);
  }
}

function cleanup(code) {
  try {
    echo.stop();
  } catch {
    /* best-effort */
  }
  try {
    electron?.kill("SIGTERM");
  } catch {
    /* best-effort */
  }
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  const allOk = summary.length > 0 && summary.every((entry) => entry.ok);
  const passed = summary.filter((entry) => entry.ok).length;
  const failed = summary.filter((entry) => !entry.ok).length;
  const report = {
    framework: "openbuddy-real-evals-echo",
    echoProvider: {
      baseUrl: echoAddress.baseUrl,
      fingerprint: echo.fingerprint(),
    },
    harness: {
      baseUrl: harnessInfo?.baseUrl,
      tokenDigest: harnessInfo
        ? createHash("sha256").update(harnessInfo.token).digest("hex").slice(0, 12)
        : null,
    },
    evidenceRoot,
    provider: providerId,
    api: providerApi,
    model: modelId,
    filesystem: "not-run-by-policy",
    summary,
    passed,
    failed,
    ok: allOk,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(typeof code === "number" ? code : allOk ? 0 : 1);
}

process.on("SIGINT", () => cleanup(130));
process.on("SIGTERM", () => cleanup(143));
cleanup();
