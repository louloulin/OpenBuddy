import { mkdtemp, rm } from "node:fs/promises"
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

function makeMessage(threadId: string, messageId: string, fromAddress: string, subject: string, text: string, date: string, to: string[] = [account.address]): EmailMessage {
  const localPart = fromAddress.split("@")[0] ?? fromAddress
  return {
    id: messageId,
    threadId,
    from: { name: localPart, address: fromAddress },
    to: to.map((address) => ({ address })),
    cc: [],
    subject,
    text,
    date,
    unread: true,
    attachments: [],
  }
}

function makePreview(threadId: string, fromAddress: string, subject: string, date: string): EmailThreadPreview {
  const localPart = fromAddress.split("@")[0] ?? fromAddress
  return {
    id: threadId,
    accountId: account.id,
    subject,
    from: { name: localPart, address: fromAddress },
    date,
    messageCount: 1,
    unread: true,
    labels: [],
    snippet: subject,
  }
}

function setup(threads: EmailThreadPreview[], messages: EmailMessage[]) {
  const dir = require("node:fs").mkdtempSync(join(tmpdir(), "openbuddy-contact-projection-"))
  process.env.PI_CODING_AGENT_DIR = dir
  const ctx = new Context()
  ctx.provide("mcpClient", { list: () => [], callTool: async () => ({ content: [], isError: true }) })
  const email = mountEmail(ctx)
  const messageByThread = new Map<string, EmailMessage[]>()
  for (const message of messages) {
    const list = messageByThread.get(message.threadId) ?? []
    list.push(message)
    messageByThread.set(message.threadId, list)
  }
  const provider = {
    name: "contact-projection-mock",
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

describe.sequential("email contact projection", () => {
  let previous: string | undefined
  beforeEach(() => { previous = process.env.PI_CODING_AGENT_DIR })
  afterEach(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previous
  })

  it("aggregates senders and recipients across threads", async () => {
    const threads = [
      makePreview("t-1", "alice@customer.example", "Quote request", "2026-09-01T09:00:00.000Z"),
      makePreview("t-2", "alice@customer.example", "Quote follow-up", "2026-09-02T10:00:00.000Z"),
      makePreview("t-3", "bob@vendor.example", "Invoice attached", "2026-09-03T11:00:00.000Z"),
    ]
    const messages = [
      makeMessage("t-1", "m-1a", "alice@customer.example", "Quote request", "Please quote", "2026-09-01T09:00:00.000Z"),
      makeMessage("t-2", "m-2a", "alice@customer.example", "Quote follow-up", "Still waiting", "2026-09-02T10:00:00.000Z"),
      makeMessage("t-3", "m-3a", "bob@vendor.example", "Invoice attached", "Pay me", "2026-09-03T11:00:00.000Z"),
    ]
    const { email, dir } = setup(threads, messages)
    try {
      const snapshot = await emailHandlers.projectContacts({ accountId: account.id, folder: "inbox", maskPersonalAddresses: false })
      expect(snapshot.total).toBe(2)
      expect(snapshot.contacts).toHaveLength(2)
      const alice = snapshot.contacts.find((entry) => entry.email === "alice@customer.example")!
      expect(alice.interactionCount).toBe(2)
      expect(alice.roleCounts.from).toBe(2)
      expect(alice.linkedThreadIds.sort()).toEqual(["t-1", "t-2"])
      const bob = snapshot.contacts.find((entry) => entry.email === "bob@vendor.example")!
      expect(bob.interactionCount).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("masks personal addresses by default and preserves domain", async () => {
    const threads = [
      makePreview("t-1", "personal@gmail.com", "Personal email", "2026-09-01T09:00:00.000Z"),
    ]
    const messages = [
      makeMessage("t-1", "m-1", "personal@gmail.com", "Personal email", "Hi", "2026-09-01T09:00:00.000Z"),
    ]
    const { email, dir } = setup(threads, messages)
    try {
      const snapshot = await emailHandlers.projectContacts({ accountId: account.id, maskPersonalAddresses: true })
      expect(snapshot.personalAddressesMasked).toBe(1)
      const contact = snapshot.contacts[0]!
      expect(contact.email).toBe("personal@gmail.com")
      expect(contact.maskedEmail).toMatch(/^p[a-z]\*+@gmail\.com$/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("respects includeDomains and excludeDomains filters", async () => {
    const threads = [
      makePreview("t-1", "a@customer.example", "Customer", "2026-09-01T09:00:00.000Z"),
      makePreview("t-2", "b@vendor.example", "Vendor", "2026-09-01T10:00:00.000Z"),
      makePreview("t-3", "c@noise.example", "Spam", "2026-09-01T11:00:00.000Z"),
    ]
    const messages = [
      makeMessage("t-1", "m-1", "a@customer.example", "Customer", "Hi", "2026-09-01T09:00:00.000Z"),
      makeMessage("t-2", "m-2", "b@vendor.example", "Vendor", "Hi", "2026-09-01T10:00:00.000Z"),
      makeMessage("t-3", "m-3", "c@noise.example", "Spam", "Hi", "2026-09-01T11:00:00.000Z"),
    ]
    const { email, dir } = setup(threads, messages)
    try {
      const onlyCustomer = await emailHandlers.projectContacts({ accountId: account.id, includeDomains: ["customer.example"], maskPersonalAddresses: false })
      expect(onlyCustomer.contacts.map((entry) => entry.email)).toEqual(["a@customer.example"])

      const noNoise = await emailHandlers.projectContacts({ accountId: account.id, excludeDomains: ["noise.example"], maskPersonalAddresses: false })
      const domains = noNoise.contacts.map((entry) => entry.email.split("@")[1]).sort()
      expect(domains).toEqual(["customer.example", "vendor.example"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("exposes the contact projection tool through the Pi read-only surface", async () => {
    const tools = (await import("./index")).createEmailReadOnlyPiTools()
    const tool = tools.find((entry) => entry.name === "email_contact_projection")
    expect(tool).toBeDefined()
    expect(tool?.description).toMatch(/不返回邮件正文/)
    const params = tool?.parameters as { properties?: Record<string, unknown> } | undefined
    expect(params?.properties).toHaveProperty("includeDomains")
    expect(params?.properties).toHaveProperty("excludeDomains")
    expect(params?.properties).toHaveProperty("includeRoles")
    expect(params?.properties).toHaveProperty("maskPersonalAddresses")
    expect(params?.properties).toHaveProperty("limit")
  })
})
