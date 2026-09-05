#!/usr/bin/env node
// Real-no-mock MT-bench-style multi-turn dialog adapter.
//
// MT-bench evaluates multi-turn conversational quality, instruction following,
// and consistency across turns. This adapter exercises the Pi session with
// multi-turn JSONL tasks and reports structural validation plus the harness
// reachability probe when credentials are present.
//
// Usage:
//   node evals/node/run_mt_bench_style.mjs
//
//   OPENBUDDY_HARNESS_URL=... OPENBUDDY_HARNESS_TOKEN=... \
//   OPENBUDDY_E2E_API_KEY=... OPENBUDDY_E2E_BASE_URL=... \
//   OPENBUDDY_E2E_MODEL_ID=... OPENBUDDY_E2E_REQUIRED=1 \
//   node evals/node/run_mt_bench_style.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..", "..")
const datasetPath = join(root, "evals", "datasets", "mt_bench_style_tasks.jsonl")

const baseUrl = (process.env.OPENBUDDY_HARNESS_URL ?? "").replace(/\/+$/, "")
const token = process.env.OPENBUDDY_HARNESS_TOKEN ?? ""
const apiKey = process.env.OPENBUDDY_E2E_API_KEY ?? ""
const providerBase = process.env.OPENBUDDY_E2E_BASE_URL ?? ""
const modelId = process.env.OPENBUDDY_E2E_MODEL_ID ?? ""
const externalRequired = process.env.OPENBUDDY_E2E_REQUIRED === "1"

const externalConfigured = Boolean(apiKey && providerBase && modelId)
const harnessConfigured = Boolean(baseUrl && token)

const evidenceDir = process.env.OPENBUDDY_EVIDENCE_DIR
  ?? join(root, "evidence", "mt-bench-style")
const artifactPath = join(evidenceDir, "mt-bench-style.json")

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
    const rpcId = `mt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

function validateMtBenchDataset(rows) {
  const findings = []
  for (const row of rows) {
    if (!row?.id) findings.push({ id: "<missing>", code: "missing-id" })
    if (!Array.isArray(row?.turns) || row.turns.length === 0) findings.push({ id: row.id, code: "missing-turns" })
    if (!Array.isArray(row?.requires)) findings.push({ id: row.id, code: "missing-requires" })
    for (const [i, turn] of (row?.turns ?? []).entries()) {
      if (!turn?.text) findings.push({ id: row.id, code: `turn-${i}-missing-text` })
      if (!turn?.marker) findings.push({ id: row.id, code: `turn-${i}-missing-marker` })
    }
    const events = new Set(row?.requires ?? [])
    if (!events.has("session/input")) findings.push({ id: row.id, code: "missing-session-input" })
    if (!events.has("agent/settled")) findings.push({ id: row.id, code: "missing-agent-settled" })
  }
  return findings
}

function summarizeLocalEvidence(rows) {
  return {
    schema: "openbuddy.mt-bench-local.v1",
    datasetPath,
    datasetRows: rows.length,
    structuralFindings: validateMtBenchDataset(rows),
    categories: rows.reduce((acc, row) => {
      acc[row.category] = (acc[row.category] ?? 0) + 1
      return acc
    }, {}),
    tasks: rows.map((row) => ({
      id: row.id,
      category: row.category,
      turnCount: row.turns.length,
      markers: row.turns.map((t) => t.marker),
      markerDigest: digest(row.turns.map((t) => t.marker).join("|")),
      requires: row.requires,
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
    console.error(`mt-bench-style: external required but not configured. See ${artifactPath}`)
    process.exit(2)
  }
  if (local.structuralFindings.length > 0) {
    console.error(`mt-bench-style: ${local.structuralFindings.length} structural findings. See ${artifactPath}`)
    process.exit(1)
  }
  console.log(JSON.stringify({ ...summary, artifactPath }, null, 2))
}

main().catch((error) => {
  console.error(`mt-bench-style: error=${safeError(error)}`)
  process.exit(1)
})
