import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { GmailApiEmailProvider, type GmailFetch } from "./gmail-api-provider"

const encoded = (value: string) => Buffer.from(value, "utf8").toString("base64url")
const jsonResponse = (value: unknown, status = 200, headers?: Record<string, string>) => ({ ok: status >= 200 && status < 300, status, statusText: status === 200 ? "OK" : "Error", headers, json: async () => value })

describe("GmailApiEmailProvider", () => {
  it("reads profile, searches threads, parses MIME messages, and exposes labels", async () => {
    const calls: string[] = []
    const fetcher: GmailFetch = async (url) => {
      calls.push(url)
      if (url.endsWith("/profile")) return jsonResponse({ emailAddress: "me@example.com" })
      if (url.includes("/threads?")) return jsonResponse({ threads: [{ id: "thread-1" }], nextPageToken: "page-2" })
      if (url.includes("/threads/thread-1")) return jsonResponse({ id: "thread-1", snippet: "请确认报价", messages: [{ id: "message-1", threadId: "thread-1", labelIds: ["INBOX", "UNREAD", "STARRED"], internalDate: "1788084000000", payload: { headers: [{ name: "From", value: "客户 <customer@example.com>" }, { name: "To", value: "me@example.com" }, { name: "Subject", value: "报价确认" }], parts: [{ mimeType: "text/plain", body: { data: encoded("请确认报价") } }, { mimeType: "application/pdf", filename: "报价.pdf", body: { attachmentId: "att-1", size: 12 } }] } }] })
      if (url.endsWith("/labels")) return jsonResponse({ labels: [{ id: "INBOX", name: "INBOX", type: "system" }, { id: "label-customer", name: "客户", type: "user" }] })
      throw new Error(`unexpected URL ${url}`)
    }
    const provider = new GmailApiEmailProvider({ accessToken: "test-token", fetch: fetcher, baseUrl: "https://gmail.test/users/me" })
    await expect(provider.accounts()).resolves.toMatchObject([{ id: "gmail:me", address: "me@example.com", capabilities: { management: true } }])
    const page = await provider.threadsPage({ query: "报价", unread: true, folder: "inbox", from: "customer@example.com", limit: 10 })
    expect(page.nextCursor).toBe("page-2")
    expect(page.items[0]).toMatchObject({ id: "thread-1", subject: "报价确认", unread: true, starred: true, attachments: 1, from: { address: "customer@example.com" } })
    expect(page.items[0]?.labels).toEqual(["INBOX", "UNREAD", "STARRED"])
    await expect(provider.labels("gmail:me")).resolves.toEqual([{ id: "INBOX", name: "INBOX", system: true, color: undefined }, { id: "label-customer", name: "客户", system: false, color: undefined }])
    expect(calls.find((url) => url.includes("/threads?") && url.includes("q=%E6%8A%A5%E4%BB%B7"))).toContain("labelIds=INBOX")
  })

  it("applies reversible management operations and preserves dry-run safety", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = []
    const fetcher: GmailFetch = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body })
      if (url.endsWith("/profile")) return jsonResponse({ emailAddress: "me@example.com" })
      return jsonResponse({})
    }
    const provider = new GmailApiEmailProvider({ accessToken: "test-token", fetch: fetcher, baseUrl: "https://gmail.test/users/me" })
    await expect(provider.update({ accountId: "gmail:me", threadId: "thread-1", kind: "archive" })).resolves.toMatchObject({ ok: true, receipt: "gmail:archive:thread-1" })
    await expect(provider.update({ accountId: "gmail:me", threadId: "thread-1", kind: "star", value: true })).resolves.toMatchObject({ ok: true })
    await expect(provider.update({ accountId: "gmail:me", threadId: "thread-1", kind: "mark-read", dryRun: true })).resolves.toMatchObject({ dryRun: true })
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(2)
    expect(calls[0]?.url).toContain("/threads/thread-1/modify")
    expect(JSON.parse(calls[0]?.body ?? "{}" )).toEqual({ addLabelIds: [], removeLabelIds: ["INBOX"] })
    await expect(provider.update({ accountId: "gmail:me", threadId: "thread-1", kind: "snooze" })).rejects.toMatchObject({ code: "operation_not_supported" })
  })

  it("uses Gmail pagination tokens and classifies transient versus authorization failures", async () => {
    const urls: string[] = []
    let listCalls = 0
    const fetcher: GmailFetch = async (url) => {
      urls.push(url)
      if (url.endsWith("/profile")) return jsonResponse({ emailAddress: "me@example.com" })
      if (url.includes("/threads?")) {
        listCalls += 1
        return jsonResponse(listCalls === 1 ? { threads: [], nextPageToken: "next-page" } : { threads: [] })
      }
      throw new Error(`unexpected URL ${url}`)
    }
    const provider = new GmailApiEmailProvider({ accessToken: "test-token", fetch: fetcher, baseUrl: "https://gmail.test/users/me" })
    await expect(provider.threadsPage({ limit: 7 })).resolves.toMatchObject({ items: [], nextCursor: "next-page" })
    await expect(provider.threadsPage({ limit: 7, cursor: "next-page" })).resolves.toEqual({ items: [] })
    expect(urls[0]).toContain("maxResults=7")
    expect(urls[1]).toContain("pageToken=next-page")

    const failing = (status: number, payload: unknown, headers?: Record<string, string>) => new GmailApiEmailProvider({ accessToken: "test-token", baseUrl: "https://gmail.test/users/me", fetch: async (url) => {
      if (url.endsWith("/profile")) return jsonResponse({ emailAddress: "me@example.com" })
      return jsonResponse(payload, status, headers)
    } })
    await expect(failing(429, { error: { message: "slow down", reason: "rateLimitExceeded" } }, { "Retry-After": "2" }).threadsPage()).rejects.toMatchObject({ code: "provider_unavailable", retryAfterMs: 2000 })
    await expect(failing(503, { error: { message: "backend" } }).threadsPage()).rejects.toMatchObject({ code: "provider_unavailable" })
    await expect(failing(401, { error: { message: "expired" } }).threadsPage()).rejects.toMatchObject({ code: "provider_unavailable", message: expect.stringContaining("重新授权") })
    await expect(failing(403, { error: { message: "forbidden", reason: "insufficientPermissions" } }).threadsPage()).rejects.toMatchObject({ code: "provider_unavailable", message: expect.stringContaining("重新授权") })
    await expect(failing(400, { error: { message: "bad query" } }).threadsPage()).rejects.toMatchObject({ code: "operation_failed" })
  })

  it("creates/updates a draft, sends it only through the provider call, and downloads an attachment safely", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbuddy-gmail-provider-"))
    const attachmentPath = join(directory, "报价.txt")
    await writeFile(attachmentPath, "attachment content")
    const calls: Array<{ url: string; method?: string; body?: string }> = []
    const fetcher: GmailFetch = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body })
      if (url.endsWith("/profile")) return jsonResponse({ emailAddress: "me@example.com" })
      if (url.endsWith("/drafts")) return jsonResponse({ id: "draft-1", message: { id: "message-draft", threadId: "thread-1" } })
      if (url.includes("/drafts/draft-1")) return jsonResponse({ id: "draft-1", message: { id: "message-draft", threadId: "thread-1" } })
      if (url.endsWith("/drafts/send")) return jsonResponse({ id: "message-sent" })
      if (url.includes("/attachments/att-1")) return jsonResponse({ data: encoded("downloaded attachment") })
      if (url.includes("/messages/thread-1")) return jsonResponse({ id: "thread-1", threadId: "thread-1", payload: { headers: [], parts: [{ mimeType: "application/pdf", filename: "报价.pdf", body: { attachmentId: "att-1", size: 18 } }] } })
      throw new Error(`unexpected URL ${url}`)
    }
    try {
      const provider = new GmailApiEmailProvider({ accessToken: async () => "test-token", fetch: fetcher, baseUrl: "https://gmail.test/users/me" })
      const draft = await provider.createDraft({ accountId: "gmail:me", draftId: "draft-1", to: [{ address: "you@example.com" }], subject: "报价", body: "正文", attachments: [attachmentPath] })
      expect(draft).toMatchObject({ id: "draft-1", threadId: "thread-1", status: "draft", attachments: [attachmentPath] })
      const draftBody = calls.find((call) => call.url.endsWith("/drafts/draft-1") && call.method === "PUT")?.body ?? ""
      expect(JSON.parse(draftBody).message.raw).toBeTruthy()
      await expect(provider.sendDraft(draft)).resolves.toMatchObject({ ok: true, receipt: "gmail:send:draft-1" })
      const downloaded = await provider.downloadAttachment("gmail:me", "att-1", "thread-1", directory)
      expect(downloaded.name).toBe("报价.pdf")
      await expect(readFile(downloaded.localPath, "utf8")).resolves.toBe("downloaded attachment")
      expect(calls.some((call) => call.url.endsWith("/drafts/send") && call.method === "POST")).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
