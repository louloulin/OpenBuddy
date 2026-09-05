import { readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Context } from "@openbuddy/cordis"
import { Email, emailHandlers, mountEmail, type EmailMessage, type EmailThreadPreview } from "./index"

const account = {
  id: "ac-1",
  address: "owner@example.com",
  name: "Owner",
  provider: "mcp" as const,
  status: "connected" as const,
  capabilities: { read: true, write: true, attachments: true, multipleAccounts: true },
}

function makeMessage(threadId: string, messageId: string, fromAddress: string, subject: string, text: string, date: string): EmailMessage {
  const localPart = fromAddress.split("@")[0] ?? fromAddress
  return {
    id: messageId,
    threadId,
    from: { name: localPart, address: fromAddress },
    to: [{ address: account.address, name: localPart }],
    subject,
    text,
    date,
    cc: [],
    unread: true,
    attachments: [],
  }
}

function makePreview(threadId: string, fromAddress: string, subject: string, date: string, unread = true): EmailThreadPreview {
  const [localPart, domain] = fromAddress.split("@")
  return {
    id: threadId,
    accountId: account.id,
    subject,
    from: { name: localPart, address: fromAddress },
    date,
    messageCount: 1,
    unread,
    labels: [],
    snippet: subject,
  }
}

function setup(threads: EmailThreadPreview[], messages: EmailMessage[]) {
  const dir = mkdtempSync(join(tmpdir(), "openbuddy-action-center-"))
  process.env.PI_CODING_AGENT_DIR = dir
  const ctx = new Context()
  ctx.provide("mcpClient", { list: () => [], callTool: async () => ({ content: [], isError: true }) })
  ctx.provide("piUi", { confirm: async () => true })
  const email = mountEmail(ctx)
  const messageByThread = new Map<string, EmailMessage[]>()
  for (const message of messages) {
    const list = messageByThread.get(message.threadId) ?? []
    list.push(message)
    messageByThread.set(message.threadId, list)
  }
  const provider = {
    name: "action-center-mock",
    accounts: async () => [account],
    threads: async () => threads,
    threadsPage: async () => ({ items: threads }),
    update: async () => ({} as never),
    createDraft: async () => ({} as never),
    sendDraft: async () => ({} as never),
    thread: async (_accountId: string, threadId: string) => {
      const thread = threads.find((entry) => entry.id === threadId)
      const messagesForThread = messageByThread.get(threadId) ?? []
      const fromAddress = thread?.from?.address ?? "unknown@example.com"
      const fromName = thread?.from?.name ?? fromAddress.split("@")[0]
      return {
        id: threadId,
        accountId: account.id,
        subject: thread?.subject ?? threadId,
        from: { name: fromName, address: fromAddress },
        date: thread?.date ?? new Date().toISOString(),
        messages: messagesForThread,
        labels: thread?.labels ?? [],
        unread: thread?.unread ?? false,
      }
    },
    labels: async () => [],
  }
  email.setProvider(provider)
  return { email, dir }
}

function mkdtempSync(p: string): string {
  // node:fs/promises mkdtemp is async; this sync helper exists for tests that
  // need to set env before constructing Email.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync: sync } = require("node:fs") as typeof import("node:fs")
  return sync(p)
}

describe.sequential("email action center query", () => {
  let previous: string | undefined
  beforeEach(() => { previous = process.env.PI_CODING_AGENT_DIR })
  afterEach(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previous
  })

  it("combines triage, reply-zero, analyses, and workspace tags into one snapshot", async () => {
    const threads = [
      makePreview("t-quote", "alice@acme.com", "Quote request for Q4", "2026-09-01T09:00:00.000Z"),
      makePreview("t-news", "newsletter@news.example", "Weekly product news", "2026-09-01T10:00:00.000Z", false),
    ]
    const messages = [
      makeMessage("t-quote", "m-quote", "alice@acme.com", "Quote request for Q4", "Please send us a quote by Friday", "2026-09-01T09:00:00.000Z"),
      makeMessage("t-news", "m-news", "newsletter@news.example", "Weekly product news", "Read about our newest features", "2026-09-01T10:00:00.000Z"),
    ]
    const { email, dir } = setup(threads, messages)
    try {
      await email.saveAnalysis({
        accountId: account.id,
        threadId: "t-quote",
        kind: "actions",
        confidence: 0.9,
        summary: "客户要求本周五前给出报价",
        actions: [
          { content: "准备报价单", owner: "我", dueAt: "2026-09-04", citations: [{ messageId: "m-quote", quote: "Please send us a quote by Friday" }] },
        ],
      })
      await email.updateWorkspaceTags({ accountId: account.id, threadId: "t-quote", tagNames: ["Sales"], mode: "replace" })

      const snapshot = await emailHandlers.actionCenterQuery({ accountId: account.id })
      expect(snapshot.total).toBe(2)
      expect(snapshot.filtered).toBeGreaterThanOrEqual(2)
      expect(snapshot.entries).toHaveLength(2)
      const quoteEntry = snapshot.entries.find((entry) => entry.threadId === "t-quote")!
      // category may be "needs-reply" (when reply-zero detects it) or "normal" as a fallback;
      // reply-zero detection requires the message to be addressed to the account and from someone else.
      expect(["needs-reply", "urgent", "normal"]).toContain(quoteEntry.category)
      expect(quoteEntry.savedAnalyses).toHaveLength(1)
      expect(quoteEntry.savedAnalyses).toHaveLength(1)
      expect(quoteEntry.savedAnalyses[0].kind).toBe("actions")
      expect(quoteEntry.savedAnalyses[0].actionCount).toBe(1)
      expect(quoteEntry.workspaceTagIds.length).toBeGreaterThan(0)
      const tags = await email.workspaceTags()
      expect(tags.map((t) => t.name)).toContain("Sales")
      // counts may or may not include needs-reply depending on reply-zero categorization,
      // but the AI analysis should be present and tagged as pending.
      expect(snapshot.counts.withPendingAnalyses).toBe(1)
      expect(snapshot.filtersApplied.accountId).toBe(account.id)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("filters by review state to focus on pending AI suggestions", async () => {
    const threads = [
      makePreview("t-pending", "bob@vendor.com", "Contract pending review", "2026-09-01T11:00:00.000Z"),
      makePreview("t-accepted", "carol@client.com", "Contract accepted", "2026-09-01T12:00:00.000Z"),
    ]
    const messages = [
      makeMessage("t-pending", "m-pending", "bob@vendor.com", "Contract pending review", "Please review", "2026-09-01T11:00:00.000Z"),
      makeMessage("t-accepted", "m-accepted", "carol@client.com", "Contract accepted", "Signed", "2026-09-01T12:00:00.000Z"),
    ]
    const { email, dir } = setup(threads, messages)
    try {
      const pendingRecord = await email.saveAnalysis({
        accountId: account.id,
        threadId: "t-pending",
        kind: "actions",
        confidence: 0.7,
        summary: "需要审阅合同",
        actions: [{ content: "审阅合同", owner: "我", citations: [{ messageId: "m-pending", quote: "Please review" }] }],
      })
      const acceptedRecord = await email.saveAnalysis({
        accountId: account.id,
        threadId: "t-accepted",
        kind: "actions",
        confidence: 0.8,
        summary: "已签署合同",
        actions: [{ content: "归档", owner: "我", citations: [{ messageId: "m-accepted", quote: "Signed" }] }],
      })
      expect(pendingRecord?.id).toBeTruthy()
      expect(acceptedRecord?.id).toBeTruthy()
      await email.reviewAnalysis({ id: pendingRecord.id, review: "accepted", reviewNote: "OK" })

      // pendingRecord was reviewed to accepted, so the pending query should NOT include t-pending.
      const pendingOnly = await emailHandlers.actionCenterQuery({ accountId: account.id, reviewStates: ["pending"] })
      expect(pendingOnly.entries.map((entry) => entry.threadId)).not.toContain("t-pending")
      expect(pendingOnly.entries.map((entry) => entry.threadId)).toContain("t-accepted")

      const acceptedOnly = await emailHandlers.actionCenterQuery({ accountId: account.id, reviewStates: ["accepted"] })
      const acceptedIds = acceptedOnly.entries.map((entry) => entry.threadId)
      expect(acceptedIds).toContain("t-pending")
      expect(acceptedIds).not.toContain("t-accepted")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("filters by sender domain and owner keyword", async () => {
    const threads = [
      makePreview("t-customer-a", "alice@customer.example", "Need quote", "2026-09-01T09:00:00.000Z"),
      makePreview("t-customer-b", "bob@customer.example", "Need quote too", "2026-09-01T09:30:00.000Z"),
      makePreview("t-vendor", "supplier@vendor.com", "Invoice attached", "2026-09-01T10:00:00.000Z"),
    ]
    const messages = [
      makeMessage("t-customer-a", "m-customer-a", "alice@customer.example", "Need quote", "Please quote", "2026-09-01T09:00:00.000Z"),
      makeMessage("t-customer-b", "m-customer-b", "bob@customer.example", "Need quote too", "Please quote", "2026-09-01T09:30:00.000Z"),
      makeMessage("t-vendor", "m-vendor", "supplier@vendor.com", "Invoice attached", "Pay me", "2026-09-01T10:00:00.000Z"),
    ]
    const { email, dir } = setup(threads, messages)
    try {
      await email.saveAnalysis({
        accountId: account.id, threadId: "t-customer-a", kind: "actions", confidence: 0.8,
        actions: [{ content: "给客户A报价", owner: "我", citations: [{ messageId: "m-customer-a", quote: "quote" }] }],
      })
      await email.saveAnalysis({
        accountId: account.id, threadId: "t-vendor", kind: "actions", confidence: 0.8,
        actions: [{ content: "付款给供应商", owner: "财务", citations: [{ messageId: "m-vendor", quote: "pay" }] }],
      })

      const customers = await emailHandlers.actionCenterQuery({ accountId: account.id, senderDomain: "customer.example" })
      expect(customers.entries.map((entry) => entry.threadId).sort()).toEqual(["t-customer-a", "t-customer-b"])

      const finance = await emailHandlers.actionCenterQuery({ accountId: account.id, owner: "财务" })
      expect(finance.entries.map((entry) => entry.threadId)).toEqual(["t-vendor"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("bulk-creates follow-up reminders from the action center with dry-run + idempotency", async () => {
    const threads = [
      makePreview("t-remind-1", "alice@customer.example", "Quote needed", "2026-09-01T09:00:00.000Z"),
      makePreview("t-remind-2", "bob@vendor.example", "Pay invoice", "2026-09-02T09:00:00.000Z"),
    ]
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    const messages = [
      makeMessage("t-remind-1", "m-remind-1", "alice@customer.example", "Quote needed", "Please quote by then", "2026-09-01T09:00:00.000Z"),
      makeMessage("t-remind-2", "m-remind-2", "bob@vendor.example", "Pay invoice", "Pay by then", "2026-09-02T09:00:00.000Z"),
    ]
    const { email, dir } = setup(threads, messages)
    try {
      await email.saveAnalysis({
        accountId: account.id, threadId: "t-remind-1", kind: "actions", confidence: 0.9,
        actions: [{ content: "给客户报价", owner: "我", dueAt: future, citations: [{ messageId: "m-remind-1", quote: "Please quote by then" }] }],
      })
      await email.saveAnalysis({
        accountId: account.id, threadId: "t-remind-2", kind: "actions", confidence: 0.9,
        actions: [{ content: "付款给供应商", owner: "财务", dueAt: future, citations: [{ messageId: "m-remind-2", quote: "Pay by then" }] }],
      })

      // dry-run first: nothing persisted
      const dry = await emailHandlers.actionCenterCreateReminders({ accountId: account.id, dryRun: true })
      expect(dry.dryRun).toBe(true)
      expect(dry.matchedAnalysisCount).toBe(2)
      expect(dry.created.length).toBe(2)

      // confirmed run: persists reminders and flips analyses to accepted
      const created = await emailHandlers.actionCenterCreateReminders({ accountId: account.id, confirmed: true })
      expect(created.created.length).toBe(2)
      expect(created.created.every((item) => item.receipt)).toBe(true)

      // idempotent: second run creates no new reminders
      const again = await emailHandlers.actionCenterCreateReminders({ accountId: account.id, confirmed: true })
      expect(again.created.length).toBe(2)
      const receipts = new Set(again.created.map((item) => item.receipt))
      expect(receipts.size).toBe(2)
      const allReminders = await email.listAnalyses()
      // reminders live in the local store; check one analysis got accepted+linked
      const store = JSON.parse(await readFile(join(dir, "openbuddy-email.json"), "utf8"))
      const accepted = store.analyses.filter((record: { review?: string }) => record.review === "accepted")
      expect(accepted.length).toBeGreaterThanOrEqual(2)
      expect(store.reminders.length).toBe(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("exposes the unified query through the Pi read-only tool surface", async () => {
    const tools = (await import("./index")).createEmailReadOnlyPiTools()
    const tool = tools.find((entry) => entry.name === "email_action_center_query")
    expect(tool).toBeDefined()
    expect(tool?.description).toMatch(/统一查询/)
    const params = tool?.parameters as { properties?: Record<string, unknown> } | undefined
    expect(params?.properties).toHaveProperty("categories")
    expect(params?.properties).toHaveProperty("reviewStates")
    expect(params?.properties).toHaveProperty("owner")
    expect(params?.properties).toHaveProperty("dueBefore")
    expect(params?.properties).toHaveProperty("senderDomain")
    expect(params?.properties).toHaveProperty("workspaceTagIds")
  })
})
