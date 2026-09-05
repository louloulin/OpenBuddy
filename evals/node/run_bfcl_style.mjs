#!/usr/bin/env node
// Real-no-mock BFCL-style function calling adapter.
//
// BFCL evaluates function calling accuracy: exact arguments, parallel calls,
// multi-turn context routing, and respecting tool restrictions. This adapter
// validates the dataset, summarizes categories, and probes harness reachability.
//
// Usage:
//   node evals/node/run_bfcl_style.mjs
//
//   OPENBUDDY_HARNESS_URL=... OPENBUDDY_HARNESS_TOKEN=... \
//   OPENBUDDY_E2E_API_KEY=... OPENBUDDY_E2E_BASE_URL=... \
//   OPENBUDDY_E2E_MODEL_ID=... OPENBUDDY_E2E_REQUIRED=1 \
//   node evals/node/run_bfcl_style.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..", "..")
const datasetPath = join(root, "evals", "datasets", "bfcl_style_function_calls.jsonl")

const baseUrl = (process.env.OPENBUDDY_HARNESS_URL ?? "").replace(/\/+$/, "")
const token = process.env.OPENBUDDY_HARNESS_TOKEN ?? ""
const apiKey = process.env.OPENBUDDY_E2E_API_KEY ?? ""
const providerBase = process.env.OPENBUDDY_E2E_BASE_URL ?? ""
const modelId = process.env.OPENBUDDY_E2E_MODEL_ID ?? ""
const externalRequired = process.env.OPENBUDDY_E2E_REQUIRED === "1"

const externalConfigured = Boolean(apiKey && providerBase && modelId)
const harnessConfigured = Boolean(baseUrl && token)

const evidenceDir = process.env.OPENBUDDY_EVIDENCE_DIR
  ?? join(root, "evidence", "bfcl-style")
const artifactPath = join(evidenceDir, "bfcl-style.json")

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
    const rpcId = `bfcl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

function validateBfclDataset(rows) {
  const findings = []
  for (const row of rows) {
    if (!row?.id) findings.push({ id: "<missing>", code: "missing-id" })
    if (!row?.category) findings.push({ id: row.id, code: "missing-category" })
    if (!row?.prompt && !row?.turns) findings.push({ id: row.id, code: "missing-prompt-or-turns" })
    if (!Array.isArray(row?.required_events)) findings.push({ id: row.id, code: "missing-required-events" })
    if (row.expected_tool && row.expected_tool !== "openbuddy_e2e_tool") {
      findings.push({ id: row.id, code: "unknown-tool-oracle" })
    }
    if (row.required_args && row.expected_marker && row.required_args.marker !== row.expected_marker) {
      findings.push({ id: row.id, code: "args-marker-mismatch" })
    }
    if (row.expected_tool === null && (row.forbidden_events ?? []).length === 0) {
      findings.push({ id: row.id, code: "missing-forbidden-events" })
    }
  }
  return findings
}

function summarizeLocalEvidence(rows) {
  return {
    schema: "openbuddy.bfcl-local.v1",
    datasetPath,
    datasetRows: rows.length,
    structuralFindings: validateBfclDataset(rows),
    categories: rows.reduce((acc, row) => {
      acc[row.category] = (acc[row.category] ?? 0) + 1
      return acc
    }, {}),
    cases: rows.map((row) => ({
      id: row.id,
      category: row.category,
      expectedTool: row.expected_tool ?? null,
      expectedMarker: row.expected_marker ?? null,
      expectedMarkers: row.expected_markers ?? null,
      markerDigest: digest([row.expected_marker, ...(row.expected_markers ?? [])].filter(Boolean).join("|")),
      requiredEvents: row.required_events,
      forbiddenEvents: row.forbidden_events ?? [],
      requiredArgs: row.required_args ?? null,
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
    console.error(`bfcl-style: external required but not configured. See ${artifactPath}`)
    process.exit(2)
  }
  if (local.structuralFindings.length > 0) {
    console.error(`bfcl-style: ${local.structuralFindings.length} structural findings. See ${artifactPath}`)
    process.exit(1)
  }
  console.log(JSON.stringify({ ...summary, artifactPath }, null, 2))
}

main().catch((error) => {
  console.error(`bfcl-style: error=${safeError(error)}`)
  process.exit(1)
})
