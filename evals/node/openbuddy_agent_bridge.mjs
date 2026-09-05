// OpenBuddy Pi Agent bridge.
// Drives the running OpenBuddy Electron harness via HTTP RPC, letting the
// real Pi Agent (LLM-backed) extract action candidates for each test case.
//
// Required env vars (provided by the Ollama launcher):
//   OPENBUDDY_HARNESS_URL     — e.g. http://127.0.0.1:54321
//   OPENBUDDY_HARNESS_TOKEN    — bearer token
//
// Output:
//   Writes {id, actions}[] to OPENBUDDY_AGENT_BRIDGE_OUT.
//
// Each case:
//   1. Creates a Pi session via `session.create`
//   2. Sends a goal describing the email + telling the agent to call
//      `email_extract_action_candidates` and then `email_save_analysis`
//      with the structured actions it produces.
//   3. Waits for `agent/settled` in the event log.
//   4. Reads back the saved analysis via `capability.email.list-analyses`.
//   5. Maps to the blind-test prediction shape.
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"

const baseUrl = (process.env.OPENBUDDY_HARNESS_URL ?? "").replace(/\/+$/, "")
const token = process.env.OPENBUDDY_HARNESS_TOKEN ?? ""
if (!baseUrl || !token) {
  console.error("[agent-bridge] OPENBUDDY_HARNESS_URL and OPENBUDDY_HARNESS_TOKEN are required")
  process.exit(2)
}

const datasetPath = process.env.OPENBUDDY_AGENT_BRIDGE_DATASET ?? join(process.cwd(), "evals/datasets/email_ai_quality_cases.json")
const outPath = process.env.OPENBUDDY_AGENT_BRIDGE_OUT ?? join(process.cwd(), "evidence/email-ai-quality/agent-bridge-predictions.json")
const limit = Number(process.env.OPENBUDDY_AGENT_BRIDGE_LIMIT ?? "0")
const timeoutMs = Number(process.env.OPENBUDDY_AGENT_BRIDGE_TIMEOUT_MS ?? "120000")

function rpc(method, payload = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/api/${method}`)
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest
    const rpcId = `agent-bridge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const body = JSON.stringify({ type: "client-request", rpcId, method, payload })
    const req = transport(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      agent: false,
    }, (res) => {
      let text = ""
      res.setEncoding("utf8")
      res.on("data", (c) => { text += c })
      res.on("end", () => {
        try { resolve({ rpcId, status: res.statusCode ?? 0, body: JSON.parse(text) }) }
        catch { reject(new Error(`non-JSON response (status=${res.statusCode}): ${text.slice(0, 200)}`)) }
      })
    })
    req.on("error", reject)
    req.end(body)
  })
}

function resultValue(response, label) {
  if (!response?.body?.result?.ok) {
    const err = response?.body?.result?.error ?? {}
    const message = err.message ?? "unknown RPC error"
    const detail = err.code ? ` code=${err.code}` : ""
    const extra = err.data ? ` data=${JSON.stringify(err.data).slice(0, 200)}` : ""
    throw new Error(`${label} failed: ${message}${detail}${extra}`)
  }
  return response.body.result.value
}

async function providerCatalog() {
  const modelsResp = await rpc("llm.models", {})
  const modelsValue = resultValue(modelsResp, "llm.models")
  const groups = Array.isArray(modelsValue?.groups) ? modelsValue.groups : []
  const flat = groups.flatMap((group) => (Array.isArray(group.models) ? group.models.map((model) => ({ ...model, providerId: model.providerId ?? group.provider })) : []))
  return { providers: groups.map((group) => ({ id: group.provider, label: group.name })), models: flat }
}

function pickModelId(catalog) {
  // OpenBuddy setModel parses modelId as `provider/modelId`. Return the full
  // qualified form so setModel can resolve it through ModelRegistry.
  const preferred = process.env.OPENBUDDY_E2E_MODEL_ID
  const models = Array.isArray(catalog?.models) ? catalog.models : []
  if (preferred) {
    if (preferred.includes("/")) return preferred
    const exact = models.find((model) => model.modelId === preferred || model.id === preferred || model.name === preferred)
    if (exact) return `${exact.providerId ?? "custom"}/${exact.modelId ?? exact.id ?? preferred}`
  }
  const fallback = models.find((model) => /minimax|m3/i.test(`${model.modelId ?? model.id ?? model.name ?? ""}`))
  return fallback ? `${fallback.providerId ?? "custom"}/${fallback.modelId ?? fallback.id}` : preferred
}

async function sessionNew(cwd) {
  const catalog = await providerCatalog()
  const primary = pickModelId(catalog)
  process.stderr.write(`[agent-bridge] pickModelId -> ${primary}\n`)
  // Try provider/model first, then bare model id, then no modelId (use harness default).
  const candidates = []
  if (primary) candidates.push(primary)
  if (primary && primary.includes("/")) candidates.push(primary.split("/", 2)[1])
  candidates.push(undefined)
  const seen = new Set()
  let lastError
  for (const candidate of candidates) {
    const key = candidate ?? "__default__"
    if (seen.has(key)) continue
    seen.add(key)
    try {
      const payload = candidate === undefined ? { cwd } : { cwd, modelId: candidate }
      const response = await rpc("session.create", payload)
      const value = resultValue(response, "session.create")
      if (typeof value === "string") return value
      if (value?.sessionId) return value.sessionId
      throw new Error("session.create returned no sessionId")
    } catch (error) {
      lastError = error
      process.stderr.write(`[agent-bridge] session.create(${candidate ?? "default"}) failed: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  throw lastError ?? new Error("session.create: all modelId candidates failed")
}

async function sessionPrompt(sessionId, text) {
  const response = await rpc("session.prompt", { sessionId, text })
  return resultValue(response, "session.prompt")
}

async function eventLog(sessionId, limit = 2000) {
  const response = await rpc("agent.event-log", { sessionId, limit })
  const value = resultValue(response, "agent.event-log")
  if (!Array.isArray(value)) throw new Error("event-log returned a non-array")
  return value.filter((event) => event?.sessionId === sessionId).sort((a, b) => (a.sequence ?? -1) - (b.sequence ?? -1))
}

async function waitForSettled(sessionId, cursor, timeoutMsLocal) {
  const deadline = Date.now() + timeoutMsLocal
  while (Date.now() < deadline) {
    const events = await eventLog(sessionId)
    const post = events.filter((event) => (event.sequence ?? -1) > cursor)
    if (post.some((event) => event.type === "agent/settled")) {
      return { events, settledAt: Date.now() }
    }
    if (post.some((event) => event.type === "agent/error" || event.type === "turn/error")) {
      const errorEvent = post.find((event) => event.type === "agent/error" || event.type === "turn/error")
      throw new Error(`agent emitted error: ${JSON.stringify(errorEvent?.payload ?? {}).slice(0, 200)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`event wait timed out for ${sessionId.slice(0, 8)}`)
}

async function listAnalyses(accountId, threadId) {
  const response = await rpc("capability.email", { action: "analyses", accountId, threadId })
  return resultValue(response, "email.list-analyses")
}

async function callEmailExtractActionCandidates(accountId, threadId, subject, body, messageId) {
  // Drive the real OpenBuddy Pi Agent: ask it to call the AI extraction tool.
  const goal = [
    "You are the OpenBuddy AI email agent. The email below was just received.",
    "Task:",
    `1. Call the tool \`email_extract_action_candidates\` with parameters { subject, body, messages: [{ id: "${messageId}", from: "test@example.com" }] } to get structured candidates.`,
    `2. For each candidate, immediately call \`email_save_analysis\` with kind="actions" and accountId="${accountId}" threadId="${threadId}" confidence=0.9 to persist the AI analysis.`,
    `3. Reply with a one-line summary of how many actions you persisted.`,
    "",
    "Email:",
    `Subject: ${subject}`,
    "",
    body,
  ].join("\n")
  return goal
}

async function runCase(testCase) {
  const accountId = `bridge-${testCase.id}`
  const threadId = `t-${testCase.id}`
  const messageId = testCase.messages?.[0]?.id ?? `m-${testCase.id}`
  try {
    const sessionId = await sessionNew(process.cwd())
    const initialEvents = await eventLog(sessionId)
    const cursor = initialEvents.length > 0 ? (initialEvents.at(-1)?.sequence ?? -1) : -1
    const goal = await callEmailExtractActionCandidates(accountId, threadId, testCase.subject, testCase.body, messageId)
    await sessionPrompt(sessionId, goal)
    await waitForSettled(sessionId, cursor, timeoutMs)
    const analyses = await listAnalyses(accountId, threadId).catch(() => [])
    const actionsRecord = analyses.find((record) => record.kind === "actions" && record.threadId === threadId)
    if (!actionsRecord) return { id: testCase.id, actions: [] }
    return {
      id: testCase.id,
      actions: (actionsRecord.actions ?? []).map((action) => ({
        content: action.content,
        owner: action.owner,
        dueAt: action.dueAt,
        messageId: action.citations?.[0]?.messageId ?? messageId,
      })),
    }
  } catch (error) {
    return { id: testCase.id, actions: [], error: error instanceof Error ? error.message : String(error) }
  }
}

async function main() {
  const cases = JSON.parse(readFileSync(datasetPath, "utf8"))
  const subset = limit > 0 ? cases.slice(0, limit) : cases
  console.error(`[agent-bridge] running ${subset.length}/${cases.length} cases via harness url=${baseUrl}`)
  const predictions = []
  for (const testCase of subset) {
    process.stderr.write(`[agent-bridge] ${testCase.id}\n`)
    predictions.push(await runCase(testCase))
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(predictions, null, 2))
  console.error(`[agent-bridge] wrote ${predictions.length} predictions to ${outPath}`)
}

main().catch((error) => {
  console.error("[agent-bridge] fatal:", error)
  process.exit(1)
})
