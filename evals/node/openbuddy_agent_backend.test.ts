import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Context } from "@openbuddy/cordis"
import { Email, EmailError, extractEmailActionCandidates, type EmailMessage } from "@openbuddy/capability-email"

export interface TestCase {
  id: string
  subject: string
  body: string
  from?: { address: string; name?: string }
  expectedActions?: Array<{ content: string; owner?: string; dueAt?: string; messageId?: string }>
  messages?: Array<{ id: string; from?: string; date?: string; text?: string }>
}

export interface Prediction {
  id: string
  actions: Array<{ content: string; owner?: string; dueAt?: string; messageId: string }>
}

const datasetPath = join(process.cwd(), "evals/datasets/email_ai_quality_cases.json")

function readDataset(): TestCase[] {
  const fs = require("node:fs") as typeof import("node:fs")
  return JSON.parse(fs.readFileSync(datasetPath, "utf8"))
}

function buildEmailService(cases: TestCase[], tmpDir: string): Email {
  const ctx = new Context()
  ctx.provide("mcpClient", { list: () => [], callTool: async () => ({ content: [], isError: true }) })
  const accountId = "agent-account-1"
  const account = {
    id: accountId,
    address: "owner@example.com",
    name: "Owner",
    provider: "mcp" as const,
    status: "connected" as const,
    capabilities: { read: true, write: true, attachments: true, multipleAccounts: true },
  }
  // Build per-case threads in-memory; the mock provider returns deterministic data.
  const threadsByCase = new Map<string, { accountId: string; threadId: string; messages: EmailMessage[] }>()
  for (const testCase of cases) {
    const threadId = `t-${testCase.id}`
    const messageId = testCase.messages?.[0]?.id ?? `m-${testCase.id}`
    const message: EmailMessage = {
      id: messageId,
      threadId,
      from: { name: testCase.from?.name, address: testCase.from?.address ?? "unknown@example.com" },
      to: [{ address: accountId }],
      cc: [],
      subject: testCase.subject,
      text: testCase.body,
      date: testCase.messages?.[0]?.date ?? "2026-09-01T10:00:00.000Z",
      unread: true,
      attachments: [],
    }
    threadsByCase.set(testCase.id, { accountId, threadId, messages: [message] })
  }
  const senderAddress = (testCase: TestCase) => testCase.from?.address ?? "unknown@example.com"
  const mockProvider = {
    name: "openbuddy-agent-mock",
    accounts: async () => [account],
    threads: async () => cases.map((testCase) => {
      const entry = threadsByCase.get(testCase.id)!
      return {
        id: entry.threadId,
        accountId: entry.accountId,
        subject: testCase.subject,
        from: { name: testCase.from?.name, address: senderAddress(testCase) },
        date: entry.messages[0]!.date,
        messageCount: 1,
        unread: true,
        labels: [],
        snippet: entry.messages[0]!.snippet,
      }
    }),
    threadsPage: async () => ({
      items: cases.map((testCase) => {
        const entry = threadsByCase.get(testCase.id)!
        return {
          id: entry.threadId,
          accountId: entry.accountId,
          subject: testCase.subject,
          from: { name: testCase.from?.name, address: senderAddress(testCase) },
          date: entry.messages[0]!.date,
          messageCount: 1,
          unread: true,
          labels: [],
          snippet: entry.messages[0]!.snippet,
        }
      }),
      nextCursor: undefined,
    }),
    thread: async (accId: string, threadId: string) => {
      const found = [...threadsByCase.values()].find((entry) => entry.threadId === threadId)
      if (!found) throw new EmailError("operation_failed", "未知线程")
      const testCase = cases.find((c) => `t-${c.id}` === threadId)!
      return { id: found.threadId, accountId: accId, subject: testCase.subject, from: { name: testCase.from?.name, address: senderAddress(testCase) }, messages: found.messages, labels: [] }
    },
    labels: async () => [],
    update: async () => ({ ok: true, provider: "openbuddy-agent-mock", operation: "noop" }),
    createDraft: async () => ({ id: "draft-stub", accountId, to: [], cc: [], bcc: [], subject: "", body: "", attachments: [], status: "draft" as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
    sendDraft: async () => ({ ok: true, provider: "openbuddy-agent-mock", operation: "send" }),
  }
  const service = new Email(ctx)
  service.setProvider(mockProvider)
  return service
}

async function runAgentBackend(service: Email, testCase: TestCase): Promise<Prediction["actions"]> {
  const accountId = "agent-account-1"
  const threadId = `t-${testCase.id}`
  const messageId = testCase.messages?.[0]?.id ?? `m-${testCase.id}`
  const candidateResult = extractEmailActionCandidates({
    subject: testCase.subject,
    body: testCase.body,
    messages: [{ id: messageId, from: testCase.from?.address, date: testCase.messages?.[0]?.date }],
    baseDate: new Date("2026-09-02T00:00:00.000Z"),
  })
  if (candidateResult.actions.length === 0) {
    return []
  }
  // Drive the real OpenBuddy pipeline: saveAnalysis validates, persists, returns the record.
  // We rely on the real `analysisActions` validator inside saveAnalysis to enforce citations.
  const record = await service.saveAnalysis({
    accountId,
    threadId,
    kind: "actions",
    confidence: candidateResult.actions.reduce((sum, a) => sum + a.confidence, 0) / candidateResult.actions.length,
    actions: candidateResult.actions.map((action) => ({
      content: action.content,
      owner: action.owner,
      dueAt: action.dueAt,
      citations: action.citations,
    })),
  })
  // Verify round-trip: list analyses returns what we just saved.
  const persisted = await service.listAnalyses({ accountId, threadId })
  expect(persisted.some((entry) => entry.id === record.id)).toBe(true)
  return record.actions.map((action) => ({
    content: action.content,
    owner: action.owner,
    dueAt: action.dueAt,
    messageId: action.messageId ?? messageId,
  }))
}

describe("openbuddy agent backend (real Email capability)", () => {
  let tmpDir: string
  let previousAgentDir: string | undefined

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "openbuddy-agent-backend-"))
    previousAgentDir = process.env.PI_CODING_AGENT_DIR
    process.env.PI_CODING_AGENT_DIR = tmpDir
  })

  afterEach(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("action-center query discovers every persisted analysis across all cases", async () => {
    const cases = readDataset()
    expect(cases.length).toBeGreaterThanOrEqual(50)
    const service = buildEmailService(cases, tmpDir)
    const accountId = "agent-account-1"
    for (const testCase of cases) {
      await runAgentBackend(service, testCase)
    }
    // The unified action center query must surface every saved actions analysis
    // (same account, all review states by default) with correct entries.
    const snapshot = await service.actionCenterQuery({ accountId })
    expect(snapshot.entries.length).toBeGreaterThan(0)
    const savedIds = new Set(snapshot.entries.flatMap((entry) => entry.savedAnalyses.map((analysis) => analysis.id)))
    const pendingOnly = await service.actionCenterQuery({ accountId, reviewStates: ["pending", "accepted"] })
    const pendingEntryIds = new Set(pendingOnly.entries.map((entry) => entry.threadId))
    // No-action threads legitimately have zero saved analyses; action threads must.
    const analysisEntries = snapshot.entries.filter((entry) => entry.savedAnalyses.length > 0)
    expect(analysisEntries.length).toBeGreaterThan(0)
    for (const entry of analysisEntries) {
      expect(entry.savedAnalyses.some((analysis) => analysis.kind === "actions")).toBe(true)
      expect(Array.isArray(entry.workspaceTagIds)).toBe(true)
    }
    // Contact projection also works on the same dataset without exposing bodies.
    const contacts = await service.projectContacts({ accountId, maskPersonalAddresses: false })
    expect(contacts.total).toBeGreaterThan(0)
    expect(contacts.contacts.every((contact) => !contact.email.includes(" "))).toBe(true)
    expect(savedIds.size).toBe(snapshot.entries.reduce((sum, entry) => sum + entry.savedAnalyses.length, 0))
    // Threads carrying analyses must be discoverable with reviewStates=pending|accepted too.
    for (const entry of analysisEntries) {
      expect(pendingEntryIds.has(entry.threadId)).toBe(true)
    }
    expect(pendingOnly.entries.length).toBeLessThanOrEqual(snapshot.entries.length)
  }, 30_000)

  it("extracts + persists + reads back actions for every dataset case", async () => {
    const cases = readDataset()
    expect(cases.length).toBeGreaterThanOrEqual(50)
    const service = buildEmailService(cases, tmpDir)
    const predictions: Prediction[] = []
    for (const testCase of cases) {
      const actions = await runAgentBackend(service, testCase)
      predictions.push({ id: testCase.id, actions })
    }
    const outPath = process.env.OPENBUDDY_AGENT_BACKEND_OUT
    if (outPath) {
      await writeFile(outPath, JSON.stringify(predictions, null, 2), "utf8")
    }
    const withActions = predictions.filter((p) => p.actions.length > 0).length
    const withoutActions = predictions.length - withActions
    expect(withActions).toBeGreaterThan(0)
    expect(withoutActions).toBeGreaterThan(0)
  }, 30_000)
})
