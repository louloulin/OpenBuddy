import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { MicrosoftGraphEmailProvider, type GraphFetch } from "./microsoft-graph-provider"

const jsonResponse = (value: unknown, status = 200, headers?: Record<string, string>) => ({ ok: status >= 200 && status < 300, status, statusText: status === 200 ? "OK" : "Error", headers, json: async () => value })
const message = (overrides: Record<string, unknown> = {}) => ({ id: "message-1", conversationId: "conversation-1", subject: "报价确认", bodyPreview: "请确认报价", body: { contentType: "html", content: "<p>请确认报价</p>" }, from: { emailAddress: { name: "客户", address: "customer@example.com" } }, toRecipients: [{ emailAddress: { address: "me@example.com" } }], receivedDateTime: "2026-08-30T09:00:00Z", isRead: false, hasAttachments: true, categories: ["客户"], flag: { flagStatus: "flagged" }, attachments: [{ id: "attachment-1", name: "报价.pdf", contentType: "application/pdf", size: 12 }], ...overrides })

describe("MicrosoftGraphEmailProvider", () => {
  it("reads profile, searches/group threads, labels, and follows Graph pagination", async () => {
    const calls: string[] = []
    const fetcher: GraphFetch = async (url) => {
      calls.push(url)
      if (url.endsWith("/me?$select=mail,displayName,userPrincipalName")) return jsonResponse({ mail: "me@example.com", displayName: "Me" })
      if (url.includes("$search=") || url.includes("%24search=")) return jsonResponse({ value: [message()], "@odata.nextLink": "https://graph.test/v1.0/me/messages?$skiptoken=next" })
      if (url.includes("$skiptoken=next")) return jsonResponse({ value: [message({ id: "message-2", conversationId: "conversation-2", subject: "后续" })] })
      if (url.endsWith("/me/mailFolders?$top=100&$select=id,displayName,parentFolderId")) return jsonResponse({ value: [{ id: "inbox", displayName: "Inbox" }, { id: "custom", displayName: "客户" }] })
      if (url.includes("/me/outlook/masterCategories")) return jsonResponse({ value: [{ id: "category-id", displayName: "重要", color: "preset0" }] })
      throw new Error(`unexpected URL ${url}`)
    }
    const provider = new MicrosoftGraphEmailProvider({ accessToken: "test-token", fetch: fetcher, baseUrl: "https://graph.test/v1.0" })
    await expect(provider.accounts()).resolves.toMatchObject([{ id: "graph:me", address: "me@example.com", provider: "graph-api" }])
    const page = await provider.threadsPage({ query: "报价", unread: true, folder: "inbox", from: "customer@example.com", hasAttachment: true, limit: 10 })
    expect(page).toMatchObject({ nextCursor: "https://graph.test/v1.0/me/messages?$skiptoken=next" })
    expect(page.items[0]).toMatchObject({ id: "conversation-1", subject: "报价确认", unread: true, starred: true, labels: ["客户"], attachments: 1, from: { address: "customer@example.com" } })
    await expect(provider.threadsPage({ cursor: page.nextCursor })).resolves.toMatchObject({ items: [{ id: "conversation-2" }] })
    await expect(provider.labels("graph:me")).resolves.toEqual([{ id: "inbox", name: "Inbox", system: true }, { id: "custom", name: "客户", system: false }, { id: "重要", name: "重要", system: false, color: "preset0" }])
    expect(calls[1]).toContain("%24filter=isRead+eq+false")
  })

  it("maps reversible management operations and classifies Graph authorization/throttle errors", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = []
    const fetcher: GraphFetch = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body })
      if (url.endsWith("/me?$select=mail,displayName,userPrincipalName")) return jsonResponse({ mail: "me@example.com" })
      if (url.includes("/me/messages?") && url.includes("conversationId") && url.includes("conversation-1")) return jsonResponse({ value: [message()] })
      return jsonResponse({})
    }
    const provider = new MicrosoftGraphEmailProvider({ accessToken: "test-token", fetch: fetcher, baseUrl: "https://graph.test/v1.0" })
    await expect(provider.update({ accountId: "graph:me", threadId: "conversation-1", kind: "mark-read" })).resolves.toMatchObject({ ok: true, matched: 1 })
    await expect(provider.update({ accountId: "graph:me", threadId: "conversation-1", kind: "star", value: false })).resolves.toMatchObject({ ok: true })
    await expect(provider.update({ accountId: "graph:me", threadId: "conversation-1", kind: "archive" })).resolves.toMatchObject({ ok: true })
    expect(calls.some((call) => call.method === "PATCH" && call.body?.includes('"isRead":true'))).toBe(true)
    expect(calls.some((call) => call.url.endsWith("/move") && call.body?.includes('"destinationId":"archive"'))).toBe(true)
    await expect(provider.update({ accountId: "graph:me", threadId: "conversation-1", kind: "snooze" })).rejects.toMatchObject({ code: "operation_not_supported" })

    const failing = (status: number, payload: unknown, headers?: Record<string, string>) => new MicrosoftGraphEmailProvider({ accessToken: "test-token", baseUrl: "https://graph.test/v1.0", fetch: async () => jsonResponse(payload, status, headers) })
    await expect(failing(429, { error: { code: "TooManyRequests", message: "slow down" } }, { "Retry-After": "3" }).accounts()).rejects.toMatchObject({ code: "provider_unavailable", retryAfterMs: 3000 })
    await expect(failing(401, { error: { code: "InvalidAuthenticationToken", message: "expired" } }).accounts()).rejects.toMatchObject({ code: "provider_unavailable", message: expect.stringContaining("重新授权") })
  })

  it("creates/updates/sends drafts and downloads Graph attachments safely", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbuddy-graph-provider-"))
    const localAttachment = join(directory, "报价.txt")
    await writeFile(localAttachment, "attachment content")
    const calls: Array<{ url: string; method?: string; body?: string }> = []
    const fetcher: GraphFetch = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body })
      if (url.endsWith("/me/messages") && init?.method === "POST") return jsonResponse({ id: "draft-1", conversationId: "conversation-draft" })
      if (url.endsWith("/me/messages/draft-1") && init?.method === "PATCH") return jsonResponse({ id: "draft-1", conversationId: "conversation-draft" })
      if (url.includes("/attachments?") && (url.includes("%24top=100") || url.includes("$top=100"))) return jsonResponse({ value: [{ id: "attachment-1", name: "报价.pdf", contentType: "application/pdf", size: 18 }] })
      if (url.endsWith("/attachments") && init?.method === "POST") return jsonResponse({ id: "attachment-uploaded" })
      if (url.endsWith("/attachments/attachment-1") && init?.method === "DELETE") return jsonResponse({}, 204)
      if (url.endsWith("/attachments/attachment-1")) return jsonResponse({ id: "attachment-1", name: "报价.pdf", contentBytes: Buffer.from("downloaded attachment").toString("base64") })
      if (url.endsWith("/send")) return jsonResponse({}, 202)
      throw new Error(`unexpected URL ${url}`)
    }
    try {
      const provider = new MicrosoftGraphEmailProvider({ accessToken: async () => "test-token", fetch: fetcher, baseUrl: "https://graph.test/v1.0" })
      const input = { accountId: "graph:me", draftId: "draft-1", to: [{ address: "you@example.com" }], subject: "报价", body: "正文", attachments: [localAttachment] }
      const draft = await provider.createDraft(input)
      expect(draft).toMatchObject({ id: "draft-1", threadId: "conversation-draft", status: "draft" })
      const updated = await provider.createDraft({ ...input, body: "更新后的正文" })
      expect(updated.id).toBe("draft-1")
      const cleared = await provider.createDraft({ ...input, attachments: [] })
      expect(cleared.id).toBe("draft-1")
      await expect(provider.sendDraft(draft)).resolves.toMatchObject({ ok: true, receipt: "graph:send:draft-1" })
      const downloaded = await provider.downloadAttachment("graph:me", "attachment-1", "message-1", directory)
      await expect(readFile(downloaded.localPath, "utf8")).resolves.toBe("downloaded attachment")
      expect(calls.some((call) => call.url.endsWith("/attachments") && call.method === "POST" && call.body?.includes("contentBytes"))).toBe(true)
      expect(calls.some((call) => call.url.endsWith("/attachments/attachment-1") && call.method === "DELETE")).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("walks all pages when a conversation contains more than one Graph page", async () => {
    const fetcher: GraphFetch = async (url) => {
      if (url.includes("skiptoken")) return jsonResponse({ value: [message({ id: "message-2", receivedDateTime: "2026-08-30T10:00:00Z" })] })
      if (url.includes("conversationId")) {
        return jsonResponse({ value: [message()], "@odata.nextLink": "https://graph.test/v1.0/me/messages?$skiptoken=thread-next" })
      }
      throw new Error(`unexpected URL ${url}`)
    }
    const provider = new MicrosoftGraphEmailProvider({ accessToken: "test-token", fetch: fetcher, baseUrl: "https://graph.test/v1.0" })
    await expect(provider.thread("graph:me", "conversation-1")).resolves.toMatchObject({ messages: [{ id: "message-1" }, { id: "message-2" }] })
  })

  it("keeps folder labels available when Outlook category permission is unavailable", async () => {
    const fetcher: GraphFetch = async (url) => {
      if (url.includes("mailFolders")) return jsonResponse({ value: [{ id: "inbox", displayName: "Inbox" }] })
      if (url.includes("masterCategories")) return jsonResponse({ error: { code: "ErrorAccessDenied", message: "category permission missing" } }, 403)
      throw new Error(`unexpected URL ${url}`)
    }
    const provider = new MicrosoftGraphEmailProvider({ accessToken: "test-token", fetch: fetcher, baseUrl: "https://graph.test/v1.0" })
    await expect(provider.labels("graph:me")).resolves.toEqual([{ id: "inbox", name: "Inbox", system: true }])
  })
})
