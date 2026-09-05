import { mkdir, readFile, open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  ImapClient,
  SmtpClient,
  buildMimeMessage,
  envConfig,
  parseMailboxUid,
  parseMessage,
  threadId,
  managementOperationsForMailboxes,
} from "./imap-smtp-core.mjs";

const config = envConfig();
const account = {
  id: config.address,
  address: config.address,
  name: config.displayName,
  provider: "imap-smtp",
  status: "connected",
  capabilities: {
    read: true,
    write: config.allowWrite,
    attachments: true,
    multipleAccounts: false,
    management: config.allowWrite,
    managementOperations: [],
    sync: true,
  },
};

const textResult = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const quote = (value) => `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const inputSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    accountId: { type: "string" }, mailbox: { type: "string" }, folder: { type: "string" },
    query: { type: "string" }, from: { type: "string" }, to: { type: "string" }, unread: { type: "boolean" }, hasAttachment: { type: "boolean" }, since: { type: "string" }, until: { type: "string" }, cursor: { type: "string" }, limit: { type: "integer" },
    threadId: { type: "string" }, messageId: { type: "string" }, attachmentId: { type: "string" },
    kind: { type: "string" }, value: { type: "boolean" }, dryRun: { type: "boolean" },
    labelId: { type: "string" }, snoozeUntil: { type: "string" },
    to: { type: "array" }, cc: { type: "array" }, bcc: { type: "array" }, replyTo: { type: "array" },
    subject: { type: "string" }, body: { type: "string" }, bodyHtml: { type: "string" },
    attachments: { type: "array" }, draftId: { type: "string" }, destinationDir: { type: "string" },
  },
};
const tools = [
  ["list_accounts", "List configured IMAP accounts"], ["list_emails", "List email headers from an IMAP mailbox"],
  ["search_emails", "Search an IMAP mailbox"], ["get_email", "Read one IMAP email"], ["list_mailboxes", "List IMAP mailboxes"],
  ["update_email", "Apply a guarded IMAP message mutation"], ["mark_email_read", "Mark an IMAP message read"],
  ["mark_email_unread", "Mark an IMAP message unread"], ["archive_email", "Archive an IMAP message"],
  ["restore_email", "Restore an IMAP message to INBOX"], ["star_email", "Star an IMAP message"],
  ["trash_email", "Move an IMAP message to Trash"], ["spam_email", "Move an IMAP message to Spam"],
  ["list_attachments", "List message attachments"], ["download_attachment", "Download one attachment"],
  ["create_draft", "Append a draft to the Drafts mailbox"], ["send_email", "Send a draft through SMTP"],
  ["sync_emails", "Return an IMAP UID incremental cursor"],
].map(([name, description]) => ({ name, description, inputSchema }));

function assertAccount(args) {
  if (args.accountId && args.accountId !== account.id) throw new Error("unknown account");
}

async function accountSnapshot() {
  if (!config.allowWrite) return account;
  try {
    const mailboxes = await withImap((imap) => imap.list());
    const managementOperations = managementOperationsForMailboxes(mailboxes, config);
    return { ...account, capabilities: { ...account.capabilities, management: managementOperations.length > 0, managementOperations } };
  } catch {
    return { ...account, capabilities: { ...account.capabilities, management: false, managementOperations: [] } };
  }
}

function mailboxFor(args) {
  const requested = String(args.mailbox ?? args.folder ?? config.defaultMailbox).trim() || config.defaultMailbox;
  const aliases = {
    inbox: config.defaultMailbox,
    sent: config.sentMailbox,
    drafts: config.draftMailbox,
    archive: config.archiveMailbox,
    trash: config.trashMailbox,
    spam: config.spamMailbox,
    starred: config.defaultMailbox,
    important: config.defaultMailbox,
    snoozed: config.defaultMailbox,
    custom: String(args.labelId ?? config.defaultMailbox).trim() || config.defaultMailbox,
  };
  return aliases[requested.toLowerCase()] ?? requested;
}

async function resolveExistingMailbox(imap, requested, aliases = []) {
  const names = await imap.list();
  const candidates = [requested, ...aliases].filter(Boolean);
  const match = names.find((name) => candidates.some((candidate) => name.toLowerCase() === String(candidate).toLowerCase()));
  if (match) return match;
  throw new Error(`mailbox ${requested} was not found; available mailboxes: ${names.slice(0, 20).join(", ")}`);
}

const MAILBOX_ALIASES = {
  sent: ["Sent", "Sent Messages", "Sent Items", "已发送"],
  draft: ["Drafts", "Draft", "草稿箱"],
  trash: ["Trash", "Deleted Messages", "Deleted Items", "已删除"],
  spam: ["Junk", "Spam", "垃圾邮件"],
  archive: ["Archive", "Archives", "归档"],
};

function requireWrite(operation) {
  if (!config.allowWrite) throw new Error(`IMAP write operation ${operation} is disabled; set OPENBUDDY_EMAIL_ALLOW_WRITE=1`);
}

function requireSend() {
  if (!config.allowSend) throw new Error("SMTP send is disabled; set OPENBUDDY_EMAIL_ALLOW_SEND=1");
}

function retryAfterError(error) {
  const message = String(error?.message ?? error);
  if (/timeout|too many|rate|temporar|try again|connection/i.test(message)) {
    const wrapped = new Error(`${message}; retry after 10 seconds`);
    wrapped.retryAfterMs = 10_000;
    return wrapped;
  }
  return error;
}

async function withImap(fn) {
  const client = new ImapClient({ ...config.imap, address: config.address, password: config.password });
  try { await client.connect(); return await fn(client); } finally { await client.close(); }
}

function imapDate(value) {
  const date = new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) return String(value ?? "");
  return `${String(date.getUTCDate()).padStart(2, "0")}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

function queryToImap(query, filters = {}) {
  const value = String(query ?? "").trim();
  const parts = [];
  for (const token of value.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
    const match = token.match(/^(from|to|subject|before|after|is|has):(.+)$/i);
    if (!match) { parts.push("TEXT", quoteValue(token)); continue; }
    const [, key, raw] = match;
    const item = raw.replace(/^"|"$/g, "");
    if (key.toLowerCase() === "from") parts.push("FROM", quoteValue(item));
    else if (key.toLowerCase() === "to") parts.push("TO", quoteValue(item));
    else if (key.toLowerCase() === "subject") parts.push("SUBJECT", quoteValue(item));
    else if (key.toLowerCase() === "after") parts.push("SINCE", quoteValue(item));
    else if (key.toLowerCase() === "before") parts.push("BEFORE", quoteValue(item));
    else if (key.toLowerCase() === "is" && item.toLowerCase() === "unread") parts.push("UNSEEN");
    else if (key.toLowerCase() === "is" && item.toLowerCase() === "read") parts.push("SEEN");
    else if (key.toLowerCase() === "is" && item.toLowerCase() === "starred") parts.push("FLAGGED");
    else if (key.toLowerCase() === "is" && item.toLowerCase() === "important") parts.push("KEYWORD", quoteValue("$Important"));
    else if (key.toLowerCase() === "has" && item.toLowerCase() === "attachment") parts.push("HEADER", "Content-Type", "multipart");
  }
  if (filters.from) parts.push("FROM", quoteValue(filters.from));
  if (filters.to) parts.push("TO", quoteValue(filters.to));
  if (filters.since) parts.push("SINCE", quoteValue(imapDate(filters.since)));
  if (filters.until) parts.push("BEFORE", quoteValue(imapDate(filters.until)));
  if (filters.unread === true) parts.push("UNSEEN");
  if (filters.unread === false) parts.push("SEEN");
  if (filters.hasAttachment === true) parts.push("HEADER", "Content-Type", quoteValue("multipart"));
  if (filters.hasAttachment === false) parts.push("NOT", "HEADER", "Content-Type", quoteValue("multipart"));
  if (filters.folder === "starred") parts.push("FLAGGED");
  if (filters.folder === "important") parts.push("KEYWORD", quoteValue("$Important"));
  return parts.length ? parts.join(" ") : "ALL";
}

function quoteValue(value) { return `"${String(value).replaceAll('"', '\\"')}"`; }

function preview(mailbox, uid, parsed, flags) {
  const unread = !flags.includes("\\Seen");
  return {
    id: threadId(mailbox, uid), threadId: threadId(mailbox, uid), accountId: account.id,
    subject: parsed.subject, snippet: String(parsed.text ?? parsed.html ?? "").replace(/\s+/g, " ").slice(0, 240),
    from: parsed.from, date: parsed.date, messageCount: 1, unread, starred: flags.includes("\\Flagged"),
    labels: [mailbox, ...(unread ? ["UNREAD"] : []), ...(flags.includes("\\Flagged") ? ["STARRED"] : [])],
    attachments: parsed.attachments.length,
  };
}

async function listMessages(args) {
  assertAccount(args);
  const mailbox = mailboxFor(args);
  const limit = Math.max(1, Math.min(Number(args.limit) || 50, 100));
  const cursor = parseCursor(args.cursor);
  if (cursor && cursor.mailbox !== mailbox) throw new Error("pagination cursor belongs to a different mailbox");
  return withImap(async (imap) => {
    await imap.select(mailbox);
    const uids = await imap.search(queryToImap(args.query, args));
    const candidates = cursor ? uids.filter((uid) => uid < cursor.uid) : uids;
    const selected = candidates.slice(-limit).reverse();
    const items = [];
    const fetchedItems = await imap.fetchMany(selected, "BODY.PEEK[HEADER.FIELDS (SUBJECT FROM TO CC REPLY-TO DATE MESSAGE-ID)]");
    for (let index = 0; index < selected.length; index += 1) {
      const uid = selected[index];
      const fetched = fetchedItems[index];
      const parsed = parseMessage(fetched.raw);
      items.push(preview(mailbox, uid, parsed, fetched.flags));
    }
    const nextCursor = selected.length === limit && selected.at(-1) !== undefined ? `${mailbox}:${selected.at(-1)}` : undefined;
    return { items, ...(nextCursor ? { nextCursor } : {}) };
  });
}

function parseCursor(cursor) {
  if (!cursor) return undefined;
  const match = String(cursor).match(/^(.*):(\d+)$/);
  return match ? { mailbox: match[1], uid: Number(match[2]) } : undefined;
}

async function getMessage(args) {
  assertAccount(args);
  const parsedId = parseMailboxUid(args.threadId ?? args.messageId, config.defaultMailbox);
  return withImap(async (imap) => {
    await imap.select(parsedId.mailbox);
    const fetched = await imap.fetch(parsedId.uid, "BODY.PEEK[]");
    const parsed = parseMessage(fetched.raw);
    const message = {
      id: String(args.messageId ?? args.threadId), messageId: parsed.messageId, threadId: threadId(parsedId.mailbox, parsedId.uid),
      from: parsed.from, to: parsed.to, cc: parsed.cc, ...(parsed.replyTo.length ? { replyTo: parsed.replyTo } : {}),
      subject: parsed.subject, date: parsed.date, text: parsed.text, html: parsed.html, unread: !fetched.flags.includes("\\Seen"),
      attachments: parsed.attachments.map((item, index) => ({ id: `${threadId(parsedId.mailbox, parsedId.uid)}#${index}`, messageId: threadId(parsedId.mailbox, parsedId.uid), name: item.name, mimeType: item.mimeType, size: item.content.length })),
    };
    return { id: threadId(parsedId.mailbox, parsedId.uid), threadId: threadId(parsedId.mailbox, parsedId.uid), accountId: account.id, subject: parsed.subject, labels: [parsedId.mailbox], messages: [message] };
  });
}

function mutation(args, operation) {
  assertAccount(args);
  if (!["mark-read", "mark-unread", "star", "archive", "restore", "trash", "spam"].includes(operation)) {
    throw new Error(`IMAP adapter does not support mutation ${operation}`);
  }
  requireWrite(operation);
  const parsedId = parseMailboxUid(args.threadId, config.defaultMailbox);
  if (args.dryRun) return { ok: true, provider: "imap-smtp", operation, threadId: args.threadId, dryRun: true, matched: 1 };
  return withImap(async (imap) => {
    await imap.select(parsedId.mailbox);
    if (operation === "mark-read") await imap.store(parsedId.uid, "+FLAGS.SILENT (\\Seen)");
    else if (operation === "mark-unread") await imap.store(parsedId.uid, "-FLAGS.SILENT (\\Seen)");
    else if (operation === "star") await imap.store(parsedId.uid, args.value === false ? "-FLAGS.SILENT (\\Flagged)" : "+FLAGS.SILENT (\\Flagged)");
    else {
      const target = operation === "archive"
        ? await resolveExistingMailbox(imap, config.archiveMailbox, MAILBOX_ALIASES.archive)
        : operation === "trash"
          ? await resolveExistingMailbox(imap, config.trashMailbox, MAILBOX_ALIASES.trash)
          : operation === "spam"
            ? await resolveExistingMailbox(imap, config.spamMailbox, MAILBOX_ALIASES.spam)
            : operation === "restore"
              ? await resolveExistingMailbox(imap, config.defaultMailbox, ["INBOX", "收件箱"])
              : String(args.labelId ?? "");
      if (!target) throw new Error("a target mailbox is required");
      if (operation === "restore" && parsedId.mailbox === config.defaultMailbox) return { ok: true, provider: "imap-smtp", operation, threadId: args.threadId, receipt: `${operation}:${args.threadId}`, unchanged: true };
      await imap.copy(parsedId.uid, target);
      await imap.store(parsedId.uid, "+FLAGS.SILENT (\\Deleted)");
      await imap.expunge(parsedId.uid);
    }
    return { ok: true, provider: "imap-smtp", operation, threadId: args.threadId, receipt: `${operation}:${args.threadId}` };
  });
}

async function listLabels() {
  return withImap(async (imap) => (await imap.list()).map((name) => ({ id: name, name, system: ["INBOX", ...Object.values(MAILBOX_ALIASES).flat()].some((systemName) => systemName.toLowerCase() === name.toLowerCase()) })));
}

async function listAttachments(args) {
  const thread = await getMessage(args);
  return thread.messages[0].attachments;
}

async function downloadAttachment(args) {
  const attachmentText = String(args.attachmentId ?? "");
  const [attachmentMessageId, attachmentIndex] = attachmentText.split("#");
  const parsedId = parseMailboxUid(attachmentMessageId || args.messageId || args.threadId, config.defaultMailbox);
  const index = Number(attachmentIndex ?? "-1");
  if (!Number.isInteger(index) || index < 0) throw new Error("invalid attachment id");
  const destinationDir = String(args.destinationDir ?? "").trim();
  if (!destinationDir) throw new Error("destinationDir is required");
  return withImap(async (imap) => {
    await imap.select(parsedId.mailbox);
    const fetched = await imap.fetch(parsedId.uid, "BODY.PEEK[]");
    const parsed = parseMessage(fetched.raw);
    const attachment = parsed.attachments[index];
    if (!attachment) throw new Error("attachment not found");
    await mkdir(destinationDir, { recursive: true });
    const destinationRoot = await realpath(destinationDir);
    const localPath = join(destinationRoot, basename(attachment.name.replaceAll("\\", "/")));
    const handle = await open(localPath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(attachment.content); } finally { await handle.close(); }
    return { attachmentId: args.attachmentId, messageId: args.messageId ?? args.threadId, name: attachment.name, localPath };
  });
}

async function createDraft(args) {
  assertAccount(args);
  requireWrite("create-draft");
  const attachments = await loadAttachments(args.attachments);
  const draftId = String(args.draftId ?? `draft:${randomUUID()}`).trim();
  if (!/^draft:[A-Za-z0-9-]{8,80}$/.test(draftId)) throw new Error("invalid draft id");
  const raw = buildMimeMessage({ ...args, draftId, from: config.address, attachments });
  return withImap(async (imap) => {
    const draftMailbox = await resolveExistingMailbox(imap, config.draftMailbox, MAILBOX_ALIASES.draft);
    await imap.select(draftMailbox);
    const previous = await imap.search(`HEADER X-OpenBuddy-Draft-ID ${quote(draftId)}`);
    for (const uid of previous) {
      await imap.store(uid, "+FLAGS.SILENT (\\Deleted)");
      await imap.expunge(uid);
    }
    await imap.append(draftMailbox, raw, ["\\Draft"]);
    return { id: draftId, accountId: account.id, to: args.to ?? [], cc: args.cc ?? [], bcc: args.bcc ?? [], subject: args.subject ?? "", body: args.body ?? "", bodyHtml: args.bodyHtml, attachments: args.attachments ?? [], status: "draft" };
  });
}

async function loadAttachments(values) {
  if (!Array.isArray(values)) return [];
  const result = [];
  for (const value of values) {
    const path = typeof value === "string" ? value : value?.path;
    if (!path) continue;
    const content = await readFile(path);
    result.push({ content, name: typeof value === "string" ? basename(path) : value.name ?? basename(path), mimeType: value.mimeType ?? "application/octet-stream" });
  }
  return result;
}

async function sendEmail(args) {
  assertAccount(args);
  requireSend();
  const recipients = [...(args.to ?? []), ...(args.cc ?? []), ...(args.bcc ?? [])].map((item) => typeof item === "string" ? item : item?.address).filter(Boolean);
  const attachments = await loadAttachments(args.attachments);
  const raw = buildMimeMessage({ ...args, from: config.address, attachments });
  const smtp = new SmtpClient({ ...config.smtp, address: config.address, password: config.password });
  try { await smtp.connect(); await smtp.send(raw, recipients, config.address); } finally { smtp.close(); }
  let sentArchived = false;
  try {
    await withImap(async (imap) => {
      const sentMailbox = await resolveExistingMailbox(imap, config.sentMailbox, MAILBOX_ALIASES.sent);
      await imap.append(sentMailbox, raw, ["\\Seen"]);
    });
    sentArchived = true;
  } catch {
    // SMTP already succeeded; Sent archival is best effort and must not resend.
  }
  return { ok: true, provider: "imap-smtp", operation: "send-draft", receipt: `smtp:${Date.now()}`, sentArchived };
}

async function syncMessages(args) {
  assertAccount(args);
  const mailbox = mailboxFor(args);
  const previous = parseSyncCursor(args.cursor);
  return withImap(async (imap) => {
    await imap.select(mailbox);
    const uids = await imap.search("ALL");
    const newestUid = uids.at(-1) ?? 0;
    const added = previous?.mailbox === mailbox && previous.uidValidity === String(imap.uidValidity ?? "unknown") ? uids.filter((uid) => uid > previous.uid).length : uids.length;
    return { status: "synced", cursor: `${mailbox}:${imap.uidValidity ?? "unknown"}:${newestUid}`, added, updated: 0, removed: 0 };
  });
}

function parseSyncCursor(cursor) {
  if (!cursor) return undefined;
  const match = String(cursor).match(/^(.*):(\d+):(\d+)$/);
  return match ? { mailbox: match[1], uidValidity: match[2], uid: Number(match[3]) } : undefined;
}

async function callTool(name, args = {}) {
  switch (name) {
    case "list_accounts": return [await accountSnapshot()];
    case "list_emails": return listMessages(args);
    case "search_emails": return listMessages(args);
    case "get_email": return getMessage(args);
    case "list_mailboxes": return listLabels();
    case "list_attachments": return listAttachments(args);
    case "download_attachment": return downloadAttachment(args);
    case "create_draft": return createDraft(args);
    case "send_email": return sendEmail(args);
    case "sync_emails": return syncMessages(args);
    case "update_email": return mutation(args, args.kind);
    case "mark_email_read": return mutation(args, "mark-read");
    case "mark_email_unread": return mutation(args, "mark-unread");
    case "archive_email": return mutation(args, "archive");
    case "restore_email": return mutation(args, "restore");
    case "star_email": return mutation(args, "star");
    case "trash_email": return mutation(args, "trash");
    case "spam_email": return mutation(args, "spam");
    default: throw new Error(`unknown tool: ${name}`);
  }
}

const server = new Server({ name: "openbuddy-imap-smtp", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try { return textResult(await callTool(request.params.name, request.params.arguments ?? {})); }
  catch (error) {
    const retryable = retryAfterError(error);
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: String(retryable?.message ?? retryable).slice(0, 300), ...(retryable?.retryAfterMs ? { retryAfterMs: retryable.retryAfterMs } : {}) }) }] };
  }
});
await server.connect(new StdioServerTransport());
