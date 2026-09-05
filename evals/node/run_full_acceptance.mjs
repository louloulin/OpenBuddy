import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateFilesystemCapabilityPolicy } from "./_filesystem-capability-policy.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const required = process.env.OPENBUDDY_E2E_REQUIRED === "1";
const apiKey = process.env.OPENBUDDY_E2E_API_KEY ?? "";
const baseUrl = process.env.OPENBUDDY_E2E_BASE_URL ?? "";
const modelId = process.env.OPENBUDDY_E2E_MODEL_ID ?? "";
const redact = (value) => String(value)
  .split(apiKey).join(apiKey ? "[redacted-api-key]" : "")
  .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted-api-key]")
  .replace(/Bearer\s+[A-Za-z0-9._~-]{16,}/g, "Bearer [redacted-token]")
  .replace(/OPENBUDDY_E2E_API_KEY[^\s]*/g, "OPENBUDDY_E2E_API_KEY=[redacted]")
  .replace(/(authorization|api[-_]?key|token|secret)[=:][^\s,}]+/gi, "$1=[redacted]");

const launcher = join(root, "scripts", "electron", "launch-harness.mjs");
const emailMcpServer = join(root, "evals", "node", "echo", "email-mcp-server.mjs");
const node = process.execPath;
const localPhases = [
  { id: "evaluation-suite-audit", command: node, args: ["evals/node/audit_evaluation_suite.mjs"] },
  { id: "benchmark-evidence-audit", command: node, args: ["evals/node/audit_benchmark_evidence.mjs"] },
  { id: "official-benchmark-readiness", command: node, args: ["evals/node/audit_official_benchmarks.mjs"] },
  { id: "capability-matrix-audit", command: node, args: ["evals/node/audit_capability_matrix.mjs"] },
  { id: "agent-surface-audit", command: node, args: ["scripts/electron/audit-agent-surface.mjs"] },
  { id: "typecheck-renderer", command: node, args: ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--noEmit"] },
  { id: "typecheck-electron", command: node, args: ["node_modules/typescript/bin/tsc", "-p", "electron/tsconfig.json", "--noEmit"] },
  { id: "production-build", command: join(root, "node_modules", ".bin", "electron-vite"), args: ["build"] },
  { id: "vitest", command: node, args: ["node_modules/vitest/vitest.mjs", "run", "--no-file-parallelism"] },
  { id: "diff-check", command: "git", args: ["diff", "--check"] },
  { id: "electron-surface-regression", command: node, args: ["scripts/electron/surface-regression.mjs"] },
  { id: "electron-ipc-surface-smoke", command: node, args: ["scripts/electron/ipc-surface-smoke.mjs"] },
  { id: "electron-email-ipc-surface-smoke", command: node, args: ["scripts/electron/email-ipc-surface-smoke.mjs"] },
];
const realProviderConfigured = required && Boolean(apiKey && baseUrl && modelId);
const phaseTimeoutMs = Number(process.env.OPENBUDDY_PHASE_TIMEOUT_MS ?? 600_000);
const heartbeatMs = Number(process.env.OPENBUDDY_PHASE_HEARTBEAT_MS ?? 10_000);
const filesystemPolicy = evaluateFilesystemCapabilityPolicy();
const phases = realProviderConfigured ? [
  ...localPhases,
  { id: "local-smoke", command: node, args: ["scripts/electron/smoke.mjs"] },
  { id: "electron-real-ui-smoke", command: node, args: ["scripts/electron/real-ui-smoke.mjs"] },
  { id: "strict-agent-benchmark", command: node, args: [launcher, "--", node, "evals/node/run_agent_benchmark.mjs"] },
  { id: "real-agent-capability-audit", command: node, args: [launcher, "--", node, "evals/node/run_real_agent_capabilities.mjs"] },
  { id: "core-regression", command: node, args: [launcher, "--", node, "evals/node/run_regression.mjs"] },
  { id: "repo-fix", command: node, args: [launcher, "--", node, "evals/node/run_repo_fix.mjs"] },
  { id: "expert-graph-smoke", command: node, args: ["scripts/electron/expert-graph-smoke.mjs"] },
  { id: "real-capability-surface", command: node, args: [launcher, "--", node, "evals/node/run_real_capability_surface.mjs"] },
  { id: "real-email-capability", command: node, args: [launcher, "--", node, "evals/node/run_real_email_capability.mjs"] },
] : [
  ...localPhases,
  { id: "local-evidence-evals", command: node, args: ["scripts/electron/launch-real-evals-echo.mjs"] },
];

function runPhase(phase) {
  return new Promise((resolve) => {
    const output = [];
    const startedAt = Date.now();
    let lastOutputAt = startedAt;
    let settled = false;
    const phaseEvidenceDir = join(evidenceRoot, phase.id);
    const child = spawn(phase.command, phase.args, {
      cwd: root,
      env: {
        ...process.env,
        OPENBUDDY_E2E_REQUIRED: realProviderConfigured ? "1" : "",
        OPENBUDDY_E2E_EXTERNAL: realProviderConfigured ? "1" : "0",
        OPENBUDDY_E2E_EVIDENCE_LEVEL: realProviderConfigured ? "real-external" : "real-local",
        OPENBUDDY_FILESYSTEM_SMOKE: filesystemPolicy.allowed ? "1" : "0",
        OPENBUDDY_E2E_MCP_SERVER_PATH: realProviderConfigured ? emailMcpServer : "",
        OPENBUDDY_HARNESS_FILE: `/tmp/openbuddy-full-acceptance-${randomUUID()}.json`,
        OPENBUDDY_EVIDENCE_DIR: ["evidence-artifact-audit", "capability-evidence-audit", "local-evidence-evals"].includes(phase.id)
          ? evidenceRoot
          : phaseEvidenceDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const collect = (chunk) => {
      output.push(String(chunk));
      if (output.length > 400) output.shift();
      lastOutputAt = Date.now();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(heartbeat);
      resolve({ id: phase.id, durationMs: Date.now() - startedAt, ...result });
    };
    const timeout = setTimeout(() => {
      const message = `phase timed out after ${phaseTimeoutMs}ms`;
      console.error(`[acceptance] ${phase.id}: ${message}`);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      finish({ ok: false, exitCode: null, signal: "SIGTERM", timedOut: true, error: message });
    }, phaseTimeoutMs);
    const heartbeat = setInterval(() => {
      console.error(`[acceptance] phase=${phase.id} elapsedMs=${Date.now() - startedAt} lastOutputAgeMs=${Date.now() - lastOutputAt}`);
    }, heartbeatMs);
    child.on("error", (error) => finish({ ok: false, exitCode: null, error: String(error) }));
    child.on("exit", (code, signal) => {
      const lines = output.join("").split("\n").map((line) => line.trim()).filter(Boolean);
      let report;
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
          const value = JSON.parse(lines[index]);
          if (value && typeof value === "object") { report = value; break; }
        } catch {
          continue;
        }
      }
      finish({
        ok: code === 0,
        exitCode: code,
        signal,
        timedOut: false,
        ...(report ? { report } : {}),
        ...(code === 0 ? {} : { tail: lines.slice(-12).map((line) => redact(line).slice(0, 800)) }),
      });
    });
  });
}

const results = [];
const evidenceRoot = process.env.OPENBUDDY_EVIDENCE_DIR ?? `/tmp/openbuddy-evidence-${randomUUID()}`;
for (const phase of phases) results.push(await runPhase(phase));
results.push(await runPhase({ id: "evidence-artifact-audit", command: node, args: ["evals/node/audit_evidence_artifacts.mjs"] }));
results.push(await runPhase({ id: "capability-evidence-audit", command: node, args: ["evals/node/audit_capability_evidence.mjs"] }));
const failed = results.filter((phase) => !phase.ok);
const externalBlocked = !realProviderConfigured;
console.log(JSON.stringify({
  framework: "openbuddy-full-real-acceptance",
  realE2E: realProviderConfigured,
  provider: "custom_anthropic",
  model: modelId,
  api: "anthropic-messages",
  filesystem: filesystemPolicy.allowed ? "enabled-by-policy" : "not-run-by-policy",
  filesystemPolicy,
  ...(externalBlocked ? { externalBlocked: "OPENBUDDY_E2E_REQUIRED=1 and complete OPENBUDDY_E2E_API_KEY/BASE_URL/MODEL_ID are required" } : {}),
  phases: results,
  evidenceRoot,
  passed: results.length - failed.length,
  failed: failed.length,
}, null, 2));
// Missing temporary provider credentials block only the external tier. The
// local Electron + Pi + Echo evidence tier remains a valid, independently
// auditable acceptance result.
process.exit(failed.length === 0 ? 0 : 1);
