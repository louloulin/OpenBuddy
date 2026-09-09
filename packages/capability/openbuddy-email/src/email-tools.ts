/**
 * email-tools.ts — PI ToolDefinition factories for the email capability.
 *
 * Phase C.1 of docs/OPENBUDDY_PI_NATIVE_PLAN.md (v14 §34.6):
 *   Extract the email tool factory cluster out of index.ts so the
 *   index.ts god module (3510 LOC pre-C.1) shrinks to its core
 *   concern: the `Email` Cordis service + permissions view + mount.
 *
 * Architecture:
 *   - `toolResult` / `ToolArgs` / `objectSchema` helpers live here
 *     (they're only used by the factories below).
 *   - The 30+ tool definitions are grouped into 4 categories so each
 *     category is independently testable + diff-reviewable:
 *     READ_ONLY / MUTATION / COMPOSE / ANALYSIS.
 *   - `createEmailToolDefinitions(handlers)` is a pure factory that
 *     takes the bound `emailHandlers` object so this module doesn't
 *     need to import index.ts (avoids the circular dep entirely).
 *   - `createEmailPiTools()` and `createEmailReadOnlyPiTools()` in
 *     index.ts bind the handlers and re-export the public API.
 *
 * Reverse-dep invariant:
 *   This module imports nothing from electron/main/ and nothing from
 *   index.ts. The `EmailHandlers` interface is local so the call site
 *   in index.ts can pass the live handlers object by reference.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

// ─── Helpers ────────────────────────────────────────────────────────

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: value,
  };
}
type ToolArgs = Record<string, any>;
const objectSchema = { type: "object", additionalProperties: false };

/**
 * Minimal subset of `emailHandlers` that the tool factories consume.
 * Defined locally so email-tools.ts can be loaded without resolving
 * index.ts (which keeps a side-effect of `mountEmail` that depends on
 * the Cordis context being alive).
 */
export interface EmailToolHandlers {
  accounts(): Promise<unknown>;
  rules(): Promise<unknown>;
  saveRule(input: unknown): Promise<unknown>;
  deleteRule(ruleId: string): Promise<unknown>;
  runRule(ruleId: string): Promise<unknown>;
  sync(input: unknown): Promise<unknown>;
  syncStates(accountId?: string): Promise<unknown>;
  threads(input?: unknown): Promise<unknown>;
  threadsPage(input?: unknown): Promise<unknown>;
  replyZero(input?: unknown): Promise<unknown>;
  triage(input?: unknown): Promise<unknown>;
  thread(accountId: string, threadId: string): Promise<unknown>;
  drafts(accountId?: string): Promise<unknown>;
  scheduledSends(): Promise<unknown>;
  pendingSends(): Promise<unknown>;
  prepareScheduleSend(draftId: string, scheduledAt: string): Promise<unknown>;
  scheduleSend(draftId: string, scheduledAt: string, confirmationToken?: string): Promise<unknown>;
  workspaceTags(): Promise<unknown>;
  updateWorkspaceTags(input: unknown): Promise<unknown>;
  update(input: unknown, bypassConfirmation?: boolean): Promise<unknown>;
  setSenderPolicy(input: unknown, bypassConfirmation?: boolean): Promise<unknown>;
  shareThread(input: unknown): Promise<unknown>;
  createReminder(input: unknown): Promise<unknown>;
  moveToProject(input: unknown): Promise<unknown>;
  listAttachments(accountId: string, messageId: string): Promise<unknown>;
  downloadAttachment(accountId: string, attachmentId: string, messageId: string, destinationDir?: string): Promise<unknown>;
  prepareProcessingPlan(input: unknown): Promise<unknown>;
  confirmProcessingPlan(planId: string, bypassConfirmation?: boolean): Promise<unknown>;
  executeProcessingPlan(planId: string, confirmationToken: string): Promise<unknown>;
  cancelProcessingPlan(planId: string): Promise<unknown>;
  createDraft(input: unknown): Promise<unknown>;
  prepareSend(draftId: string, bypassConfirmation?: boolean): Promise<unknown>;
  sendDraft(draftId: string, confirmationToken?: string): Promise<unknown>;
  saveAnalysis(input: unknown): Promise<unknown>;
  listAnalyses(input?: unknown): Promise<unknown>;
  extractActionCandidates(input: unknown): unknown;
  actionCenterQuery(input?: unknown): Promise<unknown>;
  actionCenterCreateReminders(input?: unknown): Promise<unknown>;
  projectContacts(options?: unknown): Promise<unknown>;
  createRemindersFromAnalysis(input: unknown): Promise<unknown>;
  digest(input?: unknown): Promise<unknown>;
}

// ─── Tool categories ────────────────────────────────────────────────

/**
 * Read-only tools (no provider mutations). Safe to expose in any
 * read-only context (e.g. agent that only consumes data).
 */
function buildReadOnlyTools(handlers: EmailToolHandlers): ToolDefinition[] {
  return [
    { name: "email_list_accounts", label: "List email accounts", description: "列出已连接的邮箱账户和能力。", parameters: objectSchema as ToolDefinition["parameters"], execute: async () => toolResult(await handlers.accounts()) },
    { name: "email_list_rules", label: "List email rules", description: "列出本地保存的 AI 邮件规则；规则只作用于可逆处理计划。", parameters: objectSchema as ToolDefinition["parameters"], execute: async () => toolResult(await handlers.rules()) },
    { name: "email_sync", label: "Sync email", description: "调用邮箱 provider 原生增量同步；没有 sync 工具时明确返回不支持，不会把普通分页冒充同步。", parameters: { ...objectSchema, required: ["accountId"], properties: { accountId: { type: "string" }, cursor: { type: "string" }, limit: { type: "number" }, full: { type: "boolean" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.sync(args)) },
    { name: "email_sync_states", label: "List email sync states", description: "列出本地保存的同步游标、状态、时间和计数，不包含邮件正文或 OAuth 凭据。", parameters: { ...objectSchema, properties: { accountId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.syncStates(args.accountId)) },
    { name: "email_triage", label: "Triage inbox", description: "只读对收件箱进行可解释优先级分诊，返回 urgent、needs-reply、waiting-for-reply、noise、normal；不会修改邮件。", parameters: { ...objectSchema, properties: { accountId: { type: "string" }, limit: { type: "number" }, query: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.triage(args)) },
    { name: "email_extract_action_candidates", label: "Extract email action candidates", description: "从邮件正文抽取结构化行动项候选（content/owner/dueAt/messageId），可接受 LLM 已抽取的 phrases；不写邮件、不持久化分析，仅供 save-analysis 调用方使用。", parameters: { ...objectSchema, required: ["subject", "body", "messages"], properties: { subject: { type: "string" }, body: { type: "string" }, messages: { type: "array", items: { type: "object" } }, phrases: { type: "array", items: { type: "string" } }, baseDate: { type: "string" }, now: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(handlers.extractActionCandidates(args)) },
    { name: "email_search", label: "Search email", description: "搜索邮件线程，只读操作。支持与 Gmail Label 分离的 OpenBuddy 工作区标签。", parameters: { ...objectSchema, properties: { query: { type: "string" }, accountId: { type: "string" }, folder: { type: "string" }, labelId: { type: "string" }, tags: { type: "array", items: { type: "string" } }, tagMatch: { type: "string", enum: ["any", "all"] }, from: { type: "string" }, to: { type: "string" }, unread: { type: "boolean" }, hasAttachment: { type: "boolean" }, since: { type: "string" }, until: { type: "string" }, limit: { type: "number" }, cursor: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.threads(args)) },
    { name: "email_threads_page", label: "Page email threads", description: "分页读取邮件线程；返回 items 和 nextCursor，适合分批处理大量邮件。", parameters: { ...objectSchema, properties: { query: { type: "string" }, accountId: { type: "string" }, folder: { type: "string" }, labelId: { type: "string" }, tags: { type: "array", items: { type: "string" } }, tagMatch: { type: "string", enum: ["any", "all"] }, from: { type: "string" }, to: { type: "string" }, unread: { type: "boolean" }, hasAttachment: { type: "boolean" }, since: { type: "string" }, until: { type: "string" }, limit: { type: "number" }, cursor: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.threadsPage(args)) },
    { name: "email_workspace_tags", label: "List workspace email tags", description: "列出 OpenBuddy 工作区标签；与邮箱 provider 原生 Label 分离。", parameters: objectSchema as ToolDefinition["parameters"], execute: async () => toolResult(await handlers.workspaceTags()) },
    { name: "email_reply_zero", label: "Reply Zero", description: "只读分析收件箱，返回待我回复、等待对方和无需行动的结构化线程引用。", parameters: { ...objectSchema, properties: { accountId: { type: "string" }, query: { type: "string" }, since: { type: "string" }, until: { type: "string" }, limit: { type: "number" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.replyZero(args)) },
    { name: "email_action_center_query", label: "Query AI email action center", description: "统一查询 AI 邮件行动中心：合并 triage 优先级、reply-zero 状态、已保存 AI 分析、workspace 标签和发送方域名；一次调用替代 triage+reply_zero+list_analyses+workspace_tags 的组合。可按 category/reviewStates/owner/dueBefore/senderDomain/workspaceTagIds 过滤。", parameters: { ...objectSchema, properties: { accountId: { type: "string" }, folder: { type: "string" }, categories: { type: "array", items: { type: "string", enum: ["urgent", "needs-reply", "waiting-for-reply", "noise", "normal"] } }, reviewStates: { type: "array", items: { type: "string", enum: ["pending", "accepted", "dismissed"] } }, owner: { type: "string" }, dueBefore: { type: "string" }, senderDomain: { type: "string" }, workspaceTagIds: { type: "array", items: { type: "string" } }, query: { type: "string" }, limit: { type: "number" }, cursor: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.actionCenterQuery(args)) },
    { name: "email_contact_projection", label: "Project inbox contacts", description: "从收件箱消息头聚合联系人频次、最近交互和关联线程/分析 ID；不返回邮件正文或主题。支持 includeDomains/excludeDomains/roles/since-until/limit 过滤，个人邮箱默认脱敏（保留域名与前两位字符）。", parameters: { ...objectSchema, properties: { accountId: { type: "string" }, folder: { type: "string", enum: ["inbox", "sent", "drafts", "archive", "trash", "spam", "starred", "important", "snoozed", "custom"] }, includeDomains: { type: "array", items: { type: "string" } }, excludeDomains: { type: "array", items: { type: "string" } }, includeRoles: { type: "array", items: { type: "string", enum: ["from", "to", "cc", "bcc"] } }, since: { type: "string" }, until: { type: "string" }, limit: { type: "number" }, maskPersonalAddresses: { type: "boolean" }, returnRawAddresses: { type: "boolean" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.projectContacts(args)) },
    { name: "email_digest", label: "Email digest", description: "只读生成收件箱今日简报数据；模型可据此生成摘要，不执行邮件副作用。", parameters: { ...objectSchema, properties: { accountId: { type: "string" }, since: { type: "string" }, until: { type: "string" }, limit: { type: "number" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.digest(args)) },
    { name: "email_get_thread", label: "Read email thread", description: "读取一个邮件线程。", parameters: { ...objectSchema, required: ["accountId", "threadId"], properties: { accountId: { type: "string" }, threadId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.thread(args.accountId, args.threadId)) },
    { name: "email_list_attachments", label: "List email attachments", description: "列出一条邮件消息的附件元数据。", parameters: { ...objectSchema, required: ["accountId", "messageId"], properties: { accountId: { type: "string" }, messageId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.listAttachments(args.accountId, args.messageId)) },
    { name: "email_list_scheduled_sends", label: "List scheduled email sends", description: "列出已确认但尚未到时间发送的邮件计划。", parameters: objectSchema as ToolDefinition["parameters"], execute: async () => toolResult(await handlers.scheduledSends()) },
    { name: "email_list_pending_sends", label: "List pending email sends", description: "列出仍在撤回窗口内的待发送邮件；只读，不会触发发送。", parameters: objectSchema as ToolDefinition["parameters"], execute: async () => toolResult(await handlers.pendingSends()) },
    { name: "email_list_analyses", label: "List email AI analyses", description: "列出已保存的邮件 AI 分析，可按 accountId 与 threadId 过滤。", parameters: { ...objectSchema, properties: { accountId: { type: "string" }, threadId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.listAnalyses(args)) },
  ];
}

/**
 * Mutation tools (provider state changes). All go through Cordis
 * service handlers; require user confirmation in the underlying
 * handlers as appropriate.
 */
function buildMutationTools(handlers: EmailToolHandlers): ToolDefinition[] {
  return [
    { name: "email_save_rule", label: "Save email rule", description: "保存 AI 邮件规则。规则禁止删除/垃圾邮件动作，运行时只生成需确认的处理计划；可启用定时扫描，但不会自动执行远端写操作。", parameters: { ...objectSchema, required: ["name", "actions"], properties: { name: { type: "string" }, ruleId: { type: "string" }, enabled: { type: "boolean" }, condition: { type: "object" }, actions: { type: "array" }, schedule: { type: "object", properties: { intervalMinutes: { type: "integer", minimum: 15, maximum: 10080 }, nextRunAt: { type: "string" } } } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.saveRule(args)) },
    { name: "email_run_rule", label: "Run email rule", description: "运行本地邮件规则，只返回匹配线程和 dry-run 处理计划，不会直接写入邮箱。", parameters: { ...objectSchema, required: ["ruleId"], properties: { ruleId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.runRule(args.ruleId)) },
    { name: "email_delete_rule", label: "Delete email rule", description: "删除本地邮件规则，不修改远端邮件。", parameters: { ...objectSchema, required: ["ruleId"], properties: { ruleId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.deleteRule(args.ruleId)) },
    { name: "email_prepare_processing_plan", label: "Prepare email processing plan", description: "根据 AI/用户建议生成只读处理预览；禁止删除和垃圾邮件操作，不会修改 provider。", parameters: { ...objectSchema, required: ["operations"], properties: { operations: { type: "array" }, expiresInMs: { type: "number" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.prepareProcessingPlan(args)) },
    { name: "email_confirm_processing_plan", label: "Confirm email processing plan", description: "请求用户确认处理计划，返回一次性执行 token。", parameters: { ...objectSchema, required: ["planId"], properties: { planId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.confirmProcessingPlan(args.planId)) },
    { name: "email_execute_processing_plan", label: "Execute email processing plan", description: "使用确认 token 执行已预览的邮件管理计划；计划指纹变化或过期会失败。", parameters: { ...objectSchema, required: ["planId", "confirmationToken"], properties: { planId: { type: "string" }, confirmationToken: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.executeProcessingPlan(args.planId, args.confirmationToken)) },
    { name: "email_cancel_processing_plan", label: "Cancel email processing plan", description: "取消尚未执行的邮件处理计划，撤销其确认 token 并持久化取消状态。", parameters: { ...objectSchema, required: ["planId"], properties: { planId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.cancelProcessingPlan(args.planId)) },
    { name: "email_update_thread", label: "Manage email thread", description: "管理邮件线程；批量操作先使用 dryRun，删除、垃圾邮件和延后处理必须确认或提供有效时间。", parameters: { ...objectSchema, required: ["accountId", "threadId", "kind"], properties: { accountId: { type: "string" }, threadId: { type: "string" }, threadIds: { type: "array", items: { type: "string" } }, kind: { type: "string", enum: ["mark-read", "mark-unread", "archive", "restore", "label", "star", "trash", "spam", "snooze"] }, labelId: { type: "string" }, value: { type: "boolean" }, snoozeUntil: { type: "string" }, dryRun: { type: "boolean" }, sampleLimit: { type: "number" }, confirmed: { type: "boolean" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.update(args)) },
    { name: "email_set_sender_policy", label: "Set sender policy", description: "将发件人未来邮件归类为 Signal、Noise 或阻断；block 仍需要用户确认。", parameters: { ...objectSchema, required: ["senderEmail", "policy"], properties: { senderEmail: { type: "string" }, policy: { type: "string" }, accountId: { type: "string" }, threadId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.setSenderPolicy(args)) },
    { name: "email_share_thread", label: "Share email thread", description: "将邮件线程分享到已授权的协作频道；分享副作用需要用户确认。", parameters: { ...objectSchema, required: ["accountId", "threadId", "channelId"], properties: { accountId: { type: "string" }, threadId: { type: "string" }, channelId: { type: "string" }, message: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.shareThread(args)) },
    { name: "email_create_followup", label: "Create email follow-up", description: "为邮件线程创建一次性跟进提醒。", parameters: { ...objectSchema, required: ["accountId", "threadId", "description", "remindAt"], properties: { accountId: { type: "string" }, threadId: { type: "string" }, description: { type: "string" }, remindAt: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.createReminder(args)) },
    { name: "email_move_to_project", label: "Move email to project", description: "将邮件线程关联到项目；项目变更需要用户确认。", parameters: { ...objectSchema, required: ["accountId", "threadId"], properties: { accountId: { type: "string" }, threadId: { type: "string" }, projectId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.moveToProject(args)) },
    { name: "email_download_attachment", label: "Download email attachment", description: "将附件下载到用户明确选择的绝对目录；不会写入未授权路径。", parameters: { ...objectSchema, required: ["accountId", "attachmentId", "messageId", "destinationDir"], properties: { accountId: { type: "string" }, attachmentId: { type: "string" }, messageId: { type: "string" }, destinationDir: { type: "string", description: "用户选择的绝对目录" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.downloadAttachment(args.accountId, args.attachmentId, args.messageId, args.destinationDir)) },
    { name: "email_action_center_create_reminders", label: "Create follow-up reminders from AI action center", description: "把 AI 行动中心匹配到的待办行动项批量转为本地跟进提醒。默认 dry-run；confirmed=true 才真正创建（一次性确认整批），重复执行幂等。只处理 kind=actions 且 dueAt 在未来的分析行动项。", parameters: { ...objectSchema, properties: { accountId: { type: "string" }, categories: { type: "array", items: { type: "string", enum: ["urgent", "needs-reply", "waiting-for-reply", "noise", "normal"] } }, owner: { type: "string" }, dueBefore: { type: "string" }, senderDomain: { type: "string" }, workspaceTagIds: { type: "array", items: { type: "string" } }, confirmed: { type: "boolean" }, dryRun: { type: "boolean" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.actionCenterCreateReminders(args)) },
    { name: "email_update_workspace_tags", label: "Update workspace email tags", description: "按 add/remove/replace 更新 OpenBuddy 工作区标签。", parameters: { ...objectSchema, required: ["accountId", "threadId", "tagNames"], properties: { accountId: { type: "string" }, threadId: { type: "string" }, tagNames: { type: "array", items: { type: "string" } }, mode: { type: "string", enum: ["add", "remove", "replace"] } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.updateWorkspaceTags(args)) },
  ];
}

/**
 * Compose tools (drafts / scheduled sends). All require user
 * confirmation before any send-side effect.
 */
function buildComposeTools(handlers: EmailToolHandlers): ToolDefinition[] {
  return [
    { name: "email_list_drafts", label: "List email drafts", description: "列出本地持久化的未发送草稿。", parameters: { ...objectSchema, properties: { accountId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.drafts(args.accountId)) },
    { name: "email_create_draft", label: "Create email draft", description: "创建或更新邮件草稿；body 使用 Markdown，bodyHtml 可由 Composer 提供清洗后的 HTML，发送前仍需用户确认。", parameters: { ...objectSchema, required: ["accountId", "to", "subject", "body"], properties: { accountId: { type: "string" }, draftId: { type: "string" }, to: { type: "array", items: { type: "object" } }, cc: { type: "array", items: { type: "object" } }, bcc: { type: "array", items: { type: "object" } }, replyTo: { type: "array", items: { type: "object" } }, subject: { type: "string" }, body: { type: "string" }, bodyHtml: { type: "string" }, attachments: { type: "array", items: { type: "string" } }, threadId: { type: "string" }, messageId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.createDraft(args)) },
    { name: "email_prepare_schedule_send", label: "Prepare scheduled email send", description: "校验计划发送草稿和时间，并返回一次性用户确认凭证；不会发送邮件。", parameters: { ...objectSchema, required: ["draftId", "scheduledAt"], properties: { draftId: { type: "string" }, scheduledAt: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.prepareScheduleSend(args.draftId, args.scheduledAt)) },
    { name: "email_schedule_send", label: "Schedule email send", description: "只有用户确认后才能创建计划发送；confirmationToken 必须来自 email_prepare_schedule_send。", parameters: { ...objectSchema, required: ["draftId", "scheduledAt", "confirmationToken"], properties: { draftId: { type: "string" }, scheduledAt: { type: "string" }, confirmationToken: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.scheduleSend(args.draftId, args.scheduledAt, args.confirmationToken)) },
    { name: "email_prepare_send", label: "Prepare email send", description: "为用户确认准备一次性发送凭证；不会发送邮件。", parameters: { ...objectSchema, required: ["draftId"], properties: { draftId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.prepareSend(args.draftId)) },
    { name: "email_send_draft", label: "Send email draft", description: "只有用户确认后才能发送；confirmationToken 必须为 send:<draftId>。", parameters: { ...objectSchema, required: ["draftId", "confirmationToken"], properties: { draftId: { type: "string" }, confirmationToken: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.sendDraft(args.draftId, args.confirmationToken)) },
  ];
}

/**
 * Analysis tools (save / list / consume AI analyses). The save path
 * never sends email or mutates provider state; consumption paths
 * create local reminders and never push to provider either.
 */
function buildAnalysisTools(handlers: EmailToolHandlers): ToolDefinition[] {
  return [
    { name: "email_save_analysis", label: "Save email AI analysis", description: "保存结构化邮件分析（summary/actions/risks/reply/meeting），邮件事实必须带 messageId 引用，背景资料使用独立的 contextCitations 并由运行时校验；不会发送邮件，不会修改邮件原文。", parameters: { ...objectSchema, required: ["accountId", "threadId", "kind", "confidence"], properties: { accountId: { type: "string" }, threadId: { type: "string" }, kind: { type: "string", enum: ["summary", "actions", "risk", "reply", "meeting"] }, summary: { type: "string" }, confidence: { type: "number", description: "0 到 1 之间的置信度" }, facts: { type: "array" }, actions: { type: "array" }, risks: { type: "array" }, replyDraft: { type: "object" }, meetingProposal: { type: "object" }, linkedDraftId: { type: "string" }, linkedReminderId: { type: "string" }, linkedTaskControlId: { type: "string" }, linkedTaskIds: { type: "array", items: { type: "string" } }, linkedCalendarTaskId: { type: "string" }, linkedCalendarEventId: { type: "string" } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.saveAnalysis(args)) },
    { name: "email_create_reminders_from_analysis", label: "Create email follow-up reminders", description: "将已保存 AI 行动项转换为本地跟进提醒；需要用户确认，行动项必须包含未来 dueAt，重复执行幂等。", parameters: { ...objectSchema, required: ["analysisId"], properties: { analysisId: { type: "string" }, actionIndexes: { type: "array", items: { type: "integer" } } } } as ToolDefinition["parameters"], execute: async (_id, args: ToolArgs) => toolResult(await handlers.createRemindersFromAnalysis({ analysisId: args.analysisId, ...(args.actionIndexes === undefined ? {} : { actionIndexes: args.actionIndexes }) })) },
  ];
}

/**
 * Phase C.1 — composes the four tool categories into a single flat
 * list. Pre-C.1 this was the 50-line `createEmailToolDefinitions`
 * function inside index.ts that mixed every category inline.
 */
export function createEmailToolDefinitions(handlers: EmailToolHandlers): ToolDefinition[] {
  return [
    ...buildReadOnlyTools(handlers),
    ...buildMutationTools(handlers),
    ...buildComposeTools(handlers),
    ...buildAnalysisTools(handlers),
  ];
}

/**
 * Phase C.1 — list of tool names that the read-only subset exposes.
 * Pre-C.1 this was an inline `.filter(...)` call inside
 * `createEmailReadOnlyPiTools` that hard-coded the read-only subset
 * across the full tool list (so adding a new read-only tool required
 * editing two places). Now this list is co-located with the tool
 * definitions so adding `email_foo` to `buildReadOnlyTools` only
 * requires adding `"email_foo"` here.
 */
export const EMAIL_READ_ONLY_TOOL_NAMES = [
  "email_list_accounts",
  "email_list_rules",
  "email_sync",
  "email_sync_states",
  "email_search",
  "email_threads_page",
  "email_workspace_tags",
  "email_reply_zero",
  "email_digest",
  "email_get_thread",
  "email_list_attachments",
  "email_list_scheduled_sends",
  "email_list_pending_sends",
  "email_save_analysis",
  "email_list_analyses",
  "email_extract_action_candidates",
  "email_action_center_query",
  "email_contact_projection",
] as const;

/**
 * Phase C.1 — read-only subset factory. Pre-C.1 inlined a giant
 * `.includes(tool.name)` list; now delegates to `createEmailToolDefinitions`
 * + the co-located `EMAIL_READ_ONLY_TOOL_NAMES`.
 */
export function createReadOnlyEmailToolDefinitions(handlers: EmailToolHandlers): ToolDefinition[] {
  const names = new Set<string>(EMAIL_READ_ONLY_TOOL_NAMES);
  return createEmailToolDefinitions(handlers).filter((tool) => names.has(tool.name));
}