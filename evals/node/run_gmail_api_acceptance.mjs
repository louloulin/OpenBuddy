import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, lstatSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const enabled = process.env.OPENBUDDY_EMAIL_GMAIL_API_ACCEPTANCE === "1";
const token = String(process.env.OPENBUDDY_EMAIL_GMAIL_ACCESS_TOKEN ?? "").trim();
const evidenceDir = String(process.env.OPENBUDDY_EVIDENCE_DIR ?? "").trim();
const requested = {
  management: process.env.OPENBUDDY_EMAIL_EXTERNAL_MANAGE === "1",
  write: process.env.OPENBUDDY_EMAIL_EXTERNAL_WRITE === "1",
  send: process.env.OPENBUDDY_EMAIL_EXTERNAL_SEND === "1",
  attachments: process.env.OPENBUDDY_EMAIL_EXTERNAL_ATTACHMENTS === "1",
  attachmentDownload: process.env.OPENBUDDY_EMAIL_EXTERNAL_ATTACHMENT_DOWNLOAD === "1",
};
const writeConfirm = "I_UNDERSTAND_MAILBOX_MUTATIONS";
const sendConfirm = "I_UNDERSTAND_EXTERNAL_EMAIL_SEND";

if (!enabled || !token) {
  console.error("Gmail API acceptance is fail-closed: set OPENBUDDY_EMAIL_GMAIL_API_ACCEPTANCE=1 and a temporary OAuth access token.");
  process.exit(2);
}
if (requested.management && process.env.OPENBUDDY_EMAIL_EXTERNAL_CONFIRM !== writeConfirm) {
  console.error(`management mode requires OPENBUDDY_EMAIL_EXTERNAL_CONFIRM=${writeConfirm}`);
  process.exit(2);
}
if ((requested.write || requested.send) && !process.env.OPENBUDDY_EMAIL_GMAIL_TEST_RECIPIENT?.trim()) {
  console.error("Gmail write/send mode requires OPENBUDDY_EMAIL_GMAIL_TEST_RECIPIENT.");
  process.exit(2);
}
if (requested.send && (!requested.write || process.env.OPENBUDDY_EMAIL_EXTERNAL_SEND_CONFIRM !== sendConfirm)) {
  console.error(`send mode requires write mode and OPENBUDDY_EMAIL_EXTERNAL_SEND_CONFIRM=${sendConfirm}`);
  process.exit(2);
}
if (requested.attachmentDownload && !path.isAbsolute(String(process.env.OPENBUDDY_EMAIL_ATTACHMENT_DIR ?? ""))) {
  console.error("attachment download requires an absolute OPENBUDDY_EMAIL_ATTACHMENT_DIR");
  process.exit(2);
}

const digest = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
const safeError = (error) => String(error?.message ?? error ?? "unknown error")
  .replace(/(authorization|bearer|password|auth[_ -]?code|token|secret)[=:][^\s,}]+/gi, "$1=[redacted]")
  .slice(0, 300);
const checks = [];
const check = async (name, fn, shouldRun = true) => {
  if (!shouldRun) {
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
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const exactRecipient = String(process.env.OPENBUDDY_EMAIL_GMAIL_TEST_RECIPIENT ?? "").trim();
const subject = `OpenBuddy Gmail API acceptance ${Date.now().toString(36)}`;
const vite = await createServer({ configFile: path.resolve("vitest.config.ts"), server: { middlewareMode: true }, appType: "custom" });
const { GmailApiEmailProvider } = await vite.ssrLoadModule(path.resolve("packages/capability/openbuddy-email/src/gmail-api-provider.ts"));
const provider = new GmailApiEmailProvider({ accessToken: token, maxResults: 20 });
let account;
let firstPage;
let firstThread;
let firstThreadDetail;
let createdDraft;

try {
  const accounts = await check("profile", async () => {
    const result = await provider.accounts();
    if (!result[0]?.address || result[0].status !== "connected") throw new Error("Gmail profile is not connected");
    account = result[0];
    return { accountDomain: account.address.split("@")[1] ?? "unknown", capabilities: account.capabilities };
  });

  await check("provider-diagnostics", async () => {
    const diagnostics = await provider.diagnostics();
    if (diagnostics.readiness !== "ready") throw new Error(`Gmail provider readiness is ${diagnostics.readiness}`);
    return { readiness: diagnostics.readiness, availableCapabilities: diagnostics.availableCapabilities };
  }, Boolean(accounts));

  firstPage = await check("thread-list-search", async () => {
    const page = await provider.threadsPage({ query: process.env.OPENBUDDY_EMAIL_GMAIL_QUERY?.trim() || "in:anywhere", limit: 10 });
    firstThread = page.items[0];
    return { count: page.items.length, hasNextPage: Boolean(page.nextCursor), firstThread: firstThread ? digest(firstThread.id) : undefined };
  }, Boolean(accounts));

  await check("pagination", async () => {
    if (!firstPage?.nextCursor) return { status: "not-run", reason: "selected result has no next page" };
    const next = await provider.threadsPage({ query: process.env.OPENBUDDY_EMAIL_GMAIL_QUERY?.trim() || "in:anywhere", limit: 10, cursor: firstPage.nextCursor });
    if (next.nextCursor === firstPage.nextCursor) throw new Error("Gmail returned a repeated page token");
    return { count: next.items.length, cursorAdvanced: true };
  }, Boolean(accounts));

  await check("labels-and-thread", async () => {
    const labels = await provider.labels(account.id);
    if (!Array.isArray(labels)) throw new Error("Gmail labels response is invalid");
    if (firstThread) {
      firstThreadDetail = await provider.thread(account.id, firstThread.id);
      if (firstThreadDetail.id !== firstThread.id) throw new Error("Gmail thread identity mismatch");
    }
    return { labels: labels.length, thread: firstThread ? digest(firstThread.id) : undefined, messages: firstThreadDetail?.messages.length ?? 0 };
  }, Boolean(accounts));

  await check("reversible-management", async () => {
    if (!firstThread) return { status: "not-run", reason: "no thread available" };
    const before = await provider.thread(account.id, firstThread.id);
    const latest = before.messages.at(-1);
    const originalStarred = firstThread.starred === true;
    const originalUnread = latest?.unread === true;
    try {
      await provider.update({ accountId: account.id, threadId: firstThread.id, kind: "star", value: !originalStarred });
      await provider.update({ accountId: account.id, threadId: firstThread.id, kind: originalUnread ? "mark-read" : "mark-unread" });
      return { thread: digest(firstThread.id), operations: ["star-roundtrip", "read-roundtrip"] };
    } finally {
      await provider.update({ accountId: account.id, threadId: firstThread.id, kind: "star", value: originalStarred });
      await provider.update({ accountId: account.id, threadId: firstThread.id, kind: originalUnread ? "mark-unread" : "mark-read" });
    }
  }, requested.management);

  await check("draft-write-and-idempotent-update", async () => {
    const input = { accountId: account.id, to: [{ address: exactRecipient }], subject, body: "OpenBuddy Gmail API acceptance draft." };
    createdDraft = await provider.createDraft(input);
    const updated = await provider.createDraft({ ...input, draftId: createdDraft.id, body: "OpenBuddy Gmail API acceptance draft updated." });
    if (updated.id !== createdDraft.id) throw new Error("Gmail draft update returned a different draft id");
    const visible = await provider.threadsPage({ folder: "drafts", query: subject, limit: 20 });
    if (visible.items.filter((item) => item.subject === subject).length !== 1) throw new Error("Gmail Drafts did not show exactly one updated draft");
    return { draft: digest(createdDraft.id), remoteVisible: true, idempotent: true };
  }, requested.write);

  await check("controlled-send-and-sent-visibility", async () => {
    if (!createdDraft) throw new Error("send requires a draft created in this run");
    await provider.sendDraft(createdDraft);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const sent = await provider.threadsPage({ folder: "sent", query: subject, limit: 20 });
      if (sent.items.some((item) => item.subject === subject)) return { draft: digest(createdDraft.id), sentVisible: true };
      await wait(500);
    }
    throw new Error("sent message was not visible in Gmail Sent");
  }, requested.send);

  await check("attachment-list-and-download", async () => {
    if (!firstThreadDetail) return { status: "not-run", reason: "no readable thread" };
    const attachment = firstThreadDetail.messages.flatMap((message) => message.attachments).at(0);
    if (!attachment) return { status: "not-run", reason: "selected thread has no attachment" };
    const listed = await provider.listAttachments(account.id, attachment.messageId);
    if (!listed.some((item) => item.id === attachment.id)) throw new Error("Gmail attachment listing did not contain the selected attachment");
    if (!requested.attachmentDownload) return { count: listed.length, attachment: digest(attachment.id), download: "not requested" };
    const destination = path.resolve(process.env.OPENBUDDY_EMAIL_ATTACHMENT_DIR);
    mkdirSync(destination, { recursive: true });
    const downloaded = await provider.downloadAttachment(account.id, attachment.id, attachment.messageId, destination);
    const root = realpathSync(destination);
    const target = realpathSync(downloaded.localPath);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || lstatSync(downloaded.localPath).isSymbolicLink() || !statSync(target).isFile()) throw new Error("downloaded attachment escaped the selected directory");
    return { count: listed.length, attachment: digest(attachment.id), downloaded: true, bytes: statSync(target).size };
  }, requested.attachments);
} catch (error) {
  checks.push({ name: "runner", status: "failed", error: safeError(error), errorDigest: digest(error) });
} finally {
  await vite.close();
}

const failed = checks.filter((item) => item.status === "failed");
const report = {
  schema: "openbuddy.gmail-api-acceptance.v1",
  evidenceLevel: "real-external",
  provider: "gmail-api",
  requested,
  accountDomain: account?.address?.split("@")[1] ?? "unknown",
  checks,
  passed: checks.filter((item) => item.status === "passed").length,
  failed: failed.length,
  notRun: checks.filter((item) => item.status === "not-run").length,
};
if (evidenceDir) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path.join(evidenceDir, "gmail-api-acceptance.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
console.log(JSON.stringify({ ...report, evidenceArtifact: evidenceDir ? path.join(evidenceDir, "gmail-api-acceptance.json") : null }, null, 2));
process.exit(failed.length ? 1 : 0);
