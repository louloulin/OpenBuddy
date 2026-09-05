import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const account = {
  id: "mail-account-1",
  address: "agent@example.test",
  name: "OpenBuddy E2E",
  provider: "mcp-e2e",
  capabilities: { read: true, write: true, attachments: true, multipleAccounts: false, management: true, managementOperations: ["mark-read", "mark-unread", "archive", "restore", "label-add", "label-remove", "star", "trash", "spam", "snooze", "unsubscribe"], sync: true },
};
const state = {
  labels: [{ id: "label-inbox", name: "INBOX", system: true }, { id: "label-starred", name: "Starred" }],
  threads: [{
    id: "thread-1",
    accountId: account.id,
    subject: "真实 MCP 邮件验证",
    snippet: "Electron + Pi + MCP 的隔离测试邮件",
    from: { address: "sender@example.test", name: "Sender" },
    date: "2026-08-30T00:00:00.000Z",
    messageCount: 1,
    unread: true,
    starred: false,
    labels: ["INBOX"],
    tags: [],
  }],
  drafts: [],
  sent: [],
  syncCount: 0,
  policies: [],
  shares: [],
  reminders: [],
  projects: [],
};

const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const inputSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    accountId: { type: "string" }, threadId: { type: "string" }, query: { type: "string" },
    kind: { type: "string" }, labelId: { type: "string" }, value: { type: "boolean" }, dryRun: { type: "boolean" },
    to: { type: "array" }, cc: { type: "array" }, bcc: { type: "array" }, subject: { type: "string" }, body: { type: "string" },
    messageId: { type: "string" }, attachmentId: { type: "string" }, destinationDir: { type: "string" },
  },
};
const tools = [
  ["list_accounts", "List isolated test accounts"], ["list_emails", "List isolated test email threads"],
  ["search_emails", "Search isolated test email threads"], ["get_email", "Read an isolated test email thread"],
  ["list_labels", "List isolated test labels"], ["update_email", "Update an isolated test thread"],
  ["mark_email_read", "Mark an isolated email read"], ["mark_email_unread", "Mark an isolated email unread"],
  ["archive_email", "Archive an isolated email"], ["restore_email", "Restore an isolated email"],
  ["star_email", "Star an isolated email"], ["trash_email", "Trash an isolated email"],
  ["spam_email", "Mark an isolated email as spam"], ["snooze_email", "Snooze an isolated email"],
  ["update_email_label", "Update an isolated email label"],
  ["set_sender_policy", "Set isolated sender policy"], ["unsubscribe_email", "Unsubscribe isolated sender"],
  ["share_email_thread", "Share an isolated email thread"], ["create_reminder", "Create an isolated reminder"],
  ["move_to_project", "Move an isolated thread to a project"], ["sync_emails", "Synchronize isolated email state"],
  ["list_attachments", "List isolated attachments"], ["download_attachment", "Download an isolated attachment"],
  ["create_draft", "Create an isolated test draft"], ["send_email", "Send an isolated test draft"],
].map(([name, description]) => ({ name, description, inputSchema }));

function findThread(threadId) {
  const thread = state.threads.find((item) => item.id === threadId);
  if (!thread) throw new Error(`thread not found: ${threadId}`);
  return thread;
}

function callTool(name, args = {}) {
  switch (name) {
    case "list_accounts": return [account];
    case "list_emails": {
      const threads = state.threads.filter((thread) => !args.accountId || thread.accountId === args.accountId);
      return args.cursor ? { items: [], nextCursor: undefined } : { items: threads, nextCursor: "page-2" };
    }
    case "search_emails": return state.threads.filter((thread) => !args.accountId || thread.accountId === args.accountId)
      .filter((thread) => !args.query || `${thread.subject} ${thread.snippet}`.toLowerCase().includes(String(args.query).toLowerCase()));
    case "get_email": {
      const thread = findThread(args.threadId ?? args.message_id);
      return {
        ...thread,
        messages: [{ id: "message-1", threadId: thread.id, from: thread.from, to: [{ address: account.address }], cc: [], subject: thread.subject,
          date: thread.date, text: thread.snippet, unread: thread.unread, attachments: [{ id: "attachment-1", messageId: "message-1", name: "e2e.txt", mimeType: "text/plain", size: 12 }] }],
      };
    }
    case "list_labels": return state.labels;
    case "sync_emails": {
      state.syncCount += 1;
      return { status: "synced", cursor: `sync-${state.syncCount}`, added: state.syncCount === 1 ? 1 : 0, updated: 0, removed: 0 };
    }
    case "list_attachments": return [{ id: "attachment-1", messageId: args.messageId, name: "e2e.txt", mimeType: "text/plain", size: 12 }];
    case "download_attachment": {
      const destinationDir = args.destinationDir;
      if (!destinationDir) throw new Error("destinationDir is required");
      mkdirSync(destinationDir, { recursive: true });
      const localPath = join(destinationDir, "e2e.txt");
      writeFileSync(localPath, "E2E attachment\n", "utf8");
      return { attachmentId: args.attachmentId, messageId: args.messageId, name: "e2e.txt", localPath };
    }
    case "update_email":
    case "mark_email_read":
    case "mark_email_unread":
    case "archive_email":
    case "restore_email":
    case "star_email":
    case "trash_email":
    case "spam_email":
    case "snooze_email":
    case "update_email_label": {
      const thread = findThread(args.threadId);
      const operation = name === "update_email" ? args.kind : ({
        mark_email_read: "mark-read", mark_email_unread: "mark-unread", archive_email: "archive",
        restore_email: "restore", star_email: "star", trash_email: "trash", spam_email: "spam",
        snooze_email: "snooze", update_email_label: "label",
      }[name] ?? name);
      if (args.dryRun) return { ok: true, provider: "mcp-email-e2e", operation, threadId: thread.id, dryRun: true, matched: 1 };
      if (operation === "mark-read") thread.unread = false;
      if (operation === "mark-unread") thread.unread = true;
      if (operation === "star") thread.starred = args.value !== false;
      if (operation === "label" && args.labelId) {
        thread.labels = args.value === false ? thread.labels.filter((label) => label !== args.labelId) : [...new Set([...thread.labels, args.labelId])];
      }
      if (operation === "archive") thread.labels = thread.labels.filter((label) => label !== "INBOX");
      if (operation === "restore") thread.labels = [...new Set([...thread.labels.filter((label) => label !== "TRASH" && label !== "SPAM"), "INBOX"])]
      if (operation === "trash") thread.labels = [...new Set([...thread.labels.filter((label) => label !== "INBOX"), "TRASH"])]
      if (operation === "spam") thread.labels = [...new Set([...thread.labels.filter((label) => label !== "INBOX"), "SPAM"])]
      return { ok: true, provider: "mcp-email-e2e", operation, threadId: thread.id, receipt: `update:${thread.id}` };
    }
    case "set_sender_policy":
      state.policies = [...state.policies.filter((item) => item.senderEmail !== args.senderEmail), { senderEmail: args.senderEmail, policy: args.policy }];
      return { ok: true, provider: "mcp-email-e2e", operation: `sender-policy:${args.policy}`, receipt: `policy:${args.senderEmail}` };
    case "unsubscribe_email":
      return { ok: true, provider: "mcp-email-e2e", operation: "unsubscribe", threadId: args.threadId, receipt: `unsubscribe:${args.messageId}` };
    case "share_email_thread":
      state.shares.push({ ...args });
      return { ok: true, provider: "mcp-email-e2e", operation: "share-thread", threadId: args.threadId, receipt: `share:${args.threadId}` };
    case "create_reminder":
      state.reminders.push({ ...args });
      return { ok: true, provider: "mcp-email-e2e", operation: "create-reminder", threadId: args.threadId, receipt: `reminder:${args.threadId}` };
    case "move_to_project":
      state.projects.push({ ...args });
      return { ok: true, provider: "mcp-email-e2e", operation: "move-to-project", threadId: args.threadId, receipt: `project:${args.threadId}` };
    case "create_draft": {
      const existing = args.draftId ? state.drafts.find((item) => item.id === args.draftId) : undefined;
      const draft = { id: existing?.id ?? args.draftId ?? `draft-${state.drafts.length + 1}`, accountId: args.accountId, to: args.to ?? [], cc: args.cc ?? [], bcc: args.bcc ?? [],
        subject: args.subject ?? "", body: args.body ?? "", attachments: args.attachments ?? [], status: "draft",
        createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z" };
      if (existing) Object.assign(existing, draft);
      else state.drafts.push(draft);
      return draft;
    }
    case "send_email": {
      const draft = state.drafts.find((item) => item.id === args.id || item.id === args.draftId);
      if (!draft) throw new Error("draft not found");
      draft.status = "sent";
      state.sent.push({ ...draft });
      return { ok: true, provider: "mcp-email-e2e", operation: "send-draft", receipt: `sent:${draft.id}` };
    }
    default: throw new Error(`unknown tool: ${name}`);
  }
}

const server = new Server({ name: "openbuddy-email-e2e", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try { return text(callTool(request.params.name, request.params.arguments ?? {})); }
  catch (error) { return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: String(error.message ?? error) }) }] }; }
});
await server.connect(new StdioServerTransport());
