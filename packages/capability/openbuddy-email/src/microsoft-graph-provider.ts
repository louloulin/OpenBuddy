import { lstat, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { EmailError, parseEmailRetryAfter, type EmailAccount, type EmailAddress, type EmailAttachment, type EmailAttachmentDownload, type EmailComposeInput, type EmailDraft, type EmailFolder, type EmailLabel, type EmailMessage, type EmailMutationInput, type EmailMutationResult, type EmailProvider, type EmailProviderDiagnostic, type EmailSearchInput, type EmailThread, type EmailThreadPage, type EmailThreadPreview } from "./index"

type GraphResponse = { ok: boolean; status: number; statusText?: string; headers?: { get(name: string): string | null } | Record<string, string | undefined>; json(): Promise<unknown>; arrayBuffer?(): Promise<ArrayBuffer> }
export type GraphFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<GraphResponse>
export type GraphAccessToken = string | (() => string | Promise<string>)

export interface GraphApiEmailProviderOptions {
	accessToken: GraphAccessToken
	fetch?: GraphFetch
	baseUrl?: string
	accountId?: string
	maxResults?: number
}

export function createMicrosoftGraphEmailProvider(options: GraphApiEmailProviderOptions): MicrosoftGraphEmailProvider {
	return new MicrosoftGraphEmailProvider(options)
}

type GraphAddress = { emailAddress?: { address?: string; name?: string } }
type GraphBody = { contentType?: string; content?: string }
type GraphFlag = { flagStatus?: string }
type GraphAttachment = { id?: string; name?: string; contentType?: string; size?: number; contentBytes?: string; isInline?: boolean; "@odata.type"?: string }
type GraphMessageResource = { id?: string; conversationId?: string; subject?: string; bodyPreview?: string; body?: GraphBody; from?: GraphAddress; sender?: GraphAddress; toRecipients?: GraphAddress[]; ccRecipients?: GraphAddress[]; bccRecipients?: GraphAddress[]; replyTo?: GraphAddress[]; receivedDateTime?: string; sentDateTime?: string; isRead?: boolean; hasAttachments?: boolean; parentFolderId?: string; categories?: string[]; flag?: GraphFlag; attachments?: GraphAttachment[] }
type GraphPage<T> = { value?: T[]; "@odata.nextLink"?: string }

const graphFetch: GraphFetch = async (url, init) => fetch(url, init as RequestInit) as unknown as GraphResponse
const folderId = (folder: EmailFolder | undefined): string | undefined => ({ inbox: "inbox", sent: "sentitems", drafts: "drafts", trash: "deleteditems", spam: "junkemail", archive: "archive", starred: undefined, important: undefined } as Record<string, string | undefined>)[folder ?? ""]
const safeName = (value: string): string => {
	const name = path.basename(value).replace(/[\u0000-\u001f\\/]/g, "_").trim()
	return name && name !== "." && name !== ".." ? name : "attachment"
}
const escapeOData = (value: string): string => value.replaceAll("'", "''")
const address = (value: GraphAddress | undefined): EmailAddress => ({ ...(value?.emailAddress?.name ? { name: value.emailAddress.name } : {}), address: value?.emailAddress?.address ?? "" })
const addresses = (values: GraphAddress[] | undefined): EmailAddress[] => (values ?? []).map(address).filter((item) => item.address)
const recipient = (item: EmailAddress): GraphAddress => ({ emailAddress: { address: item.address, ...(item.name ? { name: item.name } : {}) } })
const iso = (value: string | undefined): string => {
	const parsed = value ? Date.parse(value) : NaN
	return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(0).toISOString()
}
const responseHeader = (response: GraphResponse, name: string): string | undefined => {
	if (!response.headers) return undefined
	if (typeof response.headers.get === "function") return response.headers.get(name) ?? undefined
	return Object.entries(response.headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
}

export class MicrosoftGraphEmailProvider implements EmailProvider {
	readonly name = "graph-api"
	private readonly token: GraphAccessToken
	private readonly request: GraphFetch
	private readonly baseUrl: string
	private readonly accountId: string
	private readonly maxResults: number
	private cachedAccount?: EmailAccount

	constructor(options: GraphApiEmailProviderOptions) {
		if (!options.accessToken) throw new EmailError("invalid_input", "Microsoft Graph provider 需要 access token")
		this.token = options.accessToken
		this.request = options.fetch ?? graphFetch
		this.baseUrl = (options.baseUrl ?? "https://graph.microsoft.com/v1.0").replace(/\/$/u, "")
		this.accountId = options.accountId?.trim() || "graph:me"
		this.maxResults = Math.max(1, Math.min(options.maxResults ?? 50, 100))
	}

	private url(pathname: string): string { return /^https?:\/\//u.test(pathname) ? pathname : `${this.baseUrl}${pathname}` }
	private async call(pathname: string, init: { method?: string; body?: unknown; raw?: boolean; headers?: Record<string, string> } = {}): Promise<unknown> {
		const token = typeof this.token === "function" ? await this.token() : this.token
		if (!token) throw new EmailError("provider_unavailable", "Microsoft Graph access token 不可用")
		const response = await this.request(this.url(pathname), { method: init.method ?? "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body === undefined ? {} : { "Content-Type": "application/json" }), ...(init.headers ?? {}) }, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) })
		if (!response.ok) {
			let detail = `${response.status} ${response.statusText ?? "Microsoft Graph API error"}`
			let code = ""
			try {
				const payload = await response.json() as { error?: { code?: string; message?: string } }
				code = payload.error?.code ?? ""
				if (payload.error?.message) detail = `${detail}: ${payload.error.message}`
			} catch { }
			const retryAfterMs = parseEmailRetryAfter(`Retry-After: ${responseHeader(response, "retry-after") ?? ""}`)
			const transient = response.status === 408 || response.status === 429 || response.status >= 500 || /throttl|timeout|temporar|serviceunavailable/i.test(code)
			if (response.status === 401 || (response.status === 403 && !transient)) throw new EmailError("provider_unavailable", `Microsoft Graph 授权失效，请重新授权：${detail}`, retryAfterMs)
			if (transient) throw new EmailError("provider_unavailable", `Microsoft Graph API 暂时不可用：${detail}`, retryAfterMs)
			throw new EmailError("operation_failed", `Microsoft Graph API 请求失败：${detail}`, retryAfterMs)
		}
		if (init.raw) return response
		if (response.status === 202 || response.status === 204) return {}
		return response.json()
	}

	private parseMessage(resource: GraphMessageResource, threadId = resource.conversationId ?? resource.id ?? ""): EmailMessage {
		const content = resource.body?.content
		const html = resource.body?.contentType?.toLowerCase() === "html" ? content : undefined
		const text = resource.body?.contentType?.toLowerCase() === "text" ? content : undefined
		const attachments = (resource.attachments ?? []).filter((item) => item.isInline !== true).map((item, index) => ({ id: item.id ?? `attachment-${index + 1}`, messageId: resource.id ?? "", name: safeName(item.name ?? "附件"), mimeType: item.contentType ?? "application/octet-stream", ...(typeof item.size === "number" ? { size: item.size } : {}) }))
		return { id: resource.id ?? "", threadId, from: address(resource.from ?? resource.sender), to: addresses(resource.toRecipients), cc: addresses(resource.ccRecipients), ...(resource.bccRecipients?.length ? { bcc: addresses(resource.bccRecipients) } : {}), ...(resource.replyTo?.length ? { replyTo: addresses(resource.replyTo) } : {}), subject: resource.subject ?? "(无主题)", date: iso(resource.receivedDateTime ?? resource.sentDateTime), ...(text === undefined ? {} : { text }), ...(html === undefined ? {} : { html }), unread: resource.isRead === false, attachments }
	}

	private preview(messages: GraphMessageResource[], threadId: string): EmailThreadPreview {
		const latest = [...messages].sort((left, right) => Date.parse(right.receivedDateTime ?? "") - Date.parse(left.receivedDateTime ?? ""))[0]
		const parsed = latest ? this.parseMessage(latest, threadId) : undefined
		const categories = [...new Set(messages.flatMap((item) => item.categories ?? []))]
		return { id: threadId, accountId: this.accountId, subject: parsed?.subject ?? "(无主题)", snippet: latest?.bodyPreview, from: parsed?.from ?? { address: "" }, date: parsed?.date ?? new Date(0).toISOString(), messageCount: messages.length, unread: messages.some((item) => item.isRead === false), starred: messages.some((item) => item.flag?.flagStatus === "flagged"), labels: categories, attachments: messages.reduce((count, item) => count + (item.hasAttachments ? 1 : (item.attachments?.length ?? 0)), 0) }
	}

	private async listMessages(input: EmailSearchInput = {}): Promise<{ items: GraphMessageResource[]; nextCursor?: string }> {
		const params = new URLSearchParams({ "$top": String(Math.min(input.limit ?? this.maxResults, 100)), "$select": "id,conversationId,subject,bodyPreview,body,from,sender,toRecipients,ccRecipients,bccRecipients,replyTo,receivedDateTime,sentDateTime,isRead,hasAttachments,parentFolderId,categories,flag,attachments" })
		const filters: string[] = []
		if (input.unread === true) filters.push("isRead eq false")
		if (input.hasAttachment === true) filters.push("hasAttachments eq true")
		if (input.from) filters.push(`from/emailAddress/address eq '${escapeOData(input.from)}'`)
		if (input.to) filters.push(`toRecipients/any(r:r/emailAddress/address eq '${escapeOData(input.to)}')`)
		if (input.since) filters.push(`receivedDateTime ge ${new Date(input.since).toISOString()}`)
		if (input.until) filters.push(`receivedDateTime le ${new Date(input.until).toISOString()}`)
		if (input.labelId) filters.push(`categories/any(c:c eq '${escapeOData(input.labelId)}')`)
		if (filters.length) params.set("$filter", filters.join(" and "))
		if (input.query) params.set("$search", `"${input.query.replaceAll('"', "\\\"")}"`)
		if (input.cursor) return this.page(input.cursor)
		const folder = folderId(input.folder)
		return this.page(folder ? `/me/mailFolders/${encodeURIComponent(folder)}/messages?${params.toString()}` : `/me/messages?${params.toString()}`)
	}

	private async page(pathname: string): Promise<{ items: GraphMessageResource[]; nextCursor?: string }> {
		const result = await this.call(pathname, { headers: { ConsistencyLevel: "eventual", Prefer: 'outlook.body-content-type="html"' } }) as GraphPage<GraphMessageResource>
		return { items: result.value ?? [], ...(result["@odata.nextLink"] ? { nextCursor: result["@odata.nextLink"] } : {}) }
	}

	async accounts(): Promise<EmailAccount[]> {
		if (!this.cachedAccount) {
			const profile = await this.call("/me?$select=mail,displayName,userPrincipalName") as { mail?: string; displayName?: string; userPrincipalName?: string }
			this.cachedAccount = { id: this.accountId, address: profile.mail ?? profile.userPrincipalName ?? this.accountId, name: profile.displayName, provider: "graph-api", status: "connected", capabilities: { read: true, write: true, attachments: true, multipleAccounts: false, management: true, managementOperations: ["mark-read", "mark-unread", "archive", "restore", "star", "trash", "spam", "label-add", "label-remove"], sync: false } }
		}
		return [this.cachedAccount]
	}

	async diagnostics(): Promise<EmailProviderDiagnostic> {
		const accounts = await this.accounts()
		const capabilities = ["read", "write", "management", "attachments"]
		return { provider: this.name, serverName: "Microsoft Graph API", profile: "outlook", toolDiscovery: "discovered", discoveredTools: ["me", "mailFolders", "messages", "attachments", "drafts", "send"], accounts: accounts.map((item) => ({ id: item.id, address: item.address, status: item.status, capabilities: item.capabilities, provider: this.name })), operations: ["邮件读取", "邮箱文件夹", "草稿写入", "受控发送", "附件读取", "附件下载"].map((name) => ({ name, ready: true, requiredTools: [name], missingTools: [] })), availableCapabilities: capabilities, missingCapabilities: [], readiness: "ready" }
	}

	async threadsPage(input: EmailSearchInput = {}): Promise<EmailThreadPage> {
		const listed = await this.listMessages(input)
		const groups = new Map<string, GraphMessageResource[]>()
		for (const item of listed.items) {
			const id = item.conversationId ?? item.id ?? `message-${groups.size + 1}`
			groups.set(id, [...(groups.get(id) ?? []), item])
		}
		return { items: [...groups].map(([id, messages]) => this.preview(messages, id)), ...(listed.nextCursor ? { nextCursor: listed.nextCursor } : {}) }
	}

	async threads(input: EmailSearchInput = {}): Promise<EmailThreadPreview[]> { return (await this.threadsPage(input)).items }

	private ensureAccount(accountId: string): void { if (accountId !== this.accountId) throw new EmailError("invalid_input", `Microsoft Graph account 不匹配: ${accountId}`) }
	private async threadResources(threadId: string): Promise<GraphMessageResource[]> {
		const params = new URLSearchParams({ "$top": "100", "$orderby": "receivedDateTime asc", "$filter": `conversationId eq '${escapeOData(threadId)}'` })
		const resources: GraphMessageResource[] = []
		let cursor: string | undefined = `/me/messages?${params.toString()}`
		const seen = new Set<string>()
		while (cursor && !seen.has(cursor)) {
			seen.add(cursor)
			const page = await this.page(cursor)
			resources.push(...page.items)
			cursor = page.nextCursor
		}
		return resources
	}

	async thread(accountId: string, threadId: string): Promise<EmailThread> {
		this.ensureAccount(accountId)
		const resources = await this.threadResources(threadId)
		const messages = resources.map((item) => this.parseMessage(item, threadId))
		return { id: threadId, accountId: this.accountId, subject: messages[0]?.subject ?? "(无主题)", messages, labels: [...new Set(resources.flatMap((item) => item.categories ?? []))] }
	}

	async labels(accountId: string): Promise<EmailLabel[]> {
		this.ensureAccount(accountId)
		const result = await this.call("/me/mailFolders?$top=100&$select=id,displayName,parentFolderId") as GraphPage<{ id?: string; displayName?: string; parentFolderId?: string }>
		let categories: GraphPage<{ id?: string; displayName?: string; color?: string }> = {}
		try { categories = await this.call("/me/outlook/masterCategories?$top=100&$select=id,displayName,color") as GraphPage<{ id?: string; displayName?: string; color?: string }> } catch (error) {
			if (!(error instanceof EmailError) || !/category.*permission|permission.*category|category.*accessdenied/i.test(error.message)) throw error
		}
		const systemNames = new Set(["Inbox", "Sent Items", "Drafts", "Deleted Items", "Junk Email", "Archive"])
		return [...(result.value ?? []).map((item) => ({ id: item.id ?? "", name: item.displayName ?? item.id ?? "", system: systemNames.has(item.displayName ?? "") })), ...(categories.value ?? []).map((item) => ({ id: item.displayName ?? item.id ?? "", name: item.displayName ?? item.id ?? "", system: false, ...(item.color ? { color: item.color } : {}) }))]
	}

	private async patchMessage(messageId: string, body: unknown): Promise<void> { await this.call(`/me/messages/${encodeURIComponent(messageId)}`, { method: "PATCH", body }) }
	private async moveMessage(messageId: string, destinationId: string): Promise<void> { await this.call(`/me/messages/${encodeURIComponent(messageId)}/move`, { method: "POST", body: { destinationId } }) }

	async update(input: EmailMutationInput): Promise<EmailMutationResult> {
		this.ensureAccount(input.accountId)
		if (input.dryRun) return { ok: true, provider: this.name, operation: input.kind, threadId: input.threadId, dryRun: true, matched: input.threadIds?.length ?? 1 }
		if (input.kind === "snooze") throw new EmailError("operation_not_supported", "Microsoft Graph provider 尚未支持 snooze")
		const resources = await this.threadResources(input.threadId)
		if (!resources.length) throw new EmailError("invalid_input", `Microsoft Graph 未找到邮件线程: ${input.threadId}`)
		for (const item of resources) {
			if (!item.id) continue
			if (input.kind === "mark-read" || input.kind === "mark-unread") await this.patchMessage(item.id, { isRead: input.kind === "mark-read" })
			else if (input.kind === "star") await this.patchMessage(item.id, { flag: { flagStatus: input.value === false ? "notFlagged" : "flagged" } })
			else if (input.kind === "archive") await this.moveMessage(item.id, "archive")
			else if (input.kind === "restore") await this.moveMessage(item.id, "inbox")
			else if (input.kind === "trash") await this.moveMessage(item.id, "deleteditems")
			else if (input.kind === "spam") await this.moveMessage(item.id, "junkemail")
			else if (input.kind === "label" && input.labelId) {
				const categories = new Set(item.categories ?? [])
				if (input.value === false) categories.delete(input.labelId)
				else categories.add(input.labelId)
				await this.patchMessage(item.id, { categories: [...categories] })
			}
		}
		return { ok: true, provider: this.name, operation: input.kind, threadId: input.threadId, receipt: `graph:${input.kind}:${input.threadId}`, matched: resources.length }
	}

	private composeMessage(input: EmailComposeInput): Record<string, unknown> {
		return { subject: input.subject, body: { contentType: input.bodyHtml ? "HTML" : "Text", content: input.bodyHtml ?? input.body }, toRecipients: input.to.map(recipient), ...(input.cc?.length ? { ccRecipients: input.cc.map(recipient) } : {}), ...(input.bcc?.length ? { bccRecipients: input.bcc.map(recipient) } : {}), ...(input.replyTo?.length ? { replyTo: input.replyTo.map(recipient) } : {}) }
	}

	private async addAttachments(messageId: string, attachments: string[]): Promise<void> {
		for (const attachment of attachments) {
			if (!path.isAbsolute(attachment)) throw new EmailError("invalid_input", "Microsoft Graph 附件必须是绝对路径")
			const stats = await lstat(attachment).catch(() => undefined)
			if (!stats || !stats.isFile() || stats.isSymbolicLink()) throw new EmailError("invalid_input", `Microsoft Graph 附件必须是普通文件: ${path.basename(attachment)}`)
			const content = (await readFile(attachment)).toString("base64")
			await this.call(`/me/messages/${encodeURIComponent(messageId)}/attachments`, { method: "POST", body: { "@odata.type": "#microsoft.graph.fileAttachment", name: safeName(path.basename(attachment)), contentType: "application/octet-stream", contentBytes: content } })
		}
	}

	private async replaceAttachments(messageId: string, attachments: string[]): Promise<void> {
		const existing = await this.listAttachments(this.accountId, messageId)
		for (const attachment of existing) await this.call(`/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}`, { method: "DELETE" })
		await this.addAttachments(messageId, attachments)
	}

	async createDraft(input: EmailComposeInput): Promise<EmailDraft> {
		this.ensureAccount(input.accountId)
		const result = input.draftId ? await this.call(`/me/messages/${encodeURIComponent(input.draftId)}`, { method: "PATCH", body: this.composeMessage(input) }) : await this.call("/me/messages", { method: "POST", body: this.composeMessage(input) }) as GraphMessageResource
		const resource = result as GraphMessageResource
		const id = resource.id ?? input.draftId ?? `graph-draft-${Date.now().toString(36)}`
		if (input.attachments !== undefined) {
			if (input.draftId) await this.replaceAttachments(id, input.attachments)
			else if (input.attachments.length) await this.addAttachments(id, input.attachments)
		}
		const now = new Date().toISOString()
		return { id, accountId: this.accountId, ...(resource.conversationId ?? input.threadId ? { threadId: resource.conversationId ?? input.threadId } : {}), messageId: id, to: input.to, cc: input.cc ?? [], bcc: input.bcc ?? [], ...(input.replyTo ? { replyTo: input.replyTo } : {}), subject: input.subject, body: input.body, ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}), attachments: input.attachments ?? [], status: "draft", createdAt: now, updatedAt: now }
	}

	async sendDraft(draft: EmailDraft): Promise<EmailMutationResult> {
		this.ensureAccount(draft.accountId)
		await this.call(`/me/messages/${encodeURIComponent(draft.id)}/send`, { method: "POST" })
		return { ok: true, provider: this.name, operation: "send-draft", receipt: `graph:send:${draft.id}` }
	}

	async listAttachments(accountId: string, messageId: string): Promise<EmailAttachment[]> {
		this.ensureAccount(accountId)
		const result: GraphAttachment[] = []
		let cursor: string | undefined = `/me/messages/${encodeURIComponent(messageId)}/attachments?$top=100`
		const seen = new Set<string>()
		while (cursor && !seen.has(cursor)) {
			seen.add(cursor)
			const page = await this.call(cursor) as GraphPage<GraphAttachment>
			result.push(...(page.value ?? []))
			cursor = page["@odata.nextLink"]
		}
		return result.filter((item) => item.isInline !== true).map((item, index) => ({ id: item.id ?? `attachment-${index + 1}`, messageId, name: safeName(item.name ?? "附件"), mimeType: item.contentType ?? "application/octet-stream", ...(typeof item.size === "number" ? { size: item.size } : {}) }))
	}

	async downloadAttachment(accountId: string, attachmentId: string, messageId: string, destinationDir?: string): Promise<EmailAttachmentDownload> {
		this.ensureAccount(accountId)
		if (!destinationDir || !path.isAbsolute(destinationDir)) throw new EmailError("invalid_input", "附件下载目录必须是绝对路径")
		const listed = await this.listAttachments(accountId, messageId)
		const attachment = listed.find((item) => item.id === attachmentId)
		if (!attachment) throw new EmailError("invalid_input", `Microsoft Graph 附件不存在: ${attachmentId}`)
		const result = await this.call(`/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`) as GraphAttachment
		let bytes: Buffer
		if (result.contentBytes) bytes = Buffer.from(result.contentBytes, "base64")
		else {
			const response = await this.call(`/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`, { raw: true }) as GraphResponse
			if (!response.arrayBuffer) throw new EmailError("operation_failed", "Microsoft Graph 未返回附件内容")
			bytes = Buffer.from(await response.arrayBuffer())
		}
		const target = path.join(destinationDir, safeName(attachment.name))
		await mkdir(destinationDir, { recursive: true })
		const targetStats = await lstat(target).catch(() => undefined)
		if (targetStats?.isSymbolicLink() || (targetStats && !targetStats.isFile())) throw new EmailError("operation_failed", "附件目标不是普通文件")
		await writeFile(target, bytes, { flag: targetStats ? "w" : "wx" })
		return { attachmentId, messageId, name: path.basename(target), localPath: target }
	}
}
