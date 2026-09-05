import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const script = join(process.cwd(), "evals/node/run_email_ai_blind_test.mjs")
const dataset = join(process.cwd(), "evals/datasets/email_ai_quality_cases.json")
const evaluator = join(process.cwd(), "evals/node/evaluate_email_ai_quality.mjs")

const baseEnv = {
  OPENBUDDY_EMAIL_AI_QUALITY_MODEL: "mock",
  OPENBUDDY_EMAIL_AI_QUALITY_MODEL_ID: "mock-fixture-v1",
  OPENBUDDY_EMAIL_AI_QUALITY_DATASET: dataset,
  OPENBUDDY_EMAIL_AI_QUALITY_REQUIRE_PASS: "1",
}

let evidenceDir

beforeEach(async () => {
  evidenceDir = await mkdtemp(join(tmpdir(), "openbuddy-email-ai-blind-"))
})

afterEach(async () => {
  if (evidenceDir) await rm(evidenceDir, { recursive: true, force: true })
})

async function runRunner(extraEnv = {}) {
  const result = await execFileAsync(process.execPath, [script], {
    cwd: process.cwd(),
    env: { ...process.env, ...baseEnv, OPENBUDDY_EVIDENCE_DIR: evidenceDir, ...extraEnv },
    maxBuffer: 8 * 1024 * 1024,
  })
  return result
}

async function runEvaluator(predictionsPath) {
  const result = await execFileAsync(process.execPath, [evaluator], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPENBUDDY_EMAIL_AI_QUALITY_DATASET: dataset,
      OPENBUDDY_EMAIL_AI_QUALITY_PREDICTIONS: predictionsPath,
    },
    maxBuffer: 8 * 1024 * 1024,
  })
  return JSON.parse(result.stdout || "{}")
}

describe("email AI blind test runner", () => {
  it("runs the full 51-case dataset in openbuddy-agent mode with realE2E evidence", async () => {
    const result = await runRunner({
      OPENBUDDY_EMAIL_AI_QUALITY_MODEL: "openbuddy-agent",
      OPENBUDDY_EMAIL_AI_QUALITY_MODEL_ID: "openbuddy-email-capability",
      OPENBUDDY_EMAIL_AI_QUALITY_REQUIRE_PASS: "0",
    })
    expect(result.stderr).toMatch(/running 51\/51 cases/)
    const datasetDirs = await import("node:fs/promises").then((fs) => fs.readdir(join(evidenceDir, "email-ai-quality")))
    const runDir = join(evidenceDir, "email-ai-quality", datasetDirs[0])
    const manifest = JSON.parse(await readFile(join(runDir, "manifest.json"), "utf8"))
    expect(manifest.modelKind).toBe("openbuddy-agent")
    expect(manifest.realE2E).toBe(true)
    expect(manifest.errorCount).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.metrics.noActionAccuracy).toBe(1)
    expect(report.metrics.citationCoverage).toBe(1)
  }, 60_000)

  it("runs the full 51-case dataset in mock mode and passes the quality gate", async () => {
    const result = await runRunner()
    expect(result.stderr).toMatch(/running 51\/51 cases/)
    const predictionsPath = join(evidenceDir, "email-ai-quality")
    const datasetDirs = await import("node:fs/promises").then((fs) => fs.readdir(predictionsPath))
    expect(datasetDirs.length).toBeGreaterThan(0)
    const runDir = join(predictionsPath, datasetDirs[0])
    const predictions = JSON.parse(await readFile(join(runDir, "predictions.json"), "utf8"))
    expect(predictions).toHaveLength(51)
    const report = JSON.parse(result.stdout)
    expect(report.qualityGate.passed).toBe(true)
    expect(report.metrics.actionPrecision).toBe(1)
    expect(report.metrics.actionRecall).toBe(1)
    expect(report.metrics.noActionAccuracy).toBe(1)
    expect(report.metrics.caseExactMatch).toBe(1)
  }, 30_000)

  it("respects the limit env to run a subset of cases in dry-run", async () => {
    const result = await runRunner({ OPENBUDDY_EMAIL_AI_QUALITY_LIMIT: "5", OPENBUDDY_EMAIL_AI_QUALITY_DRY_RUN: "1" })
    expect(result.stderr).toMatch(/running 5\/51 cases/)
  }, 30_000)

  it("writes manifest.json alongside predictions.json", async () => {
    const result = await runRunner()
    const datasetDirs = await import("node:fs/promises").then((fs) => fs.readdir(join(evidenceDir, "email-ai-quality")))
    const runDir = join(evidenceDir, "email-ai-quality", datasetDirs[0])
    const manifest = JSON.parse(await readFile(join(runDir, "manifest.json"), "utf8"))
    expect(manifest.schema).toBe("openbuddy.email-ai-blind-run.v1")
    expect(manifest.caseCount).toBe(51)
    expect(manifest.modelKind).toBe("mock")
    expect(manifest.runId).toBeDefined()
  }, 30_000)

  it("dry-run produces predictions but skips the evaluator", async () => {
    const result = await runRunner({ OPENBUDDY_EMAIL_AI_QUALITY_DRY_RUN: "1" })
    expect(result.stderr).toMatch(/dry-run, skipping evaluator/)
    const datasetDirs = await import("node:fs/promises").then((fs) => fs.readdir(join(evidenceDir, "email-ai-quality")))
    expect(datasetDirs.length).toBe(1)
  }, 30_000)

  it("openbuddy-agent-harness mode reports harness env missing instead of hanging", async () => {
    // Runner swallows per-case errors into { ok:false } so we inspect the
    // manifest.errors[] surface instead of stderr. We also relax the quality
    // gate because no harness means precision/recall == 0 by design.
    const result = await runRunner({
      OPENBUDDY_EMAIL_AI_QUALITY_MODEL: "openbuddy-agent-harness",
      OPENBUDDY_EMAIL_AI_QUALITY_MODEL_ID: "openbuddy-pi-agent",
      OPENBUDDY_EMAIL_AI_QUALITY_LIMIT: "1",
      OPENBUDDY_EMAIL_AI_QUALITY_REQUIRE_PASS: "0",
      OPENBUDDY_HARNESS_URL: "",
      OPENBUDDY_HARNESS_TOKEN: "",
    })
    expect(result.stderr).toMatch(/running 1\/51 cases/)
    const datasetDirs = await import("node:fs/promises").then((fs) => fs.readdir(join(evidenceDir, "email-ai-quality")))
    const runDir = join(evidenceDir, "email-ai-quality", datasetDirs[0])
    const manifest = JSON.parse(await readFile(join(runDir, "manifest.json"), "utf8"))
    expect(manifest.modelKind).toBe("openbuddy-agent-harness")
    expect(manifest.realE2E).toBe(true)
    expect(manifest.errorCount).toBe(1)
    expect(manifest.errors[0].error).toMatch(/OPENBUDDY_HARNESS_URL/)
    // Bridge artifact directory is created even on failure so debugging is easier.
    const harnessBridgeDir = join(runDir, "agent-harness")
    const harnessBridgeFiles = await import("node:fs/promises").then((fs) => fs.readdir(harnessBridgeDir).catch(() => []))
    expect(harnessBridgeFiles.length).toBeGreaterThan(0)
  }, 30_000)

  it("evaluator rejects empty predictions with full quality gate failures", async () => {
    const raw = await readFile(dataset, "utf8")
    const cases = JSON.parse(raw)
    const predictions = cases.map((c) => ({ id: c.id, actions: [] }))
    const tmp = await mkdtemp(join(tmpdir(), "openbuddy-email-ai-empty-"))
    const predictionsPath = join(tmp, "predictions.json")
    await import("node:fs/promises").then((fs) => fs.writeFile(predictionsPath, JSON.stringify(predictions)))
    try {
      const result = await runEvaluator(predictionsPath)
      expect(result.metrics.actionPrecision).toBe(0)
      expect(result.metrics.actionRecall).toBe(0)
      expect(result.metrics.noActionAccuracy).toBeGreaterThan(0)
      expect(result.qualityGate.passed).toBe(false)
      expect(result.qualityGate.failures.length).toBeGreaterThan(0)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
