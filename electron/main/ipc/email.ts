/**
 * IPC surface — email domain.
 *
 * Split out of `./index.ts`.
 */
import { ipcMain, type BrowserWindow } from "electron";
import {
	absolutePath,
	assertPolicyModelAllowed,
	assertPolicySkillUploadAllowed,
	emailComposePayload,
	emailMutationPayload,
	emailRuleSchedule,
	emailSearchPayload,
	emailTagMutationPayload,
	enumValue,
	fromPiPermissionMode,
	httpUrl,
	memoryScope,
	modelId,
	normalizePromptContent,
	numberValue,
	openDialogOptions,
	optionalCwd,
	optionalFiniteInteger,
	optionalFiniteNumber,
	optionalNonNegativeIntegerArray,
	optionalString,
	optionalStringArray,
	permissionRules,
	providerId,
	publicPermissionMode,
	recordValue,
	requiredBoolean,
	requiredString,
	requiredStringArray,
	saveDialogOptions,
	stringValue,
	throwWorkspaceIpcError,
	toPiPermissionMode,
	writeAllowedRoot,
	type RecordValue,
} from "./validation";
// dynamic: @openbuddy/capability-email

export function registerEmailIpc(getWindow: () => BrowserWindow | null): void {
	const currentWindow = () => getWindow();

		ipcMain.handle("email:provider-diagnostics", async () => (await import("@openbuddy/capability-email")).emailHandlers.providerDiagnostics());
		ipcMain.handle("email:registry-list", async () => (await import("@openbuddy/capability-email")).emailHandlers.registryList());
		ipcMain.handle("email:registry-readiness", async () => (await import("@openbuddy/capability-email")).emailHandlers.registryReadiness());
		ipcMain.handle("email:registry-set-enabled", async (_e, args: unknown) => { const input = recordValue(args, "email registry-set-enabled payload"); return (await import("@openbuddy/capability-email")).emailHandlers.registrySetEnabled(requiredString(input.id, "id"), requiredBoolean(input.enabled, "enabled")); });
		ipcMain.handle("email:registry-reauthorize", async (_e, args: unknown) => { const input = recordValue(args, "email registry-reauthorize payload"); return (await import("@openbuddy/capability-email")).emailHandlers.registryReauthorize(requiredString(input.id, "id")); });
		ipcMain.handle("email:registry-register", async (_e, args: unknown) => { const input = recordValue(args, "email registry-register payload"); return (await import("@openbuddy/capability-email")).emailHandlers.registryRegister({ ...(input.id === undefined ? {} : { id: requiredString(input.id, "id") }), providerType: enumValue(input.providerType, "providerType", ["mcp", "gmail-api", "graph-api", "jmap-api"] as const), displayName: requiredString(input.displayName, "displayName"), ...(input.credentialRef === undefined ? {} : { credentialRef: requiredString(input.credentialRef, "credentialRef") }), ...(input.mcpServerName === undefined ? {} : { mcpServerName: requiredString(input.mcpServerName, "mcpServerName") }), ...(input.scopes === undefined ? {} : { scopes: optionalStringArray(input.scopes, "scopes") }), ...(input.enabledCapabilities === undefined ? {} : { enabledCapabilities: optionalStringArray(input.enabledCapabilities, "enabledCapabilities") }), ...(input.enabled === undefined ? {} : { enabled: requiredBoolean(input.enabled, "enabled") }) }); });
		ipcMain.handle("email:registry-remove", async (_e, args: unknown) => { const input = recordValue(args, "email registry-remove payload"); return (await import("@openbuddy/capability-email")).emailHandlers.registryRemove(requiredString(input.id, "id")); });
		ipcMain.handle("email:registry-diagnostics", async () => (await import("@openbuddy/capability-email")).emailHandlers.registryDiagnostics());
		ipcMain.handle("email:accounts", async () => (await import("@openbuddy/capability-email")).emailHandlers.accounts());
		ipcMain.handle("email:rules", async () => (await import("@openbuddy/capability-email")).emailHandlers.rules());
		ipcMain.handle("email:save-rule", async (_e, args: unknown) => { const input = recordValue(args, "email save-rule payload"); if (!Array.isArray(input.actions)) throw new Error("actions must be an array"); const schedule = input.schedule === null ? null : input.schedule === undefined ? undefined : emailRuleSchedule(input.schedule); return (await import("@openbuddy/capability-email")).emailHandlers.saveRule({ id: input.ruleId === undefined ? undefined : requiredString(input.ruleId, "ruleId"), name: requiredString(input.name, "name"), enabled: input.enabled === undefined ? true : requiredBoolean(input.enabled, "enabled"), condition: input.condition as never, actions: input.actions as never, ...(schedule === undefined ? {} : { schedule }) }); });
		ipcMain.handle("email:delete-rule", async (_e, args: unknown) => { const input = recordValue(args, "email delete-rule payload"); return (await import("@openbuddy/capability-email")).emailHandlers.deleteRule(requiredString(input.ruleId, "ruleId")); });
		ipcMain.handle("email:run-rule", async (_e, args: unknown) => { const input = recordValue(args, "email run-rule payload"); return (await import("@openbuddy/capability-email")).emailHandlers.runRule(requiredString(input.ruleId, "ruleId")); });
		ipcMain.handle("email:run-scheduled-rules", async () => (await import("@openbuddy/capability-email")).emailHandlers.runScheduledRules());
		ipcMain.handle("email:sync", async (_e, args: unknown) => {
			const input = recordValue(args, "email sync payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.sync({ accountId: requiredString(input.accountId, "accountId"), ...(input.cursor === undefined ? {} : { cursor: requiredString(input.cursor, "cursor") }), ...(input.limit === undefined ? {} : { limit: optionalFiniteInteger(input.limit, "limit", 100, 1, 500) }), ...(input.full === undefined ? {} : { full: requiredBoolean(input.full, "full") }) });
		});
		ipcMain.handle("email:sync-states", async (_e, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "email sync states payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.syncStates(input.accountId === undefined ? undefined : requiredString(input.accountId, "accountId"));
		});
		ipcMain.handle("email:triage", async (_e, args?: unknown) => {
			return (await import("@openbuddy/capability-email")).emailHandlers.triage(emailSearchPayload(args === undefined || args === null ? {} : args) as never);
		});
		ipcMain.handle("email:prepare-processing-plan", async (_e, args: unknown) => {
			const input = recordValue(args, "email processing plan payload");
			if (!Array.isArray(input.operations)) throw new Error("operations must be an array");
			return (await import("@openbuddy/capability-email")).emailHandlers.prepareProcessingPlan({ operations: input.operations as never, ...(input.expiresInMs === undefined ? {} : { expiresInMs: optionalFiniteInteger(input.expiresInMs, "expiresInMs", 300000, 30000, 1800000) }) });
		});
		ipcMain.handle("email:confirm-processing-plan", async (_e, args: unknown) => {
			const input = recordValue(args, "email confirm processing plan payload");
			const planId = requiredString(input.planId, "planId");
			const confirmed = input.confirmed === undefined ? undefined : requiredBoolean(input.confirmed, "confirmed");
			requireConfirmation(confirmed, "执行邮件处理计划");
			return (await import("@openbuddy/capability-email")).emailHandlers.confirmProcessingPlan(planId, confirmed === true);
		});
			ipcMain.handle("email:execute-processing-plan", async (_e, args: unknown) => {
			const input = recordValue(args, "email execute processing plan payload");
				return (await import("@openbuddy/capability-email")).emailHandlers.executeProcessingPlan(requiredString(input.planId, "planId"), requiredString(input.confirmationToken, "confirmationToken"));
			});
			ipcMain.handle("email:cancel-processing-plan", async (_e, args: unknown) => {
				const input = recordValue(args, "email cancel processing plan payload");
				return (await import("@openbuddy/capability-email")).emailHandlers.cancelProcessingPlan(requiredString(input.planId, "planId"));
			});
		ipcMain.handle("email:processing-plans", async () => (await import("@openbuddy/capability-email")).emailHandlers.processingPlans());
		ipcMain.handle("email:threads", async (_e, args?: unknown) => {
			return (await import("@openbuddy/capability-email")).emailHandlers.threads(emailSearchPayload(args === undefined || args === null ? {} : args) as never);
		});
		ipcMain.handle("email:threads-page", async (_e, args?: unknown) => {
			return (await import("@openbuddy/capability-email")).emailHandlers.threadsPage(emailSearchPayload(args === undefined || args === null ? {} : args) as never);
		});
		ipcMain.handle("email:reply-zero", async (_e, args?: unknown) => {
			return (await import("@openbuddy/capability-email")).emailHandlers.replyZero(emailSearchPayload(args === undefined || args === null ? {} : args) as never);
		});
		ipcMain.handle("email:ack-inbox", async (_e, args?: unknown) => {
			const input = recordValue(args === undefined || args === null ? {} : args, "email inbox acknowledgement payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.acknowledgeInbox(requiredString(input.accountId, "accountId"), requiredString(input.threadId, "threadId"), input.messageDate === undefined ? undefined : requiredString(input.messageDate, "messageDate"));
		});
		ipcMain.handle("email:digest", async (_e, args?: unknown) => {
			return (await import("@openbuddy/capability-email")).emailHandlers.digest(emailSearchPayload(args === undefined || args === null ? {} : args) as never);
		});
		ipcMain.handle("email:drafts", async (_e, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "email drafts payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.drafts(input.accountId === undefined ? undefined : requiredString(input.accountId, "accountId"));
		});
		ipcMain.handle("email:scheduled-sends", async () => (await import("@openbuddy/capability-email")).emailHandlers.scheduledSends());
		ipcMain.handle("email:pending-sends", async () => (await import("@openbuddy/capability-email")).emailHandlers.pendingSends());
		ipcMain.handle("email:analyses", async (_e, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "email analyses payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.listAnalyses({
				...(input.accountId === undefined ? {} : { accountId: requiredString(input.accountId, "accountId") }),
				...(input.threadId === undefined ? {} : { threadId: requiredString(input.threadId, "threadId") }),
			});
		});
		ipcMain.handle("email:action-center-query", async (_e, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "email action-center-query payload");
			const categories = input.categories === undefined ? undefined : optionalStringArray(input.categories, "categories");
			const reviewStates = input.reviewStates === undefined ? undefined : optionalStringArray(input.reviewStates, "reviewStates");
			return (await import("@openbuddy/capability-email")).emailHandlers.actionCenterQuery({
				...(input.accountId === undefined ? {} : { accountId: requiredString(input.accountId, "accountId") }),
				...(input.folder === undefined ? {} : { folder: requiredString(input.folder, "folder") as "inbox" | "sent" | "drafts" | "archive" | "trash" | "spam" | "starred" | "important" | "snoozed" | "custom" }),
				...(categories === undefined ? {} : { categories: categories as never }),
				...(reviewStates === undefined ? {} : { reviewStates: reviewStates as never }),
				...(input.owner === undefined ? {} : { owner: requiredString(input.owner, "owner") }),
				...(input.dueBefore === undefined ? {} : { dueBefore: requiredString(input.dueBefore, "dueBefore") }),
				...(input.senderDomain === undefined ? {} : { senderDomain: requiredString(input.senderDomain, "senderDomain") }),
				...(input.workspaceTagIds === undefined ? {} : { workspaceTagIds: optionalStringArray(input.workspaceTagIds, "workspaceTagIds") }),
				...(input.limit === undefined ? {} : { limit: optionalFiniteInteger(input.limit, "limit", 50, 1, 200) }),
			});
		});
		ipcMain.handle("email:contact-projection", async (_e, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "email contact-projection payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.projectContacts({
				...(input.accountId === undefined ? {} : { accountId: requiredString(input.accountId, "accountId") }),
				...(input.folder === undefined ? {} : { folder: requiredString(input.folder, "folder") as "inbox" | "sent" | "drafts" | "archive" | "trash" | "spam" | "starred" | "important" | "snoozed" | "custom" }),
				...(input.includeDomains === undefined ? {} : { includeDomains: optionalStringArray(input.includeDomains, "includeDomains") }),
				...(input.excludeDomains === undefined ? {} : { excludeDomains: optionalStringArray(input.excludeDomains, "excludeDomains") }),
				...(input.since === undefined ? {} : { since: requiredString(input.since, "since") }),
				...(input.until === undefined ? {} : { until: requiredString(input.until, "until") }),
				...(input.limit === undefined ? {} : { limit: optionalFiniteInteger(input.limit, "limit", 200, 1, 500) }),
				...(input.maskPersonalAddresses === undefined ? {} : { maskPersonalAddresses: requiredBoolean(input.maskPersonalAddresses, "maskPersonalAddresses") }),
				...(input.returnRawAddresses === undefined ? {} : { returnRawAddresses: requiredBoolean(input.returnRawAddresses, "returnRawAddresses") }),
			});
		});
		ipcMain.handle("email:action-center-create-reminders", async (_e, args?: unknown) => {
			const input = args === undefined || args === null ? {} : recordValue(args, "email action-center-create-reminders payload");
			const categories = input.categories === undefined ? undefined : optionalStringArray(input.categories, "categories");
			return (await import("@openbuddy/capability-email")).emailHandlers.actionCenterCreateReminders({
				...(input.accountId === undefined ? {} : { accountId: requiredString(input.accountId, "accountId") }),
				...(categories === undefined ? {} : { categories: categories as never }),
				...(input.owner === undefined ? {} : { owner: requiredString(input.owner, "owner") }),
				...(input.dueBefore === undefined ? {} : { dueBefore: requiredString(input.dueBefore, "dueBefore") }),
				...(input.senderDomain === undefined ? {} : { senderDomain: requiredString(input.senderDomain, "senderDomain") }),
				...(input.workspaceTagIds === undefined ? {} : { workspaceTagIds: optionalStringArray(input.workspaceTagIds, "workspaceTagIds") }),
				...(input.confirmed === undefined ? {} : { confirmed: requiredBoolean(input.confirmed, "confirmed") }),
				...(input.dryRun === undefined ? {} : { dryRun: requiredBoolean(input.dryRun, "dryRun") }),
			});
		});
		ipcMain.handle("email:save-analysis", async (_e, args: unknown) => {
			const input = recordValue(args, "email save-analysis payload");
			const confidence = input.confidence === undefined ? NaN : optionalFiniteNumber(input.confidence, "confidence", 0, 0, 1);
			if (Number.isNaN(confidence)) throw new Error("confidence must be a number between 0 and 1");
			return (await import("@openbuddy/capability-email")).emailHandlers.saveAnalysis({
				accountId: requiredString(input.accountId, "accountId"),
				threadId: requiredString(input.threadId, "threadId"),
				kind: enumValue(input.kind, "kind", ["summary", "actions", "risk", "reply", "meeting"] as const),
				...(input.summary === undefined ? {} : { summary: stringValue(input.summary, "summary") }),
				confidence,
				...(input.facts === undefined ? {} : { facts: input.facts as never }),
				...(input.actions === undefined ? {} : { actions: input.actions as never }),
				...(input.risks === undefined ? {} : { risks: input.risks as never }),
				...(input.replyDraft === undefined ? {} : { replyDraft: input.replyDraft as never }),
				...(input.meetingProposal === undefined ? {} : { meetingProposal: input.meetingProposal as never }),
				...(input.linkedDraftId === undefined ? {} : { linkedDraftId: stringValue(input.linkedDraftId, "linkedDraftId") }),
				...(input.linkedReminderId === undefined ? {} : { linkedReminderId: stringValue(input.linkedReminderId, "linkedReminderId") }),
				...(input.linkedTaskControlId === undefined ? {} : { linkedTaskControlId: stringValue(input.linkedTaskControlId, "linkedTaskControlId") }),
				...(input.linkedTaskIds === undefined ? {} : { linkedTaskIds: optionalStringArray(input.linkedTaskIds, "linkedTaskIds") }),
				...(input.linkedCalendarTaskId === undefined ? {} : { linkedCalendarTaskId: stringValue(input.linkedCalendarTaskId, "linkedCalendarTaskId") }),
				...(input.linkedCalendarEventId === undefined ? {} : { linkedCalendarEventId: stringValue(input.linkedCalendarEventId, "linkedCalendarEventId") }),
			} as never);
		});
		ipcMain.handle("email:review-analysis", async (_e, args: unknown) => {
			const input = recordValue(args, "email review-analysis payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.reviewAnalysis({
				id: requiredString(input.id, "id"),
				review: enumValue(input.review, "review", ["accepted", "dismissed", "pending"] as const),
				...(input.reviewNote === undefined ? {} : { reviewNote: stringValue(input.reviewNote, "reviewNote") }),
			});
		});
		ipcMain.handle("email:link-analysis", async (_e, args: unknown) => {
			const input = recordValue(args, "email link-analysis payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.linkAnalysis({
				id: requiredString(input.id, "id"),
				...(input.linkedDraftId === undefined ? {} : { linkedDraftId: requiredString(input.linkedDraftId, "linkedDraftId") }),
				...(input.linkedReminderId === undefined ? {} : { linkedReminderId: requiredString(input.linkedReminderId, "linkedReminderId") }),
				...(input.linkedTaskControlId === undefined ? {} : { linkedTaskControlId: requiredString(input.linkedTaskControlId, "linkedTaskControlId") }),
				...(input.linkedTaskIds === undefined ? {} : { linkedTaskIds: optionalStringArray(input.linkedTaskIds, "linkedTaskIds") }),
			});
		});
		ipcMain.handle("email:create-reminders-from-analysis", async (_e, args: unknown) => {
			const input = recordValue(args, "email create-reminders-from-analysis payload");
			const confirmed = input.confirmed === undefined ? undefined : requiredBoolean(input.confirmed, "confirmed");
			requireConfirmation(confirmed, "创建跟进提醒");
			const actionIndexes = optionalNonNegativeIntegerArray(input.actionIndexes, "actionIndexes");
			return (await import("@openbuddy/capability-email")).emailHandlers.createRemindersFromAnalysis({ analysisId: requiredString(input.analysisId, "analysisId"), ...(actionIndexes === undefined ? {} : { actionIndexes }), confirmed: confirmed === true });
		});
		ipcMain.handle("email:prepare-schedule-send", async (_e, args: unknown) => {
			const input = recordValue(args, "email prepare-schedule-send payload");
			const confirmed = input.confirmed === undefined ? undefined : requiredBoolean(input.confirmed, "confirmed");
			requireConfirmation(confirmed, "创建计划发送");
			return (await import("@openbuddy/capability-email")).emailHandlers.prepareScheduleSend(requiredString(input.draftId, "draftId"), requiredString(input.scheduledAt, "scheduledAt"), confirmed === true);
		});
		ipcMain.handle("email:schedule-send", async (_e, args: unknown) => {
			const input = recordValue(args, "email schedule-send payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.scheduleSend(requiredString(input.draftId, "draftId"), requiredString(input.scheduledAt, "scheduledAt"), input.confirmationToken === undefined ? undefined : requiredString(input.confirmationToken, "confirmationToken"));
		});
		ipcMain.handle("email:cancel-scheduled-send", async (_e, args: unknown) => {
			const input = recordValue(args, "email cancel-scheduled-send payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.cancelScheduledSend(requiredString(input.scheduleId, "scheduleId"));
		});
		ipcMain.handle("email:cancel-pending-send", async (_e, args: unknown) => {
			const input = recordValue(args, "email cancel-pending-send payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.cancelPendingSend(requiredString(input.pendingId, "pendingId"));
		});
		ipcMain.handle("email:thread", async (_e, args: unknown) => {
			const input = recordValue(args, "email thread payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.thread(requiredString(input.accountId, "accountId"), requiredString(input.threadId, "threadId"));
		});
		ipcMain.handle("email:project-threads", async (_e, args: unknown) => {
			const input = recordValue(args, "email project-threads payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.projectThreads(requiredString(input.projectId, "projectId"), input.limit === undefined ? undefined : optionalFiniteInteger(input.limit, "limit", 50, 1, 100));
		});
		ipcMain.handle("email:labels", async (_e, args: unknown) => {
			const input = recordValue(args, "email labels payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.labels(requiredString(input.accountId, "accountId"));
		});
		ipcMain.handle("email:workspace-tags", async () => (await import("@openbuddy/capability-email")).emailHandlers.workspaceTags());
		ipcMain.handle("email:update-workspace-tags", async (_e, args: unknown) => (await import("@openbuddy/capability-email")).emailHandlers.updateWorkspaceTags(emailTagMutationPayload(args) as never));
		ipcMain.handle("email:update", async (_e, args: unknown) => {
			const input = emailMutationPayload(args);
			const destructive = input.kind === "trash" || input.kind === "spam";
			const confirmed = input.confirmed === undefined ? undefined : requiredBoolean(input.confirmed, "confirmed");
			if (destructive) requireConfirmation(confirmed, input.kind === "trash" ? "删除线程" : "标记垃圾邮件");
			return (await import("@openbuddy/capability-email")).emailHandlers.update({ ...input, confirmed: destructive ? confirmed === true : input.confirmed } as never, destructive && confirmed === true);
		});
		ipcMain.handle("email:unsubscribe", async (_e, args: unknown) => {
			const input = recordValue(args, "email unsubscribe payload");
			const confirmed = input.confirmed === undefined ? undefined : requiredBoolean(input.confirmed, "confirmed");
			requireConfirmation(confirmed, "退订邮件列表");
			return (await import("@openbuddy/capability-email")).emailHandlers.unsubscribe({ accountId: requiredString(input.accountId, "accountId"), messageId: requiredString(input.messageId, "messageId"), ...(input.threadId === undefined ? {} : { threadId: requiredString(input.threadId, "threadId") }), confirmed: confirmed === true }, confirmed === true);
		});
		ipcMain.handle("email:sender-policy", async (_e, args: unknown) => {
			const input = recordValue(args, "email sender-policy payload");
			const policy = enumValue(input.policy, "policy", ["signal", "noise", "block"] as const);
			const senderEmail = requiredString(input.senderEmail, "senderEmail");
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) throw new Error("senderEmail must be a valid email address");
			const confirmed = input.confirmed === undefined ? undefined : requiredBoolean(input.confirmed, "confirmed");
			if (policy === "block") requireConfirmation(confirmed, "阻断发件人");
			return (await import("@openbuddy/capability-email")).emailHandlers.setSenderPolicy({ senderEmail, policy, ...(input.accountId === undefined ? {} : { accountId: requiredString(input.accountId, "accountId") }), ...(input.threadId === undefined ? {} : { threadId: requiredString(input.threadId, "threadId") }), confirmed: confirmed === true }, confirmed === true);
		});
		ipcMain.handle("email:share-thread", async (_e, args: unknown) => {
			const input = recordValue(args, "email share-thread payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.shareThread({ accountId: requiredString(input.accountId, "accountId"), threadId: requiredString(input.threadId, "threadId"), channelId: requiredString(input.channelId, "channelId"), ...(input.message === undefined ? {} : { message: stringValue(input.message, "message") }) });
		});
		ipcMain.handle("email:create-reminder", async (_e, args: unknown) => {
			const input = recordValue(args, "email reminder payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.createReminder({ accountId: requiredString(input.accountId, "accountId"), threadId: requiredString(input.threadId, "threadId"), description: requiredString(input.description, "description"), remindAt: requiredString(input.remindAt, "remindAt") });
		});
		ipcMain.handle("email:move-to-project", async (_e, args: unknown) => {
			const input = recordValue(args, "email move-to-project payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.moveToProject({ accountId: requiredString(input.accountId, "accountId"), threadId: requiredString(input.threadId, "threadId"), ...(input.projectId === undefined ? {} : { projectId: requiredString(input.projectId, "projectId") }) });
		});
		ipcMain.handle("email:attachments", async (_e, args: unknown) => {
			const input = recordValue(args, "email attachments payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.listAttachments(requiredString(input.accountId, "accountId"), requiredString(input.messageId, "messageId"));
		});
		ipcMain.handle("email:attachment-download", async (_e, args: unknown) => {
			const input = recordValue(args, "email attachment-download payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.downloadAttachment(requiredString(input.accountId, "accountId"), requiredString(input.attachmentId, "attachmentId"), requiredString(input.messageId, "messageId"), absolutePath(input.destinationDir, "destinationDir"));
		});
		ipcMain.handle("email:create-draft", async (_e, args: unknown) => {
			return (await import("@openbuddy/capability-email")).emailHandlers.createDraft(emailComposePayload(args) as never);
		});
		ipcMain.handle("email:prepare-send", async (_e, args: unknown) => {
			const input = recordValue(args, "email prepare-send payload");
			const confirmed = input.confirmed === undefined ? undefined : requiredBoolean(input.confirmed, "confirmed");
			requireConfirmation(confirmed, "发送邮件");
			return (await import("@openbuddy/capability-email")).emailHandlers.prepareSend(requiredString(input.draftId, "draftId"), confirmed === true);
		});
		ipcMain.handle("email:queue-send", async (_e, args: unknown) => {
			const input = recordValue(args, "email queue-send payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.queueSend(requiredString(input.draftId, "draftId"), requiredString(input.confirmationToken, "confirmationToken"), input.undoWindowMs === undefined ? undefined : optionalFiniteInteger(input.undoWindowMs, "undoWindowMs", 5000, 1000, 30000));
		});
		ipcMain.handle("email:send-draft", async (_e, args: unknown) => {
			const input = recordValue(args, "email send payload");
			return (await import("@openbuddy/capability-email")).emailHandlers.sendDraft(requiredString(input.draftId, "draftId"), input.confirmationToken === undefined ? undefined : requiredString(input.confirmationToken, "confirmationToken"));
		});
		ipcMain.handle("email:invalidate-provider", async () => (await import("@openbuddy/capability-email")).emailHandlers.invalidateProvider());
		ipcMain.handle("email:audit", async () => (await import("@openbuddy/capability-email")).emailHandlers.audit());
		/**
		 * `requireConfirmation` replaces the previous native
		 * `dialog.showMessageBox` confirmation. The renderer-side flows now
		 * show the workbuddy-style `ConfirmDialog` (via `requestConfirm` in
		 * EmailPanel / EmailComposer) BEFORE invoking these IPC handlers,
		 * so the only remaining responsibility of the IPC layer is to verify
		 * the renderer passed `confirmed: true` and reject any unsanctioned
		 * call with a structured `confirmation_required` error.
		 *
		 * Defense-in-depth rationale: this keeps the harness / smoke paths
		 * from accidentally triggering destructive email operations while
		 * delivering the user a single, beautiful confirmation surface
		 * (matching the rest of the openbuddy UI) instead of the legacy
		 * native macOS / GTK dialog.
		 */
		const requireConfirmation = (confirmed: boolean | undefined, operation: string): void => {
			if (confirmed !== true) throw Object.assign(new Error(`${operation}必须经过确认`), { code: "confirmation_required" });
		};
}
