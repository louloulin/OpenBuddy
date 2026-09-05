import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { JmapEmailProvider, type JmapFetch } from "./jmap-provider"

const session = {
  apiUrl: "https://jmap.test/api",
  uploadUrl: "https://jmap.test/upload/{accountId}",
  downloadUrl: "https://jmap.test/download/{accountId}/{blobId}/{name}?type={type}",
  primaryAccounts: { "urn:ietf:params:jmap:mail": "mail-account", "urn:ietf:params:jmap:submission": "mail-account" },
  accounts: { "mail-account": { name: "Me", emailAddresses: [{ email: "me@example.com", name: "Me", type: "primary" }] } },
}
const message = (id: string, overrides: Record<string, unknown> = {}) => ({ id, threadId: id === "email-2" ? "thread-1" : id, mailboxIds: { inbox: true }, keywords: id === "email-1" ? { $seen: false, $flagged: true } : { $seen: true }, from: [{ email: "sender@example.com", name: "Sender" }], to: [{ email: "me@example.com" }], subject: id === "email-2" ? "后续" : "报价确认", receivedAt: "2026-08-30T09:00:00Z", preview: "请确认报价", hasAttachment: id === "email-1", textBody: [{ partId: "text-1", type: "text/plain" }], htmlBody: [{ partId: "html-1", type: "text/html" }], bodyValues: { "text-1": { value: "请确认报价" }, "html-1": { value: "<p>请确认报价</p>" } }, attachments: id === "email-1" ? [{ blobId: "blob-1", name: "报价.pdf", type: "application/pdf", size: 18, disposition: "attachment" }] : [], ...overrides })
const response = (value: unknown, status = 200, headers?: Record<string, string>) => ({ ok: status >= 200 && status < 300, status, statusText: status === 200 ? "OK" : "Error", headers, json: async () => value, arrayBuffer: async () => new TextEncoder().encode("downloaded attachment").buffer })

function createFakeJmap() {
  const calls: Array<{ url: string; method?: string; body?: string; headers?: Record<string, string> }> = []
  const fetcher: JmapFetch = async (url, init) => {
    calls.push({ url, method: init?.method, body: typeof init?.body === "string" ? init.body : undefined, headers: init?.headers })
    if (url === "https://jmap.test/session") return response(session)
    if (url.startsWith("https://jmap.test/upload/")) return response({ blobId: "blob-uploaded", type: "text/plain", size: 17 })
    if (url.startsWith("https://jmap.test/download/")) return response({}, 200, { "Content-Type": "application/octet-stream" })
    if (url !== session.apiUrl) throw new Error(`unexpected URL ${url}`)
    const body = JSON.parse(String(init?.body)) as { methodCalls: Array<[string, Record<string, unknown>, string]> }
    const result = body.methodCalls.map(([name, args, clientId]) => {
      if (name === "Mailbox/get") return [name, { accountId: args.accountId, list: [{ id: "inbox", name: "Inbox", role: "inbox" }, { id: "drafts", name: "Drafts", role: "drafts" }, { id: "archive", name: "Archive", role: "archive" }, { id: "trash", name: "Trash", role: "trash" }, { id: "junk", name: "Junk", role: "junk" }] }, clientId]
      if (name === "Email/query") {
        if ((args.filter as Record<string, unknown>)?.inThread) return [name, { ids: ["email-1", "email-2"], position: 0, total: 2 }, clientId]
        const position = Number(args.position ?? 0)
        return [name, { ids: position === 0 ? ["email-1"] : ["email-2"], position, total: 2 }, clientId]
      }
      if (name === "Email/get") {
        const ids = args.ids as string[]
        return [name, { list: ids.map((id) => id === "draft-1" ? message(id, { subject: "草稿" }) : message(id)) }, clientId]
      }
      if (name === "Email/set") {
        const create = args.create as Record<string, unknown> | undefined
        if (create?.draft) return [name, { created: { draft: { id: "draft-1", threadId: "draft-thread" } } }, clientId]
        return [name, { updated: Object.keys((args.update as Record<string, unknown> | undefined) ?? {}) }, clientId]
      }
      if (name === "Identity/get") return [name, { list: [{ id: "identity-1", email: "me@example.com" }] }, clientId]
      if (name === "EmailSubmission/set") return [name, { created: { submission: { id: "submission-1" } } }, clientId]
      throw new Error(`unexpected JMAP method ${name}`)
    })
    return response({ methodResponses: result })
  }
  return { calls, fetcher }
}

describe("JmapEmailProvider", () => {
  it("reads Session, mailboxes, searches with cursor pagination, and groups threads", async () => {
    const fake = createFakeJmap()
    const provider = new JmapEmailProvider({ accessToken: "test-token", fetch: fake.fetcher, sessionUrl: "https://jmap.test/session", maxResults: 1 })
    await expect(provider.accounts()).resolves.toMatchObject([{ id: "jmap:me", address: "me@example.com", provider: "jmap-api" }])
    const first = await provider.threadsPage({ folder: "inbox", unread: true, hasAttachment: true, limit: 1 })
    expect(first).toMatchObject({ nextCursor: expect.any(String), items: [{ id: "email-1", subject: "报价确认", unread: true, starred: true, attachments: 1 }] })
    const second = await provider.threadsPage({ folder: "inbox", cursor: first.nextCursor })
    expect(second.items[0]).toMatchObject({ id: "thread-1", subject: "后续" })
    await expect(provider.labels("jmap:me")).resolves.toEqual(expect.arrayContaining([{ id: "inbox", name: "Inbox", system: true }, { id: "drafts", name: "Drafts", system: true }]))
    expect(fake.calls.some((call) => call.headers?.Authorization === "Bearer test-token")).toBe(true)
    expect(fake.calls.some((call) => call.body?.includes("Email/query"))).toBe(true)
  })

  it("reads full threads and applies reversible JMAP Email/set management updates", async () => {
    const fake = createFakeJmap()
    const provider = new JmapEmailProvider({ accessToken: "test-token", fetch: fake.fetcher, sessionUrl: "https://jmap.test/session" })
    await expect(provider.thread("jmap:me", "thread-1")).resolves.toMatchObject({ id: "thread-1", messages: [{ id: "email-1", text: "请确认报价" }, { id: "email-2" }] })
    await expect(provider.update({ accountId: "jmap:me", threadId: "thread-1", kind: "mark-read" })).resolves.toMatchObject({ ok: true, matched: 2 })
    await expect(provider.update({ accountId: "jmap:me", threadId: "thread-1", kind: "archive" })).resolves.toMatchObject({ ok: true })
    expect(fake.calls.filter((call) => call.body?.includes("Email/set")).length).toBeGreaterThanOrEqual(2)
    await expect(provider.update({ accountId: "jmap:me", threadId: "thread-1", kind: "snooze" })).rejects.toMatchObject({ code: "operation_not_supported" })
  })

  it("uploads attachments, updates the same draft id, submits it, and downloads safely", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbuddy-jmap-provider-"))
    const localAttachment = join(directory, "报价.txt")
    await writeFile(localAttachment, "attachment content")
    const fake = createFakeJmap()
    try {
      const provider = new JmapEmailProvider({ accessToken: async () => "test-token", fetch: fake.fetcher, sessionUrl: "https://jmap.test/session" })
      const input = { accountId: "jmap:me", to: [{ address: "you@example.com" }], subject: "报价", body: "正文", attachments: [localAttachment] }
      const draft = await provider.createDraft(input)
      expect(draft).toMatchObject({ id: "draft-1", status: "draft", attachments: [localAttachment] })
      const draftCall = fake.calls.find((call) => call.body?.includes("Email/set") && call.body?.includes("bodyStructure"))
      expect(draftCall?.body).toContain('"type":"multipart/mixed"')
      expect(draftCall?.body).not.toContain('"textBody"')
      expect(draftCall?.body).toContain('"from":[{"email":"me@example.com"')
      const updated = await provider.createDraft({ ...input, draftId: draft.id, attachments: [] })
      expect(updated.id).toBe(draft.id)
      await expect(provider.sendDraft(draft)).resolves.toMatchObject({ ok: true, receipt: "jmap:send:draft-1" })
      const downloaded = await provider.downloadAttachment("jmap:me", "blob-1", "email-1", directory)
      await expect(readFile(downloaded.localPath, "utf8")).resolves.toBe("downloaded attachment")
      expect(fake.calls.some((call) => call.url.startsWith("https://jmap.test/upload/") && call.method === "POST")).toBe(true)
      expect(fake.calls.some((call) => call.body?.includes("EmailSubmission/set"))).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("classifies authorization and throttling errors and rejects unsafe attachment paths", async () => {
    const unauthorized: JmapFetch = async () => response({ type: "invalidArguments", description: "expired token" }, 401)
    const provider = new JmapEmailProvider({ accessToken: "test-token", fetch: unauthorized, sessionUrl: "https://jmap.test/session" })
    await expect(provider.accounts()).rejects.toMatchObject({ code: "provider_unavailable", message: expect.stringContaining("重新授权") })
    const throttled: JmapFetch = async () => response({ type: "serverFail", description: "slow down" }, 429, { "Retry-After": "2" })
    await expect(new JmapEmailProvider({ accessToken: "test-token", fetch: throttled, sessionUrl: "https://jmap.test/session" }).accounts()).rejects.toMatchObject({ code: "provider_unavailable", retryAfterMs: 2000 })
    const fake = createFakeJmap()
    const safeProvider = new JmapEmailProvider({ accessToken: "test-token", fetch: fake.fetcher, sessionUrl: "https://jmap.test/session" })
    await expect(safeProvider.downloadAttachment("jmap:me", "blob-1", "email-1", "relative-dir")).rejects.toMatchObject({ code: "invalid_input" })
  })
})
