import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const address = String(process.env.OPENBUDDY_EMAIL_ADDRESS ?? "").trim();
const password = String(process.env.OPENBUDDY_EMAIL_PASSWORD ?? process.env.OPENBUDDY_EMAIL_AUTH_CODE ?? "");
const serverPath = String(process.env.OPENBUDDY_IMAP_SMTP_MCP_SERVER ?? "scripts/email/imap-smtp-mcp-server.mjs").trim();
const evidenceDir = String(process.env.OPENBUDDY_EVIDENCE_DIR ?? "").trim();
const requested = {
  management: process.env.OPENBUDDY_EMAIL_EXTERNAL_MANAGE === "1",
  write: process.env.OPENBUDDY_EMAIL_EXTERNAL_WRITE === "1",
  send: process.env.OPENBUDDY_EMAIL_EXTERNAL_SEND === "1",
  attachments: process.env.OPENBUDDY_EMAIL_EXTERNAL_ATTACHMENTS === "1",
  attachmentDownload: process.env.OPENBUDDY_EMAIL_EXTERNAL_ATTACHMENT_DOWNLOAD === "1",
  sync: process.env.OPENBUDDY_EMAIL_EXTERNAL_SYNC === "1",
};
const writeConfirm = "I_UNDERSTAND_MAILBOX_MUTATIONS";
const sendConfirm = "I_UNDERSTAND_EXTERNAL_EMAIL_SEND";

if (!address || !password) {
  console.error("OPENBUDDY_EMAIL_ADDRESS and OPENBUDDY_EMAIL_PASSWORD/AUTH_CODE are required");
  process.exit(2);
}
if (requested.management && process.env.OPENBUDDY_EMAIL_EXTERNAL_CONFIRM !== writeConfirm) {
  console.error(`management mode requires OPENBUDDY_EMAIL_EXTERNAL_CONFIRM=${writeConfirm}`);
  process.exit(2);
}
if (requested.write && !process.env.OPENBUDDY_EMAIL_TEST_RECIPIENT?.trim()) {
  console.error("write mode requires OPENBUDDY_EMAIL_TEST_RECIPIENT; draft creation leaves a provider-side draft");
  process.exit(2);
}
if (requested.send && (!requested.write || process.env.OPENBUDDY_EMAIL_EXTERNAL_SEND_CONFIRM !== sendConfirm)) {
  console.error(`send mode requires write mode and OPENBUDDY_EMAIL_EXTERNAL_SEND_CONFIRM=${sendConfirm}`);
  process.exit(2);
}
if (requested.attachmentDownload && !process.env.OPENBUDDY_EMAIL_ATTACHMENT_DIR?.trim()) {
  console.error("attachment download requires OPENBUDDY_EMAIL_ATTACHMENT_DIR");
  process.exit(2);
}

const digest = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
const safeError = (error) => String(error?.message ?? error ?? "unknown error")
  .replace(/(password|auth[_ -]?code|token|secret)[=:][^\s,}]+/gi, "$1=[redacted]")
  .slice(0, 300);
const validateDownloadedAttachment = (downloaded, destinationDir) => {
  const localPath = String(downloaded?.localPath ?? "");
  const name = String(downloaded?.name ?? "");
  if (!localPath || !name) throw new Error("provider did not return attachment name and local path");
  const root = realpathSync(destinationDir);
  const target = realpathSync(localPath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("downloaded attachment escaped the selected directory");
  if (lstatSync(localPath).isSymbolicLink() || !statSync(target).isFile()) throw new Error("downloaded attachment is not a regular file");
  if (name !== path.basename(name) || /[\\/\u0000-\u001f]/u.test(name) || name === "." || name === "..") throw new Error("provider returned an unsafe attachment filename");
  if (path.basename(target) !== name) throw new Error("downloaded filename does not match the sanitized attachment name");
  return { name, bytes: statSync(target).size };
};
const checks = [];
const check = async (name, fn, enabled = true) => {
  if (!enabled) {
    checks.push({ name, status: "not-run", reason: "not requested" });
    return undefined;
  }
  try {
    const result = await fn();
    checks.push({ name, status: "passed", result });
    return result;
  } catch (error) {
    checks.push({ name, status: "failed", error: safeError(error), errorDigest: digest(error) });
    return undefined;
  }
};

const mailboxName = (key, fallback) => String(process.env[key] ?? fallback).trim() || fallback;
const waitForRemoteSubject = async (mailbox, subject, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs;
  let lastPage;
  while (Date.now() < deadline) {
    lastPage = await call("list_emails", { accountId: account.id, mailbox, query: `subject:"${subject.replaceAll('"', "")}"`, limit: 100 });
    const matches = (lastPage?.items ?? []).filter((item) => item.subject === subject);
    if (matches.length) return matches;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return (lastPage?.items ?? []).filter((item) => item.subject === subject);
};

const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], cwd: process.cwd(), env: { ...process.env } });
const client = new Client({ name: "openbuddy-imap-smtp-acceptance", version: "1.0.0" }, { capabilities: {} });
const call = async (name, args = {}) => {
  const response = await client.callTool({ name, arguments: args });
  const text = response.content?.find((item) => item.type === "text")?.text ?? "{}";
  if (response.isError) throw new Error(text.slice(0, 300));
  return JSON.parse(text);
};

let account;
let firstPage;
let firstThread;
let firstAttachment;
try {
  await client.connect(transport);
  const tools = await client.listTools();
  await check("provider-tools", async () => ({ toolCount: tools.tools.length, tools: tools.tools.map((tool) => tool.name) }));
  const accounts = await check("accounts", () => call("list_accounts"));
  account = accounts?.find((item) => item.address === address) ?? accounts?.[0];
  if (!account?.id) throw new Error("provider returned no account");
  const accountRef = { account: digest(account.id), addressDomain: String(account.address).split("@")[1] ?? "unknown", capabilities: account.capabilities };
  checks[checks.length - 1].result = accountRef;

  await check("mailboxes", async () => {
    const mailboxes = await call("list_mailboxes", { accountId: account.id });
    return { count: mailboxes.length, names: mailboxes.map((item) => item.name).slice(0, 20) };
  });
  firstPage = await check("list-and-search", () => call("list_emails", { accountId: account.id, mailbox: process.env.OPENBUDDY_EMAIL_DEFAULT_MAILBOX ?? "INBOX", limit: 10 }));
  await check("pagination", async () => {
    if (!firstPage?.nextCursor) return { hasNextPage: false, duplicateCount: 0 };
    const secondPage = await call("list_emails", { accountId: account.id, mailbox: process.env.OPENBUDDY_EMAIL_DEFAULT_MAILBOX ?? "INBOX", limit: 10, cursor: firstPage.nextCursor });
    const ids = [...(firstPage.items ?? []), ...(secondPage.items ?? [])].map((item) => item.id);
    return { hasNextPage: true, firstPageItems: firstPage.items?.length ?? 0, secondPageItems: secondPage.items?.length ?? 0, duplicateCount: ids.length - new Set(ids).size };
  });
  firstThread = firstPage?.items?.[0];
  await check("thread-read", async () => {
    if (!firstThread?.id) return { status: "empty-mailbox" };
    const thread = await call("get_email", { accountId: account.id, threadId: firstThread.id });
    return { messageCount: thread.messages?.length ?? 0, attachmentCount: thread.messages?.[0]?.attachments?.length ?? 0, threadDigest: digest(firstThread.id) };
  });
  await check("incremental-sync", async () => {
    const result = await call("sync_emails", { accountId: account.id, mailbox: process.env.OPENBUDDY_EMAIL_DEFAULT_MAILBOX ?? "INBOX" });
    return { status: result.status, added: result.added, cursorPresent: Boolean(result.cursor) };
  }, requested.sync);
  await check("attachment-read", async () => {
    if (!firstThread?.id) return { status: "empty-mailbox" };
    const attachments = await call("list_attachments", { accountId: account.id, threadId: firstThread.id });
    firstAttachment = attachments[0];
    return { count: attachments.length, firstName: firstAttachment?.name, firstSize: firstAttachment?.size };
  }, requested.attachments || requested.attachmentDownload);
  await check("attachment-download", async () => {
    if (!firstAttachment) throw new Error("selected test thread has no attachment metadata");
    const result = await call("download_attachment", { accountId: account.id, threadId: firstThread.id, attachmentId: firstAttachment.id, destinationDir: process.env.OPENBUDDY_EMAIL_ATTACHMENT_DIR });
    const validated = validateDownloadedAttachment(result, process.env.OPENBUDDY_EMAIL_ATTACHMENT_DIR);
    return { name: validated.name, bytes: validated.bytes, pathVerified: true };
  }, requested.attachmentDownload);
  await check("reversible-management", async () => {
    if (!firstThread?.id) throw new Error("selected test mailbox is empty");
    const originalStarred = Boolean(firstThread.starred);
    const operations = [
      ["mark-read", { kind: "mark-read" }],
      ["mark-unread", { kind: "mark-unread" }],
      ["star", { kind: "star", value: !originalStarred }],
      ["unstar", { kind: "star", value: originalStarred }],
      ["archive", { kind: "archive" }],
      ["restore", { kind: "restore" }],
    ];
    for (const [, input] of operations.slice(0, 4)) await call("update_email", { accountId: account.id, threadId: firstThread.id, ...input });
    const archiveResult = await call("update_email", { accountId: account.id, threadId: firstThread.id, kind: "archive" });
    if (!archiveResult?.ok) throw new Error("archive operation was not acknowledged");
    const archived = await call("list_emails", { accountId: account.id, mailbox: mailboxName("OPENBUDDY_EMAIL_ARCHIVE_MAILBOX", "Archive"), query: `subject:"${String(firstThread.subject ?? "").replaceAll('"', "")}"`, limit: 100 });
    const archivedThread = (archived?.items ?? []).find((item) => item.subject === firstThread.subject);
    if (!archivedThread?.id) throw new Error("archived thread was not visible in the archive mailbox");
    await call("update_email", { accountId: account.id, threadId: archivedThread.id, kind: "restore" });
    const restored = await call("list_emails", { accountId: account.id, mailbox: mailboxName("OPENBUDDY_EMAIL_DEFAULT_MAILBOX", "INBOX"), query: `subject:"${String(firstThread.subject ?? "").replaceAll('"', "")}"`, limit: 100 });
    if (!(restored?.items ?? []).some((item) => item.subject === firstThread.subject)) throw new Error("restored thread was not visible in INBOX");
    return { threadDigest: digest(firstThread.id), operations: operations.map(([name]) => name), restored: true };
  }, requested.management);
  await check("draft-write", async () => {
    const draftId = `draft:${Date.now().toString(36)}test1234`;
    const subject = `OpenBuddy IMAP draft test ${draftId}`;
    const input = { accountId: account.id, draftId, to: [{ address: process.env.OPENBUDDY_EMAIL_TEST_RECIPIENT.trim() }], subject, body: "OpenBuddy explicit IMAP draft acceptance test." };
    const draft = await call("create_draft", input);
    const created = await waitForRemoteSubject(mailboxName("OPENBUDDY_EMAIL_DRAFT_MAILBOX", "Drafts"), subject);
    if (created.length !== 1) throw new Error(`expected one remote draft, got ${created.length}`);
    const updatedSubject = `${subject} updated`;
    const updated = await call("create_draft", { ...input, subject: updatedSubject, body: "OpenBuddy updated draft acceptance test." });
    if (updated.id !== draft.id) throw new Error("remote draft update returned a different draft id");
    const updatedRemote = await waitForRemoteSubject(mailboxName("OPENBUDDY_EMAIL_DRAFT_MAILBOX", "Drafts"), updatedSubject);
    if (updatedRemote.length !== 1) throw new Error(`expected one updated remote draft, got ${updatedRemote.length}`);
    const staleRemote = await call("list_emails", { accountId: account.id, mailbox: mailboxName("OPENBUDDY_EMAIL_DRAFT_MAILBOX", "Drafts"), query: `subject:"${subject.replaceAll('"', "")}"`, limit: 100 });
    if ((staleRemote?.items ?? []).some((item) => item.subject === subject)) throw new Error("remote draft update left a stale draft copy");
    return { draftDigest: digest(draft.id), updatedDraftDigest: digest(updated.id), remoteVisible: true, idempotent: true };
  }, requested.write);
  await check("controlled-send", async () => {
    const subject = `OpenBuddy SMTP send test ${Date.now().toString(36)}`;
    const result = await call("send_email", { accountId: account.id, to: [{ address: process.env.OPENBUDDY_EMAIL_TEST_RECIPIENT.trim() }], subject, body: "OpenBuddy explicit SMTP acceptance test." });
    if (!result?.ok) throw new Error("SMTP provider did not acknowledge the send");
    const sent = await waitForRemoteSubject(mailboxName("OPENBUDDY_EMAIL_SENT_MAILBOX", "Sent"), subject);
    if (sent.length !== 1) throw new Error(`expected one message in Sent, got ${sent.length}`);
    return { sent: true, receiptDigest: digest(result.receipt ?? "sent"), sentArchived: result.sentArchived === true, sentVisible: true };
  }, requested.send);
} catch (error) {
  checks.push({ name: "runner", status: "failed", error: safeError(error), errorDigest: digest(error) });
} finally {
  await client.close().catch(() => {});
}

const failed = checks.filter((item) => item.status === "failed");
const report = {
  schema: "openbuddy.imap-smtp-acceptance.v1",
  evidenceLevel: "real-external",
  provider: "imap-smtp",
  accountDomain: String(address).split("@")[1] ?? "unknown",
  requested,
  writeMode: requested.write,
  managementMode: requested.management,
  sendMode: requested.send,
  checks,
  passed: checks.filter((item) => item.status === "passed").length,
  failed: failed.length,
  notRun: checks.filter((item) => item.status === "not-run").length,
};
if (evidenceDir) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(`${evidenceDir}/imap-smtp-acceptance.json`, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify({ ...report, evidenceArtifact: evidenceDir ? `${evidenceDir}/imap-smtp-acceptance.json` : null }, null, 2));
process.exit(failed.length ? 1 : 0);
