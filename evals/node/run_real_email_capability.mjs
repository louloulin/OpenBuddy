import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const baseUrl = (process.env.OPENBUDDY_HARNESS_URL ?? "").replace(/\/+$/, "");
const token = process.env.OPENBUDDY_HARNESS_TOKEN ?? "";
if (process.env.OPENBUDDY_E2E_REQUIRED !== "1" || !baseUrl || !token) {
  console.error("real-email-capability requires OPENBUDDY_E2E_REQUIRED=1 and Electron Harness credentials");
  process.exit(2);
}

const digest = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
const safeError = (error) => String(error?.message ?? error ?? "unknown error").replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted-api-key]").slice(0, 300);
function rpc(method, payload = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/api/${method}`);
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const body = JSON.stringify({ type: "client-request", rpcId: `email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, method, payload });
    const request = transport(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, connection: "close" }, agent: false }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => { try { resolve(JSON.parse(text)); } catch { reject(new Error(`non-JSON response from ${method}`)); } });
    });
    request.on("error", reject);
    request.end(body);
  });
}
function value(response, label) {
  if (!response?.result?.ok) throw new Error(`${label} failed: ${response?.result?.error?.message ?? "unknown RPC error"}`);
  return response.result.value;
}
async function check(name, fn) {
  try { const result = await fn(); return { name, ok: true, result }; }
  catch (error) { return { name, ok: false, error: safeError(error), errorDigest: digest(error) }; }
}

const checks = [];
let draft;
checks.push(await check("mcp-ready", async () => {
  let statuses = [];
  let status;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    statuses = value(await rpc("capability.mcp", { action: "status" }), "mcp.status");
    status = statuses.find((entry) => entry.serverName === "mail-e2e");
    if (status?.status === "ready") break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!status || status.status !== "ready" || status.toolCount < 8) throw new Error(`mail-e2e not ready: ${JSON.stringify(statuses)}`);
  return { server: status.serverName, status: status.status, toolCount: status.toolCount };
}));
checks.push(await check("accounts-search-thread-labels", async () => {
  const accounts = value(await rpc("capability.email", { action: "accounts" }), "email.accounts");
  if (accounts.length !== 1 || accounts[0].address !== "agent@example.test") throw new Error("account normalization failed");
  const search = value(await rpc("capability.email", { action: "threads", query: "真实 MCP" }), "email.search");
  if (search.length !== 1 || search[0].id !== "thread-1") throw new Error("search did not find seeded thread");
  const page = value(await rpc("capability.email", { action: "threads-page", accountId: "mail-account-1" }), "email.threads-page");
  if (page.items?.length !== 1 || page.nextCursor !== "page-2") throw new Error("cursor page normalization failed");
  const thread = value(await rpc("capability.email", { action: "thread", accountId: "mail-account-1", threadId: "thread-1" }), "email.thread");
  const labels = value(await rpc("capability.email", { action: "labels", accountId: "mail-account-1" }), "email.labels");
  if (thread.messages?.length !== 1 || labels.length < 2) throw new Error("thread/labels normalization failed");
  return { account: accounts[0].id, searchCount: search.length, messageCount: thread.messages.length, labelCount: labels.length };
}));
checks.push(await check("reply-zero-and-digest", async () => {
  const replyZero = value(await rpc("capability.email", { action: "reply-zero", accountId: "mail-account-1" }), "email.reply-zero");
  const digest = value(await rpc("capability.email", { action: "digest", accountId: "mail-account-1" }), "email.digest");
  if (!Array.isArray(replyZero.needsReply) || replyZero.needsReply[0]?.threadId !== "thread-1") throw new Error("Reply Zero did not classify the seeded incoming thread");
  if (digest.total !== 1 || digest.unread !== 1 || !Array.isArray(digest.highlights)) throw new Error("email digest contract failed");
  return { needsReply: replyZero.needsReply.length, waitingForReply: replyZero.waitingForReply.length, total: digest.total, unread: digest.unread };
}));
checks.push(await check("structured-ai-analysis-review-and-reminders", async () => {
  const thread = value(await rpc("capability.email", { action: "thread", accountId: "mail-account-1", threadId: "thread-1" }), "email.analysis.thread");
  const sourceMessageId = thread.messages?.[0]?.id;
  if (!sourceMessageId) throw new Error("analysis source message was not available");
  const analysis = value(await rpc("capability.email", {
    action: "save-analysis",
    accountId: "mail-account-1",
    threadId: "thread-1",
    kind: "actions",
    confidence: 0.91,
    summary: "真实 MCP 行动项分析",
    facts: [{ statement: "The seeded thread has a source message", citations: [{ messageId: sourceMessageId }] }],
    actions: [{ content: "Review the seeded thread", dueAt: "2030-01-01T09:00:00.000Z", citations: [{ messageId: sourceMessageId }] }],
    risks: [],
  }), "email.save-analysis");
  if (!analysis?.id || analysis.review !== "pending" || analysis.actions?.length !== 1) throw new Error("structured analysis was not persisted");
  const listed = value(await rpc("capability.email", { action: "analyses", accountId: "mail-account-1", threadId: "thread-1" }), "email.analyses");
  if (!listed.some((entry) => entry.id === analysis.id && entry.actions?.[0]?.citations?.[0]?.messageId === sourceMessageId)) throw new Error("analysis listing lost source citation");
  const unconfirmed = await rpc("capability.email", { action: "create-reminders-from-analysis", analysisId: analysis.id, actionIndexes: [0] });
  if (unconfirmed?.result?.ok === true || unconfirmed?.result?.error?.code !== "confirmation_required") throw new Error(`analysis reminder confirmation boundary failed: ${JSON.stringify({ ok: unconfirmed?.result?.ok, error: unconfirmed?.result?.error })}`);
  const created = value(await rpc("capability.email", { action: "create-reminders-from-analysis", analysisId: analysis.id, actionIndexes: [0], confirmed: true }), "email.create-reminders-from-analysis");
  if (created.analysis?.review !== "accepted" || created.reminders?.length !== 1 || !created.reminders[0]?.receipt) throw new Error("analysis reminder creation was not observable");
  const repeated = value(await rpc("capability.email", { action: "create-reminders-from-analysis", analysisId: analysis.id, actionIndexes: [0], confirmed: true }), "email.create-reminders-from-analysis.idempotent");
  if (repeated.reminders?.[0]?.receipt !== created.reminders[0].receipt) throw new Error("analysis reminder creation was not idempotent");
  return { analysis: digest(analysis.id), sourceMessage: digest(sourceMessageId), confirmationRequired: true, reminder: digest(created.reminders[0].receipt), idempotent: true, review: created.analysis.review };
}));
checks.push(await check("processing-plan-preview-confirm-execute", async () => {
  const before = value(await rpc("capability.email", { action: "threads-page", accountId: "mail-account-1" }), "email.processing-plan.before").items?.find((item) => item.id === "thread-1");
  if (!before) throw new Error("seeded thread was not available for processing plan");
  const originalStarred = before.starred === true;
  const targetStarred = !originalStarred;
  const plan = value(await rpc("capability.email", { action: "prepare-processing-plan", operations: [{ accountId: "mail-account-1", threadIds: ["thread-1"], kind: "star", value: targetStarred, rationale: "isolated processing plan contract" }] }), "email.prepare-processing-plan");
  if (!plan?.id || plan.status !== "pending" || !plan.previews?.every((preview) => preview.dryRun === true)) throw new Error("processing plan preview contract failed");
  const afterPreview = value(await rpc("capability.email", { action: "threads-page", accountId: "mail-account-1" }), "email.processing-plan.after-preview").items?.find((item) => item.id === "thread-1");
  if ((afterPreview?.starred === true) !== originalStarred) throw new Error("processing plan preview performed a provider write");
  const confirmationToken = value(await rpc("capability.email", { action: "confirm-processing-plan", planId: plan.id }), "email.confirm-processing-plan");
  const executed = value(await rpc("capability.email", { action: "execute-processing-plan", planId: plan.id, confirmationToken }), "email.execute-processing-plan");
  if (executed.status !== "executed") throw new Error("processing plan did not execute");
  const afterExecution = value(await rpc("capability.email", { action: "threads-page", accountId: "mail-account-1" }), "email.processing-plan.after-execution").items?.find((item) => item.id === "thread-1");
  if ((afterExecution?.starred === true) !== targetStarred) throw new Error("processing plan execution was not observable");
  const restored = value(await rpc("capability.email", { action: "update", accountId: "mail-account-1", threadId: "thread-1", kind: "star", value: originalStarred }), "email.processing-plan.restore");
  if (!restored?.ok) throw new Error("processing plan state restoration failed");
  const cancelledPlan = value(await rpc("capability.email", { action: "prepare-processing-plan", operations: [{ accountId: "mail-account-1", threadIds: ["thread-1"], kind: "star", value: targetStarred, rationale: "isolated cancellation contract" }] }), "email.prepare-cancelled-processing-plan");
  const cancelledToken = value(await rpc("capability.email", { action: "confirm-processing-plan", planId: cancelledPlan.id }), "email.confirm-cancelled-processing-plan");
  const cancelled = value(await rpc("capability.email", { action: "cancel-processing-plan", planId: cancelledPlan.id }), "email.cancel-processing-plan");
  if (cancelled.status !== "cancelled") throw new Error("processing plan cancellation was not persisted");
  const cancelledExecution = await rpc("capability.email", { action: "execute-processing-plan", planId: cancelledPlan.id, confirmationToken: cancelledToken });
  const cancellationError = cancelledExecution?.result?.error;
  if (cancelledExecution?.result?.ok === true || (cancellationError?.code !== "confirmation_required" && !/确认|撤销|取消|不可执行/.test(String(cancellationError?.message ?? "")))) throw new Error("cancelled processing plan remained executable");
  const afterCancellation = value(await rpc("capability.email", { action: "threads-page", accountId: "mail-account-1" }), "email.processing-plan.after-cancellation").items?.find((item) => item.id === "thread-1");
  if ((afterCancellation?.starred === true) !== originalStarred) throw new Error("cancelled processing plan changed provider state");
  return { plan: digest(plan.id), cancelledPlan: digest(cancelledPlan.id), previewWasReadOnly: true, executed: true, cancelled: true, cancellationRejected: true, restored: true };
}));
checks.push(await check("update-dry-run-and-commit", async () => {
  const dryRun = value(await rpc("capability.email", { action: "update", accountId: "mail-account-1", threadId: "thread-1", kind: "mark-read", dryRun: true }), "email.update.dry-run");
  const committed = value(await rpc("capability.email", { action: "update", accountId: "mail-account-1", threadId: "thread-1", kind: "mark-read" }), "email.update");
  if (dryRun.dryRun !== true || committed.ok !== true) throw new Error("email update contract failed");
  const addLabel = value(await rpc("capability.email", { action: "update", accountId: "mail-account-1", threadId: "thread-1", kind: "label", labelId: "label-starred", value: true }), "email.label-add");
  const removeLabel = value(await rpc("capability.email", { action: "update", accountId: "mail-account-1", threadId: "thread-1", kind: "label", labelId: "label-starred", value: false }), "email.label-remove");
  if (!addLabel.ok || !removeLabel.ok) throw new Error("email label mutation failed");
  return { dryRun: dryRun.dryRun, committed: committed.ok, labelAdd: addLabel.ok, labelRemove: removeLabel.ok, receiptDigest: digest(committed.receipt) };
}));
checks.push(await check("local-integrations-and-safety", async () => {
  const rejectedDelete = await rpc("capability.email", { action: "update", accountId: "mail-account-1", threadId: "thread-1", kind: "trash" });
  if (rejectedDelete?.result?.ok === true || !String(rejectedDelete?.result?.error?.message ?? "").includes("确认")) throw new Error("destructive email update bypassed confirmation");
  const deleted = value(await rpc("capability.email", { action: "update", accountId: "mail-account-1", threadId: "thread-1", kind: "trash", confirmed: true }), "email.update.confirmed-delete");
  const policy = value(await rpc("capability.email", { action: "sender-policy", accountId: "mail-account-1", threadId: "thread-1", senderEmail: "sender@example.test", policy: "block", confirmed: true }), "email.sender-policy");
  const reminder = value(await rpc("capability.email", { action: "create-reminder", accountId: "mail-account-1", threadId: "thread-1", description: "E2E follow-up", remindAt: "2030-01-01T09:00:00.000Z" }), "email.reminder");
  const project = value(await rpc("capability.email", { action: "move-to-project", accountId: "mail-account-1", threadId: "thread-1", projectId: "project-e2e" }), "email.project");
  const share = value(await rpc("capability.email", { action: "share-thread", accountId: "mail-account-1", threadId: "thread-1", channelId: "work", message: "E2E shared thread" }), "email.share");
  const results = [deleted, policy, reminder, project, share];
  if (!results.every((result) => result.ok && typeof result.provider === "string" && typeof result.operation === "string")) throw new Error(`email provider result was incomplete: ${JSON.stringify(results.map(({ ok, provider, operation, receipt }) => ({ ok, provider, operation, receipt })))} `);
  return { destructiveConfirmed: deleted.ok, providers: [...new Set(results.map((result) => result.provider))], operations: results.map((result) => result.operation), policy: policy.ok, reminder: reminder.ok, project: project.ok, share: share.ok };
}));
checks.push(await check("draft-confirmation-send-audit", async () => {
  draft = value(await rpc("capability.email", { action: "create-draft", accountId: "mail-account-1", to: [{ address: "recipient@example.test" }], subject: "E2E draft", body: "隔离 MCP 草稿正文" }), "email.create-draft");
  const updatedDraft = value(await rpc("capability.email", { action: "create-draft", draftId: draft.id, accountId: "mail-account-1", to: [{ address: "recipient@example.test" }], subject: "E2E draft updated", body: "更新后的隔离 MCP 草稿正文" }), "email.update-draft");
  const drafts = value(await rpc("capability.email", { action: "drafts", accountId: "mail-account-1" }), "email.drafts");
  if (updatedDraft.id !== draft.id || drafts.length !== 1 || drafts[0].subject !== "E2E draft updated") throw new Error("draft update/list contract failed");
  const rejected = await rpc("capability.email", { action: "send-draft", draftId: draft.id, confirmationToken: "send:wrong" });
  if (rejected?.result?.ok === true || !String(rejected?.result?.error?.message ?? "").includes("确认")) throw new Error("invalid confirmation token was accepted");
  const tokenResponse = value(await rpc("capability.email", { action: "prepare-send", draftId: draft.id }), "email.prepare-send");
  const sent = value(await rpc("capability.email", { action: "send-draft", draftId: draft.id, confirmationToken: tokenResponse }), "email.send-draft");
  const audit = value(await rpc("capability.email", { action: "audit" }), "email.audit");
  const statuses = audit.filter((entry) => entry.resourceId === draft.id).map((entry) => entry.status);
  if (!sent.ok || !statuses.includes("requested") || !statuses.includes("confirmed") || !statuses.includes("completed")) throw new Error(`audit lifecycle incomplete: ${statuses.join(",")}`);
  if (JSON.stringify(audit).includes("隔离 MCP 草稿正文")) throw new Error("email body leaked into audit log");
  return { draft: digest(draft.id), draftUpdated: updatedDraft.id === draft.id, draftCount: drafts.length, sent: sent.ok, auditStatuses: statuses, tokenDigest: digest(tokenResponse) };
}));
checks.push(await check("scheduled-send-confirmation-and-cancel", async () => {
  const scheduledDraft = value(await rpc("capability.email", { action: "create-draft", accountId: "mail-account-1", to: [{ address: "recipient@example.test" }], subject: "E2E scheduled draft", body: "不会自动发送" }), "email.create-scheduled-draft");
  const rejected = await rpc("capability.email", { action: "schedule-send", draftId: scheduledDraft.id, scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  if (rejected?.result?.ok === true || !String(rejected?.result?.error?.message ?? "").includes("确认")) throw new Error(`scheduled send confirmation was bypassed: ${JSON.stringify({ ok: rejected?.result?.ok, code: rejected?.result?.error?.code, message: rejected?.result?.error?.message })}`);
  const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const scheduleToken = value(await rpc("capability.email", { action: "prepare-schedule-send", draftId: scheduledDraft.id, scheduledAt }), "email.prepare-schedule-send");
  const scheduled = value(await rpc("capability.email", { action: "schedule-send", draftId: scheduledDraft.id, scheduledAt, confirmationToken: scheduleToken }), "email.schedule-send");
  const listed = value(await rpc("capability.email", { action: "scheduled-sends" }), "email.scheduled-sends");
  if (scheduled.status !== "scheduled" || !listed.some((item) => item.id === scheduled.id)) throw new Error("scheduled send was not persisted");
  value(await rpc("capability.email", { action: "cancel-scheduled-send", scheduleId: scheduled.id }), "email.cancel-scheduled-send");
  const remaining = value(await rpc("capability.email", { action: "scheduled-sends" }), "email.scheduled-sends.after-cancel");
  if (remaining.some((item) => item.id === scheduled.id)) throw new Error("scheduled send was not cancelled");
  return { schedule: digest(scheduled.id), cancelled: true, sent: false };
}));

const failed = checks.filter((check) => !check.ok);
const report = {
  framework: "openbuddy-real-email-capability",
  schema: "openbuddy.redacted-evidence.v1",
  evidenceLevel: process.env.OPENBUDDY_E2E_EVIDENCE_LEVEL ?? (process.env.OPENBUDDY_E2E_EXTERNAL === "1" ? "real-external" : "real-local"),
  realE2E: true,
  capability: "email",
  capabilities: ["email"],
  transport: "Electron Harness -> dispatchTypedRpc -> Cordis Email -> MCP stdio child process",
  provider: "isolated-mcp-email-e2e",
  filesystem: "not-run-by-policy",
  passed: checks.length - failed.length,
  failed: failed.length,
  checks,
};
const evidenceDir = process.env.OPENBUDDY_EVIDENCE_DIR;
if (evidenceDir) { mkdirSync(evidenceDir, { recursive: true }); writeFileSync(`${evidenceDir}/email-mcp.json`, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ ...report, evidenceArtifact: evidenceDir ? `${evidenceDir}/email-mcp.json` : null }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
