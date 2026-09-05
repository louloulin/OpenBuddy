// Bridge smoke test for evals/node/openbuddy_agent_bridge.mjs
//
// Spins up a minimal HTTP server on a random port that emulates the OpenBuddy
// harness RPC surface (llm.models, session.create, session.prompt,
// agent.event-log, capability.email) so we can verify the bridge wiring
// without booting Electron. This proves the model-id fallback, event polling
// loop, and analysis readback in isolation.
import { createServer } from "node:http"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { spawn } from "node:child_process"

const script = join(process.cwd(), "evals/node/openbuddy_agent_bridge.mjs")

function startStubHarness(handlers) {
  return new Promise((resolve) => {
    const events = []
    const settledAt = new Map()
    const analysesByThread = new Map()
    const server = createServer((req, res) => {
      let body = ""
      req.on("data", (chunk) => { body += chunk })
      req.on("end", async () => {
        try {
          const { method, payload } = JSON.parse(body || "{}")
          const handler = handlers[method]
          if (!handler) {
            res.setHeader("content-type", "application/json")
            res.end(JSON.stringify({ result: { ok: false, error: { message: `no stub for ${method}` } } }))
            return
          }
          const result = await handler(payload ?? {}, { events, settledAt, analysesByThread })
          res.setHeader("content-type", "application/json")
          res.end(JSON.stringify({ result: { ok: true, value: result } }))
        } catch (error) {
          res.setHeader("content-type", "application/json")
          res.end(JSON.stringify({ result: { ok: false, error: { message: error instanceof Error ? error.message : String(error) } } }))
        }
      })
    })
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        token: "stub-token",
        events,
        settledAt,
        analysesByThread,
        async stop() { await new Promise((resolve) => server.close(resolve)) },
      })
    })
  })
}

async function runBridge(env) {
  const tmp = await mkdtemp(join(tmpdir(), "openbuddy-bridge-test-"))
  const out = join(tmp, "predictions.json")
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, ...env, OPENBUDDY_AGENT_BRIDGE_OUT: out, OPENBUDDY_AGENT_BRIDGE_LIMIT: "1", OPENBUDDY_AGENT_BRIDGE_TIMEOUT_MS: "10000" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const stderr = []
  child.stderr.on("data", (chunk) => stderr.push(chunk))
  const code = await new Promise((resolve) => child.on("exit", resolve))
  let predictions = []
  try {
    predictions = JSON.parse(await readFile(out, "utf8"))
  } catch {
    predictions = []
  }
  await rm(tmp, { recursive: true, force: true })
  return { code, stderr: Buffer.concat(stderr).toString(), predictions }
}

describe("openbuddy_agent_bridge wiring", () => {
  let harness

  beforeEach(async () => {
    harness = await startStubHarness({
      "llm.models": () => ({ groups: [{ provider: "custom_anthropic", name: "Stub Anthropic", models: [{ modelId: "MiniMax-M3", providerId: "custom_anthropic", name: "MiniMax-M3" }] }], failures: [] }),
      "session.create": (_payload, ctx) => {
        const sessionId = `stub-session-${Math.random().toString(36).slice(2, 8)}`
        ctx.events.push({ sessionId, sequence: 1, type: "session/created", payload: { cwd: "/tmp" } })
        return { sessionId }
      },
      "session.prompt": (_payload, ctx) => {
        const sessionId = ctx.events[ctx.events.length - 1].sessionId
        ctx.events.push({ sessionId, sequence: 2, type: "agent/turn", payload: {} })
        ctx.events.push({ sessionId, sequence: 3, type: "agent/settled", payload: {} })
        ctx.settledAt.set(sessionId, Date.now())
        const caseId = "quote-request-customer-a"
        ctx.analysesByThread.set(`t-${caseId}`, [{ kind: "actions", threadId: `t-${caseId}`, accountId: `bridge-${caseId}`, actions: [{ content: "Reply customer", owner: "me", dueAt: null, citations: [{ messageId: `m-${caseId}`, quote: "snippet" }] }] }])
        return { accepted: true }
      },
      "agent.event-log": (payload, ctx) => ctx.events.filter((event) => !payload?.sessionId || event.sessionId === payload.sessionId),
      "capability.email": (payload, ctx) => ctx.analysesByThread.get(payload.threadId) ?? [],
    })
  })

  afterEach(async () => {
    if (harness) await harness.stop()
  })

  it("connects to a stub harness, drives a single case, and reads back actions", async () => {
    const result = await runBridge({
      OPENBUDDY_HARNESS_URL: harness.url,
      OPENBUDDY_HARNESS_TOKEN: harness.token,
      OPENBUDDY_E2E_MODEL_ID: "MiniMax-M3",
    })
    expect(result.code).toBe(0)
    expect(result.stderr).toMatch(/pickModelId -> custom_anthropic\/MiniMax-M3/)
    expect(result.predictions).toHaveLength(1)
    expect(result.predictions[0].id).toBe("quote-request-customer-a")
    expect(result.predictions[0].actions).toEqual([
      { content: "Reply customer", owner: "me", dueAt: null, messageId: "m-quote-request-customer-a" },
    ])
  }, 30_000)

  it("falls back to bare model id when provider-prefixed lookup fails", async () => {
    const failingHarness = await startStubHarness({
      "llm.models": () => ({ groups: [{ provider: "custom_anthropic", name: "Stub", models: [{ modelId: "MiniMax-M3", providerId: "custom_anthropic" }] }], failures: [] }),
      "session.create": (payload, ctx) => {
        if (payload?.modelId === "custom_anthropic/MiniMax-M3") {
          throw new Error("openbuddy-agent: model custom_anthropic/MiniMax-M3 not found")
        }
        const sessionId = "fallback-session"
        ctx.events.push({ sessionId, sequence: 1, type: "session/created", payload: {} })
        ctx.events.push({ sessionId, sequence: 2, type: "agent/settled", payload: {} })
        ctx.settledAt.set(sessionId, Date.now())
        const caseId = "quote-request-customer-a"
        ctx.analysesByThread.set(`t-${caseId}`, [{ kind: "actions", threadId: `t-${caseId}`, accountId: `bridge-${caseId}`, actions: [] }])
        return { sessionId }
      },
      "session.prompt": () => ({ accepted: true }),
      "agent.event-log": (payload, ctx) => ctx.events.filter((event) => !payload?.sessionId || event.sessionId === payload.sessionId),
      "capability.email": (payload, ctx) => ctx.analysesByThread.get(payload.threadId) ?? [],
    })
    try {
      const result = await runBridge({
        OPENBUDDY_HARNESS_URL: failingHarness.url,
        OPENBUDDY_HARNESS_TOKEN: failingHarness.token,
        OPENBUDDY_E2E_MODEL_ID: "MiniMax-M3",
      })
      expect(result.code).toBe(0)
      expect(result.stderr).toMatch(/session.create\(custom_anthropic\/MiniMax-M3\) failed/)
    } finally {
      await failingHarness.stop()
    }
  }, 30_000)

  it("fails fast with a clear error when harness env vars are missing", async () => {
    const result = await runBridge({
      OPENBUDDY_HARNESS_URL: "",
      OPENBUDDY_HARNESS_TOKEN: "",
    })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toMatch(/OPENBUDDY_HARNESS_URL/)
  }, 15_000)
})
