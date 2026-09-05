import { describe, expect, it } from "vitest"
import { collectEmailContacts, filterEmailContacts, type EmailContact } from "./email-contacts"
import type { EmailThread, EmailThreadPreview } from "@/lib/agent/pi-client"

const previewAlice: EmailThreadPreview = {
  id: "p1",
  accountId: "acct-a",
  subject: "报价",
  from: { address: "alice@example.com", name: "Alice Smith" },
  date: "2026-08-30T10:00:00.000Z",
  messageCount: 1,
  unread: true,
  labels: [],
}

const previewBob: EmailThreadPreview = {
  id: "p2",
  accountId: "acct-b",
  subject: "未读对话",
  from: { address: "bob@example.com" },
  date: "2026-08-29T08:00:00.000Z",
  messageCount: 1,
  unread: false,
  labels: [],
}

const threadCarol: EmailThread = {
  id: "t1",
  accountId: "acct-c",
  subject: "团队讨论",
  labels: [],
  messages: [
    {
      id: "m1",
      threadId: "t1",
      from: { address: "carol@example.com", name: "Carol" },
      to: [{ address: "dan@example.com", name: "Dan" }],
      cc: [],
      subject: "团队讨论",
      date: "2026-08-31T12:00:00.000Z",
      unread: false,
      attachments: [],
    },
    {
      id: "m2",
      threadId: "t1",
      from: { address: "alice@example.com" },
      to: [{ address: "carol@example.com" }],
      cc: [],
      subject: "团队讨论",
      date: "2026-08-31T13:00:00.000Z",
      unread: false,
      attachments: [],
    },
  ],
}

describe("email-contacts pure helpers", () => {
  describe("collectEmailContacts", () => {
    it("deduplicates contacts across preview and thread sources", () => {
      const contacts = collectEmailContacts([previewAlice, previewBob, threadCarol])
      const addresses = contacts.map((c) => c.address)
      expect(addresses.filter((a) => a === "alice@example.com")).toHaveLength(1)
      expect(addresses).toContain("bob@example.com")
      expect(addresses).toContain("carol@example.com")
      expect(addresses).toContain("dan@example.com")
      const alice = contacts.find((c) => c.address === "alice@example.com")
      expect(alice?.accountIds.slice().sort()).toEqual(["acct-a", "acct-c"])
    })

    it("counts each interaction from every message", () => {
      const contacts = collectEmailContacts([threadCarol])
      const alice = contacts.find((c) => c.address === "alice@example.com")
      expect(alice?.interactionCount).toBeGreaterThanOrEqual(1)
      const carol = contacts.find((c) => c.address === "carol@example.com")
      expect(carol?.interactionCount).toBe(2)
    })

    it("tracks the most recent lastContactedAt across sources", () => {
      const contacts = collectEmailContacts([previewAlice, threadCarol])
      const carol = contacts.find((c) => c.address === "carol@example.com")
      expect(carol?.lastContactedAt).toBe("2026-08-31T13:00:00.000Z")
    })

    it("skips invalid and excluded addresses", () => {
      const badPreview: EmailThreadPreview = {
        id: "bad",
        accountId: "acct-x",
        subject: "Bad",
        from: { address: "not-an-email" },
        date: "2026-01-01T00:00:00.000Z",
        messageCount: 1,
        unread: false,
        labels: [],
      }
      const contacts = collectEmailContacts([previewAlice, badPreview], ["alice@example.com"])
      const addresses = contacts.map((c) => c.address)
      expect(addresses).not.toContain("alice@example.com")
      expect(addresses).not.toContain("not-an-email")
    })

    it("returns empty for no threads", () => {
      expect(collectEmailContacts([])).toEqual([])
    })
  })

  describe("filterEmailContacts", () => {
    const sampleContacts: EmailContact[] = [
      { address: "alice@example.com", name: "Alice Smith", accountIds: ["a1"], interactionCount: 10, lastContactedAt: "2026-08-31T00:00:00.000Z" },
      { address: "bob@example.com", name: "Bob Jones", accountIds: ["a1"], intersectionCount: 5, interactionCount: 5 } as EmailContact,
      { address: "carol@example.com", name: "Carol Lee", accountIds: ["a2"], interactionCount: 20 },
      { address: "dave@other.org", name: "Dave", accountIds: ["a2"], interactionCount: 1 },
    ]

    it("filters by name match (case-insensitive)", () => {
      const result = filterEmailContacts(sampleContacts, "alice")
      expect(result).toHaveLength(1)
      expect(result[0]?.address).toBe("alice@example.com")
    })

    it("filters by address substring", () => {
      const result = filterEmailContacts(sampleContacts, "other.org")
      expect(result.map((c) => c.address)).toEqual(["dave@other.org"])
    })

    it("returns up to `limit` when query is empty", () => {
      expect(filterEmailContacts(sampleContacts, "", 2)).toHaveLength(2)
    })

    it("returns all contacts when query is empty and no limit", () => {
      expect(filterEmailContacts(sampleContacts, "")).toHaveLength(sampleContacts.length)
    })

    it("returns empty for no matches", () => {
      expect(filterEmailContacts(sampleContacts, "nonexistent")).toEqual([])
    })
  })
})
