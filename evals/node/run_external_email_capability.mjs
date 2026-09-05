import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";

const baseUrl = (process.env.OPENBUDDY_HARNESS_URL ?? "").replace(/\/+$/, "");
const token = process.env.OPENBUDDY_HARNESS_TOKEN ?? "";
const serverName = process.env.OPENBUDDY_EMAIL_MCP_SERVER?.trim();
const profile = process.env.OPENBUDDY_EMAIL_MCP_PROFILE?.trim() || "auto";
const evidenceDir = process.env.OPENBUDDY_EVIDENCE_DIR;
if (process.env.OPENBUDDY_E2E_REQUIRED !== "1" || !baseUrl || !token || !serverName) {
  console.error("external email capability requires OPENBUDDY_E2E_REQUIRED=1, harness credentials, and OPENBUDDY_EMAIL_MCP_SERVER");
  process.exit(2);
}

const digest = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
const safeError = (error) => String(error?.message ?? error ?? "unknown error")
  .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted-api-key]")
  .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted-token]")
  .slice(0, 300);

function rpc(method, payload = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/api/${method}`);
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const body = JSON.stringify({ type: "client-request", rpcId: `email-external-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, method, payload });
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
  try { return { name, ok: true, result: await fn() }; }
  catch (error) { return { name, ok: false, error: safeError(error), errorDigest: digest(error) }; }
}

function validateDownloadedAttachment(downloaded, destinationDir) {
  const localPath = String(downloaded?.localPath ?? "");
  const reportedName = String(downloaded?.name ?? "");
  if (!localPath || !reportedName) throw new Error("provider did not return attachment name and local path");
  const destinationRoot = realpathSync(destinationDir);
  const target = realpathSync(localPath);
  const relative = path.relative(destinationRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("downloaded attachment escaped the selected directory");
  if (lstatSync(localPath).isSymbolicLink() || !statSync(target).isFile()) throw new Error("downloaded attachment is not a regular file");
  if (reportedName !== path.basename(reportedName) || /[\\/\u0000-\u001f]/u.test(reportedName) || reportedName === "." || reportedName === "..") {
    throw new Error("provider returned an unsafe attachment filename");
  }
  if (path.basename(target) !== reportedName) throw new Error("downloaded filename does not match the sanitized attachment name");
  return { name: reportedName, bytes: statSync(target).size };
}

async function waitForRemoteThread({ accountId, folder, subject, timeoutMs = 8000 }) {
  const deadline = Date.now() + timeoutMs;
  let lastItems = [];
  while (Date.now() < deadline) {
    const page = value(await rpc("capability.email", { action: "threads-page", accountId, folder, query: subject, limit: 100 }), `email.${folder}.visibility`);
    lastItems = Array.isArray(page?.items) ? page.items : [];
    const match = lastItems.filter((item) => item.accountId === accountId && item.subject === subject);
    if (match.length > 0) return { items: match, page };
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { items: lastItems.filter((item) => item.accountId === accountId && item.subject === subject), page: undefined };
}

const checks = [];
const requestedModes = {
  management: process.env.OPENBUDDY_EMAIL_EXTERNAL_MANAGE === "1",
  write: process.env.OPENBUDDY_EMAIL_EXTERNAL_WRITE === "1",
  send: process.env.OPENBUDDY_EMAIL_EXTERNAL_SEND === "1",
  attachments: process.env.OPENBUDDY_EMAIL_EXTERNAL_ATTACHMENTS === "1",
  attachmentDownload: process.env.OPENBUDDY_EMAIL_EXTERNAL_ATTACHMENT_DOWNLOAD === "1",
  incrementalSync: process.env.OPENBUDDY_EMAIL_EXTERNAL_SYNC === "1",
  processingPlan: process.env.OPENBUDDY_EMAIL_EXTERNAL_PROCESSING_PLAN === "1",
  unsubscribe: process.env.OPENBUDDY_EMAIL_EXTERNAL_UNSUBSCRIBE === "1",
};
let account;
let firstThread;
let firstThreadDetail;
let providerDiagnostic;
checks.push(await check("provider-ready", async () => {
  let statuses = [];
  let status;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    statuses = value(await rpc("capability.mcp", { action: "status" }), "mcp.status");
    status = statuses.find((entry) => entry.serverName === serverName);
    if (status?.status === "ready") break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!status || status.status !== "ready") throw new Error(`MCP provider is not ready: ${JSON.stringify(statuses)}`);
  return { server: serverName, status: status.status, toolCount: status.toolCount, profile };
}));

checks.push(await check("accounts-and-read-capability", async () => {
  const accounts = value(await rpc("capability.email", { action: "accounts" }), "email.accounts");
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error("provider returned no mailbox accounts");
  const requiredManagement = ["star", "mark-read", "mark-unread"];
  const supportsRequiredManagement = (item) => requiredManagement.every((operation) => item.capabilities?.managementOperations?.includes(operation));
  const requiresManagement = requestedModes.management || requestedModes.processingPlan;
  account = accounts.find((item) => item.status === "connected" && item.capabilities?.read !== false && (!requiresManagement || supportsRequiredManagement(item))) ?? accounts.find((item) => item.status === "connected" && item.capabilities?.read !== false) ?? accounts[0];
  if (!account?.id || !account?.address) throw new Error("provider returned an invalid mailbox account");
  if (account.status !== "connected") throw new Error(`mailbox is not connected: ${account.status}`);
  return { account: digest(account.id), addressDomain: String(account.address).split("@")[1] ?? "unknown", count: accounts.length, capabilities: account.capabilities };
}));

checks.push(await check("provider-readiness-diagnostics", async () => {
  providerDiagnostic = value(await rpc("capability.email", { action: "provider-diagnostics" }), "email.provider-diagnostics");
  if (!providerDiagnostic || !Array.isArray(providerDiagnostic.accounts) || !Array.isArray(providerDiagnostic.operations)) throw new Error("provider diagnostics returned an invalid shape");
  if (!providerDiagnostic.profile || !providerDiagnostic.readiness) throw new Error("provider diagnostics omitted profile or readiness");
  const diagnosticAccount = providerDiagnostic.accounts.find((item) => item.id === account.id);
  if (!diagnosticAccount) throw new Error("selected mailbox is missing from provider diagnostics");
  for (const key of ["read", "write", "attachments", "multipleAccounts"]) {
    if (diagnosticAccount.capabilities?.[key] !== account.capabilities?.[key]) throw new Error(`account capability mismatch for ${key}`);
  }
  const declaredOperations = [...(diagnosticAccount.capabilities?.managementOperations ?? [])].sort().join(",");
  const accountOperations = [...(account.capabilities?.managementOperations ?? [])].sort().join(",");
  if (declaredOperations !== accountOperations) throw new Error("account management operation mismatch between diagnostics and accounts");
  if (profile !== "auto" && providerDiagnostic.profile !== profile) throw new Error(`provider profile mismatch: expected ${profile}, got ${providerDiagnostic.profile}`);
  if (requestedModes.management && !diagnosticAccount.capabilities?.management) throw new Error("management mode requested but diagnostics do not declare management capability");
  if (requestedModes.incrementalSync && diagnosticAccount.capabilities?.sync !== true) throw new Error("sync mode requested but diagnostics do not declare native sync");
  return {
    provider: providerDiagnostic.provider,
    profile: providerDiagnostic.profile,
    readiness: providerDiagnostic.readiness,
    account: digest(diagnosticAccount.id),
    missingCapabilities: providerDiagnostic.missingCapabilities ?? [],
    operationCount: providerDiagnostic.operations.length,
  };
}));

if (requestedModes.incrementalSync) {
  checks.push(await check("explicit-incremental-sync", async () => {
    if (account?.capabilities?.sync !== true) throw new Error("selected mailbox does not declare native incremental sync");
    const first = value(await rpc("capability.email", { action: "sync", accountId: account.id }), "email.sync.initial");
    if (first.status !== "synced" || !first.completedAt) throw new Error("provider did not return a completed sync state");
    if (first.cursor !== undefined && typeof first.cursor !== "string") throw new Error("provider returned an invalid sync cursor");
    for (const key of ["added", "updated", "removed"]) if (first[key] !== undefined && !Number.isInteger(first[key])) throw new Error(`provider returned an invalid ${key} count`);
    const states = value(await rpc("capability.email", { action: "sync-states", accountId: account.id }), "email.sync-states");
    if (!Array.isArray(states) || !states.some((state) => state.accountId === account.id && state.status === "synced")) throw new Error("sync state was not persisted");
    if (first.cursor) {
      const second = value(await rpc("capability.email", { action: "sync", accountId: account.id, cursor: first.cursor }), "email.sync.incremental");
      if (second.status !== "synced") throw new Error("provider rejected cursor-based sync");
    }
    return { status: first.status, cursorPresent: Boolean(first.cursor), counts: { added: first.added ?? 0, updated: first.updated ?? 0, removed: first.removed ?? 0 } };
  }));
}

checks.push(await check("threads-search-thread-labels", async () => {
  const page = value(await rpc("capability.email", { action: "threads-page", accountId: account.id, limit: 10 }), "email.threads-page");
  const items = Array.isArray(page?.items) ? page.items : [];
  if (items.length === 0) throw new Error("provider returned no readable threads");
  let pagination = { hasNextPage: false, cursorAdvanced: true, nextPageCount: 0 };
  if (page?.nextCursor) {
    const nextPage = value(await rpc("capability.email", { action: "threads-page", accountId: account.id, limit: 10, cursor: page.nextCursor }), "email.threads-page.next");
    const nextItems = Array.isArray(nextPage?.items) ? nextPage.items : [];
    const firstIds = new Set(items.map((item) => String(item.id)));
    if (nextItems.some((item) => firstIds.has(String(item.id)))) throw new Error("provider returned duplicate thread ids across pages");
    if (nextPage?.nextCursor === page.nextCursor) throw new Error("provider returned an unchanged pagination cursor");
    pagination = { hasNextPage: true, cursorAdvanced: true, nextPageCount: nextItems.length };
  }
  firstThread = items[0];
  const query = String(firstThread.subject || firstThread.from?.address || "").slice(0, 32);
  const search = value(await rpc("capability.email", { action: "threads", accountId: account.id, query, limit: 10 }), "email.search");
  const thread = value(await rpc("capability.email", { action: "thread", accountId: account.id, threadId: firstThread.id }), "email.thread");
  const labels = value(await rpc("capability.email", { action: "labels", accountId: account.id }), "email.labels");
  if (!thread?.id || !Array.isArray(thread.messages)) throw new Error("provider returned an invalid thread");
  if (!thread.messages[0]?.id) throw new Error("provider returned a thread without a source message id");
  firstThreadDetail = thread;
  return { pageCount: items.length, searchCount: Array.isArray(search) ? search.length : 0, messageCount: thread.messages.length, labelCount: Array.isArray(labels) ? labels.length : 0, pagination };
}));

if (process.env.OPENBUDDY_EMAIL_EXTERNAL_MANAGE === "1") {
  checks.push(await check("explicit-reversible-management", async () => {
    if (!(account?.capabilities?.management ?? account?.capabilities?.write)) throw new Error("reversible management requires provider management capability");
    if (!firstThread?.id) throw new Error("a readable thread is required for reversible management");
    const readPreview = async () => {
      const page = value(await rpc("capability.email", { action: "threads-page", accountId: account.id, limit: 50 }), "email.management-refresh");
      const item = (page.items ?? []).find((candidate) => candidate.id === firstThread.id && candidate.accountId === firstThread.accountId);
      if (!item) throw new Error("managed thread disappeared during refresh");
      return item;
    };
    const original = await readPreview();
    const originalStarred = original.starred === true;
    const originalUnread = original.unread === true;
    let starAttempted = false;
    let readAttempted = false;
    try {
      starAttempted = true;
      const starred = value(await rpc("capability.email", { action: "update", accountId: account.id, threadId: firstThread.id, kind: "star", value: !originalStarred }), "email.management-star");
      if (!starred?.ok) throw new Error("provider rejected reversible star update");
      const afterStar = await readPreview();
      if (afterStar.starred !== !originalStarred) throw new Error("star update was not observable after refresh");

      readAttempted = true;
      const toggledUnread = !originalUnread;
      const marked = value(await rpc("capability.email", { action: "update", accountId: account.id, threadId: firstThread.id, kind: toggledUnread ? "mark-unread" : "mark-read", value: toggledUnread }), "email.management-read");
      if (!marked?.ok) throw new Error("provider rejected reversible read update");
      const afterRead = await readPreview();
      if (afterRead.unread !== toggledUnread) throw new Error("read state update was not observable after refresh");
    return { thread: digest(firstThread.id), restored: { starred: originalStarred, unread: originalUnread }, managementCapability: account.capabilities?.management ?? account.capabilities?.write, operations: ["star-roundtrip", "read-roundtrip"] };
    } finally {
      const restoreErrors = [];
      if (readAttempted) {
        try {
          const restoredRead = value(await rpc("capability.email", { action: "update", accountId: account.id, threadId: firstThread.id, kind: originalUnread ? "mark-unread" : "mark-read", value: originalUnread }), "email.management-read-restore");
          if (!restoredRead?.ok) throw new Error("provider rejected read restoration");
        } catch (error) { restoreErrors.push(error); }
      }
      if (starAttempted) {
        try {
          const restoredStar = value(await rpc("capability.email", { action: "update", accountId: account.id, threadId: firstThread.id, kind: "star", value: originalStarred }), "email.management-star-restore");
          if (!restoredStar?.ok) throw new Error("provider rejected star restoration");
        } catch (error) { restoreErrors.push(error); }
      }
      if (restoreErrors.length) throw restoreErrors[0];
      const restored = await readPreview();
      if (restored.starred !== originalStarred || restored.unread !== originalUnread) throw new Error("provider did not restore the original management state");
    }
  }));
}

if (requestedModes.unsubscribe) {
  checks.push(await check("explicit-unsubscribe", async () => {
    if (!firstThreadDetail?.messages?.length) throw new Error("a readable message is required for unsubscribe testing");
    const message = [...firstThreadDetail.messages].reverse().find((item) => Array.isArray(item.unsubscribeLinks) && item.unsubscribeLinks.length > 0);
    if (!message) return { status: "not-run", reason: "selected test thread has no provider-reported unsubscribe links" };
    if (!account?.capabilities?.managementOperations?.includes("unsubscribe")) throw new Error("provider does not declare unsubscribe management capability");
    const result = value(await rpc("capability.email", { action: "unsubscribe", accountId: account.id, messageId: message.id, threadId: firstThread.id, confirmed: true }), "email.unsubscribe");
    if (!result?.ok) throw new Error("provider rejected unsubscribe request");
    return { status: "passed", message: digest(message.id), method: result.method ?? "provider-defined" };
  }));
}

if (requestedModes.attachments) {
  checks.push(await check("explicit-attachment-read", async () => {
    if (!(account?.capabilities?.attachments === true)) throw new Error("attachment testing requires provider attachment capability");
    const attachments = (firstThreadDetail?.messages ?? []).flatMap((message) => Array.isArray(message.attachments) ? message.attachments : []);
    if (!attachments.length) throw new Error("selected external thread has no attachment metadata to verify");
    const listed = value(await rpc("capability.email", { action: "attachments", accountId: account.id, messageId: attachments[0].messageId }), "email.attachments");
    if (!Array.isArray(listed) || !listed.some((item) => item.id === attachments[0].id)) throw new Error("provider attachment listing did not contain the selected attachment");
    return { message: digest(attachments[0].messageId), attachment: digest(attachments[0].id), count: listed.length, downloadRequested: requestedModes.attachmentDownload };
  }));
}

if (requestedModes.attachmentDownload) {
  checks.push(await check("explicit-attachment-download", async () => {
    if (!requestedModes.attachments) throw new Error("attachment download requires attachment read mode");
    const destinationDir = process.env.OPENBUDDY_EMAIL_ATTACHMENT_DIR?.trim();
    if (!destinationDir) throw new Error("OPENBUDDY_EMAIL_ATTACHMENT_DIR is required for attachment download testing");
    const attachments = (firstThreadDetail?.messages ?? []).flatMap((message) => Array.isArray(message.attachments) ? message.attachments : []);
    if (!attachments.length) throw new Error("selected external thread has no attachment metadata to download");
    const downloaded = value(await rpc("capability.email", { action: "attachment-download", accountId: account.id, attachmentId: attachments[0].id, messageId: attachments[0].messageId, destinationDir }), "email.attachment-download");
    const validated = validateDownloadedAttachment(downloaded, destinationDir);
    return { attachment: digest(attachments[0].id), downloaded: true, bytes: validated.bytes };
  }));
}

checks.push(await check("reply-zero-and-digest", async () => {
  const replyZero = value(await rpc("capability.email", { action: "reply-zero", accountId: account.id }), "email.reply-zero");
  const digest = value(await rpc("capability.email", { action: "digest", accountId: account.id }), "email.digest");
  if (!Array.isArray(replyZero.items) || !Number.isFinite(digest.total)) throw new Error("AI email summary contract failed");
  return { total: digest.total, unread: digest.unread, needsReply: replyZero.needsReply?.length ?? 0, waitingForReply: replyZero.waitingForReply?.length ?? 0 };
}));

checks.push(await check("read-only-ai-triage", async () => {
  const triage = value(await rpc("capability.email", { action: "triage", accountId: account.id, limit: 50 }), "email.triage");
  const categories = new Set(["urgent", "needs-reply", "waiting-for-reply", "noise", "normal"]);
  if (!Array.isArray(triage?.items) || !triage?.counts || triage.total !== triage.items.length) throw new Error("AI triage returned an invalid snapshot");
  if (triage.items.some((item) => !categories.has(item.category) || !Number.isInteger(item.score) || item.score < 0 || item.score > 100 || !Array.isArray(item.reasons))) throw new Error("AI triage returned an invalid item");
  return { total: triage.total, counts: triage.counts, topThread: triage.items[0]?.threadId ? digest(triage.items[0].threadId) : null };
}));

if (requestedModes.processingPlan) {
  checks.push(await check("explicit-processing-plan", async () => {
    if (!(account?.capabilities?.management ?? account?.capabilities?.write)) throw new Error("processing plan testing requires provider management capability");
    if (!firstThread?.id) throw new Error("a readable thread is required for processing plan testing");
    const readThreadPreview = async () => {
      const page = value(await rpc("capability.email", { action: "threads-page", accountId: account.id, limit: 50 }), "email.processing-plan-refresh");
      const item = (page.items ?? []).find((candidate) => candidate.id === firstThread.id && candidate.accountId === firstThread.accountId);
      if (!item) throw new Error("processing-plan thread disappeared during refresh");
      return item;
    };
    const original = await readThreadPreview();
    const originalStarred = original.starred === true;
    const targetStarred = !originalStarred;
    let executionAttempted = false;
    try {
      const plan = value(await rpc("capability.email", {
        action: "prepare-processing-plan",
        operations: [{ accountId: account.id, threadIds: [firstThread.id], kind: "star", value: targetStarred, rationale: "External reversible processing-plan contract test" }],
      }), "email.prepare-processing-plan");
      if (!plan?.id || plan.status !== "pending" || !Array.isArray(plan.previews) || plan.previews.some((preview) => preview.dryRun !== true)) throw new Error("processing plan preview contract failed");
      const afterPreview = await readThreadPreview();
      if ((afterPreview.starred === true) !== originalStarred) throw new Error("processing plan preview performed a provider write");
      const confirmationToken = value(await rpc("capability.email", { action: "confirm-processing-plan", planId: plan.id }), "email.confirm-processing-plan");
      if (typeof confirmationToken !== "string" || !confirmationToken.startsWith("email-plan:")) throw new Error("processing plan confirmation did not return a one-time token");
      executionAttempted = true;
      const executed = value(await rpc("capability.email", { action: "execute-processing-plan", planId: plan.id, confirmationToken }), "email.execute-processing-plan");
      if (executed?.status !== "executed") throw new Error("processing plan execution did not complete");
      const afterExecution = await readThreadPreview();
      if ((afterExecution.starred === true) !== targetStarred) throw new Error("processing plan execution was not observable after refresh");
      const cancelledPlan = value(await rpc("capability.email", {
        action: "prepare-processing-plan",
        operations: [{ accountId: account.id, threadIds: [firstThread.id], kind: "star", value: originalStarred, rationale: "External cancellation contract test" }],
      }), "email.prepare-cancelled-processing-plan");
      const cancelledToken = value(await rpc("capability.email", { action: "confirm-processing-plan", planId: cancelledPlan.id }), "email.confirm-cancelled-processing-plan");
      const cancelled = value(await rpc("capability.email", { action: "cancel-processing-plan", planId: cancelledPlan.id }), "email.cancel-processing-plan");
      if (cancelled?.status !== "cancelled") throw new Error("processing plan cancellation was not persisted");
      const cancelledExecution = await rpc("capability.email", { action: "execute-processing-plan", planId: cancelledPlan.id, confirmationToken: cancelledToken });
      if (cancelledExecution?.result?.ok === true || !String(cancelledExecution?.result?.error?.message ?? "").includes("不可执行")) throw new Error("cancelled processing plan remained executable");
      return { plan: digest(plan.id), thread: digest(firstThread.id), previewWasReadOnly: true, executed: true, cancelled: true, restored: true };
    } finally {
      if (executionAttempted) {
        const restored = value(await rpc("capability.email", { action: "update", accountId: account.id, threadId: firstThread.id, kind: "star", value: originalStarred }), "email.processing-plan-restore");
        if (!restored?.ok) throw new Error("provider rejected processing plan state restoration");
        const finalState = await readThreadPreview();
        if ((finalState.starred === true) !== originalStarred) throw new Error("provider did not restore the original processing plan state");
      }
    }
  }));
}

let structuredAnalysisId;
let structuredAnalysisContext;
checks.push(await check("structured-ai-analysis-review", async () => {
  if (!firstThread?.id || !firstThreadDetail?.messages?.[0]?.id || !account?.id) throw new Error("a readable thread with a source message is required for structured AI analysis");
  const sourceMessageId = String(firstThreadDetail.messages[0].id);
  const saved = value(await rpc("capability.email", {
    action: "save-analysis",
    accountId: account.id,
    threadId: firstThread.id,
    kind: "actions",
    confidence: 0.82,
    summary: "External contract analysis",
    facts: [{ statement: "The thread has a source reference", citations: [{ messageId: sourceMessageId }] }],
    actions: [{ content: "Review the thread manually", dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), citations: [{ messageId: sourceMessageId }] }],
    risks: [],
  }), "email.save-analysis");
  if (!saved?.id || saved.review !== "pending" || saved.confidence !== 0.82) throw new Error("structured analysis save contract failed");
  const listed = value(await rpc("capability.email", { action: "analyses", accountId: account.id, threadId: firstThread.id }), "email.analyses");
  if (!Array.isArray(listed) || !listed.some((item) => item.id === saved.id && item.actions?.[0]?.citations?.[0]?.messageId === sourceMessageId)) throw new Error("structured analysis list contract failed");
  const reviewed = value(await rpc("capability.email", { action: "review-analysis", id: saved.id, review: "accepted", reviewNote: "external contract review" }), "email.review-analysis");
  if (reviewed.review !== "accepted" || !reviewed.reviewedAt) throw new Error("structured analysis review contract failed");
  structuredAnalysisId = saved.id;
  structuredAnalysisContext = { sourceMessageId, review: reviewed.review };
  return { analysis: digest(saved.id), sourceMessage: digest(sourceMessageId), review: reviewed.review };
}));

checks.push(await check("structured-ai-action-reminders", async () => {
  if (!structuredAnalysisId || !structuredAnalysisContext) throw new Error("structured AI analysis review must pass before reminder creation");
  const reminders = value(await rpc("capability.email", { action: "create-reminders-from-analysis", analysisId: structuredAnalysisId, confirmed: true }), "email.create-reminders-from-analysis");
  if (!reminders?.analysis?.linkedReminderIds?.length || reminders.reminders?.length !== 1) throw new Error("AI action reminder creation contract failed");
  const repeated = value(await rpc("capability.email", { action: "create-reminders-from-analysis", analysisId: structuredAnalysisId, confirmed: true }), "email.create-reminders-from-analysis.idempotent");
  if (repeated.reminders?.[0]?.receipt !== reminders.reminders?.[0]?.receipt) throw new Error("AI action reminder creation was not idempotent");
  return { analysis: digest(structuredAnalysisId), sourceMessage: digest(structuredAnalysisContext.sourceMessageId), reminder: digest(reminders.reminders[0].receipt), idempotent: true };
}));

if (process.env.OPENBUDDY_EMAIL_EXTERNAL_WRITE === "1") {
  checks.push(await check("explicit-write-draft", async () => {
    const recipient = process.env.OPENBUDDY_EMAIL_TEST_RECIPIENT?.trim();
    if (!recipient) throw new Error("OPENBUDDY_EMAIL_TEST_RECIPIENT is required for external write testing");
    if (account.capabilities?.write !== true) throw new Error("provider does not declare draft write capability");
    const draftKey = `openbuddy-external-draft-${Date.now().toString(36)}`;
    const subject = `OpenBuddy external draft test ${draftKey}`;
    const draft = value(await rpc("capability.email", { action: "create-draft", accountId: account.id, draftId: draftKey, to: [{ address: recipient }], subject, body: "This draft was created by an explicit OpenBuddy capability test." }), "email.create-draft");
    if (!draft?.id) throw new Error("provider did not return a draft id");
    const createdRemote = await waitForRemoteThread({ accountId: account.id, folder: "drafts", subject });
    if (createdRemote.items.length !== 1) throw new Error("remote drafts folder did not expose exactly one newly created draft");
    const updatedSubject = `${subject} updated`;
    const updated = value(await rpc("capability.email", { action: "create-draft", accountId: account.id, draftId: draft.id, to: [{ address: recipient }], subject: updatedSubject, body: "This draft was updated by an explicit OpenBuddy capability test." }), "email.update-draft");
    if (!updated?.id) throw new Error("provider did not return the updated draft id");
    if (updated.id !== draft.id) throw new Error("provider returned a different draft id during idempotent update");
    const updatedRemote = await waitForRemoteThread({ accountId: account.id, folder: "drafts", subject: updatedSubject });
    if (updatedRemote.items.length !== 1) throw new Error("remote drafts folder did not expose exactly one updated draft");
    const staleRemote = await waitForRemoteThread({ accountId: account.id, folder: "drafts", subject, timeoutMs: 1200 });
    if (staleRemote.items.length > 0) throw new Error("remote draft update left a stale duplicate draft");
    return { draft: digest(draft.id), updatedDraft: digest(updated.id), remoteDraftVisible: true, idempotentUpdate: true, writeCapability: true };
  }));
}

if (process.env.OPENBUDDY_EMAIL_EXTERNAL_SEND === "1") {
  checks.push(await check("explicit-send", async () => {
    if (process.env.OPENBUDDY_EMAIL_EXTERNAL_WRITE !== "1") throw new Error("external send requires external write mode");
    const recipient = process.env.OPENBUDDY_EMAIL_TEST_RECIPIENT?.trim();
    if (!recipient) throw new Error("OPENBUDDY_EMAIL_TEST_RECIPIENT is required for external send testing");
    const subject = `OpenBuddy external email send test ${Date.now().toString(36)}`;
    const draft = value(await rpc("capability.email", { action: "create-draft", accountId: account.id, to: [{ address: recipient }], subject, body: "This message was sent by an explicit OpenBuddy capability test." }), "email.create-send-draft");
    const confirmationToken = value(await rpc("capability.email", { action: "prepare-send", draftId: draft.id }), "email.prepare-send");
    const sent = value(await rpc("capability.email", { action: "send-draft", draftId: draft.id, confirmationToken }), "email.send-draft");
    if (!sent?.ok) throw new Error("provider did not confirm the external send");
    const sentRemote = await waitForRemoteThread({ accountId: account.id, folder: "sent", subject, timeoutMs: 12000 });
    if (sentRemote.items.length !== 1) throw new Error("sent folder did not expose exactly one newly sent message");
    return { draft: digest(draft.id), sent: true, receipt: digest(sent.receipt ?? "sent"), sentFolderVisible: true, sentThread: digest(sentRemote.items[0].id) };
  }));
}

const failed = checks.filter((check) => !check.ok);
const checkState = (name, requested, notRunReason) => {
  const result = checks.find((check) => check.name === name);
  if (result) {
    if (!result.ok) return { status: "failed", error: result.error, errorDigest: result.errorDigest };
    if (result.result?.status === "not-run") return { status: "not-run", reason: result.result.reason ?? notRunReason };
    return { status: "passed", evidence: result.result };
  }
  return { status: requested ? "failed" : "not-run", reason: notRunReason };
};
const report = {
  framework: "openbuddy-real-external-email-capability",
  schema: "openbuddy.redacted-evidence.v1",
  evidenceLevel: "real-external",
  realE2E: true,
  capability: "email",
  transport: "Electron Harness -> dispatchTypedRpc -> Cordis Email -> configured MCP provider",
  provider: serverName,
  profile,
  writeMode: process.env.OPENBUDDY_EMAIL_EXTERNAL_WRITE === "1",
  managementMode: process.env.OPENBUDDY_EMAIL_EXTERNAL_MANAGE === "1",
  sendMode: process.env.OPENBUDDY_EMAIL_EXTERNAL_SEND === "1",
  requestedModes,
  capabilityMatrix: {
    oauthAndProviderReady: checkState("provider-ready", true, "provider readiness is always required"),
    providerReadinessDiagnostics: checkState("provider-readiness-diagnostics", true, "provider diagnostics are always required"),
    readSearchThreadLabels: checkState("threads-search-thread-labels", true, "read capability is always required"),
    pagination: { status: checks.find((check) => check.name === "threads-search-thread-labels")?.ok ? "passed" : "failed", reason: "validated when the provider returns a nextCursor; single-page providers are recorded as hasNextPage=false" },
    reversibleManagement: checkState("explicit-reversible-management", requestedModes.management, "set OPENBUDDY_EMAIL_EXTERNAL_MANAGE=1"),
    attachmentRead: checkState("explicit-attachment-read", requestedModes.attachments, "set OPENBUDDY_EMAIL_EXTERNAL_ATTACHMENTS=1"),
    attachmentDownload: checkState("explicit-attachment-download", requestedModes.attachmentDownload, "set OPENBUDDY_EMAIL_EXTERNAL_ATTACHMENT_DOWNLOAD=1 and provide OPENBUDDY_EMAIL_ATTACHMENT_DIR"),
    draftWrite: checkState("explicit-write-draft", requestedModes.write, "set OPENBUDDY_EMAIL_EXTERNAL_WRITE=1 and provide OPENBUDDY_EMAIL_TEST_RECIPIENT"),
    controlledSend: checkState("explicit-send", requestedModes.send, "set OPENBUDDY_EMAIL_EXTERNAL_SEND=1; this also requires explicit write mode"),
    aiAnalysisReview: checkState("structured-ai-analysis-review", true, "structured analysis review is always required"),
    aiActionReminders: checkState("structured-ai-action-reminders", true, "structured analysis reminder creation is always required"),
    readOnlyAiTriage: checkState("read-only-ai-triage", true, "read-only AI triage is always required"),
    incrementalSync: checkState("explicit-incremental-sync", requestedModes.incrementalSync, "set OPENBUDDY_EMAIL_EXTERNAL_SYNC=1"),
    processingPlan: checkState("explicit-processing-plan", requestedModes.processingPlan, "set OPENBUDDY_EMAIL_EXTERNAL_PROCESSING_PLAN=1"),
    unsubscribe: checkState("explicit-unsubscribe", requestedModes.unsubscribe, "set OPENBUDDY_EMAIL_EXTERNAL_UNSUBSCRIBE=1; requires an isolated test mailbox and a provider-reported unsubscribe link"),
  },
  passed: checks.length - failed.length,
  failed: failed.length,
  checks,
};
const requestedCapabilityNotRun = Object.values(report.capabilityMatrix).some((state) => state?.status === "not-run");
report.requestedCapabilityNotRun = requestedCapabilityNotRun;
if (evidenceDir) { mkdirSync(evidenceDir, { recursive: true }); writeFileSync(`${evidenceDir}/email-external.json`, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ ...report, evidenceArtifact: evidenceDir ? `${evidenceDir}/email-external.json` : null }, null, 2));
process.exit(failed.length === 0 && !requestedCapabilityNotRun ? 0 : 1);
