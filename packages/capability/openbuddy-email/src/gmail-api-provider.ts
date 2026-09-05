import { lstat, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { EmailError, buildGmailSearchQuery, parseEmailRetryAfter, type EmailAccount, type EmailAddress, type EmailAttachment, type EmailAttachmentDownload, type EmailComposeInput, type EmailDraft, type EmailFolder, type EmailLabel, type EmailMessage, type EmailMutationInput, type EmailMutationResult, type EmailProvider, type EmailProviderDiagnostic, type EmailSearchInput, type EmailThread, type EmailThreadPage, type EmailThreadPreview } from "./index"

type GmailResponse = { ok: boolean; status: number; statusText?: string; headers?: { get(name: string): string | null } | Record<string, string | undefined>; json(): Promise<unknown>; arrayBuffer?(): Promise<ArrayBuffer> }
export type GmailFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<GmailResponse>
export type GmailAccessToken = string | (() => string | Promise<string>)

export interface GmailApiEmailProviderOptions {
	accessToken: GmailAccessToken
	fetch?: GmailFetch
	baseUrl?: string
	accountId?: string
	maxResults?: number
}

export function createGmailApiEmailProvider(options: GmailApiEmailProviderOptions): GmailApiEmailProvider {
	return new GmailApiEmailProvider(options)
}

type GmailHeader = { name?: string; value?: string }
type GmailPart = { mimeType?: string; filename?: string; body?: { data?: string; size?: number; attachmentId?: string }; headers?: GmailHeader[]; parts?: GmailPart[] }
type GmailMessageResource = { id?: string; threadId?: string; labelIds?: string[]; internalDate?: string; payload?: GmailPart; snippet?: string }
type GmailThreadResource = { id?: string; messages?: GmailMessageResource[]; snippet?: string }

const gmailFetch: GmailFetch = async (url, init) => fetch(url, init as RequestInit) as unknown as GmailResponse
const decodeBase64Url = (value: string): string => Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8")
const encodeBase64Url = (value: string): string => Buffer.from(value, "utf8").toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll(/=+$/g, "")
const header = (payload: GmailPart | undefined, name: string): string => payload?.headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? ""
const address = (value: string): EmailAddress => {
	const match = value.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/) ?? value.match(/^([^\s@]+@[^\s@]+)$/)
	if (!match) return { address: value }
	return match[2] ? { name: match[1]?.trim() || undefined, address: match[2].trim() } : { address: match[1].trim() }
}
const addresses = (value: string): EmailAddress[] => value.split(",").map((item) => item.trim()).filter(Boolean).map(address)
const findPart = (part: GmailPart | undefined, mimeType: string): GmailPart | undefined => {
	if (!part) return undefined
	if (part.mimeType === mimeType && part.body?.data) return part
	for (const child of part.parts ?? []) { const found = findPart(child, mimeType); if (found) return found }
	return undefined
}
const allParts = (part: GmailPart | undefined): GmailPart[] => [ ...(part ? [part] : []), ...(part?.parts ?? []).flatMap(allParts) ]
const bodyText = (payload: GmailPart | undefined): { text?: string; html?: string } => {
	const textPart = findPart(payload, "text/plain")
	const htmlPart = findPart(payload, "text/html")
	return { ...(textPart?.body?.data ? { text: decodeBase64Url(textPart.body.data) } : {}), ...(htmlPart?.body?.data ? { html: decodeBase64Url(htmlPart.body.data) } : {}) }
}
const safeName = (value: string): string => {
	const name = path.basename(value).replace(/[\u0000-\u001f\\/]/g, "_").trim()
	return name && name !== "." && name !== ".." ? name : "attachment"
}
const labelForFolder = (folder: EmailFolder | undefined): string | undefined => ({ inbox: "INBOX", sent: "SENT", drafts: "DRAFT", trash: "TRASH", spam: "SPAM", starred: "STARRED", important: "IMPORTANT" } as Record<string, string>)[folder ?? ""]
const responseHeader = (response: GmailResponse, name: string): string | undefined => {
	if (!response.headers) return undefined
	if (typeof response.headers.get === "function") return response.headers.get(name) ?? undefined
	const value = Object.entries(response.headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
	return value
}

export class GmailApiEmailProvider implements EmailProvider {
	readonly name = "gmail-api"
	private readonly token: GmailAccessToken
	private readonly request: GmailFetch
	private readonly baseUrl: string
	private readonly accountId: string
	private readonly maxResults: number
	private cachedAccount?: EmailAccount

	constructor(options: GmailApiEmailProviderOptions) {
		if (!options.accessToken) throw new EmailError("invalid_input", "Gmail API provider 需要 access token")
		this.token = options.accessToken
		this.request = options.fetch ?? gmailFetch
		this.baseUrl = (options.baseUrl ?? "https://gmail.googleapis.com/gmail/v1/users/me").replace(/\/$/u, "")
		this.accountId = options.accountId?.trim() || "gmail:me"
		this.maxResults = Math.max(1, Math.min(options.maxResults ?? 50, 100))
	}

	private async call(pathname: string, init: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<unknown> {
		const token = typeof this.token === "function" ? await this.token() : this.token
		if (!token) throw new EmailError("provider_unavailable", "Gmail access token 不可用")
		const response = await this.request(`${this.baseUrl}${pathname}`, { method: init.method ?? "GET", headers: { Authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) })
		if (!response.ok) {
			let detail = `${response.status} ${response.statusText ?? "Gmail API error"}`
			let reason = ""
			try {
				const payload = await response.json() as { error?: { message?: string; reason?: string; errors?: Array<{ reason?: string }> } }
				reason = payload.error?.reason ?? payload.error?.errors?.find((item) => item.reason)?.reason ?? ""
				if (payload.error?.message) detail = `${detail}: ${payload.error.message}`
			} catch { /* keep status */ }
			const retryAfterMs = parseEmailRetryAfter(`Retry-After: ${responseHeader(response, "retry-after") ?? ""}`)
			const transient = response.status === 408 || response.status === 429 || response.status >= 500 || /rateLimitExceeded|userRateLimitExceeded|backendError/i.test(reason)
			if (response.status === 401 || (response.status === 403 && !transient)) throw new EmailError("provider_unavailable", `Gmail 授权失效，请重新授权：${detail}`, retryAfterMs)
			if (transient) throw new EmailError("provider_unavailable", `Gmail API 暂时不可用：${detail}`, retryAfterMs)
			throw new EmailError("operation_failed", `Gmail API 请求失败：${detail}`, retryAfterMs)
		}
		return response.json()
	}

	private parseMessage(resource: GmailMessageResource): EmailMessage {
		const payload = resource.payload
		const body = bodyText(payload)
		const attachments = allParts(payload).filter((part) => Boolean(part.filename && part.body?.attachmentId)).map((part, index) => ({ id: part.body!.attachmentId!, messageId: resource.id ?? `message-${index}`, name: safeName(part.filename!), mimeType: part.mimeType ?? "application/octet-stream", ...(typeof part.body?.size === "number" ? { size: part.body.size } : {}) }))
		return { id: resource.id ?? "", threadId: resource.threadId ?? "", from: address(header(payload, "From")), to: addresses(header(payload, "To")), cc: addresses(header(payload, "Cc")), ...(header(payload, "Bcc") ? { bcc: addresses(header(payload, "Bcc")) } : {}), ...(header(payload, "Reply-To") ? { replyTo: addresses(header(payload, "Reply-To")) } : {}), subject: header(payload, "Subject"), date: new Date(Number(resource.internalDate ?? Date.now())).toISOString(), ...body, unread: resource.labelIds?.includes("UNREAD") ?? false, attachments }
	}

	private preview(thread: GmailThreadResource): EmailThreadPreview {
		const messages = thread.messages ?? []
		const latest = messages.at(-1)
		const latestMessage = latest ? this.parseMessage(latest) : undefined
		const labels = [...new Set(messages.flatMap((item) => item.labelIds ?? []))]
		return { id: thread.id ?? "", accountId: this.accountId, subject: latestMessage?.subject ?? "", snippet: thread.snippet ?? latest?.snippet, from: latestMessage?.from ?? { address: "" }, date: latestMessage?.date ?? new Date(0).toISOString(), messageCount: messages.length, unread: messages.some((item) => item.labelIds?.includes("UNREAD")), starred: messages.some((item) => item.labelIds?.includes("STARRED")), labels, attachments: messages.reduce((count, item) => count + this.parseMessage(item).attachments.length, 0) }
	}

	async accounts(): Promise<EmailAccount[]> {
		if (!this.cachedAccount) {
			const profile = await this.call("/profile") as { emailAddress?: string }
			this.cachedAccount = { id: this.accountId, address: profile.emailAddress ?? this.accountId, provider: "gmail-api", status: "connected", capabilities: { read: true, write: true, attachments: true, multipleAccounts: false, management: true, managementOperations: ["mark-read", "mark-unread", "archive", "restore", "star", "trash", "spam", "label-add", "label-remove"], sync: false } }
		}
		return [this.cachedAccount]
	}

	async diagnostics(): Promise<EmailProviderDiagnostic> {
		const accounts = await this.accounts()
		return { provider: this.name, serverName: "Gmail REST API", profile: "gmail", toolDiscovery: "discovered", discoveredTools: ["profile", "threads", "labels", "threads.modify", "drafts", "drafts.send", "attachments"], accounts: accounts.map((item) => ({ id: item.id, address: item.address, status: item.status, capabilities: item.capabilities, provider: this.name })), operations: ["邮件读取", "邮箱标签", "草稿写入", "受控发送", "附件读取", "附件下载"].map((name) => ({ name, ready: true, requiredTools: [name], missingTools: [] })), availableCapabilities: ["read", "write", "management", "attachments"], missingCapabilities: [], readiness: "ready" }
	}

	async threadsPage(input: EmailSearchInput = {}): Promise<EmailThreadPage> {
		const params = new URLSearchParams({ maxResults: String(Math.min(input.limit ?? this.maxResults, 100)) })
		const query = buildGmailSearchQuery(input)
		if (query) params.set("q", query)
		const labelId = input.labelId ?? labelForFolder(input.folder)
		if (labelId) params.set("labelIds", labelId)
		if (input.cursor) params.set("pageToken", input.cursor)
		const listed = await this.call(`/threads?${params.toString()}`) as { threads?: Array<{ id?: string }>; nextPageToken?: string }
		const threads = await Promise.all((listed.threads ?? []).map(async (item) => await this.call(`/threads/${encodeURIComponent(item.id ?? "")}?format=full`) as GmailThreadResource))
		return { items: threads.map((thread) => this.preview(thread)), ...(listed.nextPageToken ? { nextCursor: listed.nextPageToken } : {}) }
	}

	async threads(input: EmailSearchInput = {}): Promise<EmailThreadPreview[]> { return (await this.threadsPage(input)).items }

	async thread(accountId: string, threadId: string): Promise<EmailThread> {
		if (accountId !== this.accountId) throw new EmailError("invalid_input", `Gmail account 不匹配: ${accountId}`)
		const resource = await this.call(`/threads/${encodeURIComponent(threadId)}?format=full`) as GmailThreadResource
		const messages = (resource.messages ?? []).map((item) => this.parseMessage(item))
		return { id: resource.id ?? threadId, accountId: this.accountId, subject: messages[0]?.subject ?? "", messages, labels: [...new Set((resource.messages ?? []).flatMap((item) => item.labelIds ?? []))] }
	}

	private async messageResource(accountId: string, messageId: string): Promise<GmailMessageResource> {
		if (accountId !== this.accountId) throw new EmailError("invalid_input", `Gmail account 不匹配: ${accountId}`)
		return await this.call(`/messages/${encodeURIComponent(messageId)}?format=full`) as GmailMessageResource
	}

	async labels(accountId: string): Promise<EmailLabel[]> {
		if (accountId !== this.accountId) throw new EmailError("invalid_input", `Gmail account 不匹配: ${accountId}`)
		const result = await this.call("/labels") as { labels?: Array<{ id?: string; name?: string; type?: string; color?: { backgroundColor?: string } }> }
		return (result.labels ?? []).map((item) => ({ id: item.id ?? "", name: item.name ?? "", system: item.type === "system", color: item.color?.backgroundColor }))
	}

	async update(input: EmailMutationInput): Promise<EmailMutationResult> {
		if (input.accountId !== this.accountId) throw new EmailError("invalid_input", `Gmail account 不匹配: ${input.accountId}`)
		if (input.dryRun) return { ok: true, provider: this.name, operation: input.kind, threadId: input.threadId, dryRun: true, matched: input.threadIds?.length ?? 1 }
		if (input.kind === "snooze") throw new EmailError("operation_not_supported", "Gmail API provider 尚未支持 snooze")
		if (input.kind === "trash" || input.kind === "spam" || input.kind === "restore") {
			const action = input.kind === "trash" ? "trash" : input.kind === "restore" ? "untrash" : "modify"
			const body = action === "modify" ? { addLabelIds: ["SPAM"] } : undefined
			await this.call(`/threads/${encodeURIComponent(input.threadId)}/${action}`, { method: "POST", body })
		} else {
			const addLabelIds: string[] = []; const removeLabelIds: string[] = []
			if (input.kind === "mark-read") removeLabelIds.push("UNREAD")
			if (input.kind === "mark-unread") addLabelIds.push("UNREAD")
			if (input.kind === "star") (input.value === false ? removeLabelIds : addLabelIds).push("STARRED")
			if (input.kind === "archive") removeLabelIds.push("INBOX")
			if (input.kind === "label" && input.labelId) (input.value === false ? removeLabelIds : addLabelIds).push(input.labelId)
			await this.call(`/threads/${encodeURIComponent(input.threadId)}/modify`, { method: "POST", body: { addLabelIds, removeLabelIds } })
		}
		return { ok: true, provider: this.name, operation: input.kind, threadId: input.threadId, receipt: `gmail:${input.kind}:${input.threadId}` }
	}

	private async rawMessage(input: EmailComposeInput): Promise<string> {
		const headers = [`To: ${input.to.map((item) => item.address).join(", ")}`, ...(input.cc?.length ? [`Cc: ${input.cc.map((item) => item.address).join(", ")}`] : []), ...(input.bcc?.length ? [`Bcc: ${input.bcc.map((item) => item.address).join(", ")}`] : []), `Subject: ${input.subject}`]
		if (!input.attachments?.length) return encodeBase64Url([...headers, "Content-Type: text/plain; charset=UTF-8", "", input.body].join("\r\n"))
		const boundary = `openbuddy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
		const parts = [`--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", input.body]
		for (const attachment of input.attachments) {
			if (!path.isAbsolute(attachment)) throw new EmailError("invalid_input", "Gmail 附件必须是绝对路径")
			const stats = await lstat(attachment).catch(() => undefined)
			if (!stats || !stats.isFile() || stats.isSymbolicLink()) throw new EmailError("invalid_input", `Gmail 附件必须是普通文件: ${path.basename(attachment)}`)
			const name = safeName(path.basename(attachment))
			const safeAttachmentName = name.replaceAll('"', "'")
			const content = (await readFile(attachment)).toString("base64").replace(/.{1,76}/g, "$&\r\n").trim()
			parts.push(`--${boundary}`, `Content-Type: application/octet-stream; name="${safeAttachmentName}"`, `Content-Disposition: attachment; filename="${safeAttachmentName}"`, "Content-Transfer-Encoding: base64", "", content)
		}
		parts.push(`--${boundary}--`)
		return encodeBase64Url([...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", parts.join("\r\n")].join("\r\n"))
	}

	async createDraft(input: EmailComposeInput): Promise<EmailDraft> {
		const body = { message: { raw: await this.rawMessage(input), ...(input.threadId ? { threadId: input.threadId } : {}) } }
		const result = await this.call(input.draftId ? `/drafts/${encodeURIComponent(input.draftId)}` : "/drafts", { method: input.draftId ? "PUT" : "POST", body }) as { id?: string; message?: { id?: string; threadId?: string } }
		const now = new Date().toISOString()
		return { id: result.id ?? input.draftId ?? `gmail-draft-${Date.now().toString(36)}`, accountId: this.accountId, ...(result.message?.threadId ?? input.threadId ? { threadId: result.message?.threadId ?? input.threadId } : {}), ...(result.message?.id ?? input.messageId ? { messageId: result.message?.id ?? input.messageId } : {}), to: input.to, cc: input.cc ?? [], bcc: input.bcc ?? [], ...(input.replyTo ? { replyTo: input.replyTo } : {}), subject: input.subject, body: input.body, ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}), attachments: input.attachments ?? [], status: "draft", createdAt: now, updatedAt: now }
	}

	async sendDraft(draft: EmailDraft): Promise<EmailMutationResult> {
		await this.call("/drafts/send", { method: "POST", body: { id: draft.id } })
		return { ok: true, provider: this.name, operation: "send-draft", receipt: `gmail:send:${draft.id}` }
	}

	async listAttachments(accountId: string, messageId: string): Promise<EmailAttachment[]> {
		const resource = await this.messageResource(accountId, messageId)
		return this.parseMessage(resource).attachments
	}
	async downloadAttachment(accountId: string, attachmentId: string, messageId: string, destinationDir?: string): Promise<EmailAttachmentDownload> {
		if (!destinationDir || !path.isAbsolute(destinationDir)) throw new EmailError("invalid_input", "附件下载目录必须是绝对路径")
		const attachments = await this.listAttachments(accountId, messageId)
		const attachment = attachments.find((item) => item.id === attachmentId)
		if (!attachment) throw new EmailError("invalid_input", `Gmail 附件不存在: ${attachmentId}`)
		const response = await this.call(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`) as { data?: string }
		if (!response.data) throw new EmailError("operation_failed", "Gmail 未返回附件内容")
		const target = path.join(destinationDir, safeName(attachment?.name ?? attachmentId))
		await mkdir(destinationDir, { recursive: true })
		const targetStats = await lstat(target).catch(() => undefined)
		if (targetStats?.isSymbolicLink() || (targetStats && !targetStats.isFile())) throw new EmailError("operation_failed", "附件目标不是普通文件")
		await writeFile(target, Buffer.from(response.data.replaceAll("-", "+").replaceAll("_", "/"), "base64"), { flag: targetStats ? "w" : "wx" })
		return { attachmentId, messageId, name: path.basename(target), localPath: target }
	}
}
