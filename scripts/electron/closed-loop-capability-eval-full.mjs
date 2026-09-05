#!/usr/bin/env node
/**
 * Comprehensive closed-loop capability evaluation harness for OpenBuddy.
 *
 * Runs every real-fs/no-mock unit test we maintain for capability packages
 * and the renderer lib helpers, then drives three layers of evidence:
 *   1. unit-level vitest (real fs / real parsers / real class instances)
 *   2. top-tier benchmark adapters (GAIA-shape, AgentBench-shape, AgentDojo-shape,
 *      MT-bench-shape, BFCL-shape)
 *   3. capability matrix audit (mapping each capability to its evidence)
 *
 * Writes:
 *   evidence/closed-loop/{timestamp}/closed-loop-summary.json
 *   evidence/closed-loop/{timestamp}/vitest-stdout.txt
 *   evidence/closed-loop/{timestamp}/vitest-stderr.txt
 *   evidence/closed-loop/{timestamp}/per-test-files.json
 *
 * No mocks. Real validation only. Optionally drives the live Electron Pi
 * harness when OPENBUDDY_HARNESS_URL/TOKEN and OPENBUDDY_E2E_* are set.
 */

import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { withTimeout, withRetry, withHeartbeat, computeDatasetHash, sha256OfText } from "../../evals/node/_harness-utils.mjs"
import { compareToGolden } from "../../evals/node/golden-compare.mjs"

const __filename = fileURLToPath(import.meta.url)
const ROOT = join(dirname(__filename), "..", "..")
const RUNNER_TIMEOUT_MS = Number(process.env.OPENBUDDY_EVAL_TIMEOUT_MS ?? 600_000)
const RUNNER_HEARTBEAT_MS = Number(process.env.OPENBUDDY_EVAL_HEARTBEAT_MS ?? 10_000)
const RUNNER_RETRY_ATTEMPTS = Number(process.env.OPENBUDDY_EVAL_RETRIES ?? 2)
const GOLDEN_DIR = join(ROOT, "evals", "golden", "closed-loop-vitest")
const SCRIPT_HASH = sha256OfText(readFileSync(__filename, "utf8"))

// Comprehensive test file inventory (only paths that exist on disk are run).
const TEST_FILES = [
  // renderer helpers — pure functions and parsers against real input
  "src/lib/file-utils.test.ts",
  "src/lib/cloud-storage.test.ts",
  "src/lib/error-format.test.ts",
  "src/lib/command-risk.test.ts",
  "src/lib/drop-utils.test.ts",
  "src/lib/content-blocks.test.ts",
  "src/lib/timeline-utils.test.ts",
  "src/lib/file-kind.test.ts",
  "src/lib/extract-text.test.ts",
  "src/lib/input-history.test.ts",
  "src/lib/file-changes.test.ts",
  "src/lib/export-markdown.test.ts",
  "src/lib/assistant-badges.test.ts",
  "src/lib/email-sender-utils.test.ts",
  "src/lib/browser-preview.test.ts",
  "src/lib/sandbox-guard.test.ts",
  "src/lib/notify-channels.test.ts",
  "src/lib/usage-quota.test.ts",
  "src/lib/markdown-host.test.ts",
  "src/lib/doc-preview.test.ts",
  "src/lib/email-contacts.test.ts",
  "src/lib/casdoor-authorization.test.ts",
  "src/lib/casdoor-capabilities.test.ts",
  "src/lib/casdoor-resources.test.ts",
  "src/lib/policy-engine.test.ts",
  "src/lib/mcp-capabilities.test.ts",
  "src/lib/oidc-auth.test.ts",
  "src/lib/tool-renderers.test.ts",
  "src/lib/casdoor-permissions.test.ts",
  // capability packages — real fs / sqlite / cordis runtime
  "packages/capability/openbuddy-folder-trust/src/index.test.ts",
  "packages/capability/openbuddy-notification/src/index.test.ts",
  // Stage G-1b: openbuddy-plan removed; plan-mode is owned by pi-plan-mode.
  "packages/capability/openbuddy-calendar/src/index.test.ts",
  "packages/capability/openbuddy-automation/src/index.test.ts",
  "packages/capability/openbuddy-mcp-client/src/index.test.ts",
  "packages/capability/openbuddy-authorization/src/index.test.ts",
  "packages/capability/openbuddy-email/src/index.test.ts",
  "packages/capability/openbuddy-email/src/provider-registry.test.ts",
  "packages/capability/openbuddy-email/src/contact-projection.test.ts",
  "packages/capability/openbuddy-email/src/email-permissions.test.ts",
  "packages/capability/openbuddy-email/src/extract-action-candidates.test.ts",
  "packages/capability/openbuddy-email/src/action-center-query.test.ts",
  "packages/capability/openbuddy-email/src/gmail-api-provider.test.ts",
  "packages/capability/openbuddy-email/src/microsoft-graph-provider.test.ts",
  "packages/capability/openbuddy-email/src/jmap-provider.test.ts",
  // runtime / cordis / plugin host
  "packages/runtime/openbuddy-cordis/src/index.test.ts",
  "packages/runtime/openbuddy-plugin-host/src/plugin-manifest.test.ts",
  "packages/runtime/openbuddy-plugin-host/src/index.test.ts",
  "packages/runtime/openbuddy-plugin-host/src/bundle-manifest.test.ts",
  "packages/runtime/openbuddy-plugin-host/src/bundle-e2e.test.ts",
  "packages/runtime/openbuddy-plugin-host/src/deepseek-cordis-runtime.test.ts",
  "packages/runtime/openbuddy-plugin-host/src/hooks.test.ts",
  "packages/runtime/openbuddy-plugin-host/src/include.test.ts",
  "packages/runtime/openbuddy-plugin-host/src/js-expr.test.ts",
  "packages/runtime/openbuddy-plugin-host/src/persistence.test.ts",
  "packages/runtime/openbuddy-plugin-host/src/plugin-snapshot.test.ts",
  "packages/runtime/openbuddy-plugin-host/src/profile.test.ts",
  "packages/runtime/openbuddy-plugin-host/src/readiness.test.ts",
  "packages/runtime/openbuddy-plugin-host/src/remote-codec.test.ts",
  "packages/runtime/openbuddy-plugin-host/src/remote-manifest.test.ts",
  "packages/runtime/openbuddy-plugin-host/src/renderer-manifest.test.ts",
  "packages/runtime/openbuddy-plugin-host/src/rpc-contract.test.ts",
  "packages/runtime/openbuddy-plugin-host/src/typert-manifest.test.ts",
  "packages/runtime/openbuddy-plugin-host/src/yaml-patch.test.ts",
  "packages/runtime/openbuddy-storage/src/__tests__/contract.test.ts",
  "packages/runtime/openbuddy-storage/src/__tests__/metrics.test.ts",
  "packages/runtime/openbuddy-storage/src/__tests__/legacy-preflight.test.ts",
  "packages/runtime/openbuddy-storage/src/__tests__/event-store.test.ts",
  "packages/runtime/openbuddy-storage/src/__tests__/capability-catalogs.test.ts",
  // collaboration / teams / auth — in-memory + real protocol validation
  "packages/collaboration/openbuddy-inbox/src/index.test.ts",
  "packages/collaboration/openbuddy-room/src/index.test.ts",
  "packages/collaboration/openbuddy-policy/src/index.test.ts",
  "packages/collaboration/openbuddy-protocol/src/index.test.ts",
  "packages/collaboration/openbuddy-evidence/src/index.test.ts",
  "packages/collaboration/openbuddy-network/src/index.test.ts",
  "packages/collaboration/openbuddy-coordinator/src/index.test.ts",
  "packages/team/openbuddy-subagent/src/index.test.ts",
  "packages/team/openbuddy-team/src/index.test.ts",
  "packages/auth/openbuddy-permission/src/index.test.ts",
  // electron main — capability surface (real fs / real sqlite / real IPC payload)
  "electron/main/__tests__/harness-token-roundtrip.test.ts",
  "electron/main/__tests__/session-lifecycle-roundtrip.test.ts",
  "electron/main/__tests__/swebench-style-edit-verify.test.ts",
  "electron/main/__tests__/weknora-status.test.ts",
  "electron/main/__tests__/workspace-history-integration.test.ts",
  "packages/runtime/openbuddy-storage/src/__tests__/workspace-bootstrap.test.ts",
]

const TOP_TIER_ADAPTERS = [
  "evals/node/run_gaia_local.mjs",
  "evals/node/run_agentbench_tools.mjs",
  "evals/node/run_agentdojo_safety.mjs",
  "evals/node/run_mt_bench_style.mjs",
  "evals/node/run_bfcl_style.mjs",
  "evals/node/run_nl2bash_style.mjs",
  "evals/node/run_swe_bench_style.mjs",
]

const REAL_AGENT_OPTIONAL = !!(
  process.env.OPENBUDDY_HARNESS_URL &&
  process.env.OPENBUDDY_HARNESS_TOKEN &&
  process.env.OPENBUDDY_E2E_API_KEY &&
  process.env.OPENBUDDY_E2E_BASE_URL &&
  process.env.OPENBUDDY_E2E_MODEL_ID
)

// Pre-existing failures discovered by the expanded coverage. As of this round
// the two original failures (email undo-window dispatch + team catalog sync)
// have been fixed at the root cause. The list is kept empty so the pass gate
// reflects the full test surface.
const PRE_EXISTING_FAILURES = []

function spawnNode(scriptPath, args = []) {
  return new Promise((resolve) => {
    const child = spawn("node", [scriptPath, ...args], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    })
    let out = ""
    let err = ""
    child.stdout.on("data", (chunk) => (out += chunk.toString()))
    child.stderr.on("data", (chunk) => (err += chunk.toString()))
    child.on("exit", (code) => resolve({ code: code ?? 1, out, err }))
  })
}

function spawnVitest(files) {
  return new Promise((resolve) => {
    const args = ["vitest", "run", "--reporter=basic"]
    for (const f of files) args.push(f)
    const child = spawn("npx", args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    let err = ""
    child.stdout.on("data", (chunk) => (out += chunk.toString()))
    child.stderr.on("data", (chunk) => (err += chunk.toString()))
    child.on("exit", (code) => resolve({ code: code ?? 1, out, err }))
  })
}

async function spawnNodeWithTimeout(scriptPath, args = []) {
  return withHeartbeat(
    withTimeout(spawnNode(scriptPath, args), RUNNER_TIMEOUT_MS, `spawnNode:${scriptPath}`),
    { ms: RUNNER_HEARTBEAT_MS, label: `spawnNode:${scriptPath}` },
  )
}

async function spawnVitestWithTimeout(files) {
  return withHeartbeat(
    withTimeout(spawnVitest(files), RUNNER_TIMEOUT_MS, "spawnVitest"),
    { ms: RUNNER_HEARTBEAT_MS, label: "spawnVitest" },
  )
}

async function run() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const outDir = join(ROOT, "evidence", "closed-loop", stamp)
  await mkdir(outDir, { recursive: true })
  const summary = {
    schema: "openbuddy.closed-loop-capability-eval-full.v1",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    root: ROOT,
    testFiles: TEST_FILES,
    topTierAdapters: TOP_TIER_ADAPTERS,
    realAgentEvaluated: REAL_AGENT_OPTIONAL,
    runnerTimeoutMs: RUNNER_TIMEOUT_MS,
    runnerHeartbeatMs: RUNNER_HEARTBEAT_MS,
    runnerRetryAttempts: RUNNER_RETRY_ATTEMPTS,
    scriptHash: SCRIPT_HASH,
    vitest: { files: 0, tests: 0, passed: 0, failed: 0, exitCode: null, durationMs: null },
    capabilities: [],
    topTier: [],
    realAgent: null,
    pass: false,
  }

  const existing = TEST_FILES.filter((f) => existsSync(join(ROOT, f)))
  summary.capabilities = existing.map((f) => ({ path: f, exists: true }))
  const missing = TEST_FILES.filter((f) => !existsSync(join(ROOT, f)))
  summary.missingTestFiles = missing
  summary.preExistingFailingFiles = PRE_EXISTING_FAILURES
  const runnableForGate = existing.filter((f) => !PRE_EXISTING_FAILURES.includes(f))

  const vitestStarted = Date.now()
  const result = await spawnVitestWithTimeout(runnableForGate)
  summary.vitest.durationMs = Date.now() - vitestStarted
  await writeFile(join(outDir, "vitest-stdout.txt"), result.out)
  await writeFile(join(outDir, "vitest-stderr.txt"), result.err)

  const fileMatch = result.out.match(/Test Files[^\n]*?(\d+)\s+passed/)
  const testMatch = result.out.match(/Tests[^\n]*?(\d+)\s+passed/)
  const failMatch = result.out.match(/(\d+)\s+failed/)
  summary.vitest.exitCode = result.code
  summary.vitest.files = existing.length
  summary.vitest.passed = parseInt(fileMatch?.[1] ?? "0", 10)
  summary.vitest.tests = parseInt(testMatch?.[1] ?? "0", 10)
  summary.vitest.failed = failMatch ? parseInt(failMatch[1], 10) : 0

  for (const adapter of TOP_TIER_ADAPTERS) {
    const r = await withRetry(() => spawnNodeWithTimeout(join(ROOT, adapter)), {
      attempts: RUNNER_RETRY_ATTEMPTS,
      baseDelayMs: 500,
      onRetry: ({ attempt, error }) => {
        console.error(`[retry] adapter=${adapter} attempt=${attempt} error=${String(error?.message ?? error).slice(0, 120)}`)
      },
    })
    const adapterResults = []
    if (r.code === 0) {
      try {
        const match = r.out.match(/\{[\s\S]*\}\s*$/)
        if (match) {
          const parsed = JSON.parse(match[0])
          if (Array.isArray(parsed.results)) adapterResults.push(...parsed.results)
          else if (parsed && typeof parsed === "object") adapterResults.push({ id: parsed.id ?? adapter, ok: Boolean(parsed.pass), eventsFingerprint: parsed.eventsFingerprint ?? null })
        }
      } catch { /* ignore parse errors — adapter may emit non-JSON */ }
    }
    const adapterHash = adapterResults.length > 0 ? computeDatasetHash(adapterResults) : null
    const golden = adapterHash
      ? compareToGolden({
          runnerId: `closed-loop-${adapter.replace(/[^a-zA-Z0-9]+/g, "-")}`,
          datasetHash: adapterHash,
          results: adapterResults,
          goldenDir: join(GOLDEN_DIR, adapter.replace(/[^a-zA-Z0-9]+/g, "-")),
        })
      : { pass: true, status: "no-results", mismatches: [] }
    summary.topTier.push({
      script: adapter,
      exitCode: r.code,
      pass: r.code === 0 && golden.pass,
      stdoutTail: r.out.slice(-200),
      stderrTail: r.err.slice(-200),
      datasetHash: adapterHash,
      scriptHash: sha256OfText(readFileSync(join(ROOT, adapter), "utf8")),
      golden,
    })
  }

  if (REAL_AGENT_OPTIONAL) {
    try {
      const { runRealAgentEval } = await import("./closed-loop-real-agent.mjs").catch(() => ({}))
      if (typeof runRealAgentEval === "function") {
        const realResult = await runRealAgentEval({ outDir })
        summary.realAgent = realResult
      }
    } catch (error) {
      summary.realAgent = { error: String(error) }
    }
  } else {
    summary.realAgent = {
      skipped: true,
      reason: "OPENBUDDY_HARNESS_URL / OPENBUDDY_HARNESS_TOKEN / OPENBUDDY_E2E_API_KEY / OPENBUDDY_E2E_BASE_URL / OPENBUDDY_E2E_MODEL_ID not all set",
    }
  }

  summary.finishedAt = new Date().toISOString()
  summary.pass =
    summary.vitest.exitCode === 0 &&
    summary.topTier.every((entry) => entry.pass)
  summary.passScope = "runnableForGate (pre-existing failures excluded)"
  await writeFile(join(outDir, "closed-loop-summary.json"), JSON.stringify(summary, null, 2))

  console.log("\n=== OpenBuddy comprehensive closed-loop capability eval ===")
  console.log(`Evidence: ${outDir}`)
  const excluded = PRE_EXISTING_FAILURES.length
  console.log(`Test files discovered: ${summary.vitest.files} (ran: ${summary.vitest.passed + summary.vitest.failed}, missing on disk: ${missing.length}, pre-existing failures excluded: ${excluded})`)
  console.log(`Individual tests: passed=${summary.vitest.tests} failed=${summary.vitest.failed}`)
  console.log(`Top-tier adapters: ${summary.topTier.length} (passed: ${summary.topTier.filter((e) => e.pass).length})`)
  console.log(`Real agent run: ${REAL_AGENT_OPTIONAL ? "yes" : "skipped (no creds)"}`)
  console.log(`Duration: ${summary.vitest.durationMs}ms`)
  console.log(`Overall pass: ${summary.pass ? "✅" : "❌"}`)
  process.exit(summary.pass ? 0 : 1)
}

run().catch((error) => {
  console.error("closed-loop eval failed:", error)
  process.exit(2)
})
