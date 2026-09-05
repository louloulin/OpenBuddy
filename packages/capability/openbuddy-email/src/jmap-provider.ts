import { lstat, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { EmailError, parseEmailRetryAfter, type EmailAccount, type EmailAddress, type EmailAttachment, type EmailAttachmentDownload, type EmailComposeInput, type EmailDraft, type EmailFolder, type EmailLabel, type EmailMessage, type EmailMutationInput, type EmailMutationResult, type EmailProvider, type EmailProviderDiagnostic, type EmailSearchInput, type EmailThread, type EmailThreadPage, type EmailThreadPreview } from "./index"

type JmapResponse = { ok: boolean; status: number; statusText?: string; headers?: { get(name: string): string | null } | Record<string, string | undefined>; json(): Promise<unknown>; arrayBuffer?(): Promise<ArrayBuffer> }
export type JmapFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }) => Promise<JmapResponse>
export type JmapAccessToken = string | (() => string | Promise<string>)
export interface JmapEmailProviderOptions {
	accessToken: JmapAccessToken
	fetch?: JmapFetch
	sessionUrl?: string
	apiUrl?: string
	downloadUrl?: string
	uploadUrl?: string
	accountId?: string
	maxResults?: number
}

type JmapSession = { apiUrl?: string; downloadUrl?: string; uploadUrl?: string; primaryAccounts?: Record<string, string>; accounts?: Record<string, { name?: string; emailAddresses?: Array<{ email?: string; name?: string; type?: string }> }> }
type JmapMethodResponse = [string, Record<string, unknown>, string]
type JmapBatchResponse = { methodResponses?: JmapMethodResponse[]; sessionState?: string }
type JmapMailbox = { id?: string; name?: string; role?: string; sortOrder?: number; totalEmails?: number; unreadEmails?: number }
type JmapAddress = { email?: string; name?: string }
type JmapEmail = { id?: string; threadId?: string; mailboxIds?: Record<string, boolean>; keywords?: Record<string, boolean>; from?: JmapAddress[]; to?: JmapAddress[]; cc?: JmapAddress[]; bcc?: JmapAddress[]; replyTo?: JmapAddress[]; subject?: string; receivedAt?: string; sentAt?: string; preview?: string; hasAttachment?: boolean; textBody?: Array<{ partId?: string; type?: string }>; htmlBody?: Array<{ partId?: string; type?: string }>; bodyValues?: Record<string, { value?: string; isEncodingProblem?: boolean }>; attachments?: Array<{ blobId?: string; name?: string; type?: string; size?: number; disposition?: string }>; headers?: Record<string, string> }
const defaultFetch: JmapFetch = async (url, init) => fetch(url, init as RequestInit) as unknown as JmapResponse
const safeName = (value: string): string => {
	const name = path.basename(value).replace(/[\u0000-\u001f\\/]/g, "_").trim()
	return name && name !== "." && name !== ".." ? name : "attachment"
}
const folderRole = (folder: EmailFolder | undefined): string | undefined => ({ inbox: "inbox", sent: "sent", drafts: "drafts", trash: "trash", spam: "junk", archive: "archive", starred: "flagged", important: "important" } as Record<string, string | undefined>)[folder ?? ""]
const jmapAddress = (value: JmapAddress | undefined): EmailAddress => ({ address: value?.email ?? "", ...(value?.name ? { name: value.name } : {}) })
const addresses = (values: JmapAddress[] | undefined): EmailAddress[] => (values ?? []).map(jmapAddress).filter((item) => item.address)
const apiResponseHeader = (response: JmapResponse, name: string): string | undefined => {
	if (!response.headers) return undefined
	if (typeof response.headers.get === "function") return response.headers.get(name) ?? undefined
	return Object.entries(response.headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
}
const iso = (value: string | undefined): string => {
	const date = value ? Date.parse(value) : NaN
	return Number.isFinite(date) ? new Date(date).toISOString() : new Date(0).toISOString()
}
const method = (responses: JmapMethodResponse[] | undefined, name: string): Record<string, unknown> => {
	const response = responses?.find((item) => item[0] === name)
	if (!response) throw new EmailError("operation_failed", `JMAP 未返回 ${name} 结果`)
	if (response[1].type && typeof response[1].type === "string" && (/error|invalid|notFound|serverFail/i.test(response[1].type) || response[1].type.endsWith("/error"))) throw new EmailError("operation_failed", `JMAP ${name} 失败: ${String(response[1].description ?? response[1].type)}`)
	return response[1]
}

export function createJmapEmailProvider(options: JmapEmailProviderOptions): JmapEmailProvider { return new JmapEmailProvider(options) }

export class JmapEmailProvider implements EmailProvider {
	readonly name = "jmap-api"
	private readonly token: JmapAccessToken
	private readonly request: JmapFetch
	private readonly sessionUrl: string
	private readonly configuredApiUrl?: string
	private readonly configuredDownloadUrl?: string
	private readonly configuredUploadUrl?: string
	private readonly accountIdHint: string
	private readonly maxResults: number
	private session?: JmapSession
	private mailAccountId?: string
	private submissionAccountId?: string
	private identityId?: string
	private identity?: { id: string; email: string; name?: string }
	private mailboxes?: JmapMailbox[]
	private cachedAccount?: EmailAccount

	constructor(options: JmapEmailProviderOptions) {
		if (!options.accessToken) throw new EmailError("invalid_input", "JMAP provider 需要 access token")
		this.token = options.accessToken
		this.request = options.fetch ?? defaultFetch
		this.sessionUrl = options.sessionUrl ?? "https://api.fastmail.com/.well-known/jmap/session"
		this.configuredApiUrl = options.apiUrl?.replace(/\/$/u, "")
		this.configuredDownloadUrl = options.downloadUrl?.replace(/\/$/u, "")
		this.configuredUploadUrl = options.uploadUrl?.replace(/\/$/u, "")
		this.accountIdHint = options.accountId?.trim() || "jmap:me"
		this.maxResults = Math.max(1, Math.min(options.maxResults ?? 50, 100))
	}

	private async http(url: string, init: { method?: string; body?: unknown; raw?: boolean; headers?: Record<string, string> } = {}): Promise<unknown> {
		const token = typeof this.token === "function" ? await this.token() : this.token
		if (!token) throw new EmailError("provider_unavailable", "JMAP access token 不可用")
		const isBinary = init.body instanceof Uint8Array
	const requestInit: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array } = { method: init.method ?? "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body === undefined || isBinary ? {} : { "Content-Type": "application/json" }), ...(init.headers ?? {}) } }
	if (init.body !== undefined) requestInit.body = isBinary ? init.body as Uint8Array : JSON.stringify(init.body)
	const response = await this.request(url, requestInit)
		if (!response.ok) {
			let detail = `${response.status} ${response.statusText ?? "JMAP API error"}`
			try { const payload = await response.json() as { type?: string; description?: string; error?: string }; detail = `${detail}: ${payload.description ?? payload.error ?? payload.type ?? "request failed"}` } catch { }
			const retryAfterMs = parseEmailRetryAfter(`Retry-After: ${apiResponseHeader(response, "retry-after") ?? ""}`)
			if (response.status === 401 || response.status === 403) throw new EmailError("provider_unavailable", `JMAP 授权失效，请重新授权：${detail}`, retryAfterMs)
			if (response.status === 408 || response.status === 429 || response.status >= 500) throw new EmailError("provider_unavailable", `JMAP API 暂时不可用：${detail}`, retryAfterMs)
			throw new EmailError("operation_failed", `JMAP API 请求失败：${detail}`, retryAfterMs)
		}
		if (init.raw) return response
		if (response.status === 202 || response.status === 204) return {}
		return response.json()
	}

	private async ensureSession(): Promise<JmapSession> {
		if (this.session) return this.session
		this.session = await this.http(this.sessionUrl) as JmapSession
		this.mailAccountId = this.session.primaryAccounts?.["urn:ietf:params:jmap:mail"] ?? Object.keys(this.session.accounts ?? {})[0]
		this.submissionAccountId = this.session.primaryAccounts?.["urn:ietf:params:jmap:submission"] ?? this.mailAccountId
		if (!this.mailAccountId) throw new EmailError("provider_unavailable", "JMAP session 未提供 mail account")
		return this.session
	}

	private async call(calls: Array<[string, Record<string, unknown>, string]>): Promise<JmapMethodResponse[]> {
		const session = await this.ensureSession()
		const apiUrl = this.configuredApiUrl ?? session.apiUrl
		if (!apiUrl) throw new EmailError("provider_unavailable", "JMAP session 未提供 API URL")
		const result = await this.http(apiUrl, { method: "POST", body: { using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail", "urn:ietf:params:jmap:submission"], methodCalls: calls } }) as JmapBatchResponse
		return result.methodResponses ?? []
	}

	private async mailboxList(): Promise<JmapMailbox[]> {
		if (this.mailboxes) return this.mailboxes
		const responses = await this.call([["Mailbox/get", { accountId: this.mailAccountId!, ids: null, properties: ["id", "name", "role", "sortOrder", "totalEmails", "unreadEmails"] }, "mailboxes"]])
		this.mailboxes = (method(responses, "Mailbox/get").list as JmapMailbox[] | undefined) ?? []
		return this.mailboxes
	}

	private mailboxFor(input: EmailFolder | undefined): JmapMailbox | undefined {
		const role = folderRole(input)
		return this.mailboxes?.find((item) => item.role === role) ?? this.mailboxes?.find((item) => item.name?.toLowerCase() === (input ?? "").toLowerCase())
	}

	private parseMessage(resource: JmapEmail, threadId = resource.threadId ?? resource.id ?? ""): EmailMessage {
		const text = resource.textBody?.map((part) => resource.bodyValues?.[part.partId ?? ""]?.value ?? "").join("\n").trim() || undefined
		const html = resource.htmlBody?.map((part) => resource.bodyValues?.[part.partId ?? ""]?.value ?? "").join("\n").trim() || undefined
		const attachments = (resource.attachments ?? []).filter((item) => item.disposition !== "inline").map((item, index) => ({ id: item.blobId ?? `attachment-${index + 1}`, messageId: resource.id ?? "", name: safeName(item.name ?? "附件"), mimeType: item.type ?? "application/octet-stream", ...(typeof item.size === "number" ? { size: item.size } : {}) }))
		return { id: resource.id ?? "", threadId, from: jmapAddress(resource.from?.[0]), to: addresses(resource.to), cc: addresses(resource.cc), ...(resource.bcc?.length ? { bcc: addresses(resource.bcc) } : {}), ...(resource.replyTo?.length ? { replyTo: addresses(resource.replyTo) } : {}), subject: resource.subject ?? "(无主题)", date: iso(resource.receivedAt ?? resource.sentAt), ...(text ? { text } : {}), ...(html ? { html } : {}), unread: resource.keywords?.$seen !== true, attachments }
	}

	private preview(resource: JmapEmail): EmailThreadPreview {
		return { id: resource.threadId ?? resource.id ?? "", accountId: this.accountIdHint, subject: resource.subject ?? "(无主题)", snippet: resource.preview, from: jmapAddress(resource.from?.[0]), date: iso(resource.receivedAt ?? resource.sentAt), messageCount: 1, unread: resource.keywords?.$seen !== true, starred: resource.keywords?.$flagged === true, labels: Object.keys(resource.mailboxIds ?? {}).filter((id) => resource.mailboxIds?.[id]) , attachments: resource.hasAttachment ? (resource.attachments?.length ?? 1) : 0 }
	}

	private encodeCursor(position: number): string { return Buffer.from(JSON.stringify({ position }), "utf8").toString("base64url") }
	private decodeCursor(cursor?: string): number { if (!cursor) return 0; try { const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { position?: number }; return Math.max(0, Number(parsed.position) || 0) } catch { throw new EmailError("invalid_input", "JMAP 分页游标无效") } }

	async accounts(): Promise<EmailAccount[]> {
		const session = await this.ensureSession()
		if (!this.cachedAccount) {
			const account = session.accounts?.[this.mailAccountId!]
			const email = account?.emailAddresses?.find((item) => item.type === "primary") ?? account?.emailAddresses?.[0]
			this.cachedAccount = { id: this.accountIdHint, address: email?.email ?? this.accountIdHint, name: email?.name ?? account?.name, provider: "jmap-api", status: "connected", capabilities: { read: true, write: true, attachments: true, multipleAccounts: false, management: true, managementOperations: ["mark-read", "mark-unread", "archive", "restore", "star", "trash", "spam", "label-add", "label-remove"], sync: false } }
		}
		return [this.cachedAccount]
	}

	async diagnostics(): Promise<EmailProviderDiagnostic> {
		const accounts = await this.accounts()
		return { provider: this.name, serverName: "JMAP API", profile: "jmap", toolDiscovery: "discovered", discoveredTools: ["Session", "Mailbox/get", "Email/query", "Email/get", "Email/set", "EmailSubmission/set", "download"], accounts: accounts.map((item) => ({ id: item.id, address: item.address, status: item.status, capabilities: item.capabilities, provider: this.name })), operations: ["邮件读取", "邮箱文件夹", "草稿写入", "受控发送", "附件读取", "附件下载"].map((name) => ({ name, ready: true, requiredTools: [name], missingTools: [] })), availableCapabilities: ["read", "write", "management", "attachments"], missingCapabilities: [], readiness: "ready" }
	}

	private async query(input: EmailSearchInput): Promise<{ ids: string[]; position: number; total?: number }> {
		await this.mailboxList()
		const filter: Record<string, unknown> = {}
		const folder = this.mailboxFor(input.folder)
		if (folder?.id) filter.inMailbox = folder.id
		if (input.query) filter.text = input.query
		if (input.from) filter.from = input.from
		if (input.to) filter.to = input.to
		if (input.unread === true) filter.notKeyword = "$seen"
		if (input.hasAttachment === true) filter.hasAttachment = true
		if (input.since) filter.after = new Date(input.since).toISOString()
		if (input.until) filter.before = new Date(input.until).toISOString()
		if (input.labelId) filter.inMailbox = input.labelId
		const position = this.decodeCursor(input.cursor)
		const responses = await this.call([["Email/query", { accountId: this.mailAccountId!, filter, sort: [{ property: "receivedAt", isAscending: false }], position, limit: Math.min(input.limit ?? this.maxResults, 100), calculateTotal: true }, "query"]])
		const result = method(responses, "Email/query")
		return { ids: (result.ids as string[] | undefined) ?? [], position: Number(result.position ?? position), ...(typeof result.total === "number" ? { total: result.total } : {}) }
	}

	private async getEmails(ids: string[]): Promise<JmapEmail[]> {
		if (!ids.length) return []
		const responses = await this.call([["Email/get", { accountId: this.mailAccountId!, ids, properties: ["id", "threadId", "mailboxIds", "keywords", "from", "to", "cc", "bcc", "replyTo", "subject", "receivedAt", "sentAt", "preview", "hasAttachment", "textBody", "htmlBody", "bodyValues", "attachments", "headers"], fetchTextBodyValues: true, fetchHTMLBodyValues: true, maxBodyValueBytes: 1_048_576 }, "emails"]])
		return (method(responses, "Email/get").list as JmapEmail[] | undefined) ?? []
	}

	async threadsPage(input: EmailSearchInput = {}): Promise<EmailThreadPage> {
		const query = await this.query(input)
		const emails = await this.getEmails(query.ids)
		const grouped = new Map<string, JmapEmail>()
		for (const email of emails) { const id = email.threadId ?? email.id ?? ""; if (!grouped.has(id)) grouped.set(id, email) }
		const nextPosition = query.position + query.ids.length
		return { items: [...grouped.values()].map((item) => this.preview(item)), ...(query.total !== undefined && nextPosition < query.total && query.ids.length ? { nextCursor: this.encodeCursor(nextPosition) } : {}) }
	}

	async threads(input: EmailSearchInput = {}): Promise<EmailThreadPreview[]> { return (await this.threadsPage(input)).items }

	private ensureAccount(accountId: string): void { if (accountId !== this.accountIdHint) throw new EmailError("invalid_input", `JMAP account 不匹配: ${accountId}`) }
	private async threadResource(threadId: string): Promise<JmapEmail[]> {
		const responses = await this.call([["Email/query", { accountId: this.mailAccountId!, filter: { inThread: threadId }, sort: [{ property: "receivedAt", isAscending: true }], limit: 100 }, "thread-query"]])
		return this.getEmails((method(responses, "Email/query").ids as string[] | undefined) ?? [])
	}

	async thread(accountId: string, threadId: string): Promise<EmailThread> {
		this.ensureAccount(accountId)
		const messages = (await this.threadResource(threadId)).map((item) => this.parseMessage(item, threadId))
		return { id: threadId, accountId: this.accountIdHint, subject: messages[0]?.subject ?? "(无主题)", messages, labels: [] }
	}

	async labels(accountId: string): Promise<EmailLabel[]> {
		this.ensureAccount(accountId)
		return (await this.mailboxList()).map((item) => ({ id: item.id ?? "", name: item.name ?? item.id ?? "", system: Boolean(item.role) }))
	}

	private async setEmail(id: string, update: Record<string, unknown>): Promise<void> {
		const responses = await this.call([["Email/set", { accountId: this.mailAccountId!, update: { [id]: update } }, "set"]])
		method(responses, "Email/set")
	}

	private async ensureIdentity(): Promise<{ id: string; email: string; name?: string }> {
		if (this.identity) return this.identity
		await this.ensureSession()
		const responses = await this.call([["Identity/get", { accountId: this.submissionAccountId!, ids: null }, "identities"]])
		const item = ((method(responses, "Identity/get").list as Array<{ id?: string; email?: string; name?: string }> | undefined) ?? []).find((entry) => entry.id && entry.email)
		if (!item?.id || !item.email) throw new EmailError("operation_not_supported", "JMAP session 未提供可发送 identity")
		this.identityId = item.id
		this.identity = { id: item.id, email: item.email, ...(item.name ? { name: item.name } : {}) }
		return this.identity
	}

	async update(input: EmailMutationInput): Promise<EmailMutationResult> {
		this.ensureAccount(input.accountId)
		if (input.dryRun) return { ok: true, provider: this.name, operation: input.kind, threadId: input.threadId, dryRun: true, matched: input.threadIds?.length ?? 1 }
		if (input.kind === "snooze") throw new EmailError("operation_not_supported", "JMAP provider 尚未支持 snooze")
		const resources = await this.threadResource(input.threadId)
		if (!resources.length) throw new EmailError("invalid_input", `JMAP 未找到邮件线程: ${input.threadId}`)
		const mailboxList = await this.mailboxList()
		const target = (role: string) => mailboxList.find((item) => item.role === role)?.id
		for (const email of resources) {
			if (!email.id) continue
			const keywords = { ...(email.keywords ?? {}) }
			const mailboxIds = { ...(email.mailboxIds ?? {}) }
			if (input.kind === "mark-read") keywords.$seen = true
			if (input.kind === "mark-unread") delete keywords.$seen
			if (input.kind === "star") { if (input.value === false) delete keywords.$flagged; else keywords.$flagged = true }
			if (input.kind === "archive") { const inbox = target("inbox"); if (inbox) delete mailboxIds[inbox] }
			if (input.kind === "restore") { const inbox = target("inbox"); if (inbox) mailboxIds[inbox] = true }
			if (input.kind === "trash") { const trash = target("trash"); if (trash) mailboxIds[trash] = true }
			if (input.kind === "spam") { const junk = target("junk"); if (junk) mailboxIds[junk] = true }
			if (input.kind === "label" && input.labelId) { if (input.value === false) delete mailboxIds[input.labelId]; else mailboxIds[input.labelId] = true }
			await this.setEmail(email.id, { keywords, mailboxIds })
		}
		return { ok: true, provider: this.name, operation: input.kind, threadId: input.threadId, receipt: `jmap:${input.kind}:${input.threadId}`, matched: resources.length }
	}

	private async uploadAttachments(attachments: string[]): Promise<Array<{ blobId: string; type: string; name: string; disposition: string; size: number }>> {
		if (!attachments.length) return []
		const session = await this.ensureSession()
		const template = this.configuredUploadUrl ?? session.uploadUrl
		if (!template) throw new EmailError("operation_not_supported", "JMAP session 未提供附件上传 URL")
		const uploaded: Array<{ blobId: string; type: string; name: string; disposition: string; size: number }> = []
		for (const attachment of attachments) {
			if (!path.isAbsolute(attachment)) throw new EmailError("invalid_input", "JMAP 附件必须是绝对路径")
			const stats = await lstat(attachment).catch(() => undefined)
			if (!stats || !stats.isFile() || stats.isSymbolicLink()) throw new EmailError("invalid_input", `JMAP 附件必须是普通文件: ${path.basename(attachment)}`)
			const name = safeName(path.basename(attachment))
			const url = template.replaceAll("{accountId}", encodeURIComponent(this.mailAccountId!))
			const response = await this.http(url, { method: "POST", body: new Uint8Array(await readFile(attachment)), headers: { "Content-Type": "application/octet-stream", "X-Filename": name } }) as { blobId?: string; type?: string; size?: number }
			if (!response.blobId) throw new EmailError("operation_failed", "JMAP 附件上传未返回 blobId")
			uploaded.push({ blobId: response.blobId, type: response.type ?? "application/octet-stream", name, disposition: "attachment", size: response.size ?? stats.size })
		}
		return uploaded
	}

	private compose(input: EmailComposeInput, identity: { email: string; name?: string }, attachments: Array<{ blobId: string; type: string; name: string; disposition: string; size: number }>): Record<string, unknown> {
		const draftMailbox = this.mailboxFor("drafts")?.id
		if (!draftMailbox) throw new EmailError("operation_not_supported", "JMAP 未提供 Drafts mailbox")
		const plainPart = { partId: "text", type: "text/plain", charset: "utf-8" }
		const htmlPart = { partId: "html", type: "text/html", charset: "utf-8" }
		const contentPart = input.bodyHtml ? { type: "multipart/alternative", subParts: [plainPart, htmlPart] } : plainPart
		const bodyStructure = attachments.length ? { type: "multipart/mixed", subParts: [contentPart, ...attachments.map((attachment) => ({ blobId: attachment.blobId, type: attachment.type, name: attachment.name, disposition: attachment.disposition, size: attachment.size }))] } : contentPart
		return { mailboxIds: { [draftMailbox]: true }, keywords: { $draft: true }, from: [{ email: identity.email, ...(identity.name ? { name: identity.name } : {}) }], to: input.to.map((item) => ({ email: item.address, ...(item.name ? { name: item.name } : {}) })), cc: (input.cc ?? []).map((item) => ({ email: item.address, ...(item.name ? { name: item.name } : {}) })), bcc: (input.bcc ?? []).map((item) => ({ email: item.address, ...(item.name ? { name: item.name } : {}) })), replyTo: (input.replyTo ?? []).map((item) => ({ email: item.address, ...(item.name ? { name: item.name } : {}) })), subject: input.subject, bodyStructure, bodyValues: { text: { value: input.body }, ...(input.bodyHtml ? { html: { value: input.bodyHtml } } : {}) } }
	}

	async createDraft(input: EmailComposeInput): Promise<EmailDraft> {
		this.ensureAccount(input.accountId)
		await this.mailboxList()
		const identity = await this.ensureIdentity()
		const attachments = await this.uploadAttachments(input.attachments ?? [])
		const update = this.compose(input, identity, attachments)
		const responses = await this.call([["Email/set", { accountId: this.mailAccountId!, ...(input.draftId ? { update: { [input.draftId]: update } } : { create: { draft: update } }) }, "draft"]])
		const result = method(responses, "Email/set")
		const created = (result.created as Record<string, { id?: string; threadId?: string }> | undefined)?.draft
		const id = created?.id ?? input.draftId ?? `jmap-draft-${Date.now().toString(36)}`
		const now = new Date().toISOString()
		return { id, accountId: this.accountIdHint, ...(created?.threadId ?? input.threadId ? { threadId: created?.threadId ?? input.threadId } : {}), messageId: id, to: input.to, cc: input.cc ?? [], bcc: input.bcc ?? [], ...(input.replyTo ? { replyTo: input.replyTo } : {}), subject: input.subject, body: input.body, ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}), attachments: input.attachments ?? [], status: "draft", createdAt: now, updatedAt: now }
	}

	async sendDraft(draft: EmailDraft): Promise<EmailMutationResult> {
		this.ensureAccount(draft.accountId)
		await this.ensureIdentity()
		const responses = await this.call([["EmailSubmission/set", { accountId: this.submissionAccountId!, create: { submission: { emailId: draft.messageId ?? draft.id, identityId: this.identityId } } }, "submission"]])
		method(responses, "EmailSubmission/set")
		return { ok: true, provider: this.name, operation: "send-draft", receipt: `jmap:send:${draft.id}` }
	}

	async listAttachments(accountId: string, messageId: string): Promise<EmailAttachment[]> {
		this.ensureAccount(accountId)
		const emails = await this.getEmails([messageId])
		return (emails[0]?.attachments ?? []).filter((item) => item.disposition !== "inline").map((item, index) => ({ id: item.blobId ?? `attachment-${index + 1}`, messageId, name: safeName(item.name ?? "附件"), mimeType: item.type ?? "application/octet-stream", ...(typeof item.size === "number" ? { size: item.size } : {}) }))
	}

	async downloadAttachment(accountId: string, attachmentId: string, messageId: string, destinationDir?: string): Promise<EmailAttachmentDownload> {
		this.ensureAccount(accountId)
		if (!destinationDir || !path.isAbsolute(destinationDir)) throw new EmailError("invalid_input", "附件下载目录必须是绝对路径")
		const attachment = (await this.listAttachments(accountId, messageId)).find((item) => item.id === attachmentId)
		if (!attachment) throw new EmailError("invalid_input", `JMAP 附件不存在: ${attachmentId}`)
		const session = await this.ensureSession()
		const template = this.configuredDownloadUrl ?? session.downloadUrl
		if (!template) throw new EmailError("operation_not_supported", "JMAP session 未提供附件下载 URL")
		const url = template.replaceAll("{accountId}", encodeURIComponent(this.mailAccountId!)).replaceAll("{blobId}", encodeURIComponent(attachmentId)).replaceAll("{name}", encodeURIComponent(attachment.name)).replaceAll("{type}", encodeURIComponent(attachment.mimeType))
		const response = await this.http(url, { raw: true }) as JmapResponse
		if (!response.arrayBuffer) throw new EmailError("operation_failed", "JMAP 未返回附件内容")
		const target = path.join(destinationDir, safeName(attachment.name))
		await mkdir(destinationDir, { recursive: true })
		const targetStats = await lstat(target).catch(() => undefined)
		if (targetStats?.isSymbolicLink() || (targetStats && !targetStats.isFile())) throw new EmailError("operation_failed", "附件目标不是普通文件")
		await writeFile(target, Buffer.from(await response.arrayBuffer()), { flag: targetStats ? "w" : "wx" })
		return { attachmentId, messageId, name: path.basename(target), localPath: target }
	}
}
