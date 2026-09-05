import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"
import type { ToolDefinition } from "@earendil-works/pi-coding-agent"
import type { Context } from "@openbuddy/cordis"
import { OpenBuddyService } from "@openbuddy/cordis"
import type { McpClient, McpToolCallResult } from "@openbuddy/capability-mcp-client"
import { EmailProviderRegistry, type EmailConnection, type EmailConnectionReadiness, type EmailProviderRegistryDiagnostic, type EmailRegistryProviderType } from "./provider-registry"
import { EmailPermissionResolver, type EmailPermission, type EmailPermissionAuditContext } from "./email-permissions"

export type EmailFolder = "inbox" | "sent" | "drafts" | "archive" | "trash" | "spam" | "starred" | "important" | "snoozed" | "custom"
export type EmailMutationKind = "mark-read" | "mark-unread" | "archive" | "restore" | "label" | "star" | "trash" | "spam" | "snooze"
export type EmailSenderPolicy = "signal" | "noise" | "block"
export type EmailManagementCapability = Exclude<EmailMutationKind, "label"> | "label-add" | "label-remove" | "unsubscribe"

export interface EmailAddress { name?: string; address: string }
export interface EmailAccount {
	id: string
	address: string
	name?: string
	provider: "mcp" | "gmail-api" | "graph-api" | "jmap-api"
	status: "connected" | "reauthorization-required" | "disconnected"
	capabilities: { read: boolean; write: boolean; attachments: boolean; multipleAccounts: boolean; management?: boolean; managementOperations?: EmailManagementCapability[]; sync?: boolean }
}
export type EmailProviderReadiness = "ready" | "partial" | "reauthorization-required" | "unavailable"
export interface EmailProviderOperationStatus {
	name: string
	ready: boolean
	requiredTools: string[]
	missingTools: string[]
}
export interface EmailProviderDiagnosticAccount {
	id: string
	address: string
	status: EmailAccount["status"]
	capabilities: EmailAccount["capabilities"]
	provider?: string
}
export interface EmailProviderDiagnostic {
	provider: string
	serverName: string
	profile: EmailMcpProviderProfile | "composite"
	toolDiscovery: "discovered" | "not-available"
	discoveredTools: string[]
	accounts: EmailProviderDiagnosticAccount[]
	operations: EmailProviderOperationStatus[]
	availableCapabilities: string[]
	missingCapabilities: string[]
	readiness: EmailProviderReadiness
	message?: string
}
export interface EmailThreadPreview {
	id: string
	accountId: string
	subject: string
	snippet?: string
	from: EmailAddress
	date: string
	messageCount: number
	unread: boolean
	starred?: boolean
	labels: string[]
	tags?: string[]
	attachments?: number
}
export interface EmailThreadPage { items: EmailThreadPreview[]; nextCursor?: string }
export type EmailSyncStatus = "synced" | "syncing" | "not-supported" | "failed" | "reauthorization-required"
export interface EmailSyncState {
	accountId: string
	provider: string
	status: EmailSyncStatus
	cursor?: string
	lastSyncedAt?: string
	startedAt?: string
	completedAt?: string
	added?: number
	updated?: number
	removed?: number
	error?: string
	retryAfterMs?: number
}
export interface EmailSyncInput {
	accountId: string
	cursor?: string
	limit?: number
	full?: boolean
}
export interface EmailSyncResult extends EmailSyncState {}
export interface EmailAttachment { id: string; messageId: string; name: string; mimeType: string; size?: number }
export interface EmailAttachmentDownload { attachmentId: string; messageId: string; name: string; localPath: string }
export interface EmailMessage {
	id: string
	threadId: string
	from: EmailAddress
	to: EmailAddress[]
	cc: EmailAddress[]
	bcc?: EmailAddress[]
	replyTo?: EmailAddress[]
	subject: string
	date: string
	text?: string
	html?: string
	unread: boolean
	attachments: EmailAttachment[]
	unsubscribeLinks?: string[]
}
export interface EmailThread { id: string; accountId: string; subject: string; messages: EmailMessage[]; labels: string[]; tags?: string[] }
export interface EmailLabel { id: string; name: string; system?: boolean; color?: string }
export interface EmailWorkspaceTag { id: string; name: string; color: string; scope: "personal" | "team"; createdAt: string }
export interface EmailTagMutationInput { accountId: string; threadId: string; tagNames: string[]; mode?: "add" | "remove" | "replace" }
export interface EmailDraft {
	id: string
	accountId: string
	threadId?: string
	messageId?: string
	to: EmailAddress[]
	cc: EmailAddress[]
	bcc: EmailAddress[]
	replyTo?: EmailAddress[]
	subject: string
	body: string
	bodyHtml?: string
	attachments: string[]
	status: "draft" | "sent"
	createdAt: string
	updatedAt: string
	scheduledAt?: string
}
export interface EmailConnectionRecord {
	id: string
	providerType: EmailRegistryProviderType
	accountId?: string
	displayName: string
	credentialRef?: string
	mcpServerName?: string
	scopes?: string[]
	enabledCapabilities?: string[]
	enabled: boolean
	status: "configured" | "connected" | "reauthorization-required" | "disabled" | "error"
	lastError?: string
	updatedAt: string
}
export interface EmailRegistryRegisterInput {
	id?: string
	providerType: EmailRegistryProviderType
	displayName: string
	credentialRef?: string
	mcpServerName?: string
	scopes?: string[]
	enabledCapabilities?: string[]
	enabled?: boolean
}
export interface EmailSearchInput {
	accountId?: string
	query?: string
	folder?: EmailFolder
	labelId?: string
	tags?: string[]
	tagMatch?: "any" | "all"
	from?: string
	to?: string
	unread?: boolean
	hasAttachment?: boolean
	since?: string
	until?: string
	limit?: number
	cursor?: string
}
export interface EmailComposeInput {
	accountId: string
	draftId?: string
	to: EmailAddress[]
	cc?: EmailAddress[]
	bcc?: EmailAddress[]
	replyTo?: EmailAddress[]
	subject: string
	body: string
	bodyHtml?: string
	attachments?: string[]
	threadId?: string
	messageId?: string
}
export interface EmailMutationInput {
	accountId: string
	threadId: string
	threadIds?: string[]
	kind: EmailMutationKind
	labelId?: string
	value?: boolean
	dryRun?: boolean
	sampleLimit?: number
	confirmed?: boolean
	snoozeUntil?: string
}
export interface EmailSenderPolicyInput { accountId?: string; threadId?: string; senderEmail: string; policy: EmailSenderPolicy; confirmed?: boolean }
export interface EmailUnsubscribeInput { accountId: string; messageId: string; threadId?: string; confirmed?: boolean }
export interface EmailUnsubscribeResult extends EmailMutationResult { method?: string; detail?: string }
export interface EmailShareInput { accountId: string; threadId: string; channelId: string; message?: string }
export interface EmailReminderInput { accountId: string; threadId: string; description: string; remindAt: string }
export interface EmailProjectLinkInput { accountId: string; threadId: string; projectId?: string }
export interface EmailProjectThread {
	accountId: string
	threadId: string
	projectId: string
	subject: string
	from: EmailAddress
	date: string
	unread: boolean
	messageCount: number
	tags?: string[]
}
export interface EmailMutationResult { ok: boolean; provider: string; operation: string; threadId?: string; receipt?: string; dryRun?: boolean; matched?: number; sampleIds?: string[] }
export type EmailProcessingPlanKind = Exclude<EmailMutationKind, "trash" | "spam">
export interface EmailProcessingPlanOperation {
	accountId: string
	threadIds: string[]
	kind: EmailProcessingPlanKind
	labelId?: string
	value?: boolean
	snoozeUntil?: string
	rationale?: string
}
export interface EmailProcessingPlanInput { operations: EmailProcessingPlanOperation[]; expiresInMs?: number }
export type EmailProcessingPlanStatus = "pending" | "executed" | "expired" | "failed" | "cancelled"
export interface EmailProcessingPlan {
	id: string
	createdAt: string
	expiresAt: string
	status: EmailProcessingPlanStatus
	operations: EmailProcessingPlanOperation[]
	previews: EmailMutationResult[]
	confirmationToken?: string
	result?: EmailMutationResult[]
	error?: string
}
export interface EmailRuleCondition {
	accountId?: string
	query?: string
	fromContains?: string
	subjectContains?: string
	unread?: boolean
	hasAttachment?: boolean
	category?: EmailTriageCategory
	olderThanDays?: number
}
export interface EmailRuleAction {
	kind: EmailProcessingPlanKind
	labelId?: string
	value?: boolean
	snoozeUntil?: string
	rationale?: string
}
export interface EmailRule {
	id: string
	name: string
	enabled: boolean
	condition: EmailRuleCondition
	actions: EmailRuleAction[]
	schedule?: EmailRuleSchedule
	createdAt: string
	updatedAt: string
	lastRunAt?: string
	lastRun?: EmailRuleRunSummary
}
export interface EmailRuleSchedule {
	intervalMinutes: number
	nextRunAt: string
	lastScheduledAt?: string
	lastScheduledStatus?: "completed" | "failed"
	lastScheduledError?: string
}
export interface EmailRuleScheduleInput { intervalMinutes: number; nextRunAt?: string }
export interface EmailRuleInput {
	id?: string
	name: string
	enabled?: boolean
	condition?: EmailRuleCondition
	actions: EmailRuleAction[]
	schedule?: EmailRuleScheduleInput | null
}
export interface EmailRuleRunSummary {
	at: string
	scannedCount: number
	pagesScanned: number
	matchedCount: number
	operationCount: number
	status: "previewed" | "no-match" | "truncated"
	planId?: string
	auditId?: string
}
export interface EmailRuleRunResult {
	rule: EmailRule
	matchedThreadIds: string[]
	scannedCount: number
	pagesScanned: number
	matchedCount: number
	operationCount: number
	truncated: boolean
	auditId: string
	lastRun: EmailRuleRunSummary
	plan?: EmailProcessingPlan
}
export interface EmailScheduledRuleRunResult {
	ruleId: string
	status: "ran" | "skipped" | "failed"
	nextRunAt?: string
	planId?: string
	error?: string
}
export interface EmailAuditEntry { id: string; at: string; accountId: string; operation: string; status: "requested" | "confirmed" | "completed" | "failed" | "cancelled" | "expired"; resourceId?: string; provider?: string; error?: string; details?: Record<string, string | number | boolean> }
export interface EmailScheduledSend { id: string; draftId: string; accountId: string; scheduledAt: string; fingerprint: string; status: "scheduled" | "sent" | "cancelled" | "failed"; createdAt: string; sideEffectIntentId?: string; error?: string }
export interface EmailPendingSend { id: string; draftId: string; accountId: string; sendAt: string; fingerprint: string; status: "pending" | "sent" | "cancelled" | "failed"; createdAt: string; sideEffectIntentId?: string; error?: string }
export type EmailReplyZeroCategory = "needs_reply" | "waiting_for_reply" | "no_action"
export interface EmailReplyZeroItem {
	category: EmailReplyZeroCategory
	accountId: string
	threadId: string
	subject: string
	sender: EmailAddress
	date: string
	snippet?: string
	reason: string
}
export interface EmailReplyZeroSnapshot {
	generatedAt: string
	items: EmailReplyZeroItem[]
	needsReply: EmailReplyZeroItem[]
	waitingForReply: EmailReplyZeroItem[]
	noAction: EmailReplyZeroItem[]
}
export interface EmailInboxReceipt {
	accountId: string
	threadId: string
	messageDate?: string
	acknowledgedAt: string
}

/**
 * Privacy-aware contact projection — aggregates senders and recipients from
 * the user's inbox without exposing message content. Used by the Pi Agent to
 * build Composer recipient completion + CRM handoff while keeping email
 * bodies and subjects off the contact record.
 */
export interface EmailContactProjectionOptions {
	accountId?: string
	folder?: EmailFolder
	includeDomains?: string[]
	excludeDomains?: string[]
	includeRoles?: EmailContactRole[]
	since?: string
	until?: string
	limit?: number
	maskPersonalAddresses?: boolean
	returnRawAddresses?: boolean
}

export type EmailContactRole = "from" | "to" | "cc" | "bcc"

export interface EmailContactRecord {
	email: string
	maskedEmail?: string
	name?: string
	roleCounts: Partial<Record<EmailContactRole, number>>
	interactionCount: number
	lastInteractionAt: string
	firstInteractionAt: string
	accountIds: string[]
	linkedThreadIds: string[]
	linkedAnalysisIds: string[]
}

export interface EmailContactProjectionSnapshot {
	generatedAt: string
	accountId?: string
	total: number
	returned: number
	truncatedByLimit: boolean
	personalAddressesMasked: number
	contacts: EmailContactRecord[]
}
export interface EmailDigestSnapshot {
	generatedAt: string
	accountId?: string
	total: number
	unread: number
	needsReply: EmailReplyZeroItem[]
	waitingForReply: EmailReplyZeroItem[]
	highlights: EmailThreadPreview[]
}
export type EmailTriageCategory = "urgent" | "needs-reply" | "waiting-for-reply" | "noise" | "normal"
export interface EmailTriageItem {
	accountId: string
	threadId: string
	subject: string
	sender: EmailAddress
	date: string
	category: EmailTriageCategory
	score: number
	reasons: string[]
	unread: boolean
	starred?: boolean
	labels: string[]
}
export interface EmailTriageSnapshot {
	generatedAt: string
	total: number
	items: EmailTriageItem[]
	counts: Record<EmailTriageCategory, number>
}

/**
 * Unified AI action center query — combines triage priority, reply-zero state,
 * saved analyses, workspace tags and sender profile into a single read-only
 * snapshot. Lets the Pi Agent answer "what should I do next?" without chaining
 * 4-5 separate tool calls.
 */
export interface EmailActionCenterQueryInput {
	accountId?: string
	folder?: string
	categories?: EmailTriageCategory[]
	reviewStates?: EmailAnalysisReview[]
	owner?: string
	dueBefore?: string
	senderDomain?: string
	workspaceTagIds?: string[]
	query?: string
	limit?: number
	cursor?: string
}

export interface EmailActionCenterEntry {
	accountId: string
	threadId: string
	subject: string
	sender: EmailAddress
	date: string
	category: EmailTriageCategory
	score: number
	reasons: string[]
	replyCategory?: EmailReplyZeroCategory
	replyReason?: string
	savedAnalyses: Array<{
		id: string
		kind: EmailAnalysisKind
		confidence: number
		review: EmailAnalysisReview
		summary?: string
		actionCount: number
		generatedAt: string
	}>
	workspaceTagIds: string[]
	unread: boolean
	starred?: boolean
}

export interface EmailActionCenterSnapshot {
	generatedAt: string
	total: number
	filtered: number
	entries: EmailActionCenterEntry[]
	counts: {
		byCategory: Record<EmailTriageCategory, number>
		byReplyCategory: Record<EmailReplyZeroCategory, number>
		withPendingAnalyses: number
		withAcceptedAnalyses: number
	}
	filtersApplied: {
		accountId?: string
		categories?: EmailTriageCategory[]
		reviewStates?: EmailAnalysisReview[]
		owner?: string
		dueBefore?: string
		senderDomain?: string
		workspaceTagIds?: string[]
	}
	nextCursor?: string
}

/**
 * Bulk "create reminders for everything my AI flagged" — lets the Pi Agent
 * turn the action-center query result into follow-up reminders in one call
 * instead of walking analyses one by one.
 */
export interface EmailActionCenterReminderInput {
	accountId?: string
	categories?: EmailTriageCategory[]
	owner?: string
	dueBefore?: string
	senderDomain?: string
	workspaceTagIds?: string[]
	confirmed?: boolean
	dryRun?: boolean
}

export interface EmailActionCenterReminderItem {
	analysisId: string
	threadId: string
	accountId: string
	actionIndex: number
	content: string
	owner?: string
	dueAt: string
	receipt?: string
}

export interface EmailActionCenterReminderResult {
	generatedAt: string
	dryRun: boolean
	requiresConfirmation: boolean
	matchedAnalysisCount: number
	matchedActionCount: number
	created: EmailActionCenterReminderItem[]
	skipped: Array<EmailActionCenterReminderItem & { reason: string }>
}
export type EmailAnalysisKind = "summary" | "actions" | "risk" | "reply" | "meeting"
export type EmailAnalysisReview = "pending" | "accepted" | "dismissed"
export interface EmailAnalysisCitation {
	messageId: string
	from?: string
	date?: string
	quote?: string
}
export interface EmailAnalysisContextCitation {
	sourceId: string
	sourceTitle?: string
	sourcePath?: string
	quote?: string
}
export interface EmailKnowledgeContextValidator {
	validate(input: {
		sourceId: string
		sourcePath?: string
		quote?: string
	}): Promise<EmailAnalysisContextCitation>
}
export interface EmailAnalysisFact {
	statement: string
	citations: EmailAnalysisCitation[]
	contextCitations?: EmailAnalysisContextCitation[]
}
export interface EmailAnalysisAction {
	content: string
	owner?: string
	dueAt?: string
	citations: EmailAnalysisCitation[]
	contextCitations?: EmailAnalysisContextCitation[]
}
export interface EmailAnalysisReplyDraft {
	subject: string
	body: string
	tone?: "neutral" | "warm" | "formal"
	citations: EmailAnalysisCitation[]
	contextCitations?: EmailAnalysisContextCitation[]
}
export interface EmailAnalysisMeetingProposal {
	title: string
	start: string
	end: string
	timeZone?: string
	location?: string
	meetingUrl?: string
	attendees: EmailAddress[]
	description?: string
	citations: EmailAnalysisCitation[]
}
export interface EmailAnalysisRecord {
	id: string
	accountId: string
	threadId: string
	kind: EmailAnalysisKind
	generatedAt: string
	generatedBy: "ai"
	summary?: string
	facts: EmailAnalysisFact[]
	actions: EmailAnalysisAction[]
	risks: EmailAnalysisFact[]
	replyDraft?: EmailAnalysisReplyDraft
	meetingProposal?: EmailAnalysisMeetingProposal
	confidence: number
	needsReview: boolean
	review: EmailAnalysisReview
	reviewNote?: string
	reviewedAt?: string
	linkedDraftId?: string
	linkedReminderId?: string
	linkedReminderIds?: string[]
	linkedTaskControlId?: string
	linkedTaskIds?: string[]
	linkedProjectTaskIds?: string[]
	linkedCalendarTaskId?: string
	linkedCalendarEventId?: string
}
export interface EmailAnalysisSaveInput {
	accountId: string
	threadId: string
	kind: EmailAnalysisKind
	summary?: string
	facts?: EmailAnalysisFact[]
	actions?: EmailAnalysisAction[]
	risks?: EmailAnalysisFact[]
	replyDraft?: EmailAnalysisReplyDraft
	meetingProposal?: EmailAnalysisMeetingProposal
	confidence: number
	needsReview?: boolean
	linkedDraftId?: string
	linkedReminderId?: string
	linkedTaskControlId?: string
	linkedTaskIds?: string[]
	linkedProjectTaskIds?: string[]
	linkedCalendarTaskId?: string
	linkedCalendarEventId?: string
}
export interface EmailAnalysisReviewInput {
	id: string
	review: EmailAnalysisReview
	reviewNote?: string
}
export interface EmailAnalysisLinkInput {
	id: string
	linkedDraftId?: string
	linkedReminderId?: string
	linkedReminderIds?: string[]
	linkedTaskControlId?: string
	linkedTaskIds?: string[]
	linkedProjectTaskIds?: string[]
	linkedCalendarTaskId?: string
	linkedCalendarEventId?: string
}

export class EmailError extends Error {
	constructor(readonly code: "provider_unavailable" | "confirmation_required" | "invalid_input" | "operation_failed" | "operation_not_supported", message: string, readonly retryAfterMs?: number) {
		super(message)
		this.name = "EmailError"
	}
}

export interface EmailProvider {
	readonly name: string
	accounts(): Promise<EmailAccount[]>
	diagnostics?(): Promise<EmailProviderDiagnostic>
	threads(input: EmailSearchInput): Promise<EmailThreadPreview[]>
	threadsPage?(input: EmailSearchInput): Promise<EmailThreadPage>
	thread(accountId: string, threadId: string): Promise<EmailThread>
	labels(accountId: string): Promise<EmailLabel[]>
	update(input: EmailMutationInput): Promise<EmailMutationResult>
	createDraft(input: EmailComposeInput): Promise<EmailDraft>
	sendDraft(draft: EmailDraft): Promise<EmailMutationResult>
	setSenderPolicy?(input: EmailSenderPolicyInput): Promise<EmailMutationResult>
	unsubscribe?(input: EmailUnsubscribeInput): Promise<EmailUnsubscribeResult>
	shareThread?(input: EmailShareInput): Promise<EmailMutationResult>
	createReminder?(input: EmailReminderInput): Promise<EmailMutationResult>
	moveToProject?(input: EmailProjectLinkInput): Promise<EmailMutationResult>
	listAttachments?(accountId: string, messageId: string): Promise<EmailAttachment[]>
	downloadAttachment?(accountId: string, attachmentId: string, messageId: string, destinationDir?: string): Promise<EmailAttachmentDownload>
	sync?(input: EmailSyncInput): Promise<EmailSyncResult>
}

export interface EmailAnalysisReminderInput {
	analysisId: string
	actionIndexes?: number[]
	confirmed?: boolean
}

export interface EmailAnalysisReminderResult {
	analysis: EmailAnalysisRecord
	reminders: EmailMutationResult[]
}

export interface EmailMcpToolMap {
	listAccounts?: string
	listThreads?: string
	search?: string
	getThread?: string
	listLabels?: string
	update?: string
	markRead?: string
	markUnread?: string
	archive?: string
	restore?: string
	star?: string
	trash?: string
	spam?: string
	snooze?: string
	addLabel?: string
	removeLabel?: string
	createDraft?: string
	sendDraft?: string
	setSenderPolicy?: string
	unsubscribe?: string
	shareThread?: string
	createReminder?: string
	moveToProject?: string
	listAttachments?: string
	downloadAttachment?: string
	sync?: string
}

export interface EmailMcpProviderConfig {
	serverName: string
	profile?: EmailMcpProviderProfile
	tools?: EmailMcpToolMap
	availableTools?: readonly string[]
	retryPolicy?: EmailMcpRetryPolicy
}

export interface EmailMcpRetryPolicy {
	/** 单次 MCP 调用最长等待时间；默认 30 秒，显式传 0 可禁用。 */
	timeoutMs?: number
	/** 读取调用的总尝试次数，包含第一次调用。默认 2。 */
	maxAttempts?: number
	/** 首次重试前等待时间。默认 250ms。 */
	initialDelayMs?: number
	/** 指数退避的最大等待时间。默认 2000ms。 */
	maxDelayMs?: number
}

/** 从 MCP/HTTP 错误文本中提取 Retry-After；返回毫秒，无法识别时返回 undefined。 */
export function parseEmailRetryAfter(value: unknown, nowMs = Date.now()): number | undefined {
	const message = value instanceof Error ? value.message : typeof value === "string" ? value : ""
	const retryAfter = message.match(/retry[- ]after\s*[:=]\s*([^;\r\n]+)/i)?.[1]?.trim()
	if (retryAfter) {
		const milliseconds = retryAfter.match(/^(\d+(?:\.\d+)?)\s*ms$/i)
		if (milliseconds) return Math.min(Math.max(Math.ceil(Number(milliseconds[1])), 0), 120_000)
		const seconds = retryAfter.match(/^(\d+(?:\.\d+)?)\s*s?$/i)
		if (seconds) return Math.min(Math.max(Math.ceil(Number(seconds[1]) * 1000), 0), 120_000)
		const dateMs = Date.parse(retryAfter)
		if (Number.isFinite(dateMs)) return Math.min(Math.max(dateMs - nowMs, 0), 120_000)
	}
	const reset = message.match(/(?:x[- ]rate[- ]limit[- ]reset|rate[- ]limit[- ]reset)\s*[:=]\s*(\d{9,13})/i)
	if (reset) {
		const raw = Number(reset[1])
		const resetMs = raw < 10_000_000_000 ? raw * 1000 : raw
		return Math.min(Math.max(resetMs - nowMs, 0), 120_000)
	}
	return undefined
}

export type EmailMcpProviderProfile = "generic" | "qq-agent-mail" | "gmail" | "outlook" | "imap-smtp" | "jmap"

export const EMAIL_MCP_PROVIDER_PROFILES: Record<EmailMcpProviderProfile, EmailMcpToolMap> = {
	generic: {},
	"qq-agent-mail": {
		listAccounts: "list_accounts",
		listThreads: "list_emails",
		search: "search_emails",
		getThread: "get_email",
		listLabels: "list_labels",
		update: "update_email",
		createDraft: "create_draft",
		sendDraft: "send_email",
		listAttachments: "list_attachments",
		downloadAttachment: "download_attachment",
		sync: "sync_emails",
	},
	gmail: {
		listAccounts: "list_accounts",
		listThreads: "list_emails",
		search: "list_emails",
		getThread: "get_email",
		listLabels: "list_labels",
		update: "modify_email",
		createDraft: "create_draft",
		sendDraft: "send_email",
		listAttachments: "list_attachments",
		downloadAttachment: "download_attachment",
		sync: "sync_emails",
	},
	outlook: {
		listAccounts: "list_accounts",
		listThreads: "list_messages",
		search: "search_messages",
		getThread: "get_message",
		listLabels: "list_folders",
		update: "update_message",
		createDraft: "create_draft",
		sendDraft: "send_email",
		listAttachments: "list_attachments",
		downloadAttachment: "download_attachment",
		sync: "sync_messages",
	},
	"imap-smtp": {
		listAccounts: "list_accounts",
		listThreads: "list_emails",
		search: "search_emails",
		getThread: "get_email",
		listLabels: "list_mailboxes",
		update: "update_email",
		createDraft: "create_draft",
		sendDraft: "send_email",
		listAttachments: "list_attachments",
		downloadAttachment: "download_attachment",
		sync: "sync_emails",
	},
	jmap: {
		listAccounts: "list_accounts",
		listThreads: "list_emails",
		search: "search_emails",
		getThread: "get_email",
		listLabels: "list_mailboxes",
		update: "update_email",
		createDraft: "create_draft",
		sendDraft: "send_email",
		listAttachments: "list_attachments",
		downloadAttachment: "download_attachment",
		sync: "sync_emails",
	},
}

export function inferEmailMcpProfile(serverName: string): EmailMcpProviderProfile {
	if (/outlook|microsoft|graph/i.test(serverName)) return "outlook"
	if (/gmail|google/i.test(serverName)) return "gmail"
	if (/qq|agent[-_ ]?mail/i.test(serverName)) return "qq-agent-mail"
	if (/jmap|fastmail/i.test(serverName)) return "jmap"
	if (/imap|smtp|163|126|mailbox/i.test(serverName)) return "imap-smtp"
	return "generic"
}

export function inferEmailMcpProfileFromTools(toolNames: readonly string[]): EmailMcpProviderProfile | undefined {
	const tools = new Set(toolNames.map((tool) => tool.toLowerCase()))
	if (tools.has("archive_email") || tools.has("apply_label") || tools.has("unsubscribe_email")) return "gmail"
	if (tools.has("list_messages") || tools.has("search_messages") || tools.has("get_message") || tools.has("list_folders")) return "outlook"
	if (tools.has("modify_email")) return "gmail"
	if (tools.has("list_mailboxes")) return "imap-smtp"
	if (tools.has("list_accounts") && (tools.has("list_emails") || tools.has("search_emails"))) return "generic"
	return undefined
}

function configuredEmailProfile(value: unknown): EmailMcpProviderProfile | undefined {
	return typeof value === "string" && value in EMAIL_MCP_PROVIDER_PROFILES ? value as EmailMcpProviderProfile : undefined
}

const DEFAULT_TOOLS: Required<EmailMcpToolMap> = {
	listAccounts: "list_accounts",
	listThreads: "list_emails",
	search: "search_emails",
	getThread: "get_email",
	listLabels: "list_labels",
	update: "update_email",
	markRead: "mark_email_read",
	markUnread: "mark_email_unread",
	archive: "archive_email",
	restore: "restore_email",
	star: "star_email",
	trash: "trash_email",
	spam: "spam_email",
	snooze: "snooze_email",
	addLabel: "add_email_label",
	removeLabel: "remove_email_label",
	createDraft: "create_draft",
	sendDraft: "send_email",
	setSenderPolicy: "set_sender_policy",
	unsubscribe: "unsubscribe_email",
	shareThread: "share_email_thread",
	createReminder: "create_reminder",
	moveToProject: "move_to_project",
	listAttachments: "list_attachments",
	downloadAttachment: "download_attachment",
	sync: "sync_emails",
}

const EMAIL_TOOL_ALIASES: Partial<Record<keyof EmailMcpToolMap, readonly string[]>> = {
	listAccounts: ["list_accounts", "accounts", "list_mail_accounts"],
	listThreads: ["list_emails", "list_messages", "list_threads", "search_emails", "search_messages"],
	search: ["search_emails", "search_messages", "list_emails", "list_messages"],
	getThread: ["get_email", "get_message", "get_thread", "read_email"],
	listLabels: ["list_labels", "list_folders", "list_mailboxes", "get_labels"],
	createDraft: ["create_draft", "create_email", "draft_email"],
	sendDraft: ["send_email", "send_message", "send_draft"],
	listAttachments: ["list_attachments", "get_attachments"],
	downloadAttachment: ["download_attachment", "get_attachment"],
	sync: ["sync_emails", "sync_messages", "sync_mail", "incremental_sync"],
	unsubscribe: ["unsubscribe_email", "unsubscribe", "email_unsubscribe"],
}

const MUTATION_TOOL_ALIASES: Record<EmailMutationKind, readonly string[]> = {
	"mark-read": ["mark_email_read", "mark_as_read", "mark_read", "set_email_read"],
	"mark-unread": ["mark_email_unread", "mark_as_unread", "mark_unread", "set_email_unread"],
	archive: ["archive_email", "archive_message", "archive_thread"],
	restore: ["restore_email", "restore_message", "restore_thread", "move_to_inbox"],
	star: ["star_email", "star_message", "toggle_star", "set_starred"],
	trash: ["trash_email", "trash_message", "trash_thread", "delete_email"],
	spam: ["spam_email", "mark_spam", "report_spam"],
	snooze: ["snooze_email", "snooze_message", "snooze_thread"],
	label: ["update_email_label", "add_email_label", "apply_label", "label_email", "modify_labels", "remove_email_label", "remove_label", "remove_email_from_label"],
}
const MANAGEMENT_OPERATION_BY_KEY: Partial<Record<keyof EmailMcpToolMap, EmailManagementCapability>> = {
	markRead: "mark-read", markUnread: "mark-unread", archive: "archive", restore: "restore", star: "star", trash: "trash", spam: "spam", snooze: "snooze", addLabel: "label-add", removeLabel: "label-remove", unsubscribe: "unsubscribe",
}
const PROFILE_MANAGEMENT_OPERATIONS: Partial<Record<EmailMcpProviderProfile, readonly EmailManagementCapability[]>> = {
	"imap-smtp": ["mark-read", "mark-unread", "archive", "restore", "star", "trash", "spam"],
	"jmap": ["mark-read", "mark-unread", "archive", "restore", "star", "trash", "spam", "label-add", "label-remove"],
	"gmail": ["mark-read", "mark-unread", "archive", "restore", "star", "trash", "spam", "snooze", "label-add", "label-remove"],
	"outlook": ["mark-read", "mark-unread", "archive", "restore", "star", "trash", "spam", "label-add", "label-remove"],
}
function managementOperationForAlias(kind: EmailMutationKind, alias: string): EmailManagementCapability {
	if (kind === "label") return /remove|delete/i.test(alias) ? "label-remove" : "label-add"
	return kind
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined }
function list<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : [] }
function listResult(value: unknown): unknown[] {
	if (Array.isArray(value)) return value
	const item = record(value)
	const thread = record(item.thread)
	return list<unknown>(item.items ?? item.data ?? item.results ?? item.messages ?? item.threads ?? item.emails ?? item.connected_accounts ?? thread.messages)
}
function threadResultItems(value: unknown): unknown[] {
	return listResult(value).flatMap((entry) => {
		const item = record(entry)
		if (!Array.isArray(item.emails)) return [entry]
		const account = stringValue(item.account ?? item.accountId)
		return item.emails.map((email) => {
			const normalized = record(email)
			return account && normalized.accountId === undefined && normalized.account === undefined ? { ...normalized, accountId: account } : email
		})
	})
}
function pageResult(value: unknown): { items: unknown[]; nextCursor?: string } {
	if (Array.isArray(value)) return { items: value }
	const item = record(value)
	return {
		items: listResult(value),
		nextCursor: stringValue(item.nextCursor ?? item.next_cursor ?? item.cursor ?? record(item.pagination).nextCursor ?? record(item.pagination).next_cursor),
	}
}
function syncResult(value: unknown): { cursor?: string; added?: number; updated?: number; removed?: number } {
	const item = record(unwrap(value))
	const count = (key: string) => typeof item[key] === "number" && Number.isFinite(item[key]) ? Math.max(0, Math.floor(item[key] as number)) : undefined
	return {
		cursor: stringValue(item.cursor ?? item.nextCursor ?? item.next_cursor ?? item.syncState ?? item.state),
		added: count("added") ?? count("created"),
		updated: count("updated"),
		removed: count("removed") ?? count("deleted"),
	}
}
function unwrap(value: unknown): unknown {
	const item = record(value)
	const content = list<Record<string, unknown>>(item.content)
	const text = content.find((entry) => entry.type === "text")?.text
	if (typeof text === "string") {
		try { return JSON.parse(text) }
		catch { return text }
	}
	return item.result ?? value
}

function mcpToolError(value: unknown): string | undefined {
	const item = record(value)
	const error = record(item.error)
	const content = list<Record<string, unknown>>(item.content)
	const text = content.find((entry) => entry.type === "text")?.text
	let parsed: Record<string, unknown> = {}
	if (typeof text === "string") {
		try { parsed = record(JSON.parse(text)) } catch { parsed = {} }
	}
	const nested = record(parsed.error)
	if (item.isError !== true && Object.keys(error).length === 0 && Object.keys(nested).length === 0 && parsed.error === undefined) return undefined
	const message = stringValue(error.message ?? nested.message ?? parsed.message ?? (typeof text === "string" ? text : undefined)) ?? "MCP tool returned an error"
	const code = stringValue(error.code ?? nested.code ?? parsed.code)
	const status = error.status ?? nested.status ?? parsed.status
	const retryAfter = error.retryAfter ?? nested.retryAfter ?? parsed.retryAfter
	const retryHint = retryAfter === undefined ? "" : ` Retry-After: ${String(retryAfter)}${typeof retryAfter === "number" ? "s" : ""}`
	return `${status === undefined ? "" : `${String(status)} `}${code ? `[${code}] ` : ""}${message}${retryHint}`
}
function address(value: unknown): EmailAddress {
	if (typeof value === "string") {
		const raw = value.trim()
		const match = raw.match(/^(?:(.*?)\s*)?<([^<>\s]+@[^<>\s]+)>$/) ?? raw.match(/([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/)
		const result = match?.[2] ?? match?.[1]
		if (!result || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new EmailError("invalid_input", "invalid email address")
		const name = match?.[2] ? match[1]?.trim().replace(/^['"]|['"]$/g, "") : undefined
		return { address: result, ...(name ? { name } : {}) }
	}
	const item = record(value)
	const result = stringValue(item.address ?? item.email)
	if (!result || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new EmailError("invalid_input", "invalid email address")
	return { address: result, ...(stringValue(item.name) ? { name: stringValue(item.name) } : {}) }
}
function addresses(value: unknown): EmailAddress[] {
	if (typeof value === "string") return value.split(/[,;]\s*/).filter(Boolean).map(address)
	return list<unknown>(value).map(address)
}
function iso(value: unknown): string { return stringValue(value) ?? new Date().toISOString() }

function gmailSearchDate(value: unknown): string | undefined {
	const raw = stringValue(value)
	if (!raw) return undefined
	const parsed = new Date(raw)
	if (!Number.isFinite(parsed.getTime())) return raw
	return `${parsed.getUTCFullYear()}/${String(parsed.getUTCMonth() + 1).padStart(2, "0")}/${String(parsed.getUTCDate()).padStart(2, "0")}`
}

function gmailSearchValue(value: unknown): string | undefined {
	const raw = stringValue(value)
	if (!raw) return undefined
	return /[\s()]/u.test(raw) ? `"${raw.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"` : raw
}

export function buildGmailSearchQuery(input: EmailSearchInput): string | undefined {
	const parts = [stringValue(input.query)]
	const add = (operator: string, value: unknown) => {
		const normalized = gmailSearchValue(value)
		if (normalized) parts.push(`${operator}:${normalized}`)
	}
	add("from", input.from)
	add("to", input.to)
	if (input.unread === true) parts.push("is:unread")
	if (input.unread === false) parts.push("-is:unread")
	if (input.hasAttachment === true) parts.push("has:attachment")
	if (input.hasAttachment === false) parts.push("-has:attachment")
	const since = gmailSearchDate(input.since)
	const until = gmailSearchDate(input.until)
	if (since) parts.push(`after:${since}`)
	if (until) parts.push(`before:${until}`)
	const folder = input.folder
	if (folder === "starred") parts.push("is:starred")
	else if (folder === "important") parts.push("is:important")
	else if (folder && folder !== "custom") parts.push(`in:${folder === "archive" ? "anywhere" : folder}`)
	if (input.labelId) add("label", input.labelId)
	return parts.filter(Boolean).join(" ") || undefined
}

interface EmailCapabilityDefaults {
	profile?: EmailMcpProviderProfile
	read?: boolean
	write?: boolean
	attachments?: boolean
	multipleAccounts?: boolean
	management?: boolean
	managementOperations?: EmailManagementCapability[]
	sync?: boolean
}

function declaredBoolean(item: Record<string, unknown>, capabilities: Record<string, unknown>, key: string): boolean | undefined {
	const value = capabilities[key] ?? item[key]
	return typeof value === "boolean" ? value : undefined
}

function normalizeAccount(value: unknown, index: number, defaults: EmailCapabilityDefaults = {}): EmailAccount {
	const item = typeof value === "string" ? { email: value } : record(value)
	const email = stringValue(item.address ?? item.email ?? item.emailAddress) ?? `account-${index + 1}`
	const capabilities = record(item.capabilities)
	const rawStatus = stringValue(item.status ?? item.connectionStatus)
	const status = rawStatus === "reauthorization-required" || rawStatus === "reauthorize" ? "reauthorization-required" : rawStatus === "disconnected" || rawStatus === "offline" ? "disconnected" : "connected"
	const active = status === "connected"
	const read = declaredBoolean(item, capabilities, "read") ?? defaults.read ?? true
	const write = declaredBoolean(item, capabilities, "write") ?? (item.readOnly === true ? false : defaults.write ?? false)
	const attachments = declaredBoolean(item, capabilities, "attachments") ?? defaults.attachments ?? false
	const multipleAccounts = declaredBoolean(item, capabilities, "multipleAccounts") ?? defaults.multipleAccounts ?? false
	const management = declaredBoolean(item, capabilities, "management") ?? defaults.management
	const sync = declaredBoolean(item, capabilities, "sync") ?? defaults.sync
	const managementOperations = list<unknown>(capabilities.managementOperations ?? item.managementOperations ?? defaults.managementOperations).filter((entry): entry is EmailManagementCapability => typeof entry === "string" && ["mark-read", "mark-unread", "archive", "restore", "label-add", "label-remove", "star", "trash", "spam", "snooze", "unsubscribe"].includes(entry))
	return { id: stringValue(item.id ?? item.accountId) ?? email, address: email, name: stringValue(item.name ?? item.displayName), provider: "mcp", status, capabilities: { read, write: active && write, attachments: active && attachments, multipleAccounts, ...(management === undefined ? {} : { management: active && management }), ...(managementOperations.length ? { managementOperations: active ? managementOperations : [] } : {}), ...(sync === undefined ? {} : { sync: active && sync }) } }
}
function normalizePreview(value: unknown, accountId: string, index: number): EmailThreadPreview {
	const item = record(value)
	const from = address(item.from ?? { email: item.senderEmail ?? item.sender })
	const labels = list<unknown>(item.labels ?? item.labelIds).filter((entry): entry is string => typeof entry === "string")
	return { id: stringValue(item.id ?? item.threadId ?? item.messageId) ?? `thread-${index + 1}`, accountId: stringValue(item.accountId ?? item.account) ?? accountId, subject: stringValue(item.subject) ?? "(无主题)", snippet: stringValue(item.snippet ?? item.preview), from, date: iso(item.date ?? item.timestamp ?? item.receivedAt), messageCount: Number(item.messageCount ?? item.count ?? 1) || 1, unread: item.unread === true || item.isRead === false || labels.includes("UNREAD"), starred: item.starred === true || labels.includes("STARRED"), labels, ...(Array.isArray(item.tags) ? { tags: item.tags.filter((entry): entry is string => typeof entry === "string") } : {}), attachments: typeof item.attachments === "number" ? item.attachments : undefined }
}
function normalizeMessage(value: unknown, threadId: string, index: number): EmailMessage {
	const item = record(value)
	const labels = list<unknown>(item.labels ?? item.labelIds).filter((entry): entry is string => typeof entry === "string")
	const unsubscribeLinks = list<unknown>(item.unsubscribeLinks ?? item.unsubscribe_links).filter((entry): entry is string => typeof entry === "string" && /^https?:\/\/|^mailto:/i.test(entry)).slice(0, 5)
	return { id: stringValue(item.id ?? item.messageId) ?? `message-${index + 1}`, threadId, from: address(item.from ?? { email: item.senderEmail ?? item.sender }), to: addresses(item.to ?? item.recipients ?? []), cc: addresses(item.cc ?? []), ...(item.bcc !== undefined ? { bcc: addresses(item.bcc) } : {}), ...(item.replyTo !== undefined || item.reply_to !== undefined ? { replyTo: addresses(item.replyTo ?? item.reply_to) } : {}), subject: stringValue(item.subject) ?? "(无主题)", date: iso(item.date ?? item.timestamp), text: stringValue(item.text ?? item.body ?? item.plainText), html: stringValue(item.html ?? item.htmlBody), unread: item.unread === true || item.isRead === false || labels.includes("UNREAD"), attachments: list<Record<string, unknown>>(item.attachments).map((attachment, attachmentIndex) => ({ id: stringValue(attachment.id ?? attachment.attachmentId) ?? `attachment-${attachmentIndex + 1}`, messageId: stringValue(item.id ?? item.messageId) ?? `message-${index + 1}`, name: stringValue(attachment.name ?? attachment.filename) ?? "附件", mimeType: stringValue(attachment.mimeType ?? attachment.contentType) ?? "application/octet-stream", size: typeof attachment.size === "number" ? attachment.size : undefined })), ...(unsubscribeLinks.length ? { unsubscribeLinks } : {}) }
}

export class McpEmailProvider implements EmailProvider {
	readonly name: string
	private readonly tools: Required<EmailMcpToolMap>
	private readonly capabilityDefaults: EmailCapabilityDefaults
	private readonly availableTools?: Set<string>
	private readonly configuredToolKeys: Set<keyof EmailMcpToolMap>
	private readonly allowImplicitDefaults: boolean
	private readonly retryPolicy: Required<EmailMcpRetryPolicy>
	private readonly profile: EmailMcpProviderProfile
	constructor(private readonly mcp: Pick<McpClient, "callTool">, private readonly serverName: string, tools: EmailMcpToolMap = {}, capabilityDefaults: EmailCapabilityDefaults = {}, availableTools?: readonly string[], allowImplicitDefaults = true, retryPolicy: EmailMcpRetryPolicy = {}) {
		this.name = `mcp:${serverName}`
		this.tools = { ...DEFAULT_TOOLS, ...tools }
		this.capabilityDefaults = capabilityDefaults
		this.profile = configuredEmailProfile(capabilityDefaults.profile) ?? inferEmailMcpProfile(serverName)
		this.availableTools = availableTools ? new Set(availableTools.map((tool) => tool.toLowerCase())) : undefined
		this.configuredToolKeys = new Set(Object.keys(tools) as (keyof EmailMcpToolMap)[])
		this.allowImplicitDefaults = allowImplicitDefaults
		this.retryPolicy = {
			timeoutMs: retryPolicy.timeoutMs === 0 ? 0 : Number.isFinite(retryPolicy.timeoutMs) && (retryPolicy.timeoutMs ?? 0) > 0 ? Math.min(Math.floor(retryPolicy.timeoutMs!), 120_000) : 30_000,
			maxAttempts: Number.isInteger(retryPolicy.maxAttempts) && (retryPolicy.maxAttempts ?? 0) > 0 ? Math.min(retryPolicy.maxAttempts!, 4) : 2,
			initialDelayMs: Number.isFinite(retryPolicy.initialDelayMs) && (retryPolicy.initialDelayMs ?? 0) >= 0 ? Math.min(Math.floor(retryPolicy.initialDelayMs!), 10_000) : 250,
			maxDelayMs: Number.isFinite(retryPolicy.maxDelayMs) && (retryPolicy.maxDelayMs ?? 0) >= 0 ? Math.min(Math.floor(retryPolicy.maxDelayMs!), 30_000) : 2_000,
		}
	}
	async diagnostics(): Promise<EmailProviderDiagnostic> {
		const discoveredTools = this.availableTools ? [...this.availableTools].sort() : []
		const required: Record<string, (keyof EmailMcpToolMap)[]> = {
			"账户读取": ["listAccounts"],
			"邮件读取": ["listThreads", "search", "getThread"],
			"标签读取": ["listLabels"],
			"草稿写入": ["createDraft"],
			"发送邮件": ["sendDraft"],
			"附件读取": ["listAttachments"],
			"附件下载": ["downloadAttachment"],
			"增量同步": ["sync"],
		}
		const operations = Object.entries(required).map(([name, keys]) => {
			const requiredTools = keys.map((key) => this.toolName(key)).filter(Boolean)
			const missingTools: string[] = keys.flatMap((key) => this.isToolAvailable(this.tools[key], key) ? [] : [this.toolName(key)])
			return { name, ready: missingTools.length === 0, requiredTools, missingTools }
		})
		const management = Object.entries(MUTATION_TOOL_ALIASES).map(([kind, aliases]) => {
			const unifiedUpdateReady = this.isToolAvailable(this.tools.update, "update")
			const discoveredTools = aliases.filter((tool) => this.isToolAvailable(tool))
			const profileAllows = PROFILE_MANAGEMENT_OPERATIONS[this.profile]?.includes(kind === "label" ? "label-add" : kind as EmailManagementCapability) ?? true
			const requiredTools = unifiedUpdateReady && profileAllows ? [this.tools.update] : discoveredTools
			const unsupportedByProfile = unifiedUpdateReady && !profileAllows ? [`profile does not declare ${kind}`] : []
			return { name: `管理:${kind}`, ready: requiredTools.length > 0 && profileAllows, requiredTools: [...requiredTools], missingTools: requiredTools.length && profileAllows ? [] : [...unsupportedByProfile, ...(requiredTools.length ? [] : aliases)] }
		})
		const unsubscribeTool = this.toolName("unsubscribe")
		const unsubscribeAvailable = this.isToolAvailable(unsubscribeTool, "unsubscribe") && (this.profile === "generic" || this.profile === "gmail" || this.profile === "qq-agent-mail")
		const unsubscribe = { name: "管理:unsubscribe", ready: unsubscribeAvailable, requiredTools: [unsubscribeTool], missingTools: unsubscribeAvailable ? [] : [this.profile === "imap-smtp" || this.profile === "jmap" || this.profile === "outlook" ? `profile does not declare unsubscribe` : unsubscribeTool] }
		const allOperations = [...operations, ...management, unsubscribe]
		let accounts: EmailAccount[] = []
		let message: string | undefined
		try { accounts = await this.accounts() } catch (error) { message = error instanceof Error ? error.message : String(error) }
		const reauthorization = accounts.some((account) => account.status === "reauthorization-required") || /重新授权|unauthori[sz]ed|token expired/i.test(message ?? "")
		const missingCapabilities = allOperations.filter((operation) => !operation.ready).map((operation) => operation.name)
		const readiness: EmailProviderReadiness = reauthorization ? "reauthorization-required" : message ? "unavailable" : missingCapabilities.length ? "partial" : "ready"
		return { provider: this.name, serverName: this.serverName, profile: this.profile, toolDiscovery: this.availableTools ? "discovered" : "not-available", discoveredTools, accounts: accounts.map(({ id, address, status, capabilities }) => ({ id, address, status, capabilities, provider: this.name })), operations: allOperations, availableCapabilities: allOperations.filter((operation) => operation.ready).map((operation) => operation.name), missingCapabilities, readiness, ...(message ? { message } : {}) }
	}
	private isToolAvailable(toolName: string, key?: keyof EmailMcpToolMap): boolean {
		if (this.availableTools) {
			if (key) return [toolName, ...(EMAIL_TOOL_ALIASES[key] ?? [])].some((candidate) => this.availableTools!.has(candidate.toLowerCase()))
			return this.availableTools.has(toolName.toLowerCase())
		}
		return key ? this.configuredToolKeys.has(key) || this.allowImplicitDefaults : false
	}
	private toolName(key: keyof EmailMcpToolMap): string {
		const configured = this.tools[key]
		if (!this.availableTools) return configured
		const candidates = [configured, ...(EMAIL_TOOL_ALIASES[key] ?? [])].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index)
		return candidates.find((candidate) => this.availableTools!.has(candidate.toLowerCase())) ?? configured
	}
	private isTransientError(error: unknown): boolean {
		const message = error instanceof Error ? error.message : String(error)
		return /(?:\b408\b|\b429\b|\b5\d\d\b|timeout|timed out|temporar|rate[\s_-]?limit|too many requests|econnreset|econnrefused|socket hang up|network|unavailable)/i.test(message)
	}
	private isReauthorizationError(error: unknown): boolean {
		const message = error instanceof Error ? error.message : String(error)
		return /(?:401|403|unauthori[sz]ed|forbidden|token expired|invalid token|reauthori[sz]ation|authentication required|oauth)/i.test(message)
	}
	private providerErrorDetail(error: unknown): string {
		const message = error instanceof Error ? error.message : String(error)
		return message.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted-token]").replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted-api-key]").slice(0, 180)
	}
	private providerAvailabilityError(toolName: string, error: unknown): EmailError {
		const retryAfterMs = parseEmailRetryAfter(error)
		const detail = this.providerErrorDetail(error)
		if (this.isReauthorizationError(error)) return new EmailError("provider_unavailable", `邮箱 provider ${this.serverName} 需要重新授权后才能调用 ${toolName}${detail ? `：${detail}` : ""}`, retryAfterMs)
		const waitHint = retryAfterMs === undefined ? "请稍后重试" : `请在约 ${Math.ceil(retryAfterMs / 1000)} 秒后重试`
		return new EmailError("provider_unavailable", `邮箱 provider ${this.serverName} 暂时不可用，调用 ${toolName} 失败${detail ? `：${detail}` : ""}；${waitHint}`, retryAfterMs)
	}
	private async callOnce(toolName: string, args: Record<string, unknown>): Promise<any> {
		const request = this.mcp.callTool(this.serverName, toolName, args)
		const readEnvelope = (envelope: McpToolCallResult): unknown => {
			const error = mcpToolError(envelope.result)
			if (error) throw new Error(error)
			return unwrap(envelope.result)
		}
		if (!this.retryPolicy.timeoutMs) return readEnvelope(await request)
		let timer: ReturnType<typeof setTimeout> | undefined
		try {
			const result = await Promise.race([
				request,
				new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`MCP tool timeout after ${this.retryPolicy.timeoutMs}ms`)), this.retryPolicy.timeoutMs) }),
			])
			return readEnvelope(result as McpToolCallResult)
		} finally {
			if (timer) clearTimeout(timer)
		}
	}
	private async callNamed(toolName: string, args: Record<string, unknown>, retryable = true): Promise<any> {
		const attempts = retryable ? this.retryPolicy.maxAttempts : 1
		for (let attempt = 1; attempt <= attempts; attempt += 1) {
			try {
				return await this.callOnce(toolName, args)
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				if (/unknown tool|tool not found|method not found|not implemented|unsupported operation/i.test(message)) throw new EmailError("operation_not_supported", `邮箱 provider 不支持操作 ${toolName}: ${message}`)
				if (this.isReauthorizationError(error)) throw this.providerAvailabilityError(toolName, error)
				if (!retryable || attempt >= attempts || !this.isTransientError(error)) {
					if (this.isTransientError(error)) throw this.providerAvailabilityError(toolName, error)
					throw error
				}
				const retryAfterMs = parseEmailRetryAfter(error)
				const exponentialDelayMs = Math.min(this.retryPolicy.initialDelayMs * (2 ** (attempt - 1)), this.retryPolicy.maxDelayMs)
				const delayMs = Math.min(Math.max(exponentialDelayMs, retryAfterMs ?? 0), 120_000)
				if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
			}
		}
		throw new Error(`MCP tool call exhausted: ${toolName}`)
	}
	private async call(tool: keyof EmailMcpToolMap, args: Record<string, unknown>): Promise<any> {
		const retryable = tool === "listAccounts" || tool === "listThreads" || tool === "search" || tool === "getThread" || tool === "listLabels" || tool === "listAttachments" || tool === "sync"
		const toolName = this.toolName(tool)
		return this.callNamed(toolName, this.toolArgs(tool, toolName, args), retryable)
	}
	private toolArgs(tool: keyof EmailMcpToolMap, toolName: string, args: Record<string, unknown>): Record<string, unknown> {
		if (this.profile === "gmail" && (tool === "listThreads" || tool === "search") && toolName === "list_emails") {
			const input = args as unknown as EmailSearchInput
			const query = buildGmailSearchQuery(input)
			return { account: stringValue(args.accountId) ?? "all", ...(query ? { query } : {}), ...(args.limit === undefined ? {} : { max_results: args.limit }) }
		}
		if (this.profile === "gmail" && tool === "getThread" && toolName === "get_email") {
			return { account: args.accountId, message_id: args.threadId }
		}
		if (this.profile === "gmail" && toolName === "archive_email") {
			return { account: args.accountId, message_id: args.threadId }
		}
		if (this.profile === "gmail" && toolName === "apply_label") {
			return { account: args.accountId, message_id: args.threadId, label_name: args.labelId }
		}
		if (this.profile === "gmail" && tool === "unsubscribe") {
			return { account: args.accountId, message_id: args.messageId }
		}
		return args
	}
	private mutationTool(input: EmailMutationInput): { name: string; key?: keyof EmailMcpToolMap } | undefined {
		if (this.isToolAvailable(this.tools.update, "update")) return { name: this.tools.update, key: "update" }
		const configuredKey: keyof EmailMcpToolMap | undefined = input.kind === "mark-read" ? "markRead" : input.kind === "mark-unread" ? "markUnread" : input.kind === "archive" ? "archive" : input.kind === "restore" ? "restore" : input.kind === "star" ? "star" : input.kind === "trash" ? "trash" : input.kind === "spam" ? "spam" : input.kind === "snooze" ? "snooze" : input.kind === "label" ? (input.value === false ? "removeLabel" : "addLabel") : undefined
		if (configuredKey && this.isToolAvailable(this.tools[configuredKey], configuredKey)) return { name: this.tools[configuredKey], key: configuredKey }
		const candidates = input.kind === "label" && input.value === false ? MUTATION_TOOL_ALIASES.label.slice().reverse() : MUTATION_TOOL_ALIASES[input.kind]
		const candidate = candidates.find((name) => this.isToolAvailable(name))
		return candidate ? { name: candidate } : undefined
	}
	private profileAllowsMutation(input: EmailMutationInput): boolean {
		const allowed = PROFILE_MANAGEMENT_OPERATIONS[this.profile]
		if (!allowed) return true
		const operation = input.kind === "label" ? (input.value === false ? "label-remove" : "label-add") : input.kind
		return allowed.includes(operation as EmailManagementCapability)
	}
	private mutationArgs(input: EmailMutationInput, mutationTool: { name: string; key?: keyof EmailMcpToolMap }): Record<string, unknown> {
		if (mutationTool.key === "update") return input as unknown as Record<string, unknown>
		const args: Record<string, unknown> = { accountId: input.accountId, threadId: input.threadId }
		if (input.threadIds?.length) args.threadIds = [...new Set(input.threadIds)]
		if (input.kind === "mark-read" || input.kind === "mark-unread" || input.kind === "star") args.value = input.value ?? true
		if (input.kind === "label") {
			if (input.labelId !== undefined) args.labelId = input.labelId
			args.value = input.value !== false
		}
		if (input.kind === "snooze" && input.snoozeUntil) args.snoozeUntil = input.snoozeUntil
		return this.toolArgs("update", mutationTool.name, args)
	}
	async accounts(): Promise<EmailAccount[]> {
		const accounts = listResult(await this.call("listAccounts", {})).map((value, index) => normalizeAccount(value, index, this.capabilityDefaults))
		if (accounts.length < 2) return accounts
		return accounts.map((account) => ({ ...account, capabilities: { ...account.capabilities, multipleAccounts: true } }))
	}
	async threadsPage(input: EmailSearchInput): Promise<EmailThreadPage> { const tool = input.query ? "search" : "listThreads"; const result = await this.call(tool, input as unknown as Record<string, unknown>); const page = pageResult(result); const nextCursor = page.nextCursor && page.nextCursor !== input.cursor ? page.nextCursor : undefined; return { items: threadResultItems(result).map((item, index) => normalizePreview(item, input.accountId ?? "default", index)), ...(nextCursor ? { nextCursor } : {}) } }
	async threads(input: EmailSearchInput): Promise<EmailThreadPreview[]> { return (await this.threadsPage(input)).items }
	async thread(accountId: string, threadId: string): Promise<EmailThread> { const raw = await this.call("getThread", { accountId, threadId }); const envelope = record(raw); const result = record(envelope.thread ?? raw); const resolvedThreadId = stringValue(result.threadId) ?? threadId; const rawMessages = listResult(raw); const messages = (rawMessages.length ? rawMessages : [result]).map((item, index) => normalizeMessage(item, resolvedThreadId, index)); const labels = list<unknown>(result.labels ?? result.labelIds).filter((item): item is string => typeof item === "string"); return { id: resolvedThreadId, accountId, subject: stringValue(result.subject) ?? messages[0]?.subject ?? "(无主题)", messages, labels } }
	async sync(input: EmailSyncInput): Promise<EmailSyncResult> {
		if (!this.isToolAvailable(this.tools.sync, "sync")) throw new EmailError("operation_not_supported", `邮箱 provider 不支持增量同步 ${this.tools.sync}`)
		const result = syncResult(await this.call("sync", input as unknown as Record<string, unknown>))
		return { accountId: input.accountId, provider: this.name, status: "synced", ...(result.cursor ? { cursor: result.cursor } : {}), ...(result.added === undefined ? {} : { added: result.added }), ...(result.updated === undefined ? {} : { updated: result.updated }), ...(result.removed === undefined ? {} : { removed: result.removed }) }
	}
	async labels(accountId: string): Promise<EmailLabel[]> { return listResult(await this.call("listLabels", { accountId })).map((value, index) => { const item = record(value); return { id: stringValue(item.id ?? item.labelId) ?? `label-${index + 1}`, name: stringValue(item.name ?? item.label) ?? "未命名", system: item.system === true, color: stringValue(item.color) }; }) }
	async update(input: EmailMutationInput): Promise<EmailMutationResult> {
		if (!this.profileAllowsMutation(input)) throw new EmailError("operation_not_supported", `邮箱 provider profile ${this.profile} 不支持操作 ${input.kind}`)
		const mutationTool = this.mutationTool(input)
		if (!mutationTool) throw new EmailError("operation_not_supported", `邮箱 provider 不支持操作 ${input.kind}`)
		const result = record(await this.callNamed(mutationTool.name, this.mutationArgs(input, mutationTool), false));
		return { ok: result.ok !== false, provider: stringValue(result.provider) ?? this.name, operation: stringValue(result.operation) ?? input.kind, threadId: stringValue(result.threadId) ?? input.threadId, receipt: stringValue(result.receipt), dryRun: result.dryRun === true, matched: typeof result.matched === "number" ? result.matched : undefined, sampleIds: list<string>(result.sampleIds) };
	}
	async createDraft(input: EmailComposeInput): Promise<EmailDraft> { const result = record(await this.call("createDraft", input as unknown as Record<string, unknown>)); return { id: stringValue(result.id ?? result.draftId) ?? input.draftId ?? `draft-${Date.now().toString(36)}`, accountId: input.accountId, ...(stringValue(result.threadId ?? input.threadId) ? { threadId: stringValue(result.threadId ?? input.threadId) } : {}), ...(stringValue(result.messageId ?? input.messageId) ? { messageId: stringValue(result.messageId ?? input.messageId) } : {}), to: addresses(result.to ?? input.to), cc: addresses(result.cc ?? input.cc ?? []), bcc: addresses(result.bcc ?? input.bcc ?? []), ...(Array.isArray(result.replyTo ?? input.replyTo) ? { replyTo: addresses(result.replyTo ?? input.replyTo) } : {}), subject: stringValue(result.subject) ?? input.subject, body: stringValue(result.body ?? result.text) ?? input.body, ...(stringValue(result.bodyHtml ?? result.html ?? input.bodyHtml) ? { bodyHtml: stringValue(result.bodyHtml ?? result.html ?? input.bodyHtml) } : {}), attachments: list<string>(result.attachments ?? input.attachments ?? []), status: "draft", createdAt: iso(result.createdAt), updatedAt: iso(result.updatedAt) } }
	async sendDraft(draft: EmailDraft): Promise<EmailMutationResult> {
		const result = record(await this.call("sendDraft", draft as unknown as Record<string, unknown>));
		return { ok: result.ok !== false, provider: stringValue(result.provider) ?? this.name, operation: stringValue(result.operation) ?? "send-draft", receipt: stringValue(result.receipt) };
	}
	async setSenderPolicy(input: EmailSenderPolicyInput): Promise<EmailMutationResult> {
		const result = record(await this.call("setSenderPolicy", input as unknown as Record<string, unknown>));
		return { ok: result.ok !== false, provider: stringValue(result.provider) ?? this.name, operation: stringValue(result.operation) ?? `sender-policy:${input.policy}`, threadId: stringValue(result.threadId) ?? input.threadId, receipt: stringValue(result.receipt) };
	}
	async unsubscribe(input: EmailUnsubscribeInput): Promise<EmailUnsubscribeResult> {
		if (!this.isToolAvailable(this.tools.unsubscribe, "unsubscribe")) throw new EmailError("operation_not_supported", `邮箱 provider 不支持操作 unsubscribe`)
		const result = record(await this.call("unsubscribe", input as unknown as Record<string, unknown>));
		return { ok: result.ok !== false || result.success === true, provider: stringValue(result.provider) ?? this.name, operation: stringValue(result.operation) ?? "unsubscribe", threadId: stringValue(result.threadId) ?? input.threadId, receipt: stringValue(result.receipt), method: stringValue(result.method), detail: stringValue(result.detail ?? result.message) };
	}
	async shareThread(input: EmailShareInput): Promise<EmailMutationResult> {
		const result = record(await this.call("shareThread", input as unknown as Record<string, unknown>));
		return { ok: result.ok !== false, provider: stringValue(result.provider) ?? this.name, operation: stringValue(result.operation) ?? "share-thread", threadId: input.threadId, receipt: stringValue(result.receipt) };
	}
	async createReminder(input: EmailReminderInput): Promise<EmailMutationResult> {
		const result = record(await this.call("createReminder", input as unknown as Record<string, unknown>));
		return { ok: result.ok !== false, provider: stringValue(result.provider) ?? this.name, operation: stringValue(result.operation) ?? "create-reminder", threadId: input.threadId, receipt: stringValue(result.receipt) };
	}
	async moveToProject(input: EmailProjectLinkInput): Promise<EmailMutationResult> {
		const result = record(await this.call("moveToProject", input as unknown as Record<string, unknown>));
		return { ok: result.ok !== false, provider: stringValue(result.provider) ?? this.name, operation: stringValue(result.operation) ?? "move-to-project", threadId: input.threadId, receipt: stringValue(result.receipt) };
	}
	async listAttachments(accountId: string, messageId: string): Promise<EmailAttachment[]> {
		return listResult(await this.call("listAttachments", { accountId, messageId })).map((value, index) => { const item = record(value); return { id: stringValue(item.id ?? item.attachmentId) ?? `attachment-${index + 1}`, messageId, name: stringValue(item.name ?? item.filename) ?? "附件", mimeType: stringValue(item.mimeType ?? item.contentType) ?? "application/octet-stream", size: typeof item.size === "number" ? item.size : undefined }; });
	}
	async downloadAttachment(accountId: string, attachmentId: string, messageId: string, destinationDir?: string): Promise<EmailAttachmentDownload> {
		const item = record(await this.call("downloadAttachment", { accountId, attachmentId, messageId, ...(destinationDir ? { destinationDir } : {}) }));
		const localPath = stringValue(item.localPath ?? item.path);
		if (!localPath) throw new EmailError("operation_failed", "邮箱 provider 未返回附件本地路径");
		return { attachmentId, messageId, name: stringValue(item.name ?? item.filename) ?? "附件", localPath };
	}
}

interface CompositeBinding {
	provider: EmailProvider
	rawAccountId: string
	qualifiedAccountId: string
	sourceIndex: number
}

const COMPOSITE_DONE_CURSOR = "__openbuddy_done__"

function encodeCompositeCursor(cursors: Record<string, string | undefined>): string | undefined {
	const entries = Object.fromEntries(Object.entries(cursors).filter(([, value]) => Boolean(value)))
	return Object.keys(entries).length ? Buffer.from(JSON.stringify(entries), "utf8").toString("base64url") : undefined
}

function decodeCompositeCursor(value?: string): Record<string, string | undefined> {
	if (!value) return {}
	try {
		const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown
		return record(parsed) as Record<string, string | undefined>
	} catch {
		return {}
	}
}

export class CompositeEmailProvider implements EmailProvider {
	readonly name = "mcp:multi"
	private readonly bindings = new Map<string, CompositeBinding>()
	private readonly rawBindings = new Map<string, CompositeBinding>()

	constructor(private readonly sources: readonly EmailProvider[]) {}

	async diagnostics(): Promise<EmailProviderDiagnostic> {
		const diagnostics = await Promise.all(this.sources.map(async (source) => source.diagnostics ? source.diagnostics() : ({ provider: source.name, serverName: source.name, profile: "generic" as const, toolDiscovery: "not-available" as const, discoveredTools: [], accounts: [], operations: [], availableCapabilities: [], missingCapabilities: [], readiness: "unavailable" as const, message: "该 provider 未暴露诊断信息" })))
		const readiness = diagnostics.some((item) => item.readiness === "ready") ? "ready" : diagnostics.some((item) => item.readiness === "partial") ? "partial" : diagnostics.some((item) => item.readiness === "reauthorization-required") ? "reauthorization-required" : "unavailable"
		const operations = [...new Map(diagnostics.flatMap((diagnostic) => diagnostic.operations).map((operation) => [operation.name, operation])).values()].map((operation) => ({ ...operation, ready: diagnostics.some((diagnostic) => diagnostic.operations.find((candidate) => candidate.name === operation.name)?.ready), missingTools: [...new Set(diagnostics.flatMap((diagnostic) => diagnostic.operations.find((candidate) => candidate.name === operation.name)?.missingTools ?? []))] }))
		const accounts = diagnostics.flatMap((diagnostic, sourceIndex) => diagnostic.accounts.map((account) => ({ ...account, id: `${this.sourceName(this.sources[sourceIndex]!, sourceIndex)}:${account.id}`, provider: this.sourceName(this.sources[sourceIndex]!, sourceIndex) })))
		return { provider: this.name, serverName: diagnostics.map((item) => item.serverName).join(", "), profile: "composite", toolDiscovery: diagnostics.every((item) => item.toolDiscovery === "discovered") ? "discovered" : "not-available", discoveredTools: [...new Set(diagnostics.flatMap((item) => item.discoveredTools))].sort(), accounts, operations, availableCapabilities: operations.filter((operation) => operation.ready).map((operation) => operation.name), missingCapabilities: operations.filter((operation) => !operation.ready).map((operation) => operation.name), readiness, ...(diagnostics.find((item) => item.message)?.message ? { message: diagnostics.find((item) => item.message)!.message } : {}) }
	}

	private sourceName(source: EmailProvider, index: number): string {
		return source.name.replace(/^mcp:/, "") || `provider-${index + 1}`
	}

	private async refreshAccounts(): Promise<EmailAccount[]> {
		this.bindings.clear()
		this.rawBindings.clear()
		const results = await Promise.allSettled(this.sources.map(async (provider, sourceIndex) => ({ provider, sourceIndex, accounts: await provider.accounts() })))
		const grouped = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
		if (!grouped.length && results[0]?.status === "rejected") throw results[0].reason
		const flattened: EmailAccount[] = []
		for (const group of grouped) {
			for (const account of group.accounts) {
				const qualifiedAccountId = `${this.sourceName(group.provider, group.sourceIndex)}:${account.id}`
				const binding: CompositeBinding = { provider: group.provider, rawAccountId: account.id, qualifiedAccountId, sourceIndex: group.sourceIndex }
				this.bindings.set(qualifiedAccountId, binding)
				this.rawBindings.set(`${group.sourceIndex}:${account.id}`, binding)
				flattened.push({ ...account, id: qualifiedAccountId, capabilities: { ...account.capabilities, multipleAccounts: true } })
			}
		}
		return flattened
	}

	private async binding(accountId: string): Promise<CompositeBinding> {
		const existing = this.bindings.get(accountId)
		if (existing) return existing
		await this.refreshAccounts()
		const resolved = this.bindings.get(accountId)
		if (!resolved) throw new EmailError("invalid_input", `邮箱账户不存在: ${accountId}`)
		return resolved
	}

	private mapPreview(preview: EmailThreadPreview, sourceIndex: number): EmailThreadPreview {
		const binding = this.rawBindings.get(`${sourceIndex}:${preview.accountId}`)
		return { ...preview, accountId: binding?.qualifiedAccountId ?? `${this.sourceName(this.sources[sourceIndex], sourceIndex)}:${preview.accountId}` }
	}

	private qualifyDraftId(binding: CompositeBinding, rawDraftId: string): string {
		return `${binding.qualifiedAccountId}::draft::${Buffer.from(rawDraftId, "utf8").toString("base64url")}`
	}

	private rawDraftId(binding: CompositeBinding, draftId: string): string {
		const prefix = `${binding.qualifiedAccountId}::draft::`
		if (!draftId.startsWith(prefix)) return draftId
		try { return Buffer.from(draftId.slice(prefix.length), "base64url").toString("utf8") } catch { return draftId }
	}

	private mapDraft(draft: EmailDraft, binding: CompositeBinding): EmailDraft {
		return { ...draft, id: this.qualifyDraftId(binding, draft.id), accountId: binding.qualifiedAccountId }
	}

	async accounts(): Promise<EmailAccount[]> {
		return this.refreshAccounts()
	}

	async threadsPage(input: EmailSearchInput): Promise<EmailThreadPage> {
		await this.refreshAccounts()
		if (input.accountId && input.accountId !== "all") {
			const binding = await this.binding(input.accountId)
			const page = binding.provider.threadsPage ? await binding.provider.threadsPage({ ...input, accountId: binding.rawAccountId }) : { items: await binding.provider.threads({ ...input, accountId: binding.rawAccountId }) }
			return { items: page.items.map((item) => this.mapPreview(item, binding.sourceIndex)), ...(page.nextCursor ? { nextCursor: encodeCompositeCursor({ [String(binding.sourceIndex)]: page.nextCursor }) } : {}) }
		}
		const cursors = decodeCompositeCursor(input.cursor)
		const results = await Promise.allSettled(this.sources.map(async (provider, sourceIndex) => {
			const compositeCursor = cursors[String(sourceIndex)]
			if (compositeCursor === COMPOSITE_DONE_CURSOR) return undefined
			const childInput = { ...input, accountId: undefined, cursor: compositeCursor }
			const page = provider.threadsPage ? await provider.threadsPage(childInput) : { items: await provider.threads(childInput) }
			return { sourceIndex, page }
		}))
		const pages = results.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : [])
		if (!pages.length && results[0]?.status === "rejected") throw results[0].reason
		const items = pages.flatMap(({ sourceIndex, page }) => page.items.map((item) => this.mapPreview(item, sourceIndex))).sort((left, right) => right.date.localeCompare(left.date))
		const hasMore = pages.some(({ page }) => Boolean(page.nextCursor))
		const nextCursor = hasMore ? encodeCompositeCursor(Object.fromEntries(this.sources.map((_, sourceIndex) => {
			const page = pages.find((entry) => entry.sourceIndex === sourceIndex)?.page
			return [String(sourceIndex), page?.nextCursor ?? COMPOSITE_DONE_CURSOR]
		}))) : undefined
		return { items, ...(nextCursor ? { nextCursor } : {}) }
	}

	async threads(input: EmailSearchInput): Promise<EmailThreadPreview[]> {
		return (await this.threadsPage(input)).items
	}

	async thread(accountId: string, threadId: string): Promise<EmailThread> {
		const binding = await this.binding(accountId)
		const thread = await binding.provider.thread(binding.rawAccountId, threadId)
		return { ...thread, accountId: binding.qualifiedAccountId }
	}

	async labels(accountId: string): Promise<EmailLabel[]> {
		const binding = await this.binding(accountId)
		return binding.provider.labels(binding.rawAccountId)
	}

	async update(input: EmailMutationInput): Promise<EmailMutationResult> {
		const binding = await this.binding(input.accountId)
		return binding.provider.update({ ...input, accountId: binding.rawAccountId })
	}

	async createDraft(input: EmailComposeInput): Promise<EmailDraft> {
		const binding = await this.binding(input.accountId)
		return this.mapDraft(await binding.provider.createDraft({ ...input, accountId: binding.rawAccountId, ...(input.draftId ? { draftId: this.rawDraftId(binding, input.draftId) } : {}) }), binding)
	}

	async sendDraft(draft: EmailDraft): Promise<EmailMutationResult> {
		const binding = await this.binding(draft.accountId)
		return binding.provider.sendDraft({ ...draft, id: this.rawDraftId(binding, draft.id), accountId: binding.rawAccountId })
	}

	async setSenderPolicy(input: EmailSenderPolicyInput): Promise<EmailMutationResult> {
		if (!input.accountId) throw new EmailError("invalid_input", "多 provider 邮箱设置发件人策略必须指定 accountId")
		const binding = await this.binding(input.accountId)
		if (!binding.provider.setSenderPolicy) throw new EmailError("operation_not_supported", "当前邮箱 provider 不支持发件人策略")
		return binding.provider.setSenderPolicy({ ...input, accountId: binding.rawAccountId })
	}

	async unsubscribe(input: EmailUnsubscribeInput): Promise<EmailUnsubscribeResult> {
		const binding = await this.binding(input.accountId)
		if (!binding.provider.unsubscribe) throw new EmailError("operation_not_supported", "当前邮箱 provider 不支持退订")
		return binding.provider.unsubscribe({ ...input, accountId: binding.rawAccountId })
	}

	async shareThread(input: EmailShareInput): Promise<EmailMutationResult> {
		const binding = await this.binding(input.accountId)
		if (!binding.provider.shareThread) throw new EmailError("operation_not_supported", "当前邮箱 provider 不支持线程分享")
		return binding.provider.shareThread({ ...input, accountId: binding.rawAccountId })
	}

	async createReminder(input: EmailReminderInput): Promise<EmailMutationResult> {
		const binding = await this.binding(input.accountId)
		if (!binding.provider.createReminder) throw new EmailError("operation_not_supported", "当前邮箱 provider 不支持提醒")
		return binding.provider.createReminder({ ...input, accountId: binding.rawAccountId })
	}

	async moveToProject(input: EmailProjectLinkInput): Promise<EmailMutationResult> {
		const binding = await this.binding(input.accountId)
		if (!binding.provider.moveToProject) throw new EmailError("operation_not_supported", "当前邮箱 provider 不支持项目关联")
		return binding.provider.moveToProject({ ...input, accountId: binding.rawAccountId })
	}

	async listAttachments(accountId: string, messageId: string): Promise<EmailAttachment[]> {
		const binding = await this.binding(accountId)
		if (!binding.provider.listAttachments) throw new EmailError("operation_not_supported", "当前邮箱 provider 不支持附件读取")
		return binding.provider.listAttachments(binding.rawAccountId, messageId)
	}

	async downloadAttachment(accountId: string, attachmentId: string, messageId: string, destinationDir?: string): Promise<EmailAttachmentDownload> {
		const binding = await this.binding(accountId)
		if (!binding.provider.downloadAttachment) throw new EmailError("operation_not_supported", "当前邮箱 provider 不支持附件下载")
		return binding.provider.downloadAttachment(binding.rawAccountId, attachmentId, messageId, destinationDir)
	}

	async sync(input: EmailSyncInput): Promise<EmailSyncResult> {
		const binding = await this.binding(input.accountId)
		if (!binding.provider.sync) throw new EmailError("operation_not_supported", "当前邮箱 provider 不支持原生增量同步")
		const result = await binding.provider.sync({ ...input, accountId: binding.rawAccountId })
		return { ...result, accountId: binding.qualifiedAccountId }
	}
}

function isToolDeclared(tools: EmailMcpToolMap, key: keyof EmailMcpToolMap, availableTools?: readonly string[]): boolean {
	const declared = tools[key] ?? DEFAULT_TOOLS[key]
	if (!declared) return false
	if (availableTools) return availableTools.some((tool) => tool.toLowerCase() === declared.toLowerCase())
	return Object.prototype.hasOwnProperty.call(tools, key)
}

export function createMcpEmailProvider(mcp: Pick<McpClient, "callTool">, config: EmailMcpProviderConfig): McpEmailProvider {
	const profileTools = config.profile ? EMAIL_MCP_PROVIDER_PROFILES[config.profile] : {}
	const declaredTools = { ...profileTools, ...config.tools }
	const mutationTools = ["update", "markRead", "markUnread", "archive", "restore", "star", "trash", "spam", "snooze", "addLabel", "removeLabel"] as const
	const availableTools = config.availableTools && config.availableTools.length > 0 ? config.availableTools.map((tool) => tool.toLowerCase()) : undefined
	const hasTool = (key: keyof EmailMcpToolMap): boolean => isToolDeclared(declaredTools, key, availableTools)
	const hasManagementTool = mutationTools.some((key) => hasTool(key)) || hasTool("unsubscribe") || (availableTools ? Object.values(MUTATION_TOOL_ALIASES).some((aliases) => aliases.some((alias) => availableTools.includes(alias))) : false)
	const managementOperations = mutationTools.flatMap((key) => hasTool(key) && MANAGEMENT_OPERATION_BY_KEY[key] ? [MANAGEMENT_OPERATION_BY_KEY[key]!] : [])
	const discoveredManagementOperations = availableTools ? Object.entries(MUTATION_TOOL_ALIASES).flatMap(([kind, aliases]) => aliases.filter((alias) => availableTools.includes(alias)).map((alias) => managementOperationForAlias(kind as EmailMutationKind, alias))) : []
	const profileManagementOperations = (hasTool("update") || !availableTools) ? (PROFILE_MANAGEMENT_OPERATIONS[config.profile ?? "generic"] ?? []) : []
	const uniqueManagementOperations = [...new Set([...managementOperations, ...discoveredManagementOperations, ...profileManagementOperations, ...(hasTool("unsubscribe") ? ["unsubscribe" as const] : [])])]
	return new McpEmailProvider(mcp, config.serverName, declaredTools, {
		profile: config.profile,
		read: true,
		write: Boolean(hasTool("createDraft") || hasTool("sendDraft")),
		attachments: Boolean(hasTool("listAttachments") || hasTool("downloadAttachment")),
		multipleAccounts: hasTool("listAccounts"),
		management: hasManagementTool,
		managementOperations: uniqueManagementOperations,
		sync: hasTool("sync"),
	}, config.availableTools, false, config.retryPolicy)
}

interface EmailSenderPolicyRecord { accountId?: string; senderEmail: string; policy: EmailSenderPolicy; updatedAt: string }
interface EmailShareRecord { id: string; accountId: string; threadId: string; channelId: string; message?: string; createdAt: string }
interface EmailReminderRecord { id: string; accountId: string; threadId: string; description: string; remindAt: string; notifiedAt?: string; analysisId?: string; actionIndex?: number }
interface EmailProjectRecord { accountId: string; threadId: string; projectId?: string; updatedAt: string }
interface EmailWorkspaceTagRecord extends EmailWorkspaceTag { }
interface EmailThreadTagRecord { accountId: string; threadId: string; tagId: string; updatedAt: string }
interface EmailStore {
	drafts: EmailDraft[]
	audit: EmailAuditEntry[]
	connections: EmailConnectionRecord[]
	senderPolicies: EmailSenderPolicyRecord[]
	shares: EmailShareRecord[]
	reminders: EmailReminderRecord[]
	projects: EmailProjectRecord[]
	tags: EmailWorkspaceTagRecord[]
	threadTags: EmailThreadTagRecord[]
	scheduledSends: EmailScheduledSend[]
	pendingSends: EmailPendingSend[]
	analyses: EmailAnalysisRecord[]
	inboxReceipts: EmailInboxReceipt[]
	syncStates: EmailSyncState[]
	processingPlans: EmailProcessingPlan[]
	rules: EmailRule[]
}
function storePath(): string { return path.join(process.env.PI_CODING_AGENT_DIR ?? path.join(process.env.PI_HOME ?? os.homedir(), ".pi", "agent"), "openbuddy-email.json") }
async function readStore(): Promise<EmailStore> { try { const item = JSON.parse(await readFile(storePath(), "utf8")) as Partial<EmailStore>; return { drafts: Array.isArray(item.drafts) ? item.drafts : [], audit: Array.isArray(item.audit) ? item.audit : [], connections: Array.isArray(item.connections) ? item.connections : [], senderPolicies: Array.isArray(item.senderPolicies) ? item.senderPolicies : [], shares: Array.isArray(item.shares) ? item.shares : [], reminders: Array.isArray(item.reminders) ? item.reminders : [], projects: Array.isArray(item.projects) ? item.projects : [], tags: Array.isArray(item.tags) ? item.tags : [], threadTags: Array.isArray(item.threadTags) ? item.threadTags : [], scheduledSends: Array.isArray(item.scheduledSends) ? item.scheduledSends : [], pendingSends: Array.isArray(item.pendingSends) ? item.pendingSends : [], analyses: Array.isArray(item.analyses) ? item.analyses : [], inboxReceipts: Array.isArray(item.inboxReceipts) ? item.inboxReceipts : [], syncStates: Array.isArray(item.syncStates) ? item.syncStates : [], processingPlans: Array.isArray(item.processingPlans) ? item.processingPlans : [], rules: Array.isArray(item.rules) ? item.rules : [] } } catch { return { drafts: [], audit: [], connections: [], senderPolicies: [], shares: [], reminders: [], projects: [], tags: [], threadTags: [], scheduledSends: [], pendingSends: [], analyses: [], inboxReceipts: [], syncStates: [], processingPlans: [], rules: [] } } }
let storeWriteQueue: Promise<void> = Promise.resolve()
function writeStore(store: EmailStore): Promise<void> {
	const operation = storeWriteQueue.then(async () => {
		const target = storePath()
		await mkdir(path.dirname(target), { recursive: true })
		const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
		await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
		try { await rename(temporary, target) } catch (error) { await rm(temporary, { force: true }).catch(() => undefined); throw error }
	})
	storeWriteQueue = operation.catch(() => undefined)
	return operation
}
function id(prefix: string): string { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` }
function analysisCitations(value: unknown): EmailAnalysisCitation[] {
	if (!Array.isArray(value)) return []
	return value.slice(0, 20).map((entry) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new EmailError("invalid_input", "AI 分析引用必须是对象")
		const item = entry as Record<string, unknown>
		if (typeof item.messageId !== "string" || !item.messageId.trim()) throw new EmailError("invalid_input", "AI 分析引用必须包含 messageId")
		return { messageId: item.messageId.trim(), ...(typeof item.from === "string" ? { from: item.from.slice(0, 320) } : {}), ...(typeof item.date === "string" ? { date: item.date.slice(0, 80) } : {}), ...(typeof item.quote === "string" ? { quote: item.quote.slice(0, 500) } : {}) }
	})
}
function analysisContextCitations(value: unknown): EmailAnalysisContextCitation[] {
	if (!Array.isArray(value)) return []
	return value.slice(0, 20).map((entry) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new EmailError("invalid_input", "AI 知识库引用必须是对象")
		const item = entry as Record<string, unknown>
		if (typeof item.sourceId !== "string" || !item.sourceId.trim()) throw new EmailError("invalid_input", "AI 知识库引用必须包含 sourceId")
		return {
			sourceId: item.sourceId.trim().slice(0, 500),
			...(typeof item.sourceTitle === "string" ? { sourceTitle: item.sourceTitle.trim().slice(0, 500) } : {}),
			...(typeof item.sourcePath === "string" ? { sourcePath: item.sourcePath.trim().slice(0, 2000) } : {}),
			...(typeof item.quote === "string" ? { quote: item.quote.slice(0, 1000) } : {}),
		}
	})
}
function analysisFacts(value: unknown): EmailAnalysisFact[] {
	if (!Array.isArray(value)) return []
	return value.slice(0, 50).map((entry) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new EmailError("invalid_input", "AI 分析事实必须是对象")
		const item = entry as Record<string, unknown>
		if (typeof item.statement !== "string" || !item.statement.trim()) throw new EmailError("invalid_input", "AI 分析事实必须包含 statement")
		const contextCitations = analysisContextCitations(item.contextCitations)
		return { statement: item.statement.trim().slice(0, 2000), citations: analysisCitations(item.citations), ...(contextCitations.length ? { contextCitations } : {}) }
	})
}
function analysisActions(value: unknown): EmailAnalysisAction[] {
	if (!Array.isArray(value)) return []
	return value.slice(0, 50).map((entry) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new EmailError("invalid_input", "AI 行动项必须是对象")
		const item = entry as Record<string, unknown>
		if (typeof item.content !== "string" || !item.content.trim()) throw new EmailError("invalid_input", "AI 行动项必须包含 content")
		const contextCitations = analysisContextCitations(item.contextCitations)
		return { content: item.content.trim().slice(0, 2000), ...(typeof item.owner === "string" ? { owner: item.owner.slice(0, 320) } : {}), ...(typeof item.dueAt === "string" ? { dueAt: item.dueAt.slice(0, 80) } : {}), citations: analysisCitations(item.citations), ...(contextCitations.length ? { contextCitations } : {}) }
	})
}

export interface EmailActionCandidateInput {
	subject: string
	body: string
	messages: Array<{ id: string; from?: string; date?: string; text?: string; snippet?: string }>
	phrases?: readonly string[]
	baseDate?: Date
	now?: Date
}

export interface EmailActionCandidate {
	content: string
	owner?: string
	dueAt?: string
	messageId: string
	citations: EmailAnalysisCitation[]
	confidence: number
	source: "llm-phrase" | "heuristic-imperative" | "heuristic-deadline"
}

export interface EmailActionCandidateResult {
	actions: EmailActionCandidate[]
	summary: string
	noise: boolean
	extractedAt: string
	stats: { candidates: number; kept: number; droppedNoise: number; droppedNoCitation: number; droppedPassiveFollowup: number; droppedRejected: number }
}

const EMAIL_ACTION_TRIGGER_PATTERNS: ReadonlyArray<{ regex: RegExp; source: EmailActionCandidate["source"] }> = [
	{ regex: /(?:请|麻烦|烦请|恳请|希望|期待)\s*([^\n。.!?！？;;；]{2,80})/g, source: "heuristic-imperative" },
	{ regex: /\b(?:please|kindly|could you|can you|would you)\s+([^\n.!?]{2,80})/gi, source: "heuristic-imperative" },
	{ regex: /(?:能否|可不可以|是否可以|方便|愿意)\s*([^\n。.!?！？;;；]{2,80})/g, source: "heuristic-imperative" },
	{ regex: /(?:审批|审核|确认|签字|回签|签署|批准|agree|approve|sign)\s*([^\n。.!?！？;;；]{2,80})/g, source: "heuristic-imperative" },
	{ regex: /(?:回复|反馈|提供|安排|发送|处理|完成|准备)\s*([^\n。.!?！？;;；]{2,80})/g, source: "heuristic-deadline" },
]

const EMAIL_NOISE_KEYWORDS = [
	"newsletter", "no-reply", "noreply", "automated", "automatic",
	"notification", "alert", "digest", "weekly", "每月精选", "本周精选",
	"每日精选", "weekly summary", "build succeeded", "build failed",
	"system report", "monitoring", "metrics", "p95", "延迟",
	"生日快乐", "happy birthday", "节日快乐",
	"感谢贵司", "感谢您的", "感谢你", "下次有项目", "下次见面",
	"webinar 邀请", "blog post", "release notes", "changelog",
	"团建", "公告", "[公告]",
]

const EMAIL_NOISE_SUBJECT_PATTERNS: RegExp[] = [
	/^InfoQ/i, /^Daily/i, /^Build\s*#/i, /^New Blog Post/i,
	/^v\d+\.\d+/, /^Webinar/i, /生日快乐/, /感谢/, /感谢贵司/,
]

const EMAIL_REJECTED_PATTERNS = [
	/(?:暂不采购|暂不合作|本期不|不续签|不参与)/,
	/(?:本期暂不|暂不考虑|暂未通过|拒绝|rejected|not proceeding)/i,
]

const EMAIL_CANCELLED_PATTERNS = [
	/(?:取消|取消：|已取消|cancelled|已结束)/,
]

const EMAIL_PASSIVE_FOLLOWUP_PATTERNS = [
	/已进入.*?(?:审核|终审|审批)/,
	/已发货|运单号|预计.*?送达/,
	/仍在.*?评审中/,
	/正在.*?处理/,
	/稍后通知|新时间稍后/,
]

function resolveMessageId(input: { messages: EmailActionCandidateInput["messages"]; fallback: string }): { id: string; from?: string; date?: string } {
	if (input.messages.length === 0) return { id: input.fallback }
	const head = input.messages[0]!
	return { id: head.id || input.fallback, ...(head.from ? { from: head.from } : {}), ...(head.date ? { date: head.date } : {}) }
}

function extractAbsoluteDate(text: string, baseDate: Date): string | undefined {
	let earliest: string | undefined
	for (const m of text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) {
		const key = m[1]!
		if (!earliest || key < earliest) earliest = key
	}
	for (const m of text.matchAll(/\b(\d{1,2})[/月-](\d{1,2})(?:[/月-](\d{2,4}))?\b/g)) {
		const month = parseInt(m[1]!, 10)
		const day = parseInt(m[2]!, 10)
		let year = m[3] ? parseInt(m[3], 10) : baseDate.getFullYear()
		if (year < 100) year += 2000
		const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
		if (!earliest || candidate < earliest) earliest = candidate
	}
	for (const m of text.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g)) {
		const month = parseInt(m[1]!, 10)
		const day = parseInt(m[2]!, 10)
		const candidate = `${baseDate.getFullYear()}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
		if (!earliest || candidate < earliest) earliest = candidate
	}
	return earliest
}

function extractRelativeDate(text: string, baseDate: Date): string | undefined {
	const weekdayMap: Record<string, number> = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0 }
	const targetWeekday = (text.match(/(?:本周|下周)([一二三四五六日天])/) ?? [])[1]
	if (targetWeekday) {
		const dow = weekdayMap[targetWeekday] ?? 0
		const curDow = baseDate.getDay()
		const delta = ((dow - curDow + 7) % 7) + (text.startsWith("下周") ? 7 : 0)
		if (delta > 0) {
			const d = new Date(baseDate)
			d.setDate(d.getDate() + delta)
			return d.toISOString().slice(0, 10)
		}
	}
	const relativeMap: Array<{ regex: RegExp; offsetDays: number }> = [
		{ regex: /本周内|本周/i, offsetDays: 4 },
		{ regex: /下周内|下周/i, offsetDays: 11 },
		{ regex: /本月底|月底/i, offsetDays: 28 },
		{ regex: /尽快|asap|immediately/i, offsetDays: 0 },
		{ regex: /今天|today/i, offsetDays: 0 },
		{ regex: /明天|tomorrow/i, offsetDays: 1 },
		{ regex: /后天/i, offsetDays: 2 },
		{ regex: /两周内|两周/i, offsetDays: 14 },
		{ regex: /一个月内|月内|一个月/i, offsetDays: 30 },
		{ regex: /本周五/i, offsetDays: 4 },
		{ regex: /下周五/i, offsetDays: 11 },
	]
	for (const entry of relativeMap) {
		if (entry.regex.test(text)) {
			const d = new Date(baseDate)
			d.setDate(d.getDate() + entry.offsetDays)
			return d.toISOString().slice(0, 10)
		}
	}
	return undefined
}

function extractDueDate(text: string, baseDate: Date): string | undefined {
	return extractAbsoluteDate(text, baseDate) ?? extractRelativeDate(text, baseDate)
}

function isNoiseEmail(input: EmailActionCandidateInput): boolean {
	const subject = input.subject ?? ""
	const body = input.body ?? ""
	const haystack = `${subject}\n${body}`
	for (const pattern of EMAIL_NOISE_SUBJECT_PATTERNS) {
		if (pattern.test(subject)) return true
	}
	return EMAIL_NOISE_KEYWORDS.some((keyword) => haystack.includes(keyword))
}

function isRejectedEmail(input: EmailActionCandidateInput): boolean {
	const haystack = `${input.subject ?? ""}\n${input.body ?? ""}`
	return EMAIL_REJECTED_PATTERNS.some((pattern) => pattern.test(haystack))
}

function isCancelledEmail(input: EmailActionCandidateInput): boolean {
	const haystack = `${input.subject ?? ""}\n${input.body ?? ""}`
	return EMAIL_CANCELLED_PATTERNS.some((pattern) => pattern.test(haystack))
}

function isPassiveFollowupEmail(input: EmailActionCandidateInput): boolean {
	return EMAIL_PASSIVE_FOLLOWUP_PATTERNS.some((pattern) => pattern.test(input.body ?? ""))
}

function trimActionContent(content: string): string {
	const trimmed = content.replace(/\s+/g, " ").trim()
	if (trimmed.length <= 30) return trimmed
	return `${trimmed.slice(0, 28)}…`
}

/**
 * OpenBuddy AI Email · action-candidate extractor.
 *
 * 真实 OpenBuddy email 包内的 AI 能力,被 Pi Agent 通过
 * `email_extract_action_candidates` 工具调用。LLM agent 把邮件正文交给
 * 本函数,本函数负责规范化、引用校验、噪声过滤和日期归一,最后产出
 * 与 `EmailAnalysisAction` 兼容的结构化候选。
 *
 * 设计原则:
 * 1. 不假设 LLM 是否可用 —— `phrases` 为空时退化为基于正则的启发式抽取,
 *    保证在 Pi Agent 暂时缺 LLM 或 MiniMax 不可达时仍然返回结构化结果。
 * 2. 所有候选项必须能映射到具体消息(`messageId` + `citations`),从而
 *    复用 `email.saveAnalysis()` 已有的引用校验链路,避免重复实现。
 * 3. 与 `triage()` / `replyZero()` / `digest()` 共享相同的"噪声/拒绝/
 *    取消/被动跟进"语义,确保整个 OpenBuddy email 包内的 AI 决策一致。
 */
export function extractEmailActionCandidates(input: EmailActionCandidateInput): EmailActionCandidateResult {
	const baseDate = input.baseDate ?? input.now ?? new Date()
	const now = input.now ?? new Date()
	const subject = input.subject ?? ""
	const body = input.body ?? ""
	const text = `${subject}\n${body}`
	const fallbackMessageId = input.messages[0]?.id ?? `m-${now.getTime().toString(36)}`
	const reference = resolveMessageId({ messages: input.messages, fallback: fallbackMessageId })
	const droppedNoise = isNoiseEmail(input)
	const droppedRejected = isRejectedEmail(input)
	const droppedCancelled = isCancelledEmail(input)
	const droppedPassiveFollowup = isPassiveFollowupEmail(input)
	if (droppedNoise || droppedRejected || droppedCancelled || droppedPassiveFollowup) {
		return {
			actions: [],
			summary: droppedCancelled ? "邮件已被取消,无需行动项" : droppedRejected ? "邮件已被对方拒绝或暂不考虑" : droppedPassiveFollowup ? "邮件仅通报进度,等待对方回复" : "邮件属于订阅或通知类型,无需行动项",
			noise: droppedNoise,
			extractedAt: now.toISOString(),
			stats: { candidates: 0, kept: 0, droppedNoise: droppedNoise ? 1 : 0, droppedNoCitation: 0, droppedPassiveFollowup: droppedPassiveFollowup ? 1 : 0, droppedRejected: droppedRejected ? 1 : 0 },
		}
	}

	const phraseSource: Map<string, EmailActionCandidate["source"]> = new Map()
	if (input.phrases && input.phrases.length > 0) {
		for (const phrase of input.phrases) {
			const trimmed = phrase.replace(/\s+/g, " ").trim()
			if (trimmed.length >= 2 && trimmed.length <= 120) phraseSource.set(trimmed, "llm-phrase")
		}
	}
	for (const pattern of EMAIL_ACTION_TRIGGER_PATTERNS) {
		pattern.regex.lastIndex = 0
		for (const match of text.matchAll(pattern.regex)) {
			const captured = (match[1] ?? "").replace(/\s+/g, " ").trim()
			if (captured.length >= 2 && captured.length <= 80) phraseSource.set(captured, pattern.source)
		}
	}
	if (phraseSource.size === 0) {
		return {
			actions: [],
			summary: "邮件未发现需要我方处理的明确行动项",
			noise: false,
			extractedAt: now.toISOString(),
			stats: { candidates: 0, kept: 0, droppedNoise: 0, droppedNoCitation: 0, droppedPassiveFollowup: 0, droppedRejected: 0 },
		}
	}
	const dueDate = extractDueDate(text, baseDate)
	const candidates: EmailActionCandidate[] = []
	let idx = 0
	for (const [phrase, source] of phraseSource) {
		if (candidates.length >= 5) break
		const content = trimActionContent(phrase)
		if (!content) continue
		const candidate: EmailActionCandidate = {
			content,
			owner: "我",
			...(dueDate ? { dueAt: dueDate } : {}),
			messageId: reference.id,
			citations: [{ messageId: reference.id, ...(reference.from ? { from: reference.from } : {}), ...(reference.date ? { date: reference.date } : {}), ...(source === "llm-phrase" && phrase ? { quote: phrase.slice(0, 200) } : {}) }],
			confidence: source === "llm-phrase" ? 0.9 : source === "heuristic-imperative" ? 0.7 : 0.55,
			source,
		}
		candidates.push(candidate)
		idx += 1
	}
	const keptCandidates = candidates.filter((candidate) => candidate.messageId.trim().length > 0)
	return {
		actions: keptCandidates,
		summary: keptCandidates.length === 0 ? "邮件未发现可引用的行动项" : `共发现 ${keptCandidates.length} 项需要我方处理的行动项`,
		noise: false,
		extractedAt: now.toISOString(),
		stats: { candidates: candidates.length, kept: keptCandidates.length, droppedNoise: 0, droppedNoCitation: candidates.length - keptCandidates.length, droppedPassiveFollowup: 0, droppedRejected: 0 },
	}
}
function analysisReplyDraft(value: unknown): EmailAnalysisReplyDraft | undefined {
	if (value === undefined || value === null) return undefined
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new EmailError("invalid_input", "AI 回复草稿必须是对象")
	const item = value as Record<string, unknown>
	if (typeof item.subject !== "string" || typeof item.body !== "string") throw new EmailError("invalid_input", "AI 回复草稿必须包含 subject 和 body")
	const tone = item.tone === "neutral" || item.tone === "warm" || item.tone === "formal" ? item.tone : undefined
	const contextCitations = analysisContextCitations(item.contextCitations)
	return { subject: item.subject.slice(0, 998), body: item.body.slice(0, 20000), ...(tone ? { tone } : {}), citations: analysisCitations(item.citations), ...(contextCitations.length ? { contextCitations } : {}) }
}
function analysisMeetingProposal(value: unknown): EmailAnalysisMeetingProposal | undefined {
	if (value === undefined || value === null) return undefined
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new EmailError("invalid_input", "AI 会议提案必须是对象")
	const item = value as Record<string, unknown>
	if (typeof item.title !== "string" || !item.title.trim() || typeof item.start !== "string" || typeof item.end !== "string") throw new EmailError("invalid_input", "AI 会议提案必须包含 title、start 和 end")
	const start = Date.parse(item.start)
	const end = Date.parse(item.end)
	if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new EmailError("invalid_input", "AI 会议提案时间范围无效")
	const meetingUrl = typeof item.meetingUrl === "string" && item.meetingUrl.trim() ? item.meetingUrl.trim() : undefined
	if (meetingUrl) {
		try { const parsed = new URL(meetingUrl); if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported") } catch { throw new EmailError("invalid_input", "会议链接必须是 http(s) URL") }
	}
	const attendees = addresses(item.attendees ?? [])
	const citations = analysisCitations(item.citations)
	return { title: item.title.trim().slice(0, 500), start: new Date(start).toISOString(), end: new Date(end).toISOString(), ...(typeof item.timeZone === "string" && item.timeZone.trim() ? { timeZone: item.timeZone.trim().slice(0, 80) } : {}), ...(typeof item.location === "string" && item.location.trim() ? { location: item.location.trim().slice(0, 1000) } : {}), ...(meetingUrl ? { meetingUrl } : {}), attendees, ...(typeof item.description === "string" && item.description.trim() ? { description: item.description.trim().slice(0, 4000) } : {}), citations }
}
function analysisContextCitationEntries(facts: EmailAnalysisFact[], actions: EmailAnalysisAction[], risks: EmailAnalysisFact[], replyDraft?: EmailAnalysisReplyDraft): EmailAnalysisContextCitation[] {
	return [...facts.flatMap((item) => item.contextCitations ?? []), ...actions.flatMap((item) => item.contextCitations ?? []), ...risks.flatMap((item) => item.contextCitations ?? []), ...(replyDraft?.contextCitations ?? [])]
}
function analysisCitationIds(facts: EmailAnalysisFact[], actions: EmailAnalysisAction[], risks: EmailAnalysisFact[], replyDraft?: EmailAnalysisReplyDraft): string[] {
	return [...new Set([
		...facts.flatMap((item) => item.citations.map((citation) => citation.messageId)),
		...actions.flatMap((item) => item.citations.map((citation) => citation.messageId)),
		...risks.flatMap((item) => item.citations.map((citation) => citation.messageId)),
		...(replyDraft ? replyDraft.citations.map((citation) => citation.messageId) : []),
	])]
}
function searchableMessageText(message: EmailMessage): string {
	const htmlText = message.html?.replace(/<[^>]+>/g, " ") ?? ""
	return [message.text ?? "", htmlText].join(" ").replace(/\s+/g, " ").trim().toLocaleLowerCase()
}
function citationQuoteMatches(message: EmailMessage, quote: string): boolean {
	const normalizedQuote = quote.replace(/\s+/g, " ").trim().toLocaleLowerCase()
	return Boolean(normalizedQuote) && searchableMessageText(message).includes(normalizedQuote)
}
function draftFingerprint(draft: EmailDraft): string { return createHash("sha256").update(JSON.stringify({ accountId: draft.accountId, threadId: draft.threadId, messageId: draft.messageId, to: draft.to, cc: draft.cc, bcc: draft.bcc, replyTo: draft.replyTo, subject: draft.subject, body: draft.body, bodyHtml: draft.bodyHtml, attachments: draft.attachments })).digest("hex") }
function processingPlanFingerprint(operations: EmailProcessingPlanOperation[]): string { return createHash("sha256").update(JSON.stringify(operations)).digest("hex") }
const MAX_DRAFT_ATTACHMENT_BYTES = 25 * 1024 * 1024
async function validateDraftAttachments(attachments: string[]): Promise<void> {
	if (attachments.length > 20 || attachments.some((attachment) => !path.isAbsolute(attachment))) throw new EmailError("invalid_input", "邮件附件必须是最多 20 个绝对路径")
	let totalBytes = 0
	for (const attachment of attachments) {
		let stats
		try { stats = await lstat(attachment) } catch { throw new EmailError("invalid_input", `邮件附件不存在或不可读取: ${path.basename(attachment)}`) }
		if (stats.isSymbolicLink() || !stats.isFile()) throw new EmailError("invalid_input", `邮件附件必须是普通文件: ${path.basename(attachment)}`)
		if (stats.size > MAX_DRAFT_ATTACHMENT_BYTES) throw new EmailError("invalid_input", `单个邮件附件不能超过 ${MAX_DRAFT_ATTACHMENT_BYTES} 字节`)
		totalBytes += stats.size
		if (totalBytes > MAX_DRAFT_ATTACHMENT_BYTES) throw new EmailError("invalid_input", `邮件附件总大小不能超过 ${MAX_DRAFT_ATTACHMENT_BYTES} 字节`)
	}
}
const DRAFT_HTML_TAGS = new Set(["A", "B", "BLOCKQUOTE", "BR", "CODE", "DEL", "DIV", "EM", "H1", "H2", "H3", "HR", "I", "LI", "OL", "P", "PRE", "S", "SPAN", "STRONG", "SUB", "SUP", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "U", "UL"])
const DRAFT_HTML_ATTRIBUTES = new Set(["align", "colspan", "dir", "href", "rowspan", "target", "title"])
function sanitizeDraftHtml(value: string): string {
	return value.replace(/<!--[\s\S]*?-->|<[^>]*>/g, (tag) => {
		if (tag.startsWith("<!--")) return ""
		const closing = /^<\s*\/\s*([A-Za-z][\w-]*)\s*>$/.exec(tag)
		if (closing) return DRAFT_HTML_TAGS.has(closing[1]!.toUpperCase()) ? `</${closing[1]!.toLowerCase()}>` : ""
		const opening = /^<\s*([A-Za-z][\w-]*)([\s\S]*?)\s*\/?>$/.exec(tag)
		if (!opening || !DRAFT_HTML_TAGS.has(opening[1]!.toUpperCase())) return ""
		const attributes: string[] = []
		for (const match of opening[2]!.matchAll(/([A-Za-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
			const name = match[1]!.toLowerCase()
			if (!DRAFT_HTML_ATTRIBUTES.has(name)) continue
			const attributeValue = match[2] ?? match[3] ?? match[4] ?? ""
			if (name === "href" && !/^(?:https?:|mailto:)/i.test(attributeValue)) continue
			attributes.push(`${name}="${attributeValue.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`)
		}
		const selfClosing = /\/\s*>$/.test(tag) || ["BR", "HR"].includes(opening[1]!.toUpperCase())
		return `<${opening[1]!.toLowerCase()}${attributes.length ? ` ${attributes.join(" ")}` : ""}${selfClosing ? " /" : ""}>`
	}).replace(/\s{2,}/g, " ").trim()
}

export class Email extends OpenBuddyService {
	static provide = "email" as const
	private readonly mcp: Pick<McpClient, "list" | "callTool"> & { listToolNames?: (serverName: string) => string[] }
	private provider: EmailProvider | null = null
	private providerFingerprint = ""
	private registry: EmailProviderRegistry | null = null
	private readonly registryPersistListeners: Array<() => void> = []
	private queue: Promise<void> = Promise.resolve()
	private readonly sendTokens = new Map<string, { draftId: string; fingerprint: string; sideEffectIntentId?: string }>()
	private readonly processingPlanTokens = new Map<string, { planId: string; fingerprint: string }>()
	private readonly scheduleTokens = new Map<string, { draftId: string; scheduledAt: string; fingerprint: string; sideEffectIntentId?: string }>()
	private readonly scheduledSendRuns = new Set<string>()
	private readonly pendingSendRuns = new Set<string>()
	private readonly scheduledRuleRuns = new Set<string>()
	private readonly reminderTimer: ReturnType<typeof setInterval>
	private readonly pendingSendTimer: ReturnType<typeof setInterval>
	private readonly knowledgeContextValidator?: EmailKnowledgeContextValidator
	constructor(ctx: Context) {
		super(ctx, "email")
		this.mcp = ctx.get("mcpClient") as Pick<McpClient, "list" | "callTool">
		this.knowledgeContextValidator = ctx.get("emailKnowledgeContextValidator") as EmailKnowledgeContextValidator | undefined
		try {
			const injectedProvider = ctx.get("emailGmailApiProvider") as EmailProvider | undefined
			const injectedGraphProvider = ctx.get("emailGraphApiProvider") as EmailProvider | undefined
			const injectedJmapProvider = ctx.get("emailJmapApiProvider") as EmailProvider | undefined
			if (injectedProvider) this.provider = injectedProvider
			else if (injectedGraphProvider) this.provider = injectedGraphProvider
			else if (injectedJmapProvider) this.provider = injectedJmapProvider
		} catch { /* optional direct Gmail API provider */ }
		this.reminderTimer = setInterval(() => { void this.dispatchDueReminders(); void this.dispatchDueScheduledSends(); void this.runScheduledRules() }, 30_000)
		this.reminderTimer.unref?.()
		this.pendingSendTimer = setInterval(() => { void this.dispatchDuePendingSends() }, 1_000)
		this.pendingSendTimer.unref?.()
		void this.runScheduledRules()
		ctx.effect(() => () => { clearInterval(this.reminderTimer); clearInterval(this.pendingSendTimer); for (const off of this.registryPersistListeners.splice(0)) off(); if (serviceRef === this) serviceRef = null })
		const injected = ctx.get("emailProviderRegistry") as EmailProviderRegistry | undefined
		if (injected) this.registry = injected
		else this.registry = new EmailProviderRegistry()
		void this.hydrateRegistry().catch((cause) => console.error("[openbuddy-email] failed to hydrate registry", cause))
	}
	private async hydrateRegistry(): Promise<void> {
		if (!this.registry) return
		const store = await readStore()
		for (const record of store.connections) {
			try { this.registry.register({ id: record.id, providerType: record.providerType, accountId: record.accountId, displayName: record.displayName, credentialRef: record.credentialRef, mcpServerName: record.mcpServerName, scopes: record.scopes, enabledCapabilities: record.enabledCapabilities, enabled: record.enabled, status: record.status, lastError: record.lastError }) }
			catch (cause) { console.error("[openbuddy-email] failed to rehydrate connection", record.id, cause) }
		}
		const options = (this.registry as unknown as { options?: { mcp?: unknown } }).options
		if (options?.mcp) await this.registry.connectAll().catch(() => undefined)
	}
	setRegistry(registry: EmailProviderRegistry): void {
		this.registry = registry
		void this.hydrateRegistry().catch((cause) => console.error("[openbuddy-email] failed to re-hydrate after setRegistry", cause))
	}
	registryHandle(): EmailProviderRegistry | null { return this.registry }
	async providerDiagnostics(): Promise<EmailProviderDiagnostic> {
		const provider = this.getProvider()
		if (!provider.diagnostics) throw new EmailError("operation_not_supported", "当前邮箱 provider 未提供连接诊断")
		return provider.diagnostics()
	}
	private getProvider(): EmailProvider {
		if (this.provider && this.providerFingerprint === "explicit") return this.provider
		const statuses = this.mcp.list().filter((item) => item.status === "ready" && (process.env.OPENBUDDY_EMAIL_MCP_SERVER ? item.serverName === process.env.OPENBUDDY_EMAIL_MCP_SERVER : /mail|email|qq|gmail|google|outlook|microsoft|graph|imap|smtp|jmap|fastmail/i.test(item.serverName)))
		const fingerprint = statuses.map((s) => `${s.serverName}:${s.emailProfile ?? ""}`).sort().join("|")
		// 缓存的 fingerprint 一致 → 复用 provider;否则丢弃缓存重新探测,支持授权后无需重启。
		if (this.provider && this.providerFingerprint === fingerprint) return this.provider
		this.provider = null
		this.providerFingerprint = fingerprint
		if (this.registry) {
			const aggregate = this.registry.provider()
			if (aggregate) {
				this.provider = aggregate
				return aggregate
			}
		}
		if (!statuses.length) throw new EmailError("provider_unavailable", "没有已连接的邮箱 MCP 服务，请先在连接器中心完成授权。此错误为终态(配置缺失),AI Agent 不应重试,可在“连接器中心 → 邮箱”授权后再调用")
		const profile = process.env.OPENBUDDY_EMAIL_MCP_PROFILE
		const providers = statuses.map((status) => {
			const discovered = this.mcp.listToolNames?.(status.serverName)
			const availableTools = discovered && discovered.length > 0 ? discovered : undefined
			const discoveredTools: readonly string[] = availableTools ?? []
			const selectedProfile = configuredEmailProfile(profile)
				?? configuredEmailProfile(status.emailProfile)
				?? inferEmailMcpProfileFromTools(discoveredTools)
				?? inferEmailMcpProfile(status.serverName)
			return createMcpEmailProvider(this.mcp, { serverName: status.serverName, profile: selectedProfile, availableTools })
		})
		this.provider = providers.length === 1 ? providers[0] : new CompositeEmailProvider(providers)
		return this.provider
	}
	invalidateProvider(): void {
		this.provider = null
		this.providerFingerprint = ""
	}
	setProvider(provider: EmailProvider | null): void {
		this.provider = provider
		// R7.1 — 显式注入的 provider 不依赖 MCP 就绪集合,标记为 "explicit" 防止 fingerprint 失效时丢缓存。
		this.providerFingerprint = provider ? "explicit" : ""
	}
	private enqueue<T>(operation: () => Promise<T>): Promise<T> { const next = this.queue.then(operation, operation); this.queue = next.then(() => undefined, () => undefined); return next }
	private nextRuleRunAt(schedule: EmailRuleSchedule, now = Date.now()): string {
		const interval = Math.max(15, Math.min(7 * 24 * 60, Math.floor(schedule.intervalMinutes)))
		const candidate = Date.parse(schedule.nextRunAt)
		const base = Number.isFinite(candidate) && candidate > now ? candidate : now
		return new Date(base + interval * 60_000).toISOString()
	}
	private async audit(entry: Omit<EmailAuditEntry, "id" | "at">): Promise<EmailAuditEntry> { const auditEntry: EmailAuditEntry = { ...entry, id: id("mail-audit"), at: new Date().toISOString() }; const store = await readStore(); store.audit = [auditEntry, ...store.audit].slice(0, 500); await writeStore(store); return auditEntry }
	private async requireConfirmation(title: string, message: string, bypass = false): Promise<void> {
		if (bypass) return
		const ui = this.ctx.get("piUi") as { confirm?: (title: string, message: string) => Promise<boolean> } | undefined
		if (ui?.confirm) {
			if (!await ui.confirm(title, message)) throw new EmailError("confirmation_required", "用户拒绝了邮件操作")
			return
		}
		throw new EmailError("confirmation_required", `${title}必须经过用户确认`)
	}
	private async requireAccountCapability(accountId: string, capability: "write" | "attachments" | "management"): Promise<EmailAccount> {
		const account = await this.requireConnectedAccount(accountId)
		const supported = capability === "management" ? account.capabilities.management ?? account.capabilities.write : account.capabilities[capability]
		if (!supported) throw new EmailError("operation_failed", `当前邮箱账户不支持${capability === "write" ? "写入" : capability === "attachments" ? "附件" : "邮件管理"}操作`)
		return account
	}
	private collaborationRuntime(): { createSideEffectIntent: (input: { capability: string; action: string; summary: string; fingerprint: string; resourceId?: string; expiresAt?: string; approvedByUser?: boolean }) => { intentId: string }; consumeSideEffectIntent: (intentId: string, fingerprint: string) => unknown; completeSideEffectIntent: (intentId: string, receipt?: string) => unknown; failSideEffectIntent: (intentId: string, error: string) => unknown; cancelSideEffectIntent?: (intentId: string, reason?: string) => unknown } | undefined {
		try { return this.ctx.get("collaborationRuntime") as never } catch { return undefined }
	}
	private createSendIntent(draft: EmailDraft, expiresAt?: string): string | undefined {
		const runtime = this.collaborationRuntime()
		if (!runtime) return undefined
		return runtime.createSideEffectIntent({ capability: "email:send", action: "external:send", summary: `发送邮件：${draft.subject || draft.id}`, fingerprint: draftFingerprint(draft), resourceId: draft.id, ...(expiresAt ? { expiresAt } : {}), approvedByUser: true }).intentId
	}
	private async requireManagementOperation(accountId: string, input: EmailMutationInput): Promise<EmailAccount> {
		const account = await this.requireAccountCapability(accountId, "management")
		const operations = account.capabilities.managementOperations
		if (!operations?.length) return account
		const requested: EmailManagementCapability = input.kind === "label" ? (input.value === false ? "label-remove" : "label-add") : input.kind
		if (!operations.includes(requested)) throw new EmailError("operation_not_supported", `当前邮箱账户不支持邮件操作: ${requested}`)
		return account
	}
	private async expireProcessingPlans(): Promise<void> {
		const expired: EmailProcessingPlan[] = []
		await this.enqueue(async () => {
			const store = await readStore()
			const now = Date.now()
			for (const plan of store.processingPlans) {
				if (plan.status === "pending" && Number.isFinite(Date.parse(plan.expiresAt)) && Date.parse(plan.expiresAt) <= now) {
					plan.status = "expired"
					plan.error = "处理计划已过期"
					expired.push({ ...plan })
				}
			}
			if (expired.length) await writeStore(store)
		})
		if (expired.length) {
			for (const token of [...this.processingPlanTokens.entries()]) if (expired.some((plan) => plan.id === token[1].planId)) this.processingPlanTokens.delete(token[0])
			for (const plan of expired) await this.audit({ accountId: plan.operations[0]?.accountId ?? "unknown", operation: "processing-plan-expired", status: "expired", resourceId: plan.id, provider: this.getProvider().name, error: plan.error })
		}
	}
	private async requireConnectedAccount(accountId: string): Promise<EmailAccount> {
		const account = (await this.accounts()).find((item) => item.id === accountId)
		if (!account) throw new EmailError("invalid_input", `邮箱账户不存在: ${accountId}`)
		if (account.status !== "connected") throw new EmailError("operation_failed", `邮箱账户当前不可用（${account.status}），请先重新授权`)
		return account
	}
	private async applySenderPolicies(threads: EmailThreadPreview[]): Promise<EmailThreadPreview[]> {
		const store = await readStore()
		return threads.filter((thread) => {
			const tagIds = store.threadTags.filter((entry) => entry.accountId === thread.accountId && entry.threadId === thread.id).map((entry) => entry.tagId)
			const tags = store.tags.filter((tag) => tagIds.includes(tag.id)).map((tag) => tag.name)
			if (tags.length) thread.tags = tags
			const sender = thread.from.address.toLowerCase()
			const policy = store.senderPolicies.find((entry) => entry.senderEmail.toLowerCase() === sender && (!entry.accountId || entry.accountId === thread.accountId))
			if (policy?.policy === "block") return false
			if (policy) {
				const labels = new Set(thread.labels)
				labels.add(policy.policy === "signal" ? "OPENBUDDY_SIGNAL" : "OPENBUDDY_NOISE")
				thread.labels = [...labels]
			}
			return true
		})
	}
	private async applyWorkspaceTagFilter(threads: EmailThreadPreview[], input: EmailSearchInput): Promise<EmailThreadPreview[]> {
		if (!input.tags?.length) return threads
		const wanted = new Set(input.tags.map((tag) => tag.toLowerCase()))
		return threads.filter((thread) => {
			const actual = new Set((thread.tags ?? []).map((tag) => tag.toLowerCase()))
			return input.tagMatch === "all" ? [...wanted].every((tag) => actual.has(tag)) : [...wanted].some((tag) => actual.has(tag))
		})
	}
	async accounts(): Promise<EmailAccount[]> { return this.getProvider().accounts() }
	async rules(): Promise<EmailRule[]> { await this.queue; return (await readStore()).rules.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)) }
	async saveRule(input: EmailRuleInput): Promise<EmailRule> {
		const name = input.name.trim()
		if (!name || name.length > 120) throw new EmailError("invalid_input", "邮件规则名称不能为空且最多 120 个字符")
		if (!Array.isArray(input.actions) || input.actions.length === 0 || input.actions.length > 5) throw new EmailError("invalid_input", "邮件规则必须包含 1 到 5 个动作")
		const rawCondition = record(input.condition)
		const condition: EmailRuleCondition = {}
		const conditionKeys = new Set(["accountId", "query", "fromContains", "subjectContains", "unread", "hasAttachment", "category", "olderThanDays"])
		if (Object.keys(rawCondition).some((key) => !conditionKeys.has(key))) throw new EmailError("invalid_input", "邮件规则包含未知条件")
		for (const key of ["accountId", "query", "fromContains", "subjectContains"] as const) { if (rawCondition[key] !== undefined && typeof rawCondition[key] !== "string") throw new EmailError("invalid_input", `${key} 必须是字符串`); if (typeof rawCondition[key] === "string") condition[key] = rawCondition[key] }
		for (const key of ["unread", "hasAttachment"] as const) { if (rawCondition[key] !== undefined && typeof rawCondition[key] !== "boolean") throw new EmailError("invalid_input", `${key} 必须是布尔值`); if (typeof rawCondition[key] === "boolean") condition[key] = rawCondition[key] }
		if (rawCondition.olderThanDays !== undefined && (typeof rawCondition.olderThanDays !== "number" || !Number.isInteger(rawCondition.olderThanDays) || rawCondition.olderThanDays < 1 || rawCondition.olderThanDays > 3650)) throw new EmailError("invalid_input", "olderThanDays 必须是 1 到 3650 之间的整数")
		if (typeof rawCondition.olderThanDays === "number") condition.olderThanDays = rawCondition.olderThanDays
		if (rawCondition.category !== undefined && (typeof rawCondition.category !== "string" || !["urgent", "needs-reply", "waiting-for-reply", "noise", "normal"].includes(rawCondition.category as string))) throw new EmailError("invalid_input", "邮件规则分类无效")
		if (typeof rawCondition.category === "string") condition.category = rawCondition.category as EmailTriageCategory
		const actions = input.actions.map((action) => {
			if (!action || typeof action !== "object" || Array.isArray(action) || typeof action.kind !== "string") throw new EmailError("invalid_input", "邮件规则动作格式无效")
			if (!["mark-read", "mark-unread", "archive", "restore", "label", "star", "snooze"].includes(action.kind)) throw new EmailError("invalid_input", "邮件规则动作不支持")
			if (["trash", "spam"].includes(action.kind)) throw new EmailError("invalid_input", "邮件规则禁止删除或标记垃圾邮件")
			if (action.kind === "label" && !action.labelId) throw new EmailError("invalid_input", "标签规则必须指定 labelId")
			if (action.value !== undefined && typeof action.value !== "boolean") throw new EmailError("invalid_input", "规则动作 value 必须是布尔值")
			if (action.snoozeUntil !== undefined && (typeof action.snoozeUntil !== "string" || Date.parse(action.snoozeUntil) <= Date.now())) throw new EmailError("invalid_input", "规则的延后时间必须是未来时间")
			if (action.rationale !== undefined && typeof action.rationale !== "string") throw new EmailError("invalid_input", "规则动作 rationale 必须是字符串")
			return { kind: action.kind as EmailProcessingPlanKind, ...(typeof action.labelId === "string" ? { labelId: action.labelId } : {}), ...(typeof action.value === "boolean" ? { value: action.value } : {}), ...(typeof action.snoozeUntil === "string" ? { snoozeUntil: action.snoozeUntil } : {}), ...(typeof action.rationale === "string" ? { rationale: action.rationale.slice(0, 500) } : {}) }
		})
		let schedule: EmailRuleSchedule | undefined
		if (input.schedule !== undefined && input.schedule !== null) {
			const intervalMinutes = input.schedule.intervalMinutes
			if (!Number.isInteger(intervalMinutes) || intervalMinutes < 15 || intervalMinutes > 7 * 24 * 60) throw new EmailError("invalid_input", "规则调度间隔必须是 15 分钟到 7 天之间的整数")
			const nextRunAt = input.schedule.nextRunAt ?? new Date(Date.now() + intervalMinutes * 60_000).toISOString()
			if (!Number.isFinite(Date.parse(nextRunAt))) throw new EmailError("invalid_input", "规则下次运行时间无效")
			schedule = { intervalMinutes, nextRunAt }
		}
		const now = new Date().toISOString()
		const rule: EmailRule = { id: input.id?.trim() || id("email-rule"), name, enabled: input.enabled !== false, condition: { ...condition, ...(condition.query ? { query: condition.query.slice(0, 500) } : {}), ...(condition.fromContains ? { fromContains: condition.fromContains.slice(0, 200) } : {}), ...(condition.subjectContains ? { subjectContains: condition.subjectContains.slice(0, 200) } : {}) }, actions, ...(schedule ? { schedule } : {}), createdAt: now, updatedAt: now }
		await this.enqueue(async () => { const store = await readStore(); const existing = store.rules.find((item) => item.id === rule.id); const persisted = existing ? { ...rule, ...(input.schedule === undefined && existing.schedule ? { schedule: existing.schedule } : {}), createdAt: existing.createdAt, ...(existing.lastRun ? { lastRun: existing.lastRun } : {}), ...(existing.lastRunAt ? { lastRunAt: existing.lastRunAt } : {}) } : rule; store.rules = [persisted, ...store.rules.filter((item) => item.id !== rule.id)].slice(0, 100); await writeStore(store) })
		await this.audit({ accountId: condition.accountId ?? "all", operation: "save-email-rule", status: "completed", resourceId: rule.id, provider: "openbuddy-local" })
		return (await this.rules()).find((item) => item.id === rule.id) ?? rule
	}
	async runScheduledRules(): Promise<EmailScheduledRuleRunResult[]> {
		const now = Date.now()
		const dueRules = (await this.rules()).filter((rule) => rule.enabled && rule.schedule && Date.parse(rule.schedule.nextRunAt) <= now).slice(0, 20)
		const results: EmailScheduledRuleRunResult[] = []
		for (const rule of dueRules) {
			if (this.scheduledRuleRuns.has(rule.id)) { results.push({ ruleId: rule.id, status: "skipped" }); continue }
			this.scheduledRuleRuns.add(rule.id)
			try {
				const result = await this.runRule(rule.id)
				const nextRunAt = this.nextRuleRunAt(rule.schedule!, now)
				await this.enqueue(async () => { const store = await readStore(); const current = store.rules.find((item) => item.id === rule.id); if (current?.schedule) { current.schedule = { ...current.schedule, nextRunAt, lastScheduledAt: new Date().toISOString(), lastScheduledStatus: "completed", lastScheduledError: undefined }; current.updatedAt = new Date().toISOString() }; await writeStore(store) })
				await this.audit({ accountId: rule.condition.accountId ?? "all", operation: "scheduled-email-rule", status: "completed", resourceId: rule.id, provider: "openbuddy-local", details: { matchedCount: result.matchedCount, ...(result.plan ? { planId: result.plan.id } : {}) } })
				if (result.plan) await this.notify("邮件规则待确认", `规则「${rule.name}」匹配 ${result.matchedCount} 个线程，已生成待确认处理计划 ${result.plan.id}`)
				results.push({ ruleId: rule.id, status: "ran", nextRunAt, ...(result.plan ? { planId: result.plan.id } : {}) })
			} catch (cause) {
				const error = cause instanceof Error ? cause.message : "规则调度失败"
				const nextRunAt = this.nextRuleRunAt(rule.schedule!, now)
				await this.enqueue(async () => { const store = await readStore(); const current = store.rules.find((item) => item.id === rule.id); if (current?.schedule) { current.schedule = { ...current.schedule, nextRunAt, lastScheduledAt: new Date().toISOString(), lastScheduledStatus: "failed", lastScheduledError: error.slice(0, 500) }; current.updatedAt = new Date().toISOString() }; await writeStore(store) })
				await this.audit({ accountId: rule.condition.accountId ?? "all", operation: "scheduled-email-rule", status: "failed", resourceId: rule.id, provider: "openbuddy-local", error })
				results.push({ ruleId: rule.id, status: "failed", nextRunAt, error })
			} finally { this.scheduledRuleRuns.delete(rule.id) }
		}
		return results
	}
	async deleteRule(ruleId: string): Promise<void> {
		const normalized = ruleId.trim()
		if (!normalized) throw new EmailError("invalid_input", "邮件规则 ID 不能为空")
		await this.enqueue(async () => { const store = await readStore(); store.rules = store.rules.filter((item) => item.id !== normalized); await writeStore(store) })
		await this.audit({ accountId: "all", operation: "delete-email-rule", status: "completed", resourceId: normalized, provider: "openbuddy-local" })
	}
	private ruleMatches(thread: EmailThreadPreview, condition: EmailRuleCondition, category?: EmailTriageCategory): boolean {
		if (condition.accountId && thread.accountId !== condition.accountId) return false
		if (condition.fromContains && !`${thread.from.name ?? ""} ${thread.from.address}`.toLowerCase().includes(condition.fromContains.toLowerCase())) return false
		if (condition.subjectContains && !thread.subject.toLowerCase().includes(condition.subjectContains.toLowerCase())) return false
		if (condition.unread !== undefined && thread.unread !== condition.unread) return false
		if (condition.hasAttachment !== undefined && Boolean(thread.attachments) !== condition.hasAttachment) return false
		if (condition.category && category !== condition.category) return false
		if (condition.olderThanDays !== undefined && Date.parse(thread.date) > Date.now() - condition.olderThanDays * 24 * 60 * 60 * 1000) return false
		return true
	}
	async runRule(ruleId: string): Promise<EmailRuleRunResult> {
		const rule = (await this.rules()).find((item) => item.id === ruleId)
		if (!rule) throw new EmailError("invalid_input", `邮件规则不存在: ${ruleId}`)
		if (!rule.enabled) throw new EmailError("operation_failed", "邮件规则已停用")
		const input = rule.condition
		const pageInput: EmailSearchInput = { ...(input.accountId ? { accountId: input.accountId } : {}), ...(input.query ? { query: input.query } : {}), folder: "inbox", limit: 100 }
		const pages: EmailThreadPage[] = []
		const seenCursors = new Set<string>()
		let cursor: string | undefined
		let truncated = false
		const maxPages = 100
		for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
			const page = await this.threadsPage({ ...pageInput, ...(cursor ? { cursor } : {}) })
			pages.push(page)
			if (!page.nextCursor || page.nextCursor === cursor || seenCursors.has(page.nextCursor)) break
			seenCursors.add(page.nextCursor)
			cursor = page.nextCursor
			if (pageIndex === maxPages - 1) truncated = true
		}
		const threadByKey = new Map<string, EmailThreadPreview>()
		for (const page of pages) for (const thread of page.items) threadByKey.set(`${thread.accountId}:${thread.id}`, thread)
		let categories: Map<string, EmailTriageCategory> | undefined
		if (input.category) {
			categories = new Map<string, EmailTriageCategory>()
			let categoryCursor: string | undefined
			for (const page of pages) {
				const triage = await this.triage({ ...pageInput, ...(categoryCursor ? { cursor: categoryCursor } : {}) })
				for (const item of triage.items) categories.set(`${item.accountId}:${item.threadId}`, item.category)
				categoryCursor = page.nextCursor
				if (!categoryCursor) break
			}
		}
		const allThreads = [...threadByKey.values()]
		const matched = allThreads.filter((thread) => this.ruleMatches(thread, input, categories?.get(`${thread.accountId}:${thread.id}`)))
		const operations: EmailProcessingPlanOperation[] = []
		for (const action of rule.actions) {
			const byAccount = new Map<string, string[]>()
			for (const thread of matched) byAccount.set(thread.accountId, [...(byAccount.get(thread.accountId) ?? []), thread.id])
			for (const [accountId, threadIds] of byAccount) operations.push({ accountId, threadIds, kind: action.kind, ...(action.labelId ? { labelId: action.labelId } : {}), ...(action.value === undefined ? {} : { value: action.value }), ...(action.snoozeUntil ? { snoozeUntil: action.snoozeUntil } : {}), rationale: action.rationale ?? `规则：${rule.name}` })
		}
		const plan = operations.length ? await this.prepareProcessingPlan({ operations }) : undefined
		const lastRunAt = new Date().toISOString()
		const status = truncated ? "truncated" : matched.length === 0 ? "no-match" : "previewed"
		const auditEntry = await this.audit({ accountId: input.accountId ?? "all", operation: "run-email-rule", status: "completed", resourceId: rule.id, provider: "openbuddy-local", details: { scannedCount: allThreads.length, pagesScanned: pages.length, matchedCount: matched.length, operationCount: operations.length, truncated, ...(plan ? { planId: plan.id } : {}) } })
		const lastRun: EmailRuleRunSummary = { at: lastRunAt, scannedCount: allThreads.length, pagesScanned: pages.length, matchedCount: matched.length, operationCount: operations.length, status, ...(plan ? { planId: plan.id } : {}), auditId: auditEntry.id }
		await this.enqueue(async () => { const store = await readStore(); const current = store.rules.find((item) => item.id === rule.id); if (current) { current.lastRunAt = lastRunAt; current.lastRun = lastRun; current.updatedAt = lastRunAt }; await writeStore(store) })
		return { rule: { ...rule, lastRunAt, lastRun }, matchedThreadIds: matched.map((thread) => `${thread.accountId}:${thread.id}`), scannedCount: allThreads.length, pagesScanned: pages.length, matchedCount: matched.length, operationCount: operations.length, truncated, auditId: auditEntry.id, lastRun, ...(plan ? { plan } : {}) }
	}
	async sync(input: EmailSyncInput): Promise<EmailSyncResult> {
		const account = await this.requireConnectedAccount(input.accountId)
		if (account.capabilities.sync !== true) throw new EmailError("operation_not_supported", "当前邮箱账户不支持原生增量同步")
		const provider = this.getProvider()
		if (!provider.sync) throw new EmailError("operation_not_supported", "当前邮箱 provider 不支持原生增量同步")
		const startedAt = new Date().toISOString()
		const syncing: EmailSyncState = { accountId: input.accountId, provider: provider.name, status: "syncing", startedAt }
		await this.saveSyncState(syncing)
		try {
			const result = await this.enqueue(() => provider.sync!(input))
			const completedAt = new Date().toISOString()
			const state: EmailSyncResult = { ...result, accountId: input.accountId, provider: result.provider || provider.name, status: "synced", startedAt, completedAt, lastSyncedAt: completedAt }
			await this.saveSyncState(state)
			await this.audit({ accountId: input.accountId, operation: "sync", status: "completed", provider: state.provider })
			return state
		} catch (cause) {
			const error = cause instanceof EmailError ? cause : new EmailError("operation_failed", cause instanceof Error ? cause.message : "邮箱同步失败")
			const failed: EmailSyncState = { ...syncing, status: error.code === "provider_unavailable" && /重新授权/i.test(error.message) ? "reauthorization-required" : "failed", error: error.message.slice(0, 240), ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }) }
			await this.saveSyncState(failed)
			await this.audit({ accountId: input.accountId, operation: "sync", status: "failed", provider: provider.name, error: failed.error })
			throw error
		}
	}
	async syncStates(accountId?: string): Promise<EmailSyncState[]> {
		await this.queue
		return (await readStore()).syncStates.filter((state) => !accountId || state.accountId === accountId).sort((left, right) => (right.completedAt ?? right.startedAt ?? "").localeCompare(left.completedAt ?? left.startedAt ?? ""))
	}
	private async saveSyncState(state: EmailSyncState): Promise<void> {
		await this.enqueue(async () => {
			const store = await readStore()
			store.syncStates = [state, ...store.syncStates.filter((item) => item.accountId !== state.accountId)].slice(0, 100)
			await writeStore(store)
		})
	}
	async threads(input: EmailSearchInput = {}): Promise<EmailThreadPreview[]> {
		return this.applyWorkspaceTagFilter(await this.applySenderPolicies(await this.getProvider().threads(input)), input)
	}
	async threadsPage(input: EmailSearchInput = {}): Promise<EmailThreadPage> {
		const provider = this.getProvider()
		const page = provider.threadsPage ? await provider.threadsPage(input) : { items: await provider.threads(input) }
		const items = await this.applyWorkspaceTagFilter(await this.applySenderPolicies(page.items), input)
		return { items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) }
	}
	private async replyZeroSnapshot(input: EmailSearchInput = {}): Promise<EmailReplyZeroSnapshot> {
		const [accounts, page] = await Promise.all([this.accounts(), this.threadsPage({ folder: "inbox", limit: 50, ...input })])
		const accountById = new Map(accounts.map((item) => [item.id, item]))
		const items = (await Promise.allSettled(page.items.map(async (preview) => {
			const detail = await this.thread(preview.accountId, preview.id)
			const account = accountById.get(preview.accountId)
			const accountAddress = account?.address.toLowerCase()
			const messages = [...detail.messages].sort((left, right) => left.date.localeCompare(right.date))
			const latest = messages.at(-1)
			if (!latest) return undefined
			const latestFrom = latest.from.address.toLowerCase()
			const isOutgoing = Boolean(accountAddress && latestFrom === accountAddress)
			const isAddressedToAccount = Boolean(accountAddress && [...latest.to, ...latest.cc].some((recipient) => recipient.address.toLowerCase() === accountAddress))
			const category: EmailReplyZeroCategory = !isOutgoing && isAddressedToAccount ? "needs_reply" : isOutgoing ? "waiting_for_reply" : "no_action"
			const reason = category === "needs_reply" ? "最新邮件来自他人且收件人包含当前账户" : category === "waiting_for_reply" ? "最新邮件由当前账户发出，尚未看到后续回复" : "最新邮件不需要当前账户立即处理"
			return { category, accountId: preview.accountId, threadId: preview.id, subject: preview.subject, sender: latest.from, date: latest.date, snippet: preview.snippet, reason } satisfies EmailReplyZeroItem
		})) ).flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : [])
		return { generatedAt: new Date().toISOString(), items, needsReply: items.filter((item) => item.category === "needs_reply"), waitingForReply: items.filter((item) => item.category === "waiting_for_reply"), noAction: items.filter((item) => item.category === "no_action") }
	}
	async replyZero(input: EmailSearchInput = {}): Promise<EmailReplyZeroSnapshot> { return this.replyZeroSnapshot(input) }
	async inboxReceipts(): Promise<EmailInboxReceipt[]> {
		await this.queue
		return (await readStore()).inboxReceipts.map((receipt) => ({ ...receipt }))
	}
	async acknowledgeInbox(accountId: string, threadId: string, messageDate?: string): Promise<EmailInboxReceipt> {
		if (!accountId.trim() || !threadId.trim()) throw new EmailError("invalid_input", "邮件收件箱回执必须包含 accountId 和 threadId")
		if (messageDate !== undefined && !Number.isFinite(Date.parse(messageDate))) throw new EmailError("invalid_input", "邮件收件箱回执的 messageDate 无效")
		const receipt = { accountId, threadId, ...(messageDate ? { messageDate } : {}), acknowledgedAt: new Date().toISOString() }
		await this.enqueue(async () => {
			const store = await readStore()
			store.inboxReceipts = [receipt, ...store.inboxReceipts.filter((item) => !(item.accountId === accountId && item.threadId === threadId))].slice(0, 2000)
			await writeStore(store)
		})
		await this.audit({ accountId, operation: "inbox-ack", status: "completed", resourceId: threadId, provider: "openbuddy-local" })
		return receipt
	}

	/**
	 * Aggregate inbox contacts with privacy controls. Walks message headers only
	 * (no bodies, no subjects) and projects frequency + recency stats. Personal
	 * addresses can be masked, opt-out domains excluded, and per-account scoping
	 * applied. Composer / CRM integrations should prefer this over free-form
	 * inbox search so PII stays constrained.
	 */
	async projectContacts(options: EmailContactProjectionOptions = {}): Promise<EmailContactProjectionSnapshot> {
		const { accountId, folder = "inbox", includeDomains, excludeDomains, includeRoles, since, until, limit = 200, maskPersonalAddresses = true, returnRawAddresses = false } = options
		const safeLimit = Math.min(Math.max(limit, 1), 1000)
		const sinceMs = since ? Date.parse(since) : undefined
		const untilMs = until ? Date.parse(until) : undefined
		const includeSet = includeDomains?.length ? new Set(includeDomains.map((entry) => entry.toLowerCase())) : null
		const excludeSet = new Set((excludeDomains ?? []).map((entry) => entry.toLowerCase()))
		const accounts = await this.accounts()
		const ownerEmails = new Set(accounts.filter((entry) => !accountId || entry.id === accountId).map((entry) => entry.address.toLowerCase()))
		const roleSet = includeRoles?.length ? new Set(includeRoles) : new Set<EmailContactRole>(["from", "to", "cc", "bcc"])
		const searchInput: EmailSearchInput = { folder, limit: Math.min(safeLimit * 2, 500), ...(accountId ? { accountId } : {}), ...(since ? { since } : {}), ...(until ? { until } : {}) }
		const threads = await this.threadsPage(searchInput)
		const analyses = await this.listAnalyses(accountId ? { accountId } : undefined)
		const analysisByThread = new Map<string, string[]>()
		for (const record of analyses) {
			const list = analysisByThread.get(record.threadId) ?? []
			list.push(record.id)
			analysisByThread.set(record.threadId, list)
		}
		const contactByEmail = new Map<string, EmailContactRecord>()
		for (const thread of threads.items) {
			const detail = await this.thread(thread.accountId, thread.id).catch(() => null)
			if (!detail) continue
			for (const message of detail.messages) {
				const messageMs = Date.parse(message.date)
				if (sinceMs !== undefined && (!Number.isFinite(messageMs) || messageMs < sinceMs)) continue
				if (untilMs !== undefined && (!Number.isFinite(messageMs) || messageMs > untilMs)) continue
				const candidates: Array<{ role: EmailContactRole; address: EmailAddress }> = []
				if (roleSet.has("from")) candidates.push({ role: "from", address: message.from })
				if (roleSet.has("to")) for (const recipient of message.to) candidates.push({ role: "to", address: recipient })
				if (roleSet.has("cc")) for (const recipient of message.cc) candidates.push({ role: "cc", address: recipient })
				if (roleSet.has("bcc")) for (const recipient of (message.bcc ?? [])) candidates.push({ role: "bcc", address: recipient })
				for (const candidate of candidates) {
					const raw = candidate.address.address.trim().toLowerCase()
					if (!raw) continue
					if (ownerEmails.has(raw)) continue
					const atIndex = raw.indexOf("@")
					const domain = atIndex > 0 ? raw.slice(atIndex + 1) : ""
					if (includeSet && !includeSet.has(domain)) continue
					if (excludeSet.has(domain)) continue
					const existing = contactByEmail.get(raw)
					if (existing) {
						existing.roleCounts[candidate.role] = (existing.roleCounts[candidate.role] ?? 0) + 1
						existing.interactionCount += 1
						if (messageMs > Date.parse(existing.lastInteractionAt)) existing.lastInteractionAt = message.date
						if (messageMs < Date.parse(existing.firstInteractionAt)) existing.firstInteractionAt = message.date
						if (!existing.accountIds.includes(thread.accountId)) existing.accountIds.push(thread.accountId)
						if (!existing.linkedThreadIds.includes(thread.id)) existing.linkedThreadIds.push(thread.id)
						if (!existing.name && candidate.address.name) existing.name = candidate.address.name
					} else {
						contactByEmail.set(raw, {
							email: returnRawAddresses ? candidate.address.address : raw,
							name: candidate.address.name,
							roleCounts: { [candidate.role]: 1 },
							interactionCount: 1,
							firstInteractionAt: message.date,
							lastInteractionAt: message.date,
							accountIds: [thread.accountId],
							linkedThreadIds: [thread.id],
							linkedAnalysisIds: analysisByThread.get(thread.id) ?? [],
						})
					}
				}
			}
		}
		const personalAddress = /@(gmail|yahoo|outlook|hotmail|icloud|qq|163|126|sina|sohu|aliyun|foxmail)\./i
		let personalMasked = 0
		const contacts = [...contactByEmail.values()]
			.sort((left, right) => right.interactionCount - left.interactionCount || right.lastInteractionAt.localeCompare(left.lastInteractionAt))
			.slice(0, safeLimit)
			.map((contact) => {
				if (!maskPersonalAddresses) return contact
				const atIndex = contact.email.indexOf("@")
				const domain = atIndex > 0 ? contact.email.slice(atIndex + 1) : ""
				if (personalAddress.test(`@${domain}`)) {
					personalMasked += 1
					const local = contact.email.slice(0, atIndex)
					const visible = local.slice(0, Math.min(2, local.length))
					const masked = `${visible}${"*".repeat(Math.max(local.length - visible.length, 1))}@${domain}`
					return { ...contact, maskedEmail: masked }
				}
				return contact
			})
		const snapshot: EmailContactProjectionSnapshot = {
			generatedAt: new Date().toISOString(),
			...(accountId ? { accountId } : {}),
			total: contactByEmail.size,
			returned: contacts.length,
			truncatedByLimit: contactByEmail.size > contacts.length,
			personalAddressesMasked: personalMasked,
			contacts,
		}
		await this.audit({ accountId: accountId ?? "global", operation: "contact-projection", status: "completed", provider: "openbuddy-local", details: { total: String(snapshot.total), returned: String(snapshot.returned), masked: String(personalMasked) } })
		return snapshot
	}

	async digest(input: EmailSearchInput = {}): Promise<EmailDigestSnapshot> {
		const [snapshot, page] = await Promise.all([this.replyZeroSnapshot({ folder: "inbox", limit: 50, ...input }), this.threadsPage({ folder: "inbox", limit: 50, ...input })])
		return { generatedAt: snapshot.generatedAt, ...(input.accountId ? { accountId: input.accountId } : {}), total: page.items.length, unread: page.items.filter((item) => item.unread).length, needsReply: snapshot.needsReply, waitingForReply: snapshot.waitingForReply, highlights: page.items.filter((item) => item.unread || item.starred || item.labels.some((label) => /important|signal/i.test(label))).slice(0, 10) }
	}
	async triage(input: EmailSearchInput = {}): Promise<EmailTriageSnapshot> {
		const scopedInput = { folder: "inbox" as const, limit: Math.min(input.limit ?? 50, 100), ...input }
		const [replyZero, page] = await Promise.all([this.replyZeroSnapshot(scopedInput), this.threadsPage(scopedInput)])
		const replyByThread = new Map(replyZero.items.map((item) => [`${item.accountId}:${item.threadId}`, item.category]))
		const now = Date.now()
		const items = page.items.map((thread) => {
			const key = `${thread.accountId}:${thread.id}`
			const replyCategory = replyByThread.get(key)
			const reasons: string[] = []
			let score = 20
			if (thread.unread) { score += 25; reasons.push("未读") }
			if (thread.starred) { score += 15; reasons.push("已加星标") }
			if (thread.labels.some((label) => /important|priority|signal/i.test(label))) { score += 20; reasons.push("重要或 Signal 标签") }
			if (thread.attachments) { score += 5; reasons.push("包含附件") }
			if (Date.parse(thread.date) >= now - 24 * 60 * 60 * 1000) { score += 10; reasons.push("最近 24 小时") }
			if (thread.labels.some((label) => /noise|spam|promotion/i.test(label))) { score -= 40; reasons.push("Noise/促销标签") }
			if (replyCategory === "needs_reply") { score += 25; reasons.push("待我回复") }
			if (replyCategory === "waiting_for_reply") { score -= 5; reasons.push("等待对方") }
			const category: EmailTriageCategory = thread.labels.some((label) => /noise|spam|promotion/i.test(label)) ? "noise" : replyCategory === "needs_reply" && score >= 75 ? "urgent" : replyCategory === "needs_reply" ? "needs-reply" : replyCategory === "waiting_for_reply" ? "waiting-for-reply" : score >= 60 ? "urgent" : "normal"
			return { accountId: thread.accountId, threadId: thread.id, subject: thread.subject, sender: thread.from, date: thread.date, category, score: Math.max(0, Math.min(100, score)), reasons, unread: thread.unread, ...(thread.starred === undefined ? {} : { starred: thread.starred }), labels: thread.labels }
		}).sort((left, right) => right.score - left.score || right.date.localeCompare(left.date))
		const counts: Record<EmailTriageCategory, number> = { urgent: 0, "needs-reply": 0, "waiting-for-reply": 0, noise: 0, normal: 0 }
		for (const item of items) counts[item.category] += 1
		return { generatedAt: new Date().toISOString(), total: items.length, items, counts }
	}

	/**
	 * Unified AI action center query — combines triage + reply-zero + saved
	 * analyses + workspace tags into a single read-only snapshot the Pi Agent
	 * can use to answer "what should I do next?" without chaining tools.
	 */
	async actionCenterQuery(input: EmailActionCenterQueryInput = {}): Promise<EmailActionCenterSnapshot> {
		const { accountId, folder, categories, reviewStates, owner, dueBefore, senderDomain, workspaceTagIds, query, limit = 50, cursor } = input
		const safeFolder: EmailFolder = (folder as EmailFolder | undefined) ?? "inbox"
		const safeLimit = Math.min(Math.max(limit, 1), 200)
		const triageInput: EmailSearchInput = { folder: safeFolder, limit: safeLimit, ...(accountId ? { accountId } : {}), ...(query ? { query } : {}), ...(cursor ? { cursor } : {}) }
		const [triage, replyZero, analyses, store] = await Promise.all([
			this.triage(triageInput),
			this.replyZeroSnapshot(triageInput),
			this.listAnalyses(accountId ? { accountId } : undefined),
			readStore(),
		])
		const replyByThread = new Map(replyZero.items.map((item) => [`${item.accountId}:${item.threadId}`, item]))
		const analysesByThread = new Map<string, EmailAnalysisRecord[]>()
		for (const record of analyses) {
			if (!accountId || record.accountId === accountId) {
				const list = analysesByThread.get(record.threadId) ?? []
				list.push(record)
				analysesByThread.set(record.threadId, list)
			}
		}
		const tagsByThread = new Map<string, string[]>()
		for (const link of store.threadTags) {
			if (accountId && link.accountId !== accountId) continue
			const list = tagsByThread.get(link.threadId) ?? []
			list.push(link.tagId)
			tagsByThread.set(link.threadId, list)
		}
		const categorySet = categories && categories.length > 0 ? new Set(categories) : null
		const reviewSet = reviewStates && reviewStates.length > 0 ? new Set(reviewStates) : null
		const tagSet = workspaceTagIds && workspaceTagIds.length > 0 ? new Set(workspaceTagIds) : null
		const dueBeforeMs = dueBefore ? Date.parse(dueBefore) : undefined
		const senderDomainLower = senderDomain?.toLowerCase()
		const entries: EmailActionCenterEntry[] = []
		let filtered = 0
		for (const item of triage.items) {
			if (categorySet && !categorySet.has(item.category)) continue
			if (senderDomainLower) {
				const domain = item.sender.address.split("@")[1]?.toLowerCase() ?? ""
				if (domain !== senderDomainLower) continue
			}
			const threadAnalyses = analysesByThread.get(item.threadId) ?? []
			if (reviewSet) {
				const matches = threadAnalyses.some((record) => reviewSet.has(record.review))
				if (!matches) continue
			}
			if (owner) {
				const ownerMatch = threadAnalyses.some((record) => (record.actions ?? []).some((action) => (action.owner ?? "").toLowerCase().includes(owner.toLowerCase())))
				if (!ownerMatch) continue
			}
			if (dueBeforeMs !== undefined) {
				const dueMatch = threadAnalyses.some((record) => (record.actions ?? []).some((action) => action.dueAt && Date.parse(action.dueAt) <= dueBeforeMs))
				if (!dueMatch) continue
			}
			const tagIds = tagsByThread.get(item.threadId) ?? []
			if (tagSet) {
				const overlap = tagIds.some((tagId) => tagSet.has(tagId))
				if (!overlap) continue
			}
			filtered += 1
			const reply = replyByThread.get(`${item.accountId}:${item.threadId}`)
			entries.push({
				accountId: item.accountId,
				threadId: item.threadId,
				subject: item.subject,
				sender: item.sender,
				date: item.date,
				category: item.category,
				score: item.score,
				reasons: item.reasons,
				...(reply ? { replyCategory: reply.category, replyReason: reply.reason } : {}),
				savedAnalyses: threadAnalyses.map((record) => ({
					id: record.id,
					kind: record.kind,
					confidence: record.confidence,
					review: record.review,
					...(record.summary ? { summary: record.summary } : {}),
					actionCount: record.actions?.length ?? 0,
					generatedAt: record.generatedAt,
				})),
				workspaceTagIds: tagIds,
				unread: item.unread,
				...(item.starred === undefined ? {} : { starred: item.starred }),
			})
		}
		const byCategory: Record<EmailTriageCategory, number> = { urgent: 0, "needs-reply": 0, "waiting-for-reply": 0, noise: 0, normal: 0 }
		const byReplyCategory: Record<EmailReplyZeroCategory, number> = { needs_reply: 0, waiting_for_reply: 0, no_action: 0 }
		let withPending = 0
		let withAccepted = 0
		for (const entry of entries) {
			byCategory[entry.category] += 1
			if (entry.replyCategory) byReplyCategory[entry.replyCategory] += 1
			for (const analysis of entry.savedAnalyses) {
				if (analysis.review === "pending") withPending += 1
				if (analysis.review === "accepted") withAccepted += 1
			}
		}
		const filtersApplied: EmailActionCenterSnapshot["filtersApplied"] = {}
		if (accountId) filtersApplied.accountId = accountId
		if (categories && categories.length > 0) filtersApplied.categories = categories
		if (reviewStates && reviewStates.length > 0) filtersApplied.reviewStates = reviewStates
		if (owner) filtersApplied.owner = owner
		if (dueBefore) filtersApplied.dueBefore = dueBefore
		if (senderDomain) filtersApplied.senderDomain = senderDomain
		if (workspaceTagIds && workspaceTagIds.length > 0) filtersApplied.workspaceTagIds = workspaceTagIds
		const snapshot: EmailActionCenterSnapshot = {
			generatedAt: new Date().toISOString(),
			total: triage.total,
			filtered,
			entries,
			counts: { byCategory, byReplyCategory, withPendingAnalyses: withPending, withAcceptedAnalyses: withAccepted },
			filtersApplied,
		}
		await this.audit({ accountId: accountId ?? "global", operation: "action-center-query", status: "completed", provider: "openbuddy-local", details: { filtered: String(filtered), total: String(triage.total) } })
		return snapshot
	}

	/**
	 * Bulk reminder creation from an action-center query. Applies the same
	 * filters as actionCenterQuery, then creates one follow-up reminder per
	 * matching analysis action that has a future dueAt. Idempotent (skips
	 * reminders already linked to the analysis action), one confirmation for
	 * the whole batch, and dry-run support.
	 */
	async actionCenterCreateReminders(input: EmailActionCenterReminderInput = {}): Promise<EmailActionCenterReminderResult> {
		const { accountId, categories, owner, dueBefore, senderDomain, workspaceTagIds, confirmed = false, dryRun = false } = input
		const snapshot = await this.actionCenterQuery({ accountId, categories, owner, dueBefore, senderDomain, workspaceTagIds })
		const analysisIds = [...new Set(snapshot.entries.flatMap((entry) => entry.savedAnalyses.filter((analysis) => analysis.kind === "actions").map((analysis) => analysis.id)))]
		const now = Date.now()
		const created: EmailActionCenterReminderItem[] = []
		const skipped: Array<EmailActionCenterReminderItem & { reason: string }> = []
		let matchedAnalysisCount = 0
		if (!dryRun) await this.requireConfirmation("批量创建跟进提醒", `确认将 ${analysisIds.length} 个分析的行动项创建为跟进提醒？`, confirmed === true)
		for (const analysisId of analysisIds) {
			const before = await readStore()
			const target = before.analyses.find((item) => item.id === analysisId)
			if (!target || target.kind !== "actions" || target.review === "dismissed") continue
			matchedAnalysisCount += 1
			for (const [index, action] of target.actions.entries()) {
				const dueAt = action.dueAt
				if (!dueAt || !Number.isFinite(Date.parse(dueAt)) || Date.parse(dueAt) <= now) {
					skipped.push({ analysisId, threadId: target.threadId, accountId: target.accountId, actionIndex: index, content: action.content, ...(action.owner ? { owner: action.owner } : {}), dueAt: dueAt ?? "", reason: "缺少未来的有效 dueAt" })
					continue
				}
				const existing = before.reminders.find((item) => item.analysisId === target.id && item.actionIndex === index)
				if (existing) {
					created.push({ analysisId: target.id, threadId: target.threadId, accountId: target.accountId, actionIndex: index, content: action.content, ...(action.owner ? { owner: action.owner } : {}), dueAt, receipt: existing.id })
					continue
				}
				if (dryRun) {
					created.push({ analysisId: target.id, threadId: target.threadId, accountId: target.accountId, actionIndex: index, content: action.content, ...(action.owner ? { owner: action.owner } : {}), dueAt })
					continue
				}
				const reminder = { id: id("email-reminder"), accountId: target.accountId, threadId: target.threadId, description: `邮件行动项：${action.content}${action.owner ? `；负责人：${action.owner}` : ""}`, remindAt: dueAt, analysisId: target.id, actionIndex: index }
				const next = await readStore()
				next.reminders = [reminder, ...next.reminders].slice(0, 500)
				await writeStore(next)
				created.push({ analysisId: target.id, threadId: target.threadId, accountId: target.accountId, actionIndex: index, content: action.content, ...(action.owner ? { owner: action.owner } : {}), dueAt, receipt: reminder.id })
			}
			if (!dryRun) {
				const next = await readStore()
				const current = next.analyses.find((item) => item.id === analysisId)
				if (current) {
					const ids = created.filter((item) => item.analysisId === analysisId && item.receipt).map((item) => item.receipt!).filter((value): value is string => Boolean(value))
					current.linkedReminderIds = [...new Set([...(current.linkedReminderIds ?? []), ...ids])]
					current.review = "accepted"
					current.reviewedAt = new Date().toISOString()
					await writeStore(next)
				}
			}
		}
		const result: EmailActionCenterReminderResult = {
			generatedAt: new Date().toISOString(),
			dryRun,
			requiresConfirmation: !confirmed,
			matchedAnalysisCount,
			matchedActionCount: created.length + skipped.length,
			created,
			skipped,
		}
		if (!dryRun) await this.audit({ accountId: accountId ?? "global", operation: "action-center-create-reminders", status: "completed", provider: "openbuddy-local", details: { created: String(created.length), skipped: String(skipped.length), analyses: String(matchedAnalysisCount) } })
		return result
	}

	async thread(accountId: string, threadId: string): Promise<EmailThread> {
		const thread = await this.getProvider().thread(accountId, threadId)
		const store = await readStore()
		const tagIds = store.threadTags.filter((entry) => entry.accountId === accountId && entry.threadId === threadId).map((entry) => entry.tagId)
		const tags = store.tags.filter((tag) => tagIds.includes(tag.id)).map((tag) => tag.name)
		return tags.length ? { ...thread, tags } : thread
	}
	async drafts(accountId?: string): Promise<EmailDraft[]> {
		await this.queue
		const store = await readStore()
		return store.drafts
			.filter((draft) => draft.status === "draft" && (!accountId || draft.accountId === accountId))
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
	}
	async labels(accountId: string): Promise<EmailLabel[]> { return this.getProvider().labels(accountId) }
	async workspaceTags(): Promise<EmailWorkspaceTag[]> { await this.queue; return (await readStore()).tags }
	async updateWorkspaceTags(input: EmailTagMutationInput): Promise<EmailWorkspaceTag[]> {
		const names = [...new Set(input.tagNames.map((name) => name.trim()).filter(Boolean))].slice(0, 20)
		await this.requireConnectedAccount(input.accountId)
		const now = new Date().toISOString()
		await this.enqueue(async () => {
			const store = await readStore()
			const tags = [...store.tags]
			const ids = names.map((name) => {
				const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase())
				if (existing) return existing.id
				const created = { id: id("email-tag"), name, color: "#6da9ff", scope: "personal" as const, createdAt: now }
				tags.push(created)
				return created.id
			})
			const current = store.threadTags.filter((entry) => entry.accountId === input.accountId && entry.threadId === input.threadId)
			const nextIds = input.mode === "remove" ? current.map((entry) => entry.tagId).filter((tagId) => !ids.includes(tagId)) : input.mode === "replace" ? ids : [...new Set([...current.map((entry) => entry.tagId), ...ids])]
			store.tags = tags
			store.threadTags = [...store.threadTags.filter((entry) => !(entry.accountId === input.accountId && entry.threadId === input.threadId)), ...nextIds.map((tagId) => ({ accountId: input.accountId, threadId: input.threadId, tagId, updatedAt: now }))]
			await writeStore(store)
		})
		await this.audit({ accountId: input.accountId, operation: `workspace-tags:${input.mode ?? "add"}`, status: "completed", resourceId: input.threadId, provider: "openbuddy-local" })
		return this.workspaceTags()
	}
	async setSenderPolicy(input: EmailSenderPolicyInput, bypassConfirmation = false): Promise<EmailMutationResult> {
		const provider = this.getProvider();
		if (input.policy === "block") await this.requireConfirmation("阻断发件人", `确认阻断 ${input.senderEmail} 的后续邮件？`, bypassConfirmation)
		const updatedAt = new Date().toISOString()
		await this.enqueue(async () => { const store = await readStore(); store.senderPolicies = [...store.senderPolicies.filter((entry) => !(entry.senderEmail.toLowerCase() === input.senderEmail.toLowerCase() && entry.accountId === input.accountId)), { accountId: input.accountId, senderEmail: input.senderEmail.toLowerCase(), policy: input.policy, updatedAt }]; await writeStore(store) })
		try {
			if (provider.setSenderPolicy) {
				const result = await this.enqueue(() => provider.setSenderPolicy!(input))
				await this.audit({ accountId: input.accountId ?? "unknown", operation: result.operation, status: result.ok ? "completed" : "failed", resourceId: input.threadId, provider: result.provider })
				return result
			}
		} catch (error) {
			await this.audit({ accountId: input.accountId ?? "unknown", operation: `sender-policy:${input.policy}`, status: "failed", resourceId: input.threadId, provider: provider.name, error: error instanceof Error ? error.message.slice(0, 240) : "provider failure" })
		}
		const result = { ok: true, provider: "openbuddy-local", operation: `sender-policy:${input.policy}`, threadId: input.threadId, receipt: id("local-policy") }
		await this.audit({ accountId: input.accountId ?? "unknown", operation: result.operation, status: "completed", resourceId: input.threadId, provider: result.provider })
		return result
	}
	async unsubscribe(input: EmailUnsubscribeInput, bypassConfirmation = false): Promise<EmailUnsubscribeResult> {
		const provider = this.getProvider()
		if (!input.accountId || !input.messageId) throw new EmailError("invalid_input", "退订必须指定账户和消息")
		await this.requireConfirmation("退订邮件列表", "确认调用邮箱 provider 的退订操作？这可能会影响后续邮件接收。", bypassConfirmation)
		if (!provider.unsubscribe) throw new EmailError("operation_not_supported", "当前邮箱 provider 不支持退订")
		try {
			const result = await this.enqueue(() => provider.unsubscribe!(input))
			await this.audit({ accountId: input.accountId, operation: "unsubscribe", status: result.ok ? "completed" : "failed", resourceId: input.messageId, provider: result.provider })
			return result
		} catch (error) {
			await this.audit({ accountId: input.accountId, operation: "unsubscribe", status: "failed", resourceId: input.messageId, provider: provider.name, error: error instanceof Error ? error.message.slice(0, 240) : "provider failure" })
			throw error
		}
	}
	async shareThread(input: EmailShareInput): Promise<EmailMutationResult> {
		const provider = this.getProvider();
		const createdAt = new Date().toISOString()
		await this.enqueue(async () => { const store = await readStore(); store.shares = [{ id: id("email-share"), ...input, createdAt }, ...store.shares].slice(0, 500); await writeStore(store) })
		const collaboration = this.ctx.get("collaborationRuntime") as { shareEmailThread?: (share: { accountId: string; threadId: string; channelId: string; subject?: string; message?: string }) => { eventId: string } } | undefined
		collaboration?.shareEmailThread?.({ accountId: input.accountId, threadId: input.threadId, channelId: input.channelId, message: input.message })
			if (provider.shareThread) {
				try {
					const result = await this.enqueue(() => provider.shareThread!(input))
					await this.audit({ accountId: input.accountId, operation: result.operation, status: result.ok ? "completed" : "failed", resourceId: input.threadId, provider: result.provider })
					return result
				} catch { }
			}
		await this.notify("邮件线程已分享", `${input.threadId} 已分享至协作频道 ${input.channelId}`)
		return { ok: true, provider: "openbuddy-local", operation: "share-thread", threadId: input.threadId, receipt: id("local-share") }
	}
	async createReminder(input: EmailReminderInput): Promise<EmailMutationResult> {
		const provider = this.getProvider();
		if (!Number.isFinite(Date.parse(input.remindAt))) throw new EmailError("invalid_input", "提醒时间必须是有效的 RFC3339 时间")
		const reminder = { id: id("email-reminder"), ...input }
		await this.enqueue(async () => { const store = await readStore(); store.reminders = [reminder, ...store.reminders].slice(0, 500); await writeStore(store) })
		if (provider.createReminder) {
			try {
				const result = await this.enqueue(() => provider.createReminder!(input))
				await this.audit({ accountId: input.accountId, operation: result.operation, status: result.ok ? "completed" : "failed", resourceId: input.threadId, provider: result.provider })
				return result
			} catch { }
		}
		await this.notify("邮件跟进提醒已创建", `${input.description} · ${input.remindAt}`)
		return { ok: true, provider: "openbuddy-local", operation: "create-reminder", threadId: input.threadId, receipt: reminder.id }
	}
	async moveToProject(input: EmailProjectLinkInput): Promise<EmailMutationResult> {
		const provider = this.getProvider();
		await this.enqueue(async () => {
			const store = await readStore()
			const remaining = store.projects.filter((entry) => !(entry.accountId === input.accountId && entry.threadId === input.threadId))
			store.projects = input.projectId ? [...remaining, { ...input, projectId: input.projectId, updatedAt: new Date().toISOString() }] : remaining
			await writeStore(store)
		})
		if (provider.moveToProject) {
			try {
				const result = await this.enqueue(() => provider.moveToProject!(input))
				await this.audit({ accountId: input.accountId, operation: result.operation, status: result.ok ? "completed" : "failed", resourceId: input.threadId, provider: result.provider })
				return result
			} catch { }
		}
		return { ok: true, provider: "openbuddy-local", operation: "move-to-project", threadId: input.threadId, receipt: id("local-project") }
	}
	async projectThreads(projectId: string, limit = 50): Promise<EmailProjectThread[]> {
		const normalizedProjectId = projectId.trim()
		if (!normalizedProjectId) throw new EmailError("invalid_input", "项目 ID 不能为空")
		if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new EmailError("invalid_input", "项目邮件数量必须是 1 到 100")
		await this.queue
		const store = await readStore()
		const links = store.projects.filter((entry) => entry.projectId === normalizedProjectId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, limit)
		const results = await Promise.all(links.map(async (link) => {
			try {
				const thread = await this.thread(link.accountId, link.threadId)
				const first = thread.messages[0]
				return { accountId: link.accountId, threadId: link.threadId, projectId: normalizedProjectId, subject: thread.subject, from: first?.from ?? { address: "unknown" }, date: first?.date ?? link.updatedAt, unread: thread.messages.some((message) => message.unread), messageCount: thread.messages.length, ...(thread.tags?.length ? { tags: thread.tags } : {}) }
			} catch { return undefined }
		}))
		return results.filter((item): item is EmailProjectThread => Boolean(item))
	}
	private async notify(title: string, body: string): Promise<void> { const notification = this.ctx.get("notification") as { append?: (kind: string, title: string, body?: string, sessionId?: string, severity?: string) => Promise<unknown> } | undefined; if (notification?.append) await notification.append("info", title, body, undefined, "info") }
	private async dispatchDueReminders(): Promise<void> { const now = Date.now(); const due = await this.enqueue(async () => { const store = await readStore(); const pending = store.reminders.filter((reminder) => !reminder.notifiedAt && Date.parse(reminder.remindAt) <= now); if (!pending.length) return []; const notifiedAt = new Date(now).toISOString(); const ids = new Set(pending.map((reminder) => reminder.id)); store.reminders = store.reminders.map((reminder) => ids.has(reminder.id) ? { ...reminder, notifiedAt } : reminder); await writeStore(store); return pending }); for (const reminder of due) await this.notify("邮件跟进提醒", reminder.description) }
	private async dispatchDueScheduledSends(): Promise<void> {
		const due = await this.enqueue(async () => { const store = await readStore(); return store.scheduledSends.filter((item) => item.status === "scheduled" && Date.parse(item.scheduledAt) <= Date.now()) })
		for (const record of due) {
			if (this.scheduledSendRuns.has(record.id)) continue
			this.scheduledSendRuns.add(record.id)
			try {
				const store = await readStore(); const draft = store.drafts.find((item) => item.id === record.draftId && item.status === "draft")
				if (!draft || draftFingerprint(draft) !== record.fingerprint) throw new EmailError("confirmation_required", "计划发送草稿内容已变化，已阻止发送")
				await this.sendAuthorizedDraft(draft, "scheduled-send", record.sideEffectIntentId)
				await this.enqueue(async () => { const next = await readStore(); const item = next.scheduledSends.find((entry) => entry.id === record.id); if (item) item.status = "sent"; await writeStore(next) })
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				await this.enqueue(async () => { const next = await readStore(); const item = next.scheduledSends.find((entry) => entry.id === record.id); if (item) { item.status = "failed"; item.error = message.slice(0, 240) }; await writeStore(next) })
				await this.audit({ accountId: record.accountId, operation: "scheduled-send", status: "failed", resourceId: record.draftId, provider: this.getProvider().name, error: message })
			} finally {
				this.scheduledSendRuns.delete(record.id)
			}
		}
	}
	async listAttachments(accountId: string, messageId: string): Promise<EmailAttachment[]> {
		const provider = this.getProvider();
		await this.requireAccountCapability(accountId, "attachments")
		if (!provider.listAttachments) throw new EmailError("operation_failed", "当前邮箱 provider 不支持附件读取");
		return provider.listAttachments(accountId, messageId);
	}
	async downloadAttachment(accountId: string, attachmentId: string, messageId: string, destinationDir?: string): Promise<EmailAttachmentDownload> {
		const provider = this.getProvider();
		await this.requireAccountCapability(accountId, "attachments")
		if (!provider.downloadAttachment) throw new EmailError("operation_failed", "当前邮箱 provider 不支持附件下载");
		if (!destinationDir || !path.isAbsolute(destinationDir)) throw new EmailError("invalid_input", "附件下载必须指定用户选择的本地目录");
		const result = await provider.downloadAttachment(accountId, attachmentId, messageId, destinationDir);
		let destinationRoot: string;
		let target: string;
		try {
			destinationRoot = await realpath(destinationDir);
			target = await realpath(result.localPath);
		} catch {
			throw new EmailError("operation_failed", "附件 provider 返回的目录或文件不可用");
		}
		const root = destinationRoot.endsWith(path.sep) ? destinationRoot : `${destinationRoot}${path.sep}`;
		if (target === destinationRoot || !target.startsWith(root)) throw new EmailError("operation_failed", "附件 provider 返回的路径超出用户选择的目录");
		return result;
	}
	async prepareProcessingPlan(input: EmailProcessingPlanInput): Promise<EmailProcessingPlan> {
		if (!Array.isArray(input.operations) || input.operations.length === 0 || input.operations.length > 20) throw new EmailError("invalid_input", "邮件处理计划必须包含 1 到 20 个操作")
		const operations = input.operations.map((operation) => {
			if (!operation || !operation.accountId || !Array.isArray(operation.threadIds) || operation.threadIds.length === 0 || operation.threadIds.length > 100) throw new EmailError("invalid_input", "邮件处理计划的账户和线程不能为空，单项最多 100 个线程")
			if (["trash", "spam"].includes(operation.kind)) throw new EmailError("invalid_input", "AI 处理计划禁止删除或标记垃圾邮件")
			if (operation.kind === "label" && !operation.labelId) throw new EmailError("invalid_input", "标签处理计划必须指定 labelId")
			return { ...operation, threadIds: [...new Set(operation.threadIds)], ...(operation.rationale ? { rationale: operation.rationale.slice(0, 500) } : {}) }
		})
		for (const operation of operations) await this.requireManagementOperation(operation.accountId, { accountId: operation.accountId, threadId: operation.threadIds[0]!, threadIds: operation.threadIds, kind: operation.kind, labelId: operation.labelId, value: operation.value, snoozeUntil: operation.snoozeUntil, dryRun: true })
		const previews = await Promise.all(operations.map((operation) => this.update({ accountId: operation.accountId, threadId: operation.threadIds[0]!, threadIds: operation.threadIds, kind: operation.kind, labelId: operation.labelId, value: operation.value, snoozeUntil: operation.snoozeUntil, dryRun: true, sampleLimit: 5 })))
		const now = Date.now()
		const plan: EmailProcessingPlan = { id: id("email-plan"), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + Math.min(Math.max(input.expiresInMs ?? 300_000, 30_000), 1_800_000)).toISOString(), status: "pending", operations, previews }
		await this.enqueue(async () => { const store = await readStore(); store.processingPlans = [plan, ...store.processingPlans.filter((item) => item.status === "pending")].slice(0, 100); await writeStore(store) })
		await this.audit({ accountId: operations[0]!.accountId, operation: "processing-plan", status: "requested", resourceId: plan.id, provider: this.getProvider().name })
		return plan
	}
	async confirmProcessingPlan(planId: string, bypassConfirmation = false): Promise<string> {
		await this.expireProcessingPlans()
		const store = await readStore()
		const plan = store.processingPlans.find((item) => item.id === planId)
		if (!plan || plan.status !== "pending") throw new EmailError("invalid_input", `处理计划不可确认: ${planId}`)
		if (Date.parse(plan.expiresAt) <= Date.now()) throw new EmailError("confirmation_required", "处理计划已过期，请重新生成预览")
		await this.requireConfirmation("执行 AI 邮件处理计划", `确认处理 ${plan.operations.reduce((total, operation) => total + operation.threadIds.length, 0)} 个线程？`, bypassConfirmation)
		const token = `email-plan:${randomUUID()}`
		this.processingPlanTokens.set(token, { planId, fingerprint: processingPlanFingerprint(plan.operations) })
		await this.audit({ accountId: plan.operations[0]!.accountId, operation: "processing-plan", status: "confirmed", resourceId: plan.id, provider: this.getProvider().name })
		return token
	}
	async executeProcessingPlan(planId: string, confirmationToken: string): Promise<EmailProcessingPlan> {
		await this.expireProcessingPlans()
		const token = this.processingPlanTokens.get(confirmationToken)
		if (!token || token.planId !== planId) throw new EmailError("confirmation_required", "处理计划必须先经过用户确认")
		this.processingPlanTokens.delete(confirmationToken)
		const store = await readStore()
		const plan = store.processingPlans.find((item) => item.id === planId)
		if (!plan || plan.status !== "pending") throw new EmailError("invalid_input", `处理计划不可执行: ${planId}`)
		if (Date.parse(plan.expiresAt) <= Date.now() || processingPlanFingerprint(plan.operations) !== token.fingerprint) throw new EmailError("confirmation_required", "处理计划已过期或内容已变化，请重新确认")
		const results: EmailMutationResult[] = []
		try {
			for (const operation of plan.operations) results.push(await this.update({ accountId: operation.accountId, threadId: operation.threadIds[0]!, threadIds: operation.threadIds, kind: operation.kind, labelId: operation.labelId, value: operation.value, snoozeUntil: operation.snoozeUntil }, true))
			plan.status = "executed"; plan.result = results
		} catch (cause) {
			plan.status = "failed"; plan.result = results; plan.error = (cause instanceof Error ? cause.message : String(cause)).slice(0, 240)
			await this.enqueue(async () => { const next = await readStore(); const item = next.processingPlans.find((entry) => entry.id === plan.id); if (item) Object.assign(item, plan); await writeStore(next) })
			throw cause
		}
		await this.enqueue(async () => { const next = await readStore(); const item = next.processingPlans.find((entry) => entry.id === plan.id); if (item) Object.assign(item, plan); await writeStore(next) })
		await this.audit({ accountId: plan.operations[0]!.accountId, operation: "processing-plan", status: "completed", resourceId: plan.id, provider: this.getProvider().name })
		return plan
	}
	async cancelProcessingPlan(planId: string): Promise<EmailProcessingPlan> {
		await this.expireProcessingPlans()
		const store = await readStore()
		const plan = store.processingPlans.find((item) => item.id === planId)
		if (!plan) throw new EmailError("invalid_input", `处理计划不存在: ${planId}`)
		if (plan.status !== "pending") throw new EmailError("invalid_input", `处理计划不可取消: ${planId}`)
		for (const token of [...this.processingPlanTokens.entries()]) if (token[1].planId === planId) this.processingPlanTokens.delete(token[0])
		plan.status = "cancelled"
		await this.enqueue(async () => { const next = await readStore(); const item = next.processingPlans.find((entry) => entry.id === planId); if (item) Object.assign(item, plan); await writeStore(next) })
		await this.audit({ accountId: plan.operations[0]?.accountId ?? "unknown", operation: "processing-plan-cancelled", status: "cancelled", resourceId: plan.id, provider: this.getProvider().name })
		return plan
	}
	async processingPlans(): Promise<EmailProcessingPlan[]> { await this.expireProcessingPlans(); await this.queue; return (await readStore()).processingPlans }
	async update(input: EmailMutationInput, bypassConfirmation = false): Promise<EmailMutationResult> { const provider = this.getProvider(); const threadIds = [...new Set(input.threadIds?.length ? input.threadIds : [input.threadId])]; if (input.kind === "trash" || input.kind === "spam") await this.requireConfirmation(input.kind === "trash" ? "删除邮件" : "标记垃圾邮件", `确认${input.kind === "trash" ? "删除" : "标记垃圾邮件"}线程 ${input.threadId}？`, bypassConfirmation); if (input.kind === "snooze") { if (!input.snoozeUntil || !Number.isFinite(Date.parse(input.snoozeUntil)) || Date.parse(input.snoozeUntil) <= Date.now()) throw new EmailError("invalid_input", "延后时间必须是未来的有效 RFC3339 时间"); } if (input.dryRun) return { ok: true, provider: provider.name, operation: input.kind, threadId: input.threadId, dryRun: true, matched: threadIds.length, sampleIds: threadIds.slice(0, Math.min(input.sampleLimit ?? 5, 20)) }; await this.requireManagementOperation(input.accountId, input); try { const result = await this.enqueue(() => provider.update({ ...input, threadIds })); await this.audit({ accountId: input.accountId, operation: input.kind, status: result.ok ? "completed" : "failed", resourceId: input.threadId, provider: provider.name }); return result; } catch (error) { await this.audit({ accountId: input.accountId, operation: input.kind, status: "failed", resourceId: input.threadId, provider: provider.name, error: error instanceof Error ? error.message.slice(0, 240) : "provider failure" }); throw error; } }
	async createDraft(input: EmailComposeInput): Promise<EmailDraft> { await this.requireAccountCapability(input.accountId, "write"); await validateDraftAttachments(input.attachments ?? []); const safeInput: EmailComposeInput = { ...input, ...(input.bodyHtml === undefined ? {} : { bodyHtml: sanitizeDraftHtml(input.bodyHtml) }) }; const providerDraft = await this.getProvider().createDraft(safeInput); const draft: EmailDraft = { ...providerDraft, body: safeInput.body, ...(providerDraft.bodyHtml === undefined && safeInput.bodyHtml !== undefined ? { bodyHtml: safeInput.bodyHtml } : {}), ...(providerDraft.bodyHtml !== undefined ? { bodyHtml: sanitizeDraftHtml(providerDraft.bodyHtml) } : {}) }; await this.enqueue(async () => { const store = await readStore(); store.drafts = [draft, ...store.drafts.filter((item) => item.id !== draft.id)].slice(0, 200); await writeStore(store) }); await this.audit({ accountId: input.accountId, operation: "create-draft", status: "completed", resourceId: draft.id, provider: this.getProvider().name }); return draft }
	private validateSchedule(draft: EmailDraft | undefined, scheduledAt: string): { timestamp: number; draft: EmailDraft } {
		const timestamp = Date.parse(scheduledAt)
		if (!Number.isFinite(timestamp) || timestamp <= Date.now()) throw new EmailError("invalid_input", "计划发送时间必须是未来的有效 RFC3339 时间")
		if (!draft || draft.status !== "draft") throw new EmailError("invalid_input", `可计划发送草稿不存在: ${draft?.id ?? "unknown"}`)
		return { timestamp, draft }
	}
	async prepareScheduleSend(draftId: string, scheduledAt: string, bypassConfirmation = false): Promise<string> {
		const store = await readStore()
		const { timestamp, draft } = this.validateSchedule(store.drafts.find((item) => item.id === draftId), scheduledAt)
		await this.requireConfirmation("计划发送", `确认在 ${new Date(timestamp).toLocaleString()} 发送草稿 ${draft.id}？`, bypassConfirmation)
		const normalizedAt = new Date(timestamp).toISOString()
		const token = `schedule:${randomUUID()}`
		const sideEffectIntentId = this.createSendIntent(draft, normalizedAt)
		this.scheduleTokens.set(token, { draftId, scheduledAt: normalizedAt, fingerprint: draftFingerprint(draft), ...(sideEffectIntentId ? { sideEffectIntentId } : {}) })
		await this.audit({ accountId: draft.accountId, operation: "schedule-send", status: "requested", resourceId: draft.id, provider: this.getProvider().name })
		return token
	}
	async scheduleSend(draftId: string, scheduledAt: string, confirmationToken?: string): Promise<EmailScheduledSend> {
		const store = await readStore()
		const draft = store.drafts.find((item) => item.id === draftId && item.status === "draft")
		const { timestamp: normalizedTimestamp, draft: validatedDraft } = this.validateSchedule(draft, scheduledAt)
		const token = confirmationToken ? this.scheduleTokens.get(confirmationToken) : undefined
		if (!token || token.draftId !== draftId || token.scheduledAt !== new Date(normalizedTimestamp).toISOString() || token.fingerprint !== draftFingerprint(validatedDraft)) throw new EmailError("confirmation_required", "计划发送必须先经过用户确认，且草稿或时间变化后需要重新确认")
		this.scheduleTokens.delete(confirmationToken!)
		const record: EmailScheduledSend = { id: id("email-scheduled-send"), draftId, accountId: validatedDraft.accountId, scheduledAt: new Date(normalizedTimestamp).toISOString(), fingerprint: draftFingerprint(validatedDraft), status: "scheduled", createdAt: new Date().toISOString(), ...(token.sideEffectIntentId ? { sideEffectIntentId: token.sideEffectIntentId } : {}) }
		await this.enqueue(async () => { const next = await readStore(); next.scheduledSends = [record, ...next.scheduledSends.filter((item) => item.draftId !== draftId || item.status !== "scheduled")].slice(0, 200); await writeStore(next) })
		await this.audit({ accountId: validatedDraft.accountId, operation: "schedule-send", status: "confirmed", resourceId: draftId, provider: this.getProvider().name })
		return record
	}
	async scheduledSends(): Promise<EmailScheduledSend[]> { await this.queue; return (await readStore()).scheduledSends.filter((item) => item.status === "scheduled") }
	async pendingSends(): Promise<EmailPendingSend[]> { await this.queue; return (await readStore()).pendingSends.filter((item) => item.status === "pending").sort((left, right) => left.sendAt.localeCompare(right.sendAt)) }
	private async dispatchDuePendingSends(): Promise<void> {
		const due = await this.enqueue(async () => (await readStore()).pendingSends.filter((item) => item.status === "pending" && Date.parse(item.sendAt) <= Date.now()))
		for (const record of due) {
			if (this.pendingSendRuns.has(record.id)) continue
			this.pendingSendRuns.add(record.id)
			try {
				const store = await readStore()
				const draft = store.drafts.find((item) => item.id === record.draftId && item.status === "draft")
				if (!draft || draftFingerprint(draft) !== record.fingerprint) throw new EmailError("confirmation_required", "撤回窗口内草稿内容已变化，已阻止发送")
				await this.sendAuthorizedDraft(draft, "send-draft", record.sideEffectIntentId)
				await this.enqueue(async () => { const next = await readStore(); const item = next.pendingSends.find((entry) => entry.id === record.id); if (item) item.status = "sent"; await writeStore(next) })
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				await this.enqueue(async () => { const next = await readStore(); const item = next.pendingSends.find((entry) => entry.id === record.id); if (item) { item.status = "failed"; item.error = message.slice(0, 240) }; await writeStore(next) })
			} finally { this.pendingSendRuns.delete(record.id) }
		}
	}
	async cancelScheduledSend(scheduleId: string): Promise<void> {
		await this.enqueue(async () => { const store = await readStore(); const record = store.scheduledSends.find((item) => item.id === scheduleId && item.status === "scheduled"); if (!record) throw new EmailError("invalid_input", `计划发送不存在: ${scheduleId}`); record.status = "cancelled"; await writeStore(store); if (record.sideEffectIntentId) this.collaborationRuntime()?.cancelSideEffectIntent?.(record.sideEffectIntentId, "计划发送已取消"); await this.audit({ accountId: record.accountId, operation: "cancel-schedule-send", status: "completed", resourceId: record.draftId, provider: this.getProvider().name }) })
	}
	async cancelPendingSend(pendingId: string): Promise<void> {
		await this.enqueue(async () => { const store = await readStore(); const record = store.pendingSends.find((item) => item.id === pendingId && item.status === "pending"); if (!record) throw new EmailError("invalid_input", `撤回发送不存在或已提交: ${pendingId}`); if (Date.parse(record.sendAt) <= Date.now()) throw new EmailError("operation_failed", "撤回窗口已结束"); record.status = "cancelled"; await writeStore(store); if (record.sideEffectIntentId) this.collaborationRuntime()?.cancelSideEffectIntent?.(record.sideEffectIntentId, "邮件已在撤回窗口内取消"); await this.audit({ accountId: record.accountId, operation: "undo-send", status: "completed", resourceId: record.draftId, provider: this.getProvider().name }) })
	}
	private async sendAuthorizedDraft(draft: EmailDraft, operation: "send-draft" | "scheduled-send", sideEffectIntentId?: string): Promise<EmailMutationResult> {
		const provider = this.getProvider()
		await this.requireAccountCapability(draft.accountId, "write")
		await this.audit({ accountId: draft.accountId, operation, status: "confirmed", resourceId: draft.id, provider: provider.name })
		const runtime = this.collaborationRuntime()
		let consumed = false
		try {
			if (runtime && !sideEffectIntentId) throw new EmailError("confirmation_required", "邮件发送缺少协作授权意图")
			if (runtime && sideEffectIntentId) { runtime.consumeSideEffectIntent(sideEffectIntentId, draftFingerprint(draft)); consumed = true }
			const safeDraft = draft.bodyHtml === undefined ? draft : { ...draft, bodyHtml: sanitizeDraftHtml(draft.bodyHtml), body: sanitizeDraftHtml(draft.bodyHtml) }
			const result = await this.enqueue(() => provider.sendDraft(safeDraft))
			const nextStore = await readStore()
			const sent = { ...draft, status: "sent" as const, updatedAt: new Date().toISOString(), scheduledAt: undefined }
			await writeStore({ ...nextStore, drafts: nextStore.drafts.map((item) => item.id === draft.id ? sent : item) })
			await this.audit({ accountId: draft.accountId, operation, status: "completed", resourceId: draft.id, provider: provider.name })
			if (runtime && sideEffectIntentId) runtime.completeSideEffectIntent(sideEffectIntentId, result.receipt)
			return result
		} catch (error) {
			if (runtime && sideEffectIntentId && consumed) { try { runtime.failSideEffectIntent(sideEffectIntentId, error instanceof Error ? error.message : String(error)) } catch { /* preserve provider error */ } }
			await this.audit({ accountId: draft.accountId, operation, status: "failed", resourceId: draft.id, provider: provider.name, error: error instanceof Error ? error.message.slice(0, 240) : "provider failure" })
			throw error
		}
	}
	async prepareSend(draftId: string, bypassConfirmation = false): Promise<string> {
		const store = await readStore();
		const draft = store.drafts.find((item) => item.id === draftId);
		if (!draft || draft.status !== "draft") throw new EmailError("invalid_input", `可发送草稿不存在: ${draftId}`);
		await this.requireConfirmation("发送邮件", `确认发送草稿 ${draft.id}？`, bypassConfirmation)
		const token = `send:${randomUUID()}`;
		const sideEffectIntentId = this.createSendIntent(draft);
		this.sendTokens.set(token, { draftId, fingerprint: draftFingerprint(draft), ...(sideEffectIntentId ? { sideEffectIntentId } : {}) });
		await this.audit({ accountId: draft.accountId, operation: "send-draft", status: "requested", resourceId: draft.id, provider: this.getProvider().name });
		return token;
	}
	async sendDraft(draftId: string, confirmationToken?: string): Promise<EmailMutationResult> {
		const token = confirmationToken ? this.sendTokens.get(confirmationToken) : undefined;
		if (!token || token.draftId !== draftId) throw new EmailError("confirmation_required", "发送邮件必须先经过用户确认");
		this.sendTokens.delete(confirmationToken!);
		const store = await readStore(); const draft = store.drafts.find((item) => item.id === draftId);
		if (!draft) throw new EmailError("invalid_input", `草稿不存在: ${draftId}`);
		if (draftFingerprint(draft) !== token.fingerprint) throw new EmailError("confirmation_required", "草稿内容已变化，请重新确认后发送");
		return this.sendAuthorizedDraft(draft, "send-draft", token.sideEffectIntentId)
	}
	async queueSend(draftId: string, confirmationToken: string, undoWindowMs = 5_000): Promise<EmailPendingSend> {
		if (!Number.isInteger(undoWindowMs) || undoWindowMs < 1_000 || undoWindowMs > 30_000) throw new EmailError("invalid_input", "撤回窗口必须是 1000 到 30000 毫秒")
		const token = this.sendTokens.get(confirmationToken)
		if (!token || token.draftId !== draftId) throw new EmailError("confirmation_required", "发送邮件必须先经过用户确认")
		this.sendTokens.delete(confirmationToken)
		const store = await readStore(); const draft = store.drafts.find((item) => item.id === draftId && item.status === "draft")
		if (!draft) throw new EmailError("invalid_input", `草稿不存在: ${draftId}`)
		if (draftFingerprint(draft) !== token.fingerprint) throw new EmailError("confirmation_required", "草稿内容已变化，请重新确认后发送")
		const record: EmailPendingSend = { id: id("email-pending-send"), draftId, accountId: draft.accountId, sendAt: new Date(Date.now() + undoWindowMs).toISOString(), fingerprint: token.fingerprint, status: "pending", createdAt: new Date().toISOString(), ...(token.sideEffectIntentId ? { sideEffectIntentId: token.sideEffectIntentId } : {}) }
		await this.enqueue(async () => { const next = await readStore(); next.pendingSends = [record, ...next.pendingSends.filter((item) => item.draftId !== draftId && item.status === "pending")].slice(0, 200); await writeStore(next) })
		await this.audit({ accountId: draft.accountId, operation: "send-draft", status: "requested", resourceId: draft.id, provider: this.getProvider().name })
		return record
	}
	async auditLog(): Promise<EmailAuditEntry[]> { await this.queue; return (await readStore()).audit }
	async saveAnalysis(input: EmailAnalysisSaveInput): Promise<EmailAnalysisRecord> {
		if (typeof input.confidence !== "number" || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new EmailError("invalid_input", "confidence 必须是 0 到 1 之间的数字")
		const confidence = input.confidence
		const facts = analysisFacts(input.facts)
		const actions = analysisActions(input.actions)
		const risks = analysisFacts(input.risks)
		const replyDraft = analysisReplyDraft(input.replyDraft)
		const meetingProposal = analysisMeetingProposal(input.meetingProposal)
		if ([...facts, ...risks].some((item) => item.citations.length === 0) || actions.some((item) => item.citations.length === 0) || (replyDraft !== undefined && replyDraft.citations.length === 0) || (meetingProposal !== undefined && meetingProposal.citations.length === 0)) throw new EmailError("invalid_input", "AI 分析事实、行动项、风险、回复草稿和会议提案必须包含来源消息引用")
		const citationIds = [...new Set([...analysisCitationIds(facts, actions, risks, replyDraft), ...(meetingProposal?.citations.map((citation) => citation.messageId) ?? [])])]
		if (citationIds.length) {
			const sourceThread = await this.thread(input.accountId, input.threadId)
			const sourceMessages = new Map(sourceThread.messages.map((message) => [message.id, message]))
			const missing = citationIds.filter((messageId) => !sourceMessages.has(messageId))
			if (missing.length) throw new EmailError("invalid_input", `AI 分析引用不属于当前邮件线程: ${missing.slice(0, 3).join(", ")}`)
			const citations = [...facts.flatMap((item) => item.citations), ...actions.flatMap((item) => item.citations), ...risks.flatMap((item) => item.citations), ...(replyDraft ? replyDraft.citations : []), ...(meetingProposal?.citations ?? [])]
			const invalidQuote = citations.find((citation) => citation.quote && !citationQuoteMatches(sourceMessages.get(citation.messageId)!, citation.quote))
			if (invalidQuote) throw new EmailError("invalid_input", `AI 分析引用摘录不属于消息正文: ${invalidQuote.messageId}`)
		}
		const contextCitations = analysisContextCitationEntries(facts, actions, risks, replyDraft)
		if (contextCitations.length) {
			if (!this.knowledgeContextValidator) throw new EmailError("invalid_input", "AI 分析包含知识库引用，但当前运行时没有可用的知识库校验器")
			for (const citation of contextCitations) {
				try {
					const validated = await this.knowledgeContextValidator.validate({ sourceId: citation.sourceId, ...(citation.sourcePath ? { sourcePath: citation.sourcePath } : {}), ...(citation.quote ? { quote: citation.quote } : {}) })
					Object.assign(citation, validated)
				} catch (error) {
					throw new EmailError("invalid_input", `知识库引用未通过校验: ${error instanceof Error ? error.message : "来源不可用"}`)
				}
			}
		}
		const record: EmailAnalysisRecord = {
			id: id("email-analysis"),
			accountId: input.accountId,
			threadId: input.threadId,
			kind: input.kind,
			generatedAt: new Date().toISOString(),
			generatedBy: "ai",
			...(input.summary ? { summary: input.summary } : {}),
			facts,
			actions,
			risks,
			...(replyDraft ? { replyDraft } : {}),
			...(meetingProposal ? { meetingProposal } : {}),
			confidence,
			needsReview: input.needsReview ?? confidence < 0.7,
			review: "pending",
		}
		const link: { key: "linkedDraftId" | "linkedReminderId" | "linkedTaskControlId"; value: string | undefined }[] = [
			{ key: "linkedDraftId", value: input.linkedDraftId },
			{ key: "linkedReminderId", value: input.linkedReminderId },
			{ key: "linkedTaskControlId", value: input.linkedTaskControlId },
		]
		for (const entry of link) if (entry.value) (record as unknown as Record<string, unknown>)[entry.key] = entry.value
		if (input.linkedTaskIds?.length) record.linkedTaskIds = [...new Set(input.linkedTaskIds)]
		if (input.linkedProjectTaskIds?.length) record.linkedProjectTaskIds = [...new Set(input.linkedProjectTaskIds)]
		if (input.linkedCalendarTaskId) record.linkedCalendarTaskId = input.linkedCalendarTaskId
		if (input.linkedCalendarEventId) record.linkedCalendarEventId = input.linkedCalendarEventId
		await this.enqueue(async () => {
			const store = await readStore()
			const next = [...store.analyses.filter((item) => !(item.accountId === input.accountId && item.threadId === input.threadId && item.kind === input.kind && item.review === "pending")), record]
			store.analyses = next.slice(-200)
			await writeStore(store)
		})
		await this.audit({ accountId: input.accountId, operation: `analysis:${input.kind}`, status: "completed", resourceId: input.threadId, provider: "openbuddy-local" })
		return record
	}
	async listAnalyses(input?: { accountId?: string; threadId?: string }): Promise<EmailAnalysisRecord[]> {
		await this.queue
		const store = await readStore()
		return store.analyses.filter((item) => (!input?.accountId || item.accountId === input.accountId) && (!input?.threadId || item.threadId === input.threadId))
	}
	async reviewAnalysis(input: EmailAnalysisReviewInput): Promise<EmailAnalysisRecord> {
		const store = await readStore()
		const target = store.analyses.find((item) => item.id === input.id)
		if (!target) throw new EmailError("invalid_input", `邮件分析不存在: ${input.id}`)
		target.review = input.review
		target.reviewedAt = new Date().toISOString()
		if (input.reviewNote) target.reviewNote = input.reviewNote
		await writeStore(store)
		await this.audit({ accountId: target.accountId, operation: `analysis-review:${input.review}`, status: "completed", resourceId: target.threadId, provider: "openbuddy-local" })
		return target
	}
	async linkAnalysis(input: EmailAnalysisLinkInput): Promise<EmailAnalysisRecord> {
		const store = await readStore()
		const target = store.analyses.find((item) => item.id === input.id)
		if (!target) throw new EmailError("invalid_input", `邮件分析不存在: ${input.id}`)
		if (input.linkedDraftId !== undefined) target.linkedDraftId = input.linkedDraftId
		if (input.linkedReminderId !== undefined) target.linkedReminderId = input.linkedReminderId
		if (input.linkedReminderIds !== undefined) target.linkedReminderIds = [...new Set(input.linkedReminderIds)]
		if (input.linkedTaskControlId !== undefined) target.linkedTaskControlId = input.linkedTaskControlId
		if (input.linkedTaskIds !== undefined) target.linkedTaskIds = [...new Set(input.linkedTaskIds)]
		if (input.linkedProjectTaskIds !== undefined) target.linkedProjectTaskIds = [...new Set(input.linkedProjectTaskIds)]
		if (input.linkedCalendarTaskId !== undefined) target.linkedCalendarTaskId = input.linkedCalendarTaskId
		if (input.linkedCalendarEventId !== undefined) target.linkedCalendarEventId = input.linkedCalendarEventId
		await writeStore(store)
		await this.audit({ accountId: target.accountId, operation: "analysis-link", status: "completed", resourceId: target.threadId, provider: "openbuddy-local" })
		return target
	}
	async createRemindersFromAnalysis(input: EmailAnalysisReminderInput): Promise<EmailAnalysisReminderResult> {
		const store = await readStore()
		const target = store.analyses.find((item) => item.id === input.analysisId)
		if (!target) throw new EmailError("invalid_input", `邮件分析不存在: ${input.analysisId}`)
		if (target.kind !== "actions" || target.actions.length === 0) throw new EmailError("invalid_input", "只有包含行动项的分析才能创建提醒")
		if (target.review === "dismissed") throw new EmailError("operation_failed", "已驳回的分析不能创建提醒")
		const indexes = input.actionIndexes === undefined ? target.actions.map((_, index) => index) : [...new Set(input.actionIndexes)]
		if (!indexes.length || indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= target.actions.length)) throw new EmailError("invalid_input", "提醒行动项索引无效")
		const selected = indexes.map((index) => target.actions[index]!)
		if (selected.some((action) => !action.dueAt || !Number.isFinite(Date.parse(action.dueAt)) || Date.parse(action.dueAt) <= Date.now())) throw new EmailError("invalid_input", "每个行动项都必须包含未来的有效 dueAt 才能创建提醒")
		await this.requireConfirmation("创建跟进提醒", `确认将 ${selected.length} 个邮件行动项创建为跟进提醒？`, input.confirmed === true)
		const prepared = await this.enqueue(async () => {
			const next = await readStore()
			const current = next.analyses.find((item) => item.id === input.analysisId)
			if (!current) throw new EmailError("invalid_input", `邮件分析不存在: ${input.analysisId}`)
			if (current.kind !== "actions" || current.actions.length === 0 || current.review === "dismissed") throw new EmailError("operation_failed", "当前分析状态已变化，不能创建提醒")
			if (indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= current.actions.length)) throw new EmailError("invalid_input", "提醒行动项索引无效")
			const currentSelected = indexes.map((index) => current.actions[index]!)
			if (currentSelected.some((action) => !action.dueAt || !Number.isFinite(Date.parse(action.dueAt)) || Date.parse(action.dueAt) <= Date.now())) throw new EmailError("invalid_input", "每个行动项都必须包含未来的有效 dueAt 才能创建提醒")
			const reminders: EmailMutationResult[] = []
			const newIndexes: number[] = []
			for (const index of indexes) {
				const action = current.actions[index]!
				const existing = next.reminders.find((item) => item.analysisId === current.id && item.actionIndex === index)
				if (existing) {
					reminders.push({ ok: true, provider: "openbuddy-local", operation: "create-reminder", threadId: current.threadId, receipt: existing.id })
					continue
				}
				const reminder = { id: id("email-reminder"), accountId: current.accountId, threadId: current.threadId, description: `邮件行动项：${action.content}${action.owner ? `；负责人：${action.owner}` : ""}`, remindAt: action.dueAt!, analysisId: current.id, actionIndex: index }
				next.reminders = [reminder, ...next.reminders].slice(0, 500)
				newIndexes.push(index)
				reminders.push({ ok: true, provider: "openbuddy-local", operation: "create-reminder", threadId: current.threadId, receipt: reminder.id })
			}
			const reminderIds = reminders.map((reminder) => reminder.receipt).filter((value): value is string => Boolean(value))
			current.linkedReminderIds = [...new Set([...(current.linkedReminderIds ?? []), ...reminderIds])]
			if (reminderIds.length === 1) current.linkedReminderId = reminderIds[0]
			current.review = "accepted"
			current.reviewedAt = new Date().toISOString()
			await writeStore(next)
			return { result: { analysis: current, reminders }, newIndexes }
		})
		for (const index of prepared.newIndexes) {
			const action = prepared.result.analysis.actions[index]!
			try {
				const provider = this.getProvider()
				if (provider.createReminder) await this.enqueue(() => provider.createReminder!({ accountId: prepared.result.analysis.accountId, threadId: prepared.result.analysis.threadId, description: `邮件行动项：${action.content}${action.owner ? `；负责人：${action.owner}` : ""}`, remindAt: action.dueAt! }))
			} catch { }
		}
		for (const reminder of prepared.result.reminders) await this.notify("邮件跟进提醒已创建", `${reminder.threadId} · ${reminder.receipt ?? ""}`)
		await this.audit({ accountId: prepared.result.analysis.accountId, operation: "analysis-create-reminders", status: "completed", resourceId: prepared.result.analysis.threadId, provider: "openbuddy-local" })
		return prepared.result
	}
	async registryList(): Promise<EmailConnection[]> {
		if (!this.registry) return []
		const stored = new Map((await readStore()).connections.map((record) => [record.id, record]))
		return this.registry.list().map((connection) => {
			const record = stored.get(connection.id)
			return record ? { ...connection, ...record, status: connection.status ?? record.status } : connection
		})
	}
	async registryReadiness(): Promise<EmailConnectionReadiness[]> {
		if (!this.registry) return []
		return this.registry.readiness()
	}
	async registrySetEnabled(id: string, enabled: boolean): Promise<EmailConnection> {
		if (!this.registry) throw new EmailError("operation_failed", "邮箱连接注册表未注入")
		const connection = await this.registry.setEnabled(id, enabled)
		await this.persistRegistryConnection(connection)
		return connection
	}
	async registryReauthorize(id: string): Promise<EmailConnection> {
		if (!this.registry) throw new EmailError("operation_failed", "邮箱连接注册表未注入")
		const connection = await this.registry.reauthorize(id)
		await this.persistRegistryConnection(connection)
		return connection
	}
	async registryRegister(input: EmailRegistryRegisterInput): Promise<EmailConnection> {
		if (!this.registry) throw new EmailError("operation_failed", "邮箱连接注册表未注入")
		const id = input.id?.trim() || `email-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
		const connection = this.registry.register({
			id,
			providerType: input.providerType,
			displayName: input.displayName,
			...(input.credentialRef ? { credentialRef: input.credentialRef } : {}),
			...(input.mcpServerName ? { mcpServerName: input.mcpServerName } : {}),
			...(input.scopes ? { scopes: input.scopes } : {}),
			...(input.enabledCapabilities ? { enabledCapabilities: input.enabledCapabilities } : {}),
			enabled: input.enabled !== false,
		})
		try { await this.registry.connect(id) } catch { /* readiness will reflect error */ }
		const persisted = this.registry.get(id) ?? connection
		await this.persistRegistryConnection(persisted)
		return persisted
	}
	async registryRemove(id: string): Promise<{ id: string; removed: boolean }> {
		if (!this.registry) throw new EmailError("operation_failed", "邮箱连接注册表未注入")
		const removed = this.registry.remove(id)
		await this.enqueue(async () => {
			const store = await readStore()
			store.connections = store.connections.filter((record) => record.id !== id)
			await writeStore(store)
		})
		this.provider = null
		return { id, removed }
	}
	private async persistRegistryConnection(connection: EmailConnection): Promise<void> {
		await this.enqueue(async () => {
			const store = await readStore()
			const next: EmailConnectionRecord = {
				id: connection.id,
				providerType: connection.providerType,
				...(connection.accountId ? { accountId: connection.accountId } : {}),
				displayName: connection.displayName,
				...(connection.credentialRef ? { credentialRef: connection.credentialRef } : {}),
				...(connection.mcpServerName ? { mcpServerName: connection.mcpServerName } : {}),
				...(connection.scopes ? { scopes: connection.scopes } : {}),
				...(connection.enabledCapabilities ? { enabledCapabilities: connection.enabledCapabilities } : {}),
				enabled: connection.enabled !== false,
				status: connection.status ?? "configured",
				...(connection.lastError ? { lastError: connection.lastError } : {}),
				updatedAt: connection.updatedAt ?? new Date().toISOString(),
			}
			store.connections = [...store.connections.filter((record) => record.id !== connection.id), next]
			await writeStore(store)
		})
	}
	async registryDiagnostics(): Promise<EmailProviderRegistryDiagnostic | null> {
		return this.registry ? this.registry.diagnostics() : null
	}
	withPermission(permission: EmailPermission): EmailPermissionScopedView {
		return new EmailPermissionScopedView(this, EmailPermissionResolver.owner(permission.actor).can("read") ? new EmailPermissionResolver(permission) : EmailPermissionResolver.readonly(permission.actor))
	}
}

export class EmailPermissionScopedView {
	constructor(private readonly email: Email, private readonly resolver: EmailPermissionResolver) {}

	async accounts(): Promise<EmailAccount[]> {
		const accounts = await this.email.accounts()
		return this.resolver.filterAccounts(accounts)
	}

	async threads(input?: EmailSearchInput): Promise<EmailThreadPreview[]> {
		const scopedInput = this.applyScope(input)
		const previews = await this.email.threads(scopedInput)
		return this.resolver.filterThreadPreviews(previews)
	}

	async thread(accountId: string, threadId: string): Promise<EmailThread> {
		this.resolver.assertCan("read", accountId, "room:personal-room")
		return this.email.thread(accountId, threadId)
	}

	async labels(accountId: string): Promise<EmailLabel[]> {
		this.resolver.assertCan("read", accountId, "room:personal-room")
		return this.email.labels(accountId)
	}

	async listAnalyses(input?: { accountId?: string; threadId?: string }): Promise<EmailAnalysisRecord[]> {
		if (input?.accountId) this.resolver.assertCan("read", input.accountId, "room:personal-room")
		const analyses = await this.email.listAnalyses(input)
		return analyses.filter((analysis) => this.resolver.isAccountAllowed(analysis.accountId))
	}

	async listAttachments(accountId: string, messageId: string): Promise<EmailAttachment[]> {
		this.resolver.assertCan("read", accountId, "room:personal-room")
		return this.email.listAttachments(accountId, messageId)
	}

	async downloadAttachment(accountId: string, attachmentId: string, messageId: string, destinationDir?: string): Promise<EmailAttachmentDownload> {
		this.resolver.assertCan("read", accountId, "room:personal-room")
		return this.email.downloadAttachment(accountId, attachmentId, messageId, destinationDir)
	}

	async shareThread(input: EmailShareInput): Promise<EmailMutationResult> {
		this.resolver.assertCan("share", input.accountId, "room:personal-room")
		return this.email.shareThread(input)
	}

	async createReminder(input: EmailReminderInput): Promise<EmailMutationResult> {
		this.resolver.assertCan("read", input.accountId, "room:personal-room")
		return this.email.createReminder(input)
	}

	async moveToProject(input: EmailProjectLinkInput): Promise<EmailMutationResult> {
		this.resolver.assertCan("read", input.accountId, "room:personal-room")
		return this.email.moveToProject(input)
	}

	async triage(input?: EmailSearchInput): Promise<EmailTriageSnapshot> {
		const scopedInput = this.applyScope(input)
		return this.email.triage(scopedInput)
	}

	async digest(input?: EmailSearchInput): Promise<EmailDigestSnapshot> {
		const scopedInput = this.applyScope(input)
		return this.email.digest(scopedInput)
	}

	async audit(): Promise<EmailAuditEntry[]> {
		if (!this.resolver.can("audit")) throw new Error("actor lacks audit capability")
		return this.email.auditLog()
	}

	auditContext(target?: { accountId?: string; scope?: string; capability?: EmailPermissionAuditContext["capability"] }): EmailPermissionAuditContext {
		return {
			permission: this.resolver["permission"] as EmailPermission,
			...(target?.accountId ? { accountId: target.accountId } : {}),
			...(target?.scope ? { scope: target.scope } : { scope: "room:personal-room" }),
			...(target?.capability ? { capability: target.capability } : {}),
		}
	}

	private applyScope(input?: EmailSearchInput): EmailSearchInput {
		const base: EmailSearchInput = { ...(input ?? {}) }
		if (this.resolver["permission"].allowedAccountIds === "*") return base
		const allowed = (this.resolver["permission"].allowedAccountIds as readonly string[])
		if (base.accountId && !allowed.includes(base.accountId)) {
			throw new Error(`account ${base.accountId} not in actor allowed list`)
		}
		if (!base.accountId) base.accountId = allowed.join(",")
		return base
	}
}

let serviceRef: Email | null = null
export function mountEmail(ctx: Context): Email { const service = new Email(ctx); serviceRef = service; return service }
function service(): Email { if (!serviceRef) throw new Error("openbuddy-email: service is not initialized"); return serviceRef }
export const emailHandlers = { accounts: () => service().accounts(), providerDiagnostics: () => service().providerDiagnostics(), rules: () => service().rules(), saveRule: (input: EmailRuleInput) => service().saveRule(input), deleteRule: (ruleId: string) => service().deleteRule(ruleId), runRule: (ruleId: string) => service().runRule(ruleId), runScheduledRules: () => service().runScheduledRules(), sync: (input: EmailSyncInput) => service().sync(input), syncStates: (accountId?: string) => service().syncStates(accountId), threads: (input?: EmailSearchInput) => service().threads(input), threadsPage: (input?: EmailSearchInput) => service().threadsPage(input), replyZero: (input?: EmailSearchInput) => service().replyZero(input), actionCenterQuery: (input?: EmailActionCenterQueryInput) => service().actionCenterQuery(input), actionCenterCreateReminders: (input?: EmailActionCenterReminderInput) => service().actionCenterCreateReminders(input), projectContacts: (options?: EmailContactProjectionOptions) => service().projectContacts(options), inboxReceipts: () => service().inboxReceipts(), acknowledgeInbox: (accountId: string, threadId: string, messageDate?: string) => service().acknowledgeInbox(accountId, threadId, messageDate), digest: (input?: EmailSearchInput) => service().digest(input), triage: (input?: EmailSearchInput) => service().triage(input), thread: (accountId: string, threadId: string) => service().thread(accountId, threadId), projectThreads: (projectId: string, limit?: number) => service().projectThreads(projectId, limit), drafts: (accountId?: string) => service().drafts(accountId), scheduledSends: () => service().scheduledSends(), pendingSends: () => service().pendingSends(), prepareScheduleSend: (draftId: string, scheduledAt: string, bypassConfirmation = false) => service().prepareScheduleSend(draftId, scheduledAt, bypassConfirmation), scheduleSend: (draftId: string, scheduledAt: string, confirmationToken?: string) => service().scheduleSend(draftId, scheduledAt, confirmationToken), cancelScheduledSend: (scheduleId: string) => service().cancelScheduledSend(scheduleId), cancelPendingSend: (pendingId: string) => service().cancelPendingSend(pendingId), labels: (accountId: string) => service().labels(accountId), workspaceTags: () => service().workspaceTags(), updateWorkspaceTags: (input: EmailTagMutationInput) => service().updateWorkspaceTags(input), update: (input: EmailMutationInput, bypassConfirmation = false) => service().update(input, bypassConfirmation), setSenderPolicy: (input: EmailSenderPolicyInput, bypassConfirmation = false) => service().setSenderPolicy(input, bypassConfirmation), unsubscribe: (input: EmailUnsubscribeInput, bypassConfirmation = false) => service().unsubscribe(input, bypassConfirmation), shareThread: (input: EmailShareInput) => service().shareThread(input), createReminder: (input: EmailReminderInput) => service().createReminder(input), moveToProject: (input: EmailProjectLinkInput) => service().moveToProject(input), listAttachments: (accountId: string, messageId: string) => service().listAttachments(accountId, messageId), downloadAttachment: (accountId: string, attachmentId: string, messageId: string, destinationDir?: string) => service().downloadAttachment(accountId, attachmentId, messageId, destinationDir), prepareProcessingPlan: (input: EmailProcessingPlanInput) => service().prepareProcessingPlan(input), confirmProcessingPlan: (planId: string, bypassConfirmation = false) => service().confirmProcessingPlan(planId, bypassConfirmation), executeProcessingPlan: (planId: string, confirmationToken: string) => service().executeProcessingPlan(planId, confirmationToken), cancelProcessingPlan: (planId: string) => service().cancelProcessingPlan(planId), processingPlans: () => service().processingPlans(), createDraft: (input: EmailComposeInput) => service().createDraft(input), prepareSend: (draftId: string, bypassConfirmation = false) => service().prepareSend(draftId, bypassConfirmation), sendDraft: (draftId: string, confirmationToken?: string) => service().sendDraft(draftId, confirmationToken), queueSend: (draftId: string, confirmationToken: string, undoWindowMs?: number) => service().queueSend(draftId, confirmationToken, undoWindowMs), invalidateProvider: () => { service().invalidateProvider(); return { ok: true } },
	audit: () => service().auditLog(), saveAnalysis: (input: EmailAnalysisSaveInput) => service().saveAnalysis(input), listAnalyses: (input?: { accountId?: string; threadId?: string }) => service().listAnalyses(input), reviewAnalysis: (input: EmailAnalysisReviewInput) => service().reviewAnalysis(input), linkAnalysis: (input: EmailAnalysisLinkInput) => service().linkAnalysis(input), createRemindersFromAnalysis: (input: EmailAnalysisReminderInput) => service().createRemindersFromAnalysis(input),
	extractActionCandidates: (input: EmailActionCandidateInput) => extractEmailActionCandidates(input),
	registryList: () => service().registryList(),
	registryReadiness: () => service().registryReadiness(),
	registrySetEnabled: (id: string, enabled: boolean) => service().registrySetEnabled(id, enabled),
	registryReauthorize: (id: string) => service().registryReauthorize(id),
	registryRegister: (input: EmailRegistryRegisterInput) => service().registryRegister(input),
	registryRemove: (id: string) => service().registryRemove(id),
	registryDiagnostics: () => service().registryDiagnostics() }

function toolResult(value: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(value) }], details: value } }
type ToolArgs = Record<string, any>
const objectSchema = { type: "object", additionalProperties: false }
export function createEmailPiTools(): ToolDefinition[] {
	return createEmailToolDefinitions()
}

export function createEmailReadOnlyPiTools(): ToolDefinition[] {
	return createEmailToolDefinitions().filter((tool) => ["email_list_accounts", "email_list_rules", "email_sync", "email_sync_states", "email_search", "email_threads_page", "email_workspace_tags", "email_reply_zero", "email_digest", "email_get_thread", "email_list_attachments", "email_list_scheduled_sends", "email_list_pending_sends", "email_save_analysis", "email_list_analyses", "email_extract_action_candidates", "email_action_center_query", "email_contact_projection"].includes(tool.name))
}

function createEmailToolDefinitions(): ToolDefinition[] {
	return [
		{ name: "email_list_accounts", label: "List email accounts", description: "列出已连接的邮箱账户和能力。", parameters: objectSchema as ToolDefinition["parameters"], execute: async () => toolResult(await emailHandlers.accounts()) },
		{ name: "email_list_rules", label: "List email rules", description: "列出本地保存的 AI 邮件规则；规则只作用于可逆处理计划。", parameters: objectSchema as ToolDefinition["parameters"], execute: async () => toolResult(await emailHandlers.rules()) },
		{ name: "email_save_rule", label: "Save email rule", description: "保存 AI 邮件规则。规则禁止删除/垃圾邮件动作，运行时只生成需确认的处理计划；可启用定时扫描，但不会自动执行远端写操作。", parameters: { ...objectSchema, required: ["name", "actions"], properties: { name: { type: "string" }, ruleId: { type: "string" }, enabled: { type: "boolean" }, condition: { type: "object" }, actions: { type: "array" }, schedule: { type: "object", properties: { intervalMinutes: { type: "integer", minimum: 15, maximum: 10080 }, nextRunAt: { type: "string" } } } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.saveRule(args as EmailRuleInput)) },
		{ name: "email_run_rule", label: "Run email rule", description: "运行本地邮件规则，只返回匹配线程和 dry-run 处理计划，不会直接写入邮箱。", parameters: { ...objectSchema, required: ["ruleId"], properties: { ruleId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.runRule(args.ruleId)) },
		{ name: "email_delete_rule", label: "Delete email rule", description: "删除本地邮件规则，不修改远端邮件。", parameters: { ...objectSchema, required: ["ruleId"], properties: { ruleId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.deleteRule(args.ruleId)) },
		{ name: "email_sync", label: "Sync email", description: "调用邮箱 provider 原生增量同步；没有 sync 工具时明确返回不支持，不会把普通分页冒充同步。", parameters: { ...objectSchema, required: ["accountId"], properties: { accountId: { type: "string" }, cursor: { type: "string" }, limit: { type: "number" }, full: { type: "boolean" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.sync(args as EmailSyncInput)) },
		{ name: "email_sync_states", label: "List email sync states", description: "列出本地保存的同步游标、状态、时间和计数，不包含邮件正文或 OAuth 凭据。", parameters: { ...objectSchema, properties: { accountId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.syncStates(args.accountId)) },
		{ name: "email_triage", label: "Triage inbox", description: "只读对收件箱进行可解释优先级分诊，返回 urgent、needs-reply、waiting-for-reply、noise、normal；不会修改邮件。", parameters: { ...objectSchema, properties: { accountId: { type: "string" }, limit: { type: "number" }, query: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.triage(args as EmailSearchInput)) },
		{ name: "email_extract_action_candidates", label: "Extract email action candidates", description: "从邮件正文抽取结构化行动项候选（content/owner/dueAt/messageId），可接受 LLM 已抽取的 phrases；不写邮件、不持久化分析，仅供 save-analysis 调用方使用。", parameters: { ...objectSchema, required: ["subject", "body", "messages"], properties: { subject: { type: "string" }, body: { type: "string" }, messages: { type: "array", items: { type: "object" } }, phrases: { type: "array", items: { type: "string" } }, baseDate: { type: "string" }, now: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(emailHandlers.extractActionCandidates(args as Parameters<typeof emailHandlers.extractActionCandidates>[0])) },
		{ name: "email_prepare_processing_plan", label: "Prepare email processing plan", description: "根据 AI/用户建议生成只读处理预览；禁止删除和垃圾邮件操作，不会修改 provider。", parameters: { ...objectSchema, required: ["operations"], properties: { operations: { type: "array" }, expiresInMs: { type: "number" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.prepareProcessingPlan(args as EmailProcessingPlanInput)) },
		{ name: "email_confirm_processing_plan", label: "Confirm email processing plan", description: "请求用户确认处理计划，返回一次性执行 token。", parameters: { ...objectSchema, required: ["planId"], properties: { planId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.confirmProcessingPlan(args.planId)) },
		{ name: "email_execute_processing_plan", label: "Execute email processing plan", description: "使用确认 token 执行已预览的邮件管理计划；计划指纹变化或过期会失败。", parameters: { ...objectSchema, required: ["planId", "confirmationToken"], properties: { planId: { type: "string" }, confirmationToken: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.executeProcessingPlan(args.planId, args.confirmationToken)) },
		{ name: "email_cancel_processing_plan", label: "Cancel email processing plan", description: "取消尚未执行的邮件处理计划，撤销其确认 token 并持久化取消状态。", parameters: { ...objectSchema, required: ["planId"], properties: { planId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.cancelProcessingPlan(args.planId)) },
		{ name: "email_search", label: "Search email", description: "搜索邮件线程，只读操作。支持与 Gmail Label 分离的 OpenBuddy 工作区标签。", parameters: { ...objectSchema, properties: { query: { type: "string" }, accountId: { type: "string" }, folder: { type: "string" }, labelId: { type: "string" }, tags: { type: "array", items: { type: "string" } }, tagMatch: { type: "string", enum: ["any", "all"] }, from: { type: "string" }, to: { type: "string" }, unread: { type: "boolean" }, hasAttachment: { type: "boolean" }, since: { type: "string" }, until: { type: "string" }, limit: { type: "number" }, cursor: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.threads(args)) },
		{ name: "email_threads_page", label: "Page email threads", description: "分页读取邮件线程；返回 items 和 nextCursor，适合分批处理大量邮件。", parameters: { ...objectSchema, properties: { query: { type: "string" }, accountId: { type: "string" }, folder: { type: "string" }, labelId: { type: "string" }, tags: { type: "array", items: { type: "string" } }, tagMatch: { type: "string", enum: ["any", "all"] }, from: { type: "string" }, to: { type: "string" }, unread: { type: "boolean" }, hasAttachment: { type: "boolean" }, since: { type: "string" }, until: { type: "string" }, limit: { type: "number" }, cursor: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.threadsPage(args)) },
		{ name: "email_workspace_tags", label: "List workspace email tags", description: "列出 OpenBuddy 工作区标签；与邮箱 provider 原生 Label 分离。", parameters: objectSchema as ToolDefinition["parameters"], execute: async () => toolResult(await emailHandlers.workspaceTags()) },
		{ name: "email_reply_zero", label: "Reply Zero", description: "只读分析收件箱，返回待我回复、等待对方和无需行动的结构化线程引用。", parameters: { ...objectSchema, properties: { accountId: { type: "string" }, query: { type: "string" }, since: { type: "string" }, until: { type: "string" }, limit: { type: "number" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.replyZero(args)) },
		{ name: "email_action_center_query", label: "Query AI email action center", description: "统一查询 AI 邮件行动中心：合并 triage 优先级、reply-zero 状态、已保存 AI 分析、workspace 标签和发送方域名；一次调用替代 triage+reply_zero+list_analyses+workspace_tags 的组合。可按 category/reviewStates/owner/dueBefore/senderDomain/workspaceTagIds 过滤。", parameters: { ...objectSchema, properties: { accountId: { type: "string" }, folder: { type: "string" }, categories: { type: "array", items: { type: "string", enum: ["urgent", "needs-reply", "waiting-for-reply", "noise", "normal"] } }, reviewStates: { type: "array", items: { type: "string", enum: ["pending", "accepted", "dismissed"] } }, owner: { type: "string" }, dueBefore: { type: "string" }, senderDomain: { type: "string" }, workspaceTagIds: { type: "array", items: { type: "string" } }, query: { type: "string" }, limit: { type: "number" }, cursor: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.actionCenterQuery(args as EmailActionCenterQueryInput)) },
		{ name: "email_action_center_create_reminders", label: "Create follow-up reminders from AI action center", description: "把 AI 行动中心匹配到的待办行动项批量转为本地跟进提醒。默认 dry-run；confirmed=true 才真正创建（一次性确认整批），重复执行幂等。只处理 kind=actions 且 dueAt 在未来的分析行动项。", parameters: { ...objectSchema, properties: { accountId: { type: "string" }, categories: { type: "array", items: { type: "string", enum: ["urgent", "needs-reply", "waiting-for-reply", "noise", "normal"] } }, owner: { type: "string" }, dueBefore: { type: "string" }, senderDomain: { type: "string" }, workspaceTagIds: { type: "array", items: { type: "string" } }, confirmed: { type: "boolean" }, dryRun: { type: "boolean" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.actionCenterCreateReminders(args as EmailActionCenterReminderInput)) },
		{ name: "email_contact_projection", label: "Project inbox contacts", description: "从收件箱消息头聚合联系人频次、最近交互和关联线程/分析 ID；不返回邮件正文或主题。支持 includeDomains/excludeDomains/roles/since-until/limit 过滤，个人邮箱默认脱敏（保留域名与前两位字符）。", parameters: { ...objectSchema, properties: { accountId: { type: "string" }, folder: { type: "string", enum: ["inbox", "sent", "drafts", "archive", "trash", "spam", "starred", "important", "snoozed", "custom"] }, includeDomains: { type: "array", items: { type: "string" } }, excludeDomains: { type: "array", items: { type: "string" } }, includeRoles: { type: "array", items: { type: "string", enum: ["from", "to", "cc", "bcc"] } }, since: { type: "string" }, until: { type: "string" }, limit: { type: "number" }, maskPersonalAddresses: { type: "boolean" }, returnRawAddresses: { type: "boolean" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.projectContacts(args as EmailContactProjectionOptions)) },
		{ name: "email_digest", label: "Email digest", description: "只读生成收件箱今日简报数据；模型可据此生成摘要，不执行邮件副作用。", parameters: { ...objectSchema, properties: { accountId: { type: "string" }, since: { type: "string" }, until: { type: "string" }, limit: { type: "number" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.digest(args)) },
		{ name: "email_get_thread", label: "Read email thread", description: "读取一个邮件线程。", parameters: { ...objectSchema, required: ["accountId", "threadId"], properties: { accountId: { type: "string" }, threadId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.thread(args.accountId, args.threadId)) },
		{ name: "email_update_thread", label: "Manage email thread", description: "管理邮件线程；批量操作先使用 dryRun，删除、垃圾邮件和延后处理必须确认或提供有效时间。", parameters: { ...objectSchema, required: ["accountId", "threadId", "kind"], properties: { accountId: { type: "string" }, threadId: { type: "string" }, threadIds: { type: "array", items: { type: "string" } }, kind: { type: "string", enum: ["mark-read", "mark-unread", "archive", "restore", "label", "star", "trash", "spam", "snooze"] }, labelId: { type: "string" }, value: { type: "boolean" }, snoozeUntil: { type: "string" }, dryRun: { type: "boolean" }, sampleLimit: { type: "number" }, confirmed: { type: "boolean" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.update(args as EmailMutationInput)) },
		{ name: "email_set_sender_policy", label: "Set sender policy", description: "将发件人未来邮件归类为 Signal、Noise 或阻断；block 仍需要用户确认。", parameters: { ...objectSchema, required: ["senderEmail", "policy"], properties: { senderEmail: { type: "string" }, policy: { type: "string" }, accountId: { type: "string" }, threadId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.setSenderPolicy(args as EmailSenderPolicyInput)) },
		{ name: "email_share_thread", label: "Share email thread", description: "将邮件线程分享到已授权的协作频道；分享副作用需要用户确认。", parameters: { ...objectSchema, required: ["accountId", "threadId", "channelId"], properties: { accountId: { type: "string" }, threadId: { type: "string" }, channelId: { type: "string" }, message: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.shareThread(args as EmailShareInput)) },
		{ name: "email_create_followup", label: "Create email follow-up", description: "为邮件线程创建一次性跟进提醒。", parameters: { ...objectSchema, required: ["accountId", "threadId", "description", "remindAt"], properties: { accountId: { type: "string" }, threadId: { type: "string" }, description: { type: "string" }, remindAt: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.createReminder(args as EmailReminderInput)) },
		{ name: "email_move_to_project", label: "Move email to project", description: "将邮件线程关联到项目；项目变更需要用户确认。", parameters: { ...objectSchema, required: ["accountId", "threadId"], properties: { accountId: { type: "string" }, threadId: { type: "string" }, projectId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.moveToProject(args as EmailProjectLinkInput)) },
		{ name: "email_list_attachments", label: "List email attachments", description: "列出一条邮件消息的附件元数据。", parameters: { ...objectSchema, required: ["accountId", "messageId"], properties: { accountId: { type: "string" }, messageId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.listAttachments(args.accountId, args.messageId)) },
		{ name: "email_download_attachment", label: "Download email attachment", description: "将附件下载到用户明确选择的绝对目录；不会写入未授权路径。", parameters: { ...objectSchema, required: ["accountId", "attachmentId", "messageId", "destinationDir"], properties: { accountId: { type: "string" }, attachmentId: { type: "string" }, messageId: { type: "string" }, destinationDir: { type: "string", description: "用户选择的绝对目录" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.downloadAttachment(args.accountId, args.attachmentId, args.messageId, args.destinationDir)) },
		{ name: "email_list_drafts", label: "List email drafts", description: "列出本地持久化的未发送草稿。", parameters: { ...objectSchema, properties: { accountId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.drafts(args.accountId)) },
		{ name: "email_list_scheduled_sends", label: "List scheduled email sends", description: "列出已确认但尚未到时间发送的邮件计划。", parameters: objectSchema as ToolDefinition["parameters"], execute: async () => toolResult(await emailHandlers.scheduledSends()) },
		{ name: "email_list_pending_sends", label: "List pending email sends", description: "列出仍在撤回窗口内的待发送邮件；只读，不会触发发送。", parameters: objectSchema as ToolDefinition["parameters"], execute: async () => toolResult(await emailHandlers.pendingSends()) },
		{ name: "email_prepare_schedule_send", label: "Prepare scheduled email send", description: "校验计划发送草稿和时间，并返回一次性用户确认凭证；不会发送邮件。", parameters: { ...objectSchema, required: ["draftId", "scheduledAt"], properties: { draftId: { type: "string" }, scheduledAt: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.prepareScheduleSend(args.draftId, args.scheduledAt)) },
		{ name: "email_schedule_send", label: "Schedule email send", description: "只有用户确认后才能创建计划发送；confirmationToken 必须来自 email_prepare_schedule_send。", parameters: { ...objectSchema, required: ["draftId", "scheduledAt", "confirmationToken"], properties: { draftId: { type: "string" }, scheduledAt: { type: "string" }, confirmationToken: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.scheduleSend(args.draftId, args.scheduledAt, args.confirmationToken)) },
		{ name: "email_create_draft", label: "Create email draft", description: "创建或更新邮件草稿；body 使用 Markdown，bodyHtml 可由 Composer 提供清洗后的 HTML，发送前仍需用户确认。", parameters: { ...objectSchema, required: ["accountId", "to", "subject", "body"], properties: { accountId: { type: "string" }, draftId: { type: "string" }, to: { type: "array", items: { type: "object" } }, cc: { type: "array", items: { type: "object" } }, bcc: { type: "array", items: { type: "object" } }, replyTo: { type: "array", items: { type: "object" } }, subject: { type: "string" }, body: { type: "string" }, bodyHtml: { type: "string" }, attachments: { type: "array", items: { type: "string" } }, threadId: { type: "string" }, messageId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.createDraft(args as EmailComposeInput)) },
		{ name: "email_prepare_send", label: "Prepare email send", description: "为用户确认准备一次性发送凭证；不会发送邮件。", parameters: { ...objectSchema, required: ["draftId"], properties: { draftId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.prepareSend(args.draftId)) },
		{ name: "email_send_draft", label: "Send email draft", description: "只有用户确认后才能发送；confirmationToken 必须为 send:<draftId>。", parameters: { ...objectSchema, required: ["draftId", "confirmationToken"], properties: { draftId: { type: "string" }, confirmationToken: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.sendDraft(args.draftId, args.confirmationToken)) },
		{ name: "email_save_analysis", label: "Save email AI analysis", description: "保存结构化邮件分析（summary/actions/risks/reply/meeting），邮件事实必须带 messageId 引用，背景资料使用独立的 contextCitations 并由运行时校验；不会发送邮件，不会修改邮件原文。", parameters: { ...objectSchema, required: ["accountId", "threadId", "kind", "confidence"], properties: { accountId: { type: "string" }, threadId: { type: "string" }, kind: { type: "string", enum: ["summary", "actions", "risk", "reply", "meeting"] }, summary: { type: "string" }, confidence: { type: "number", description: "0 到 1 之间的置信度" }, facts: { type: "array" }, actions: { type: "array" }, risks: { type: "array" }, replyDraft: { type: "object" }, meetingProposal: { type: "object" }, linkedDraftId: { type: "string" }, linkedReminderId: { type: "string" }, linkedTaskControlId: { type: "string" }, linkedTaskIds: { type: "array", items: { type: "string" } }, linkedCalendarTaskId: { type: "string" }, linkedCalendarEventId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.saveAnalysis(args as Parameters<typeof emailHandlers.saveAnalysis>[0])) },
		{ name: "email_list_analyses", label: "List email AI analyses", description: "列出已保存的邮件 AI 分析，可按 accountId 与 threadId 过滤。", parameters: { ...objectSchema, properties: { accountId: { type: "string" }, threadId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.listAnalyses(args)) },
		{ name: "email_create_reminders_from_analysis", label: "Create email follow-up reminders", description: "将已保存 AI 行动项转换为本地跟进提醒；需要用户确认，行动项必须包含未来 dueAt，重复执行幂等。", parameters: { ...objectSchema, required: ["analysisId"], properties: { analysisId: { type: "string" }, actionIndexes: { type: "array", items: { type: "integer" } } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await emailHandlers.createRemindersFromAnalysis({ analysisId: args.analysisId, ...(args.actionIndexes === undefined ? {} : { actionIndexes: args.actionIndexes }) })) },
	]
}

declare module "@openbuddy/cordis" { interface Context { email: Email } }

export { GmailApiEmailProvider, createGmailApiEmailProvider } from "./gmail-api-provider"
export type { GmailAccessToken, GmailApiEmailProviderOptions, GmailFetch } from "./gmail-api-provider"
export { MicrosoftGraphEmailProvider, createMicrosoftGraphEmailProvider } from "./microsoft-graph-provider"
export type { GraphAccessToken, GraphApiEmailProviderOptions, GraphFetch } from "./microsoft-graph-provider"
export { JmapEmailProvider, createJmapEmailProvider } from "./jmap-provider"
export type { JmapAccessToken, JmapEmailProviderOptions, JmapFetch } from "./jmap-provider"
export { EmailProviderRegistry } from "./provider-registry"
export type { EmailConnection, EmailConnectionReadiness, EmailProviderRegistryDiagnostic, EmailRegistryProviderType } from "./provider-registry"
export {
	EmailPermissionResolver,
	EmailPermissionError,
	EMAIL_DEFAULT_FORBIDDEN_SCOPES,
	EMAIL_DEFAULT_OWNER_SCOPES,
} from "./email-permissions"
export type { EmailPermission, EmailPermissionAccountScope, EmailPermissionAuditContext, EmailPermissionCapability } from "./email-permissions"
