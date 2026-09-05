import { EventEmitter } from "node:events";
import net from "node:net";
import { describe, expect, it } from "vitest";
import {
  buildMimeMessage,
  decodeHeader,
  decodeImapMailbox,
  encodeImapMailbox,
  envConfig,
  ImapClient,
  parseMessage,
  parseHeaders,
  parseMailboxUid,
  SmtpClient,
  threadId,
  LineSocket,
  managementOperationsForMailboxes,
} from "./imap-smtp-core.mjs";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(() => resolve()));
}

async function createImapFixture() {
  const state = { commands: [], appended: [] };
  const rawMessage = "Subject: fixture\r\nFrom: sender@example.com\r\n\r\nfixture body\r\n";
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let pendingAppend;
    socket.write("* OK fixture IMAP ready\r\n");
    const sendTagged = (tag, text = "OK completed") => socket.write(`${tag} ${text}\r\n`);
    const process = () => {
      while (true) {
        if (pendingAppend) {
          if (buffer.length < pendingAppend.size + 2) return;
          pendingAppend.raw = buffer.subarray(0, pendingAppend.size).toString("utf8");
          buffer = buffer.subarray(pendingAppend.size + 2);
          state.appended.push(pendingAppend);
          sendTagged(pendingAppend.tag);
          pendingAppend = undefined;
          continue;
        }
        const end = buffer.indexOf("\r\n");
        if (end < 0) return;
        const line = buffer.subarray(0, end).toString("utf8");
        buffer = buffer.subarray(end + 2);
        const match = line.match(/^(\S+)\s+(.+)$/);
        if (!match) continue;
        const [, tag, command] = match;
        state.commands.push(command);
        if (/^LOGIN\b/i.test(command)) sendTagged(tag);
        else if (/^LIST\b/i.test(command)) {
          socket.write("* LIST (\\HasNoChildren) \"/\" \"INBOX\"\r\n");
          socket.write("* LIST (\\HasNoChildren) \"/\" \"Drafts\"\r\n");
          socket.write("* LIST (\\HasNoChildren) \"/\" \"Sent\"\r\n");
          sendTagged(tag);
        } else if (/^SELECT\b/i.test(command)) {
          socket.write("* 1 EXISTS\r\n* OK [UIDVALIDITY 42] fixture\r\n");
          sendTagged(tag);
        } else if (/^UID SEARCH\b/i.test(command)) {
          socket.write("* SEARCH 1\r\n");
          sendTagged(tag);
        } else if (/^UID FETCH\b/i.test(command)) {
          socket.write(`* 1 FETCH (UID 1 FLAGS (\\Seen) BODY.PEEK[] {${Buffer.byteLength(rawMessage)}}\r\n`);
          socket.write(rawMessage);
          socket.write(`\r\n${tag} OK completed\r\n`);
        } else if (/^UID STORE\b|^UID COPY\b|^UID EXPUNGE\b/i.test(command)) sendTagged(tag);
        else if (/^APPEND\b/i.test(command)) {
          const literal = command.match(/\{(\d+)\}$/);
          if (!literal) return sendTagged(tag, "BAD missing literal");
          pendingAppend = { tag, size: Number(literal[1]), mailbox: command };
          socket.write("+ Ready for literal\r\n");
        } else if (/^LOGOUT\b/i.test(command)) {
          socket.write("* BYE fixture\r\n");
          sendTagged(tag, "OK logout");
          socket.end();
        } else sendTagged(tag);
      }
    };
    socket.on("data", (chunk) => { buffer = Buffer.concat([buffer, chunk]); process(); });
  });
  const port = await listen(server);
  return { port, state, rawMessage, server };
}

async function createSmtpFixture() {
  const state = { commands: [], message: "" };
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let dataMode = false;
    socket.write("220 fixture SMTP ready\r\n");
    const process = () => {
      if (dataMode) {
        const end = buffer.indexOf("\r\n.\r\n");
        if (end < 0) return;
        state.message = buffer.subarray(0, end).toString("utf8");
        buffer = buffer.subarray(end + 5);
        dataMode = false;
        socket.write("250 2.0.0 accepted\r\n");
      }
      while (!dataMode) {
        const end = buffer.indexOf("\r\n");
        if (end < 0) return;
        const line = buffer.subarray(0, end).toString("utf8");
        buffer = buffer.subarray(end + 2);
        state.commands.push(line);
        if (/^EHLO\b/i.test(line)) socket.write("250-fixture\r\n250 AUTH LOGIN\r\n");
        else if (/^AUTH LOGIN$/i.test(line)) socket.write("334 VXNlcm5hbWU6\r\n");
        else if (state.commands.at(-2)?.toUpperCase() === "AUTH LOGIN") socket.write("334 UGFzc3dvcmQ6\r\n");
        else if (/^MAIL FROM:/i.test(line) || /^RCPT TO:/i.test(line)) socket.write("250 accepted\r\n");
        else if (/^DATA$/i.test(line)) { dataMode = true; socket.write("354 end with <CRLF>.<CRLF>\r\n"); break; }
        else if (/^QUIT$/i.test(line)) { socket.write("221 bye\r\n"); socket.end(); break; }
        else if (/^[A-Za-z0-9+/=]+$/.test(line)) socket.write("235 authenticated\r\n");
      }
    };
    socket.on("data", (chunk) => { buffer = Buffer.concat([buffer, chunk]); process(); });
  });
  const port = await listen(server);
  return { port, state, server };
}

describe("OpenBuddy IMAP/SMTP adapter core", () => {
  it("declares only management operations backed by real mailboxes", () => {
    const config = { allowWrite: true, defaultMailbox: "INBOX", archiveMailbox: "Archive", trashMailbox: "Trash", spamMailbox: "Junk" };
    expect(managementOperationsForMailboxes(["INBOX", "Sent Messages", "Drafts", "Deleted Messages", "Junk"], config)).toEqual(["mark-read", "mark-unread", "star", "restore", "trash", "spam"]);
    expect(managementOperationsForMailboxes(["INBOX", "Drafts"], config)).toEqual(["mark-read", "mark-unread", "star", "restore"]);
    expect(managementOperationsForMailboxes(["INBOX", "Archive", "Trash", "Junk"], { ...config, allowWrite: false })).toEqual([]);
  });

  it("loads QQ-compatible configuration without logging secrets", () => {
    const config = envConfig({
      OPENBUDDY_EMAIL_ADDRESS: "user@qq.com",
      OPENBUDDY_EMAIL_AUTH_CODE: "secret-code",
      OPENBUDDY_IMAP_HOST: "imap.qq.com",
      OPENBUDDY_SMTP_HOST: "smtp.qq.com",
    });
    expect(config.address).toBe("user@qq.com");
    expect(config.imap.port).toBe(993);
    expect(config.smtp.port).toBe(465);
    expect(config.smtp.startTls).toBe(false);
    expect(config.smtp.allowInsecure).toBe(false);
    expect(config.allowWrite).toBe(false);
    expect(config.allowSend).toBe(false);
    expect(config.password).toBe("secret-code");
    expect(config.imap.maxMessageBytes).toBe(25 * 1024 * 1024);
  });

  it("decodes folded and encoded message headers", () => {
    const headers = parseHeaders("Subject: =?UTF-8?B?5rWL6K+V?=\r\n\t= ?\r\nFrom: Alice <alice@example.com>");
    expect(decodeHeader(headers.subject)).toContain("测试");
    expect(headers.from).toBe("Alice <alice@example.com>");
  });

  it("parses plain and multipart messages into OpenBuddy fields", () => {
    const raw = [
      "Subject: =?UTF-8?B?5rWL6K+V?=",
      "From: Alice <alice@example.com>",
      "To: Bob <bob@example.com>",
      "Date: Sat, 30 Aug 2026 00:00:00 +0000",
      "Message-ID: <message-1@example.com>",
      "Content-Type: multipart/mixed; boundary=mail-boundary",
      "",
      "--mail-boundary",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "正文内容",
      "--mail-boundary",
      "Content-Type: text/plain; name=note.txt",
      "Content-Disposition: attachment; filename=note.txt",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("attachment\n").toString("base64"),
      "--mail-boundary--",
      "",
    ].join("\r\n");
    const message = parseMessage(raw);
    expect(message.subject).toBe("测试");
    expect(message.messageId).toBe("message-1@example.com");
    expect(message.from.address).toBe("alice@example.com");
    expect(message.to[0].address).toBe("bob@example.com");
    expect(message.text).toContain("正文内容");
    expect(message.attachments[0].name).toBe("note.txt");
    expect(message.attachments[0].content.toString()).toContain("attachment");
  });

  it("builds safe UTF-8 MIME and keeps BCC out of visible headers", () => {
    const raw = buildMimeMessage({
      from: "user@qq.com",
      to: [{ address: "to@example.com" }],
      cc: [{ address: "cc@example.com" }],
      bcc: [{ address: "hidden@example.com" }],
      subject: "中文主题",
      body: "正文",
      attachments: [{ name: "note.txt", mimeType: "text/plain", content: Buffer.from("hello") }],
    });
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(raw).toContain("To: to@example.com");
    expect(raw).toContain("Cc: cc@example.com");
    expect(raw).not.toContain("Bcc:");
    expect(raw).toContain("filename=\"note.txt\"");
  });

  it("persists a safe stable draft identity in MIME headers", () => {
    const raw = buildMimeMessage({ draftId: "draft:abc-123", from: "user@qq.com", to: [{ address: "to@example.com" }], subject: "subject", body: "body" });
    expect(raw).toContain("X-OpenBuddy-Draft-ID: draft:abc-123");
    expect(() => buildMimeMessage({ draftId: "draft:bad\\r\\nX-Injected: yes", from: "user@qq.com", to: [{ address: "to@example.com" }], subject: "subject", body: "body" })).not.toThrow();
    expect(buildMimeMessage({ draftId: "draft:bad\\r\\nX-Injected: yes", from: "user@qq.com", to: [{ address: "to@example.com" }], subject: "subject", body: "body" })).not.toContain("X-Injected: yes");
  });

  it("uses mailbox and UID as stable provider thread identity", () => {
    expect(parseMailboxUid("INBOX:42")).toEqual({ mailbox: "INBOX", uid: 42 });
    expect(parseMailboxUid("42")).toEqual({ mailbox: "INBOX", uid: 42 });
    expect(threadId("INBOX", 42)).toBe("INBOX:42");
    expect(() => parseMailboxUid("bad")).toThrow(/invalid mailbox message id/);
    expect(() => parseMailboxUid("INBOX:0")).toThrow(/invalid mailbox message id/);
  });

  it("round-trips IMAP modified UTF-7 mailbox names", () => {
    for (const mailbox of ["INBOX", "收件箱", "项目 & 归档"]) {
      expect(decodeImapMailbox(encodeImapMailbox(mailbox))).toBe(mailbox);
    }
    expect(encodeImapMailbox("收件箱")).toBe("&ZTZO9nux-");
  });

  it("does not expose BCC in the SMTP header while retaining recipients in input", () => {
    const raw = buildMimeMessage({ from: "user@qq.com", to: [{ address: "to@example.com" }], bcc: [{ address: "hidden@example.com" }], subject: "subject", body: "body" });
    expect(raw).toContain("To: to@example.com");
    expect(raw).not.toContain("hidden@example.com");
    expect(raw).not.toContain("Bcc:");
  });

  it("allows BCC-only delivery without adding a visible Bcc header", () => {
    const raw = buildMimeMessage({ from: "user@qq.com", bcc: [{ address: "hidden@example.com" }], subject: "subject", body: "body" });
    expect(raw).toContain("From: user@qq.com");
    expect(raw).not.toContain("Bcc:");
  });

  it("rejects address and MIME header injection", () => {
    expect(() => buildMimeMessage({ from: "user@qq.com\r\nBcc: leak@example.com", to: [{ address: "to@example.com" }], subject: "subject", body: "body" })).toThrow(/invalid sender/);
    expect(() => buildMimeMessage({ from: "user@qq.com", to: [{ address: "to@example.com\r\nBcc: leak@example.com" }], subject: "subject", body: "body" })).toThrow(/invalid email recipient/);
    const raw = buildMimeMessage({ from: "user@qq.com", to: [{ address: "to@example.com" }], subject: "subject", body: "body", attachments: [{ name: "..\\evil\r\n.txt", mimeType: "text/plain\r\nX-Injected: yes", content: Buffer.from("x") }] });
    expect(raw).not.toContain("X-Injected: yes");
    expect(raw).not.toContain("..\\evil");
  });

  it("encodes Reply-To while keeping the authenticated sender separate", () => {
    const raw = buildMimeMessage({ from: "user@qq.com", to: [{ address: "to@example.com" }], replyTo: [{ address: "reply@example.com" }], subject: "subject", body: "body" });
    expect(raw).toContain("From: user@qq.com");
    expect(raw).toContain("Reply-To: reply@example.com");
  });

  it("handles a line split across multiple socket data chunks", async () => {
    const socket = new EventEmitter();
    socket.write = (_value, callback) => callback?.();
    socket.end = () => undefined;
    const io = new LineSocket(socket, 100);
    const line = io.readLine();
    socket.emit("data", Buffer.from("a001 O"));
    socket.emit("data", Buffer.from("K completed\r"));
    socket.emit("data", Buffer.from("\n"));
    await expect(line).resolves.toBe("a001 OK completed");
  });

  it("executes IMAP read, management, draft, and mailbox operations", async () => {
    const fixture = await createImapFixture();
    const client = new ImapClient({ host: "127.0.0.1", port: fixture.port, tls: false, rejectUnauthorized: true, timeoutMs: 1000, maxMessageBytes: 1024 * 1024, address: "user@example.com", password: "secret" });
    try {
      await client.connect();
      expect(await client.list()).toEqual(["INBOX", "Drafts", "Sent"]);
      expect(await client.select("INBOX")).toMatchObject({ mailbox: "INBOX", exists: 1, uidValidity: "42" });
      expect(await client.search("ALL")).toEqual([1]);
      const fetched = await client.fetch(1);
      expect(fetched.raw.toString()).toContain("fixture body");
      expect(fetched.flags).toContain("\\Seen");
      await client.store(1, "+FLAGS.SILENT (\\Flagged)");
      await client.copy(1, "Drafts");
      await client.expunge(1);
      await client.append("Drafts", "Subject: draft\r\n\r\ndraft body\r\n", ["\\Draft"]);
      expect(fixture.state.commands).toEqual(expect.arrayContaining([
        expect.stringMatching(/^LOGIN /),
        expect.stringMatching(/^SELECT /),
        expect.stringMatching(/^UID SEARCH /),
        expect.stringMatching(/^UID FETCH /),
        expect.stringMatching(/^UID STORE /),
        expect.stringMatching(/^UID COPY /),
        expect.stringMatching(/^UID EXPUNGE /),
        expect.stringMatching(/^APPEND /),
      ]));
      expect(fixture.state.appended[0].raw).toContain("draft body");
    } finally {
      await client.close();
      await closeServer(fixture.server);
    }
  });

  it("authenticates and sends SMTP data through an explicit insecure test fixture", async () => {
    const fixture = await createSmtpFixture();
    const client = new SmtpClient({ host: "127.0.0.1", port: fixture.port, tls: false, startTls: false, allowInsecure: true, rejectUnauthorized: true, timeoutMs: 1000, maxMessageBytes: 1024 * 1024, address: "user@example.com", password: "secret" });
    try {
      await client.connect();
      await client.send("From: user@example.com\r\n\r\nline\r\n.dot", ["recipient@example.com"], "user@example.com");
      expect(fixture.state.commands).toEqual(expect.arrayContaining([
        "EHLO openbuddy.local",
        "AUTH LOGIN",
        "MAIL FROM:<user@example.com>",
        "RCPT TO:<recipient@example.com>",
        "DATA",
        "QUIT",
      ]));
      expect(fixture.state.message).toContain("line\r\n..dot");
    } finally {
      client.close();
      await closeServer(fixture.server);
    }
  });

  it("rejects plaintext SMTP authentication unless explicitly enabled", async () => {
    const client = new SmtpClient({ host: "127.0.0.1", port: 1, tls: false, startTls: false, allowInsecure: false, rejectUnauthorized: true, timeoutMs: 100, maxMessageBytes: 1024, address: "user@example.com", password: "secret" });
    await expect(client.connect()).rejects.toThrow(/plaintext AUTH is disabled/);
  });

  it("selects STARTTLS for port 587 and rejects plaintext SMTP by default", () => {
    const config = envConfig({ OPENBUDDY_EMAIL_ADDRESS: "user@qq.com", OPENBUDDY_EMAIL_PASSWORD: "secret", OPENBUDDY_SMTP_PORT: "587", OPENBUDDY_SMTP_TLS: "0" });
    expect(config.smtp.tls).toBe(false);
    expect(config.smtp.startTls).toBe(true);
    expect(config.smtp.allowInsecure).toBe(false);
  });

  it("infers secure transport from the standard SMTP port", () => {
    const config = envConfig({ OPENBUDDY_EMAIL_ADDRESS: "user@qq.com", OPENBUDDY_EMAIL_PASSWORD: "secret", OPENBUDDY_SMTP_PORT: "587" });
    expect(config.smtp.tls).toBe(false);
    expect(config.smtp.startTls).toBe(true);
  });

  it("keeps credentials as placeholders when the source environment is absent", () => {
    const config = envConfig({
      OPENBUDDY_EMAIL_ADDRESS: "user@qq.com",
      OPENBUDDY_EMAIL_PASSWORD: "placeholder",
      OPENBUDDY_EMAIL_ALLOW_WRITE: "0",
    });
    expect(config.allowWrite).toBe(false);
    expect(config.allowSend).toBe(false);
  });
});
