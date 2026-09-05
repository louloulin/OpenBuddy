#!/usr/bin/env node
// Real-no-mock SWE-bench-style multi-file edit adapter.
//
// SWE-bench evaluates repository issue fix across multiple files. This
// adapter validates the dataset (initial files + expected marker), summarizes
// categories, and probes harness reachability.
//
// The adapter checks for: presence of initial files, expected marker, and
// oracle tool. It does NOT execute the real agent edits; that requires a
// live harness with provider credentials.
//
// Usage:
//   node evals/node/run_swe_bench_style.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..", "..")
const datasetPath = join(root, "evals", "datasets", "swe_bench_style_edits.jsonl")

const baseUrl = (process.env.OPENBUDDY_HARNESS_URL ?? "").replace(/\/+$/, "")
const token = process.env.OPENBUDDY_HARNESS_TOKEN ?? ""
const apiKey = process.env.OPENBUDDY_E2E_API_KEY ?? ""
const providerBase = process.env.OPENBUDDY_E2E_BASE_URL ?? ""
const modelId = process.env.OPENBUDDY_E2E_MODEL_ID ?? ""
const externalRequired = process.env.OPENBUDDY_E2E_REQUIRED === "1"

const externalConfigured = Boolean(apiKey && providerBase && modelId)
const harnessConfigured = Boolean(baseUrl && token)

const evidenceDir = process.env.OPENBUDDY_EVIDENCE_DIR
  ?? join(root, "evidence", "swe-bench-style")
const artifactPath = join(evidenceDir, "swe-bench-style.json")

const safeError = (error) => {
  let message = String(error?.message ?? error ?? "unknown error")
  if (apiKey) message = message.split(apiKey).join("[redacted-api-key]")
  return message
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted-api-key]")
    .replace(/OPENBUDDY_E2E_API_KEY[^\s]*/g, "OPENBUDDY_E2E_API_KEY=[redacted]")
    .slice(0, 500)
}

const digest = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 16)

function rpc(method, payload = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/api/${method}`)
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest
    const rpcId = `swe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const body = JSON.stringify({ type: "client-request", rpcId, method, payload })
    const req = transport(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, connection: "close" },
      agent: false,
    }, (res) => {
      let text = ""
      res.setEncoding("utf8")
      res.on("data", (chunk) => { text += chunk })
      res.on("end", () => {
        try { resolve(JSON.parse(text)) } catch { reject(new Error(`Non-JSON from ${method}`)) }
      })
    })
    req.on("error", reject)
    req.end(body)
  })
}

function loadDataset() {
  const text = readFileSync(datasetPath, "utf8")
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

function validateSweBenchDataset(rows) {
  const findings = []
  for (const row of rows) {
    if (!row?.id) findings.push({ id: "<missing>", code: "missing-id" })
    if (!row?.category) findings.push({ id: row.id, code: "missing-category" })
    if (!row?.description) findings.push({ id: row.id, code: "missing-description" })
    if (!row?.initialFiles || typeof row.initialFiles !== "object") {
      findings.push({ id: row.id, code: "missing-initial-files" })
    } else {
      const files = Object.keys(row.initialFiles)
      if (files.length === 0) findings.push({ id: row.id, code: "empty-initial-files" })
    }
    if (!row?.expectedMarker) findings.push({ id: row.id, code: "missing-marker" })
    if (!Array.isArray(row?.requiredEvents)) findings.push({ id: row.id, code: "missing-required-events" })
    if (!row?.oracleTool) findings.push({ id: row.id, code: "missing-oracle-tool" })
  }
  return findings
}

function summarizeLocalEvidence(rows) {
  return {
    schema: "openbuddy.swe-bench-style-local.v1",
    datasetPath,
    datasetRows: rows.length,
    structuralFindings: validateSweBenchDataset(rows),
    categories: rows.reduce((acc, row) => {
      acc[row.category] = (acc[row.category] ?? 0) + 1
      return acc
    }, {}),
    tasks: rows.map((row) => ({
      id: row.id,
      category: row.category,
      description: row.description,
      fileCount: Object.keys(row.initialFiles ?? {}).length,
      expectedMarker: row.expectedMarker,
      markerDigest: digest(row.expectedMarker),
      requiredEvents: row.requiredEvents,
      oracleTool: row.oracleTool,
    })),
    externalProvider: externalConfigured
      ? { configured: true, model: modelId, provider: providerBase }
      : { configured: false, reason: "missing OPENBUDDY_E2E_API_KEY/BASE_URL/MODEL_ID" },
    harness: harnessConfigured
      ? { configured: true, baseUrl }
      : { configured: false, reason: "missing OPENBUDDY_HARNESS_URL/TOKEN" },
    mode: externalConfigured && harnessConfigured ? "real-external" : "local-evidence-only",
  }
}

let remoteResults = []
async function runRemoteIfAvailable() {
  if (!harnessConfigured) return
  try {
    const desc = await rpc("host.describe", {})
    remoteResults.push({ code: "host.describe", ok: Boolean(desc?.result?.ok) })
  } catch (error) {
    remoteResults.push({ code: "host.describe", ok: false, error: safeError(error) })
  }
}

async function main() {
  const rows = await loadDataset()
  const local = summarizeLocalEvidence(rows)
  await runRemoteIfAvailable()
  if (remoteResults.length) local.harness.probe = remoteResults

  const summary = {
    ...local,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    pass: local.structuralFindings.length === 0
      && (!externalRequired || (externalConfigured && harnessConfigured)),
  }

  mkdirSync(evidenceDir, { recursive: true })
  writeFileSync(artifactPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8")

  if (externalRequired && !(externalConfigured && harnessConfigured)) {
    console.error(`swe-bench-style: external required but not configured. See ${artifactPath}`)
    process.exit(2)
  }
  if (local.structuralFindings.length > 0) {
    console.error(`swe-bench-style: ${local.structuralFindings.length} structural findings. See ${artifactPath}`)
    process.exit(1)
  }
  console.log(JSON.stringify({ ...summary, artifactPath }, null, 2))
}

main().catch((error) => {
  console.error(`swe-bench-style: error=${safeError(error)}`)
  process.exit(1)
})
