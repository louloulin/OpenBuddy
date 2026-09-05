/**
 * pi-client-email.ts — email + calendar IPC wrappers.
 *
 * Phase 3 (架构高内聚低耦合): extracted from `pi-client.ts` (~200 lines).
 * Thin typed wrappers over the versioned Electron preload API for the
 * email and calendar capabilities. Self-contained: no dependency on the
 * rest of pi-client.ts beyond the shared `invoke` helper.
 */
import { invoke } from "@/lib/platform/electron-api";
import type { EmailProviderDiagnostic } from "@openbuddy/capability-email";
export type { EmailProviderDiagnostic } from "@openbuddy/capability-email";

export type {
  EmailAccount,
  EmailAddress,
  EmailAttachment,
  EmailAttachmentDownload,
  EmailComposeInput,
  EmailDraft,
  EmailLabel,
  EmailMessage,
  EmailMutationInput,
  EmailUnsubscribeInput,
  EmailUnsubscribeResult,
  EmailManagementCapability,
  EmailSenderPolicyInput,
  EmailMutationResult,
  EmailPendingSend,
  EmailDigestSnapshot,
  EmailReplyZeroItem,
  EmailReplyZeroSnapshot,
  EmailScheduledSend,
  EmailSearchInput,
  EmailSyncInput,
  EmailSyncState,
  EmailSyncResult,
  EmailTriageSnapshot,
  EmailProcessingPlan,
  EmailProcessingPlanInput,
  EmailThread,
  EmailThreadPage,
  EmailThreadPreview,
  EmailWorkspaceTag,
  EmailTagMutationInput,
  EmailProjectThread,
  EmailAnalysisRecord,
  EmailAnalysisContextCitation,
  EmailAnalysisMeetingProposal,
  EmailAnalysisKind,
  EmailAnalysisSaveInput,
  EmailAnalysisReviewInput,
  EmailAnalysisLinkInput,
  EmailAnalysisReminderInput,
  EmailAnalysisReminderResult,
  EmailInboxReceipt,
  EmailRule,
  EmailRuleAction,
  EmailRuleCondition,
  EmailRuleInput,
  EmailRuleRunResult,
  EmailProcessingPlanKind,
  EmailTriageCategory,
  EmailConnection,
  EmailConnectionReadiness,
} from "@openbuddy/capability-email";
import type {
  EmailAccount,
  EmailAttachment,
  EmailAttachmentDownload,
  EmailComposeInput,
  EmailDraft,
  EmailLabel,
  EmailMutationInput,
  EmailUnsubscribeInput,
  EmailUnsubscribeResult,
  EmailSenderPolicyInput,
  EmailMutationResult,
  EmailPendingSend,
  EmailDigestSnapshot,
  EmailReplyZeroSnapshot,
  EmailScheduledSend,
  EmailSearchInput,
  EmailSyncInput,
  EmailSyncState,
  EmailSyncResult,
  EmailTriageSnapshot,
  EmailProcessingPlan,
  EmailProcessingPlanInput,
  EmailThread,
  EmailThreadPage,
  EmailThreadPreview,
  EmailWorkspaceTag,
  EmailTagMutationInput,
  EmailProjectThread,
  EmailAnalysisRecord,
  EmailAnalysisSaveInput,
  EmailAnalysisReviewInput,
  EmailAnalysisLinkInput,
  EmailAnalysisReminderInput,
  EmailAnalysisReminderResult,
  EmailInboxReceipt,
  EmailRule,
  EmailRuleInput,
  EmailRuleRunResult,
  EmailScheduledRuleRunResult,
  EmailConnection,
  EmailConnectionReadiness,
  EmailRegistryProviderType,
  EmailProviderRegistryDiagnostic,
} from "@openbuddy/capability-email";

export const emailListAccounts = () => invoke<EmailAccount[]>("email:accounts");
export const emailProviderDiagnostics = () => invoke<EmailProviderDiagnostic>("email:provider-diagnostics");
/** R7.1 — 让 renderer 主动丢弃缓存的 provider,授权后无需重启即可看到账户。 */
export const emailInvalidateProvider = () => invoke<{ ok: true }>("email:invalidate-provider");
export const emailListRegistryConnections = () => invoke<EmailConnection[]>("email:registry-list");
export const emailRegistryReadiness = () => invoke<EmailConnectionReadiness[]>("email:registry-readiness");
export const emailSetRegistryEnabled = (id: string, enabled: boolean) => invoke<EmailConnection>("email:registry-set-enabled", { id, enabled });
export const emailReauthorizeRegistryConnection = (id: string) => invoke<EmailConnection>("email:registry-reauthorize", { id });
export interface EmailRegistryRegisterPayload {
  id?: string;
  providerType: EmailRegistryProviderType;
  displayName: string;
  credentialRef?: string;
  mcpServerName?: string;
  scopes?: string[];
  enabledCapabilities?: string[];
  enabled?: boolean;
}
export const emailRegisterRegistryConnection = (input: EmailRegistryRegisterPayload) => invoke<EmailConnection>("email:registry-register", input);
export const emailRemoveRegistryConnection = (id: string) => invoke<{ id: string; removed: boolean }>("email:registry-remove", { id });
export const emailRegistryDiagnostics = () => invoke<EmailProviderRegistryDiagnostic | null>("email:registry-diagnostics");
export const emailListRules = () => invoke<EmailRule[]>("email:rules");
export const emailSaveRule = (input: EmailRuleInput) => invoke<EmailRule>("email:save-rule", input);
export const emailDeleteRule = (ruleId: string) => invoke<void>("email:delete-rule", { ruleId });
export const emailRunRule = (ruleId: string) => invoke<EmailRuleRunResult>("email:run-rule", { ruleId });
export const emailRunScheduledRules = () => invoke<EmailScheduledRuleRunResult[]>("email:run-scheduled-rules");
export const emailSync = (input: EmailSyncInput) => invoke<EmailSyncResult>("email:sync", input);
export const emailListSyncStates = (accountId?: string) => invoke<EmailSyncState[]>("email:sync-states", accountId ? { accountId } : {});
export const emailTriage = (input: EmailSearchInput = {}) => invoke<EmailTriageSnapshot>("email:triage", input);
export const emailPrepareProcessingPlan = (input: EmailProcessingPlanInput) => invoke<EmailProcessingPlan>("email:prepare-processing-plan", input);
export const emailConfirmProcessingPlan = (planId: string) => invoke<string>("email:confirm-processing-plan", { planId });
export const emailExecuteProcessingPlan = (planId: string, confirmationToken: string) => invoke<EmailProcessingPlan>("email:execute-processing-plan", { planId, confirmationToken });
export const emailCancelProcessingPlan = (planId: string) => invoke<EmailProcessingPlan>("email:cancel-processing-plan", { planId });
export const emailListProcessingPlans = () => invoke<EmailProcessingPlan[]>("email:processing-plans");

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  timeZone?: string;
  allDay: boolean;
  status: "confirmed" | "tentative" | "cancelled";
  roomId: string;
  contextRefs: string[];
  description?: string;
  location?: string;
  attendees: string[];
  createdAt: string;
  updatedAt: string;
}

export const calendarList = (input: { from?: string; to?: string; roomId?: string; contextRef?: string } = {}) => invoke<CalendarEvent[]>("calendar:list", input);
/**
 * @deprecated Stage B — todo list moved to pi-native (juicesharp/rpiv-todo
 * when installed; otherwise the bundled pi todo tool). Kept as a marker so
 * the renderer knows not to import it; the IPC channels were deleted.
 */
export interface SessionTaskEntry {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  createdAt: string;
  updatedAt: string;
  order: number;
}

export const calendarCreate = (input: { title: string; start: string; end: string; timeZone?: string; allDay?: boolean; status?: CalendarEvent["status"]; roomId?: string; contextRefs?: string[]; description?: string; location?: string; attendees?: string[] }) => invoke<CalendarEvent>("calendar:create", input);
export const calendarUpdate = (id: string, patch: Partial<Omit<CalendarEvent, "id" | "createdAt" | "updatedAt" | "roomId">>) => invoke<CalendarEvent | null>("calendar:update", { id, patch });
export const calendarDelete = (id: string) => invoke<boolean>("calendar:delete", id);
export const emailListDrafts = (accountId?: string) => invoke<EmailDraft[]>("email:drafts", accountId ? { accountId } : {});
export const emailListThreads = (input: EmailSearchInput = {}) => invoke<EmailThreadPreview[]>("email:threads", input);
export const emailListThreadsPage = (input: EmailSearchInput = {}) => invoke<EmailThreadPage>("email:threads-page", input);
export const emailReplyZero = (input: EmailSearchInput = {}) => invoke<EmailReplyZeroSnapshot>("email:reply-zero", input);
export const emailDigest = (input: EmailSearchInput = {}) => invoke<EmailDigestSnapshot>("email:digest", input);
export const emailListAnalyses = (input: { accountId?: string; threadId?: string } = {}) => invoke<EmailAnalysisRecord[]>("email:analyses", input);
export const emailAcknowledgeInbox = (accountId: string, threadId: string, messageDate?: string) => invoke<EmailInboxReceipt>("email:ack-inbox", { accountId, threadId, ...(messageDate ? { messageDate } : {}) });
export const emailSaveAnalysis = (input: EmailAnalysisSaveInput) => invoke<EmailAnalysisRecord>("email:save-analysis", input);
export const emailReviewAnalysis = (input: EmailAnalysisReviewInput) => invoke<EmailAnalysisRecord>("email:review-analysis", input);
export const emailLinkAnalysis = (input: EmailAnalysisLinkInput) => invoke<EmailAnalysisRecord>("email:link-analysis", input);
export const emailCreateRemindersFromAnalysis = (input: EmailAnalysisReminderInput) => invoke<EmailAnalysisReminderResult>("email:create-reminders-from-analysis", input);
export const emailActionCenterQuery = (input: Parameters<typeof import("@openbuddy/capability-email").emailHandlers.actionCenterQuery>[0] = {}) => invoke<unknown>("email:action-center-query", input);
export const emailContactProjection = (input: Parameters<typeof import("@openbuddy/capability-email").emailHandlers.projectContacts>[0] = {}) => invoke<unknown>("email:contact-projection", input);
export const emailActionCenterCreateReminders = (input: Parameters<typeof import("@openbuddy/capability-email").emailHandlers.actionCenterCreateReminders>[0] = {}) => invoke<Awaited<ReturnType<typeof import("@openbuddy/capability-email").emailHandlers.actionCenterCreateReminders>>>("email:action-center-create-reminders", input);
export const emailPrepareScheduleSend = (draftId: string, scheduledAt: string) => invoke<string>("email:prepare-schedule-send", { draftId, scheduledAt });
export const emailScheduleSend = (draftId: string, scheduledAt: string, confirmationToken: string) => invoke<EmailScheduledSend>("email:schedule-send", { draftId, scheduledAt, confirmationToken });
export const emailCancelScheduledSend = (scheduleId: string) => invoke<void>("email:cancel-scheduled-send", { scheduleId });
export const emailListScheduledSends = () => invoke<EmailScheduledSend[]>("email:scheduled-sends");
export const emailListPendingSends = () => invoke<EmailPendingSend[]>("email:pending-sends");
export const emailCancelPendingSend = (pendingId: string) => invoke<void>("email:cancel-pending-send", { pendingId });
export const emailGetThread = (accountId: string, threadId: string) => invoke<EmailThread>("email:thread", { accountId, threadId });
export const emailListProjectThreads = (projectId: string, limit = 50) => invoke<EmailProjectThread[]>("email:project-threads", { projectId, limit });
export const emailListLabels = (accountId: string) => invoke<EmailLabel[]>("email:labels", { accountId });
export const emailListWorkspaceTags = () => invoke<EmailWorkspaceTag[]>("email:workspace-tags");
export const emailUpdateWorkspaceTags = (input: EmailTagMutationInput) => invoke<EmailWorkspaceTag[]>("email:update-workspace-tags", input);
export const emailUpdateThread = (input: EmailMutationInput) => invoke<EmailMutationResult>("email:update", input);
export const emailUnsubscribe = (input: EmailUnsubscribeInput) => invoke<EmailUnsubscribeResult>("email:unsubscribe", input);
export const emailSetSenderPolicy = (input: EmailSenderPolicyInput) => invoke<EmailMutationResult>("email:sender-policy", input);
export const emailShareThread = (input: { accountId: string; threadId: string; channelId: string; message?: string }) => invoke<EmailMutationResult>("email:share-thread", input);
export const emailCreateFollowup = (input: { accountId: string; threadId: string; description: string; remindAt: string }) => invoke<EmailMutationResult>("email:create-reminder", input);
export const emailMoveToProject = (input: { accountId: string; threadId: string; projectId?: string }) => invoke<EmailMutationResult>("email:move-to-project", input);
export const emailListAttachments = (accountId: string, messageId: string) => invoke<EmailAttachment[]>("email:attachments", { accountId, messageId });
export const emailDownloadAttachment = (accountId: string, attachmentId: string, messageId: string, destinationDir: string) => invoke<EmailAttachmentDownload>("email:attachment-download", { accountId, attachmentId, messageId, destinationDir });
export const emailCreateDraft = (input: EmailComposeInput) => invoke<EmailDraft>("email:create-draft", input);
export const emailPrepareSend = (draftId: string) => invoke<string>("email:prepare-send", { draftId });
export const emailQueueSend = (draftId: string, confirmationToken: string, undoWindowMs = 5_000) => invoke<EmailPendingSend>("email:queue-send", { draftId, confirmationToken, undoWindowMs });
export const emailSendDraft = (draftId: string, confirmationToken: string) => invoke<EmailMutationResult>("email:send-draft", { draftId, confirmationToken });
