import { randomUUID } from "node:crypto";
import tls from "node:tls";
import net from "node:net";

const DEFAULT_TIMEOUT_MS = 20_000;

const MAILBOX_CAPABILITY_ALIASES = {
  inbox: ["INBOX", "收件箱"],
  archive: ["Archive", "Archives", "归档"],
  trash: ["Trash", "Deleted Messages", "Deleted Items", "已删除"],
  spam: ["Junk", "Spam", "垃圾邮件"],
};

function hasMailbox(mailboxes, requested, aliases = []) {
  const candidates = [requested, ...aliases].filter(Boolean).map((value) => String(value).toLocaleLowerCase());
  return mailboxes.some((mailbox) => candidates.includes(String(mailbox).toLocaleLowerCase()));
}

export function managementOperationsForMailboxes(mailboxes, config) {
  if (!config?.allowWrite || !Array.isArray(mailboxes)) return [];
  const operations = ["mark-read", "mark-unread", "star"];
  if (hasMailbox(mailboxes, config.defaultMailbox, MAILBOX_CAPABILITY_ALIASES.inbox)) operations.push("restore");
  if (hasMailbox(mailboxes, config.archiveMailbox, MAILBOX_CAPABILITY_ALIASES.archive)) operations.push("archive");
  if (hasMailbox(mailboxes, config.trashMailbox, MAILBOX_CAPABILITY_ALIASES.trash)) operations.push("trash");
  if (hasMailbox(mailboxes, config.spamMailbox, MAILBOX_CAPABILITY_ALIASES.spam)) operations.push("spam");
  return operations;
}

export function envConfig(env = process.env) {
  const required = (name) => {
    const value = String(env[name] ?? "").trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  const number = (name, fallback) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value <= 0 || value > 65_535) throw new Error(`${name} must be a valid port`);
    return value;
  };
  const positiveInteger = (name, fallback) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
    return value;
  };
  const address = required("OPENBUDDY_EMAIL_ADDRESS");
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(address)) throw new Error("OPENBUDDY_EMAIL_ADDRESS must be a valid email address");
  const password = String(env.OPENBUDDY_EMAIL_PASSWORD ?? env.OPENBUDDY_EMAIL_AUTH_CODE ?? "");
  if (!password) throw new Error("OPENBUDDY_EMAIL_PASSWORD or OPENBUDDY_EMAIL_AUTH_CODE is required");
  const smtpPort = number("OPENBUDDY_SMTP_PORT", 465);
  return {
    address,
    password,
    displayName: String(env.OPENBUDDY_EMAIL_DISPLAY_NAME ?? "OpenBuddy").trim() || "OpenBuddy",
    imap: {
      host: String(env.OPENBUDDY_IMAP_HOST ?? "imap.qq.com").trim(),
      port: number("OPENBUDDY_IMAP_PORT", 993),
      tls: String(env.OPENBUDDY_IMAP_TLS ?? "1") !== "0",
      rejectUnauthorized: String(env.OPENBUDDY_IMAP_REJECT_UNAUTHORIZED ?? "1") !== "0",
      timeoutMs: number("OPENBUDDY_EMAIL_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
      maxMessageBytes: positiveInteger("OPENBUDDY_EMAIL_MAX_MESSAGE_BYTES", 25 * 1024 * 1024),
    },
    smtp: {
      host: String(env.OPENBUDDY_SMTP_HOST ?? "smtp.qq.com").trim(),
      port: smtpPort,
      tls: String(env.OPENBUDDY_SMTP_TLS ?? (smtpPort === 587 ? "0" : "1")) !== "0",
      startTls: String(env.OPENBUDDY_SMTP_STARTTLS ?? (smtpPort === 587 ? "1" : "0")) !== "0",
      allowInsecure: String(env.OPENBUDDY_SMTP_ALLOW_INSECURE ?? "0") === "1",
      rejectUnauthorized: String(env.OPENBUDDY_SMTP_REJECT_UNAUTHORIZED ?? "1") !== "0",
      timeoutMs: number("OPENBUDDY_EMAIL_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
      maxMessageBytes: positiveInteger("OPENBUDDY_EMAIL_MAX_MESSAGE_BYTES", 25 * 1024 * 1024),
    },
    allowWrite: String(env.OPENBUDDY_EMAIL_ALLOW_WRITE ?? "0") === "1",
    allowSend: String(env.OPENBUDDY_EMAIL_ALLOW_SEND ?? "0") === "1",
    defaultMailbox: String(env.OPENBUDDY_EMAIL_DEFAULT_MAILBOX ?? "INBOX").trim() || "INBOX",
    archiveMailbox: String(env.OPENBUDDY_EMAIL_ARCHIVE_MAILBOX ?? "Archive").trim() || "Archive",
    sentMailbox: String(env.OPENBUDDY_EMAIL_SENT_MAILBOX ?? "Sent").trim() || "Sent",
    draftMailbox: String(env.OPENBUDDY_EMAIL_DRAFT_MAILBOX ?? "Drafts").trim() || "Drafts",
    trashMailbox: String(env.OPENBUDDY_EMAIL_TRASH_MAILBOX ?? "Trash").trim() || "Trash",
    spamMailbox: String(env.OPENBUDDY_EMAIL_SPAM_MAILBOX ?? "Junk").trim() || "Junk",
  };
}

function quote(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function timeoutPromise(ms, label) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms));
}

async function withTimeout(promise, ms, label) {
  return Promise.race([promise, timeoutPromise(ms, label)]);
}

function decodeQuotedPrintable(value) {
  return value.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function decodeTransfer(value, encoding) {
  const normalized = String(encoding ?? "").toLowerCase().trim();
  if (normalized === "base64") return Buffer.from(value.replace(/\s+/g, ""), "base64");
  if (normalized === "quoted-printable") return Buffer.from(decodeQuotedPrintable(value), "binary");
  return Buffer.from(value, "utf8");
}

export function decodeHeader(value) {
  return String(value ?? "").replace(/=\?([^?\s]+)\?([bqBQ])\?([^?]*)\?=/g, (_, charset, encoding, payload) => {
    try {
      if (encoding.toLowerCase() === "b") return Buffer.from(payload, "base64").toString(charset);
      return Buffer.from(payload.replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16))).replaceAll("_", " "), "binary").toString(charset);
    } catch {
      return payload;
    }
  });
}

export function parseHeaders(raw) {
  const headers = {};
  let current;
  for (const line of String(raw).split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && current) {
      headers[current] = `${headers[current]} ${line.trim()}`;
      continue;
    }
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    current = match[1].toLowerCase();
    headers[current] = match[2];
  }
  return headers;
}

function headerParameter(value, name) {
  const match = String(value ?? "").match(new RegExp(`${name}\\s*=\\s*(?:"([^"]+)"|([^;\\s]+))`, "i"));
  return decodeHeader(match?.[1] ?? match?.[2] ?? "");
}

function splitAddressList(value) {
  return String(value ?? "").split(/,\s*(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map((entry) => {
    const item = entry.trim();
    const angle = item.match(/^(.*?)\s*<([^>]+)>$/);
    const address = (angle?.[2] ?? item).trim();
    if (!address || !address.includes("@")) return null;
    return { address, ...(angle?.[1]?.trim() ? { name: decodeHeader(angle[1].trim().replace(/^"|"$/g, "")) } : {}) };
  }).filter(Boolean);
}

function parseMimePart(raw) {
  const separator = raw.search(/\r?\n\r?\n/);
  const headerText = separator < 0 ? raw : raw.slice(0, separator);
  const bodyText = separator < 0 ? "" : raw.slice(raw.indexOf("\n", separator) + 1).replace(/^\r?\n/, "");
  const headers = parseHeaders(headerText);
  const contentType = headers["content-type"] ?? "text/plain";
  const transfer = headers["content-transfer-encoding"] ?? "";
  const boundary = headerParameter(contentType, "boundary");
  if (boundary) {
    const marker = `--${boundary}`;
    const children = bodyText.split(marker).slice(1).filter((part) => !/^--\s*$/.test(part.trim())).map((part) => parseMimePart(part.replace(/^\r?\n/, "")));
    return children.reduce((result, child) => ({
      ...result,
      text: result.text ?? child.text,
      html: result.html ?? child.html,
      attachments: [...result.attachments, ...child.attachments],
    }), { text: undefined, html: undefined, attachments: [] });
  }
  const content = decodeTransfer(bodyText, transfer);
  const disposition = headers["content-disposition"] ?? "";
  const filename = headerParameter(disposition, "filename") || headerParameter(contentType, "name");
  if (filename || /^attachment/i.test(disposition)) {
    return { text: undefined, html: undefined, attachments: [{ name: filename || "attachment", mimeType: contentType.split(";", 1)[0].trim(), content }] };
  }
  const type = contentType.split(";", 1)[0].trim().toLowerCase();
  if (type === "text/html") return { text: undefined, html: content.toString("utf8"), attachments: [] };
  return { text: content.toString("utf8"), html: undefined, attachments: [] };
}

export function parseMessage(raw) {
  const source = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? "");
  const separator = source.search(/\r?\n\r?\n/);
  const headers = parseHeaders(separator < 0 ? source : source.slice(0, separator));
  const body = separator < 0 ? "" : source.slice(source.indexOf("\n", separator) + 1).replace(/^\r?\n/, "");
  const mime = parseMimePart(source);
  const messageId = (headers["message-id"] ?? "").trim().replace(/^<|>$/g, "");
  return {
    messageId: messageId || randomUUID(),
    subject: decodeHeader(headers.subject ?? "(无主题)"),
    from: splitAddressList(headers.from)[0] ?? { address: "unknown@invalid" },
    to: splitAddressList(headers.to),
    cc: splitAddressList(headers.cc),
    replyTo: splitAddressList(headers["reply-to"]),
    date: headers.date ? new Date(headers.date).toISOString() : new Date().toISOString(),
    text: mime.text,
    html: mime.html,
    attachments: mime.attachments,
    inReplyTo: headers["in-reply-to"],
    references: headers.references,
    rawBody: body,
  };
}

export function encodeMimeHeader(value) {
  const text = String(value ?? "");
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

export function decodeImapMailbox(value) {
  let output = "";
  let index = 0;
  const source = String(value ?? "");
  while (index < source.length) {
    if (source[index] !== "&") { output += source[index]; index += 1; continue; }
    const end = source.indexOf("-", index + 1);
    if (end < 0) { output += source.slice(index); break; }
    const segment = source.slice(index + 1, end);
    if (!segment) output += "&";
    else {
      const padding = (4 - (segment.length % 4)) % 4;
      const bytes = Buffer.from(segment.replaceAll(",", "/") + "=".repeat(padding), "base64");
      for (let offset = 0; offset + 1 < bytes.length; offset += 2) output += String.fromCharCode(bytes.readUInt16BE(offset));
    }
    index = end + 1;
  }
  return output;
}

export function encodeImapMailbox(value) {
  let output = "";
  let nonAscii = "";
  const flush = () => {
    if (!nonAscii) return;
    const bytes = Buffer.alloc(nonAscii.length * 2);
    for (let index = 0; index < nonAscii.length; index += 1) bytes.writeUInt16BE(nonAscii.charCodeAt(index), index * 2);
    output += `&${bytes.toString("base64").replace(/=+$/, "").replaceAll("/", ",")}-`;
    nonAscii = "";
  };
  for (const character of String(value ?? "")) {
    if (character === "&") { flush(); output += "&-"; }
    else if (character >= " " && character <= "~") { flush(); output += character; }
    else nonAscii += character;
  }
  flush();
  return output;
}

function normalizeRecipients(values) {
  return (Array.isArray(values) ? values : []).map((item) => typeof item === "string" ? item : item?.address).filter((item) => {
    if (typeof item !== "string" || !/^[^\s@<>]+@[^\s@<>]+$/.test(item)) throw new Error("invalid email recipient");
    return true;
  });
}

function safeHeaderAddress(value, name) {
  if (typeof value !== "string" || !/^[^\s@<>]+@[^\s@<>]+$/.test(value)) throw new Error(`invalid ${name} address`);
  return value;
}

function safeAttachmentName(value) {
  const name = String(value || "attachment").replace(/[\r\n\\/]/g, "_").replaceAll('"', "").trim();
  return name || "attachment";
}

function safeMimeType(value) {
  const mimeType = String(value || "application/octet-stream").trim();
  return /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(mimeType) ? mimeType : "application/octet-stream";
}

export function buildMimeMessage(input) {
  const to = normalizeRecipients(input.to);
  const cc = normalizeRecipients(input.cc);
  const bcc = normalizeRecipients(input.bcc);
  const from = safeHeaderAddress(typeof input.from === "string" ? input.from : input.from?.address, "sender");
  if (to.length + cc.length + bcc.length === 0) throw new Error("from and at least one recipient are required");
  const replyTo = normalizeRecipients(input.replyTo);
  const draftId = typeof input.draftId === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(input.draftId) ? input.draftId : undefined;
  const headers = [`From: ${from}`, `To: ${to.join(", ")}`, ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []), ...(replyTo.length ? [`Reply-To: ${replyTo.join(", ")}`] : []), `Subject: ${encodeMimeHeader(input.subject ?? "")}`, "MIME-Version: 1.0", `Date: ${new Date().toUTCString()}`, `Message-ID: <${randomUUID()}@openbuddy.local>`, ...(draftId ? [`X-OpenBuddy-Draft-ID: ${draftId}`] : [])];
  const text = String(input.body ?? "");
  const html = typeof input.bodyHtml === "string" && input.bodyHtml ? input.bodyHtml : undefined;
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  const parts = [];
  if (text) parts.push(`Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${text}`);
  if (html) parts.push(`Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${html}`);
  for (const attachment of attachments) {
    const content = Buffer.isBuffer(attachment.content) ? attachment.content : Buffer.from(String(attachment.content ?? ""));
    const name = safeAttachmentName(attachment.name);
    const mimeType = safeMimeType(attachment.mimeType);
    parts.push(`Content-Type: ${mimeType}; name="${name}"\r\nContent-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${content.toString("base64").replace(/(.{76})/g, "$1\r\n")}`);
  }
  if (parts.length <= 1) return `${headers.join("\r\n")}\r\n\r\n${parts[0] ?? ""}\r\n`;
  const boundary = `=_OpenBuddy_${randomUUID()}`;
  return `${headers.join("\r\n")}\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${parts.map((part) => `--${boundary}\r\n${part}`).join("\r\n")}\r\n--${boundary}--\r\n`;
}

export class LineSocket {
  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.lineWaiters = [];
    this.closed = false;
    this.onData = (chunk) => { this.buffer = Buffer.concat([this.buffer, chunk]); this.flush(); };
    this.onClose = () => {
      this.closed = true;
      const error = new Error("mail server connection closed");
      for (const waiter of this.waiters.splice(0)) waiter.reject(error);
      for (const waiter of this.lineWaiters.splice(0)) waiter.reject(error);
    };
    this.onError = (error) => {
      for (const waiter of this.waiters.splice(0)) waiter.reject(error);
      for (const waiter of this.lineWaiters.splice(0)) waiter.reject(error);
    };
    socket.on("data", this.onData);
    socket.on("close", this.onClose);
    socket.on("error", this.onError);
  }
  flush() {
    for (const waiter of [...this.waiters]) {
      if (this.buffer.length < waiter.size) continue;
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      const value = this.buffer.subarray(0, waiter.size);
      this.buffer = this.buffer.subarray(waiter.size);
      waiter.resolve(value);
    }
    while (this.lineWaiters.length > 0) {
      const index = this.buffer.indexOf("\r\n");
      if (index < 0) break;
      const waiter = this.lineWaiters.shift();
      const line = this.buffer.subarray(0, index).toString("utf8");
      this.buffer = this.buffer.subarray(index + 2);
      waiter.resolve(line);
    }
  }
  readBytes(size) { return withTimeout(new Promise((resolve, reject) => { this.waiters.push({ size, resolve, reject }); this.flush(); }), this.timeoutMs, "mail server read"); }
  readLine() {
    const index = this.buffer.indexOf("\r\n");
    if (index >= 0) {
      const line = this.buffer.subarray(0, index).toString("utf8");
      this.buffer = this.buffer.subarray(index + 2);
      return Promise.resolve(line);
    }
    return withTimeout(new Promise((resolve, reject) => { this.lineWaiters.push({ resolve, reject }); this.flush(); }), this.timeoutMs, "mail server line read");
  }
  write(value) { return new Promise((resolve, reject) => this.socket.write(value, (error) => error ? reject(error) : resolve())); }
  end() { this.socket.end(); }
  dispose() {
    this.socket.removeListener("data", this.onData);
    this.socket.removeListener("close", this.onClose);
    this.socket.removeListener("error", this.onError);
    this.closed = true;
  }
}

function connectSocket(options) {
  return new Promise((resolve, reject) => {
    const socket = options.tls ? tls.connect(options) : net.connect(options);
    const onError = (error) => { socket.destroy(); reject(error); };
    socket.once("error", onError);
    socket.once("connect", () => { socket.removeListener("error", onError); resolve(socket); });
    socket.setTimeout(options.timeoutMs, () => socket.destroy(new Error("mail server socket timeout")));
  });
}

function upgradeSocketToTls(socket, options) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({ socket, host: options.host, servername: options.host, rejectUnauthorized: options.rejectUnauthorized });
    const onError = (error) => { secureSocket.destroy(); reject(error); };
    secureSocket.once("error", onError);
    secureSocket.once("secureConnect", () => { secureSocket.removeListener("error", onError); resolve(secureSocket); });
    secureSocket.setTimeout(options.timeoutMs, () => secureSocket.destroy(new Error("mail server socket timeout")));
  });
}

function parseTagged(line) {
  const match = line.match(/^(\S+)\s+(OK|NO|BAD)\b\s*(.*)$/i);
  return match ? { tag: match[1], status: match[2].toUpperCase(), text: match[3] } : undefined;
}

export class ImapClient {
  constructor(config) { this.config = config; this.tag = 0; this.socket = undefined; this.io = undefined; this.mailbox = undefined; this.uidValidity = undefined; }
  async connect() {
    const socket = await connectSocket({ host: this.config.host, port: this.config.port, servername: this.config.host, rejectUnauthorized: this.config.rejectUnauthorized, tls: this.config.tls, timeoutMs: this.config.timeoutMs });
    this.socket = socket; this.io = new LineSocket(socket, this.config.timeoutMs);
    const greeting = await this.io.readLine();
    if (!/^\* OK/i.test(greeting)) throw new Error(`IMAP greeting rejected: ${greeting.slice(0, 120)}`);
    await this.command(`LOGIN ${quote(this.config.address)} ${quote(this.config.password)}`, false);
  }
  async command(command, includeLiterals = true) {
    const tag = `a${String(++this.tag).padStart(4, "0")}`;
    await this.io.write(`${tag} ${command}\r\n`);
    const lines = [];
    while (true) {
      const line = await this.io.readLine();
      lines.push(line);
      const literal = line.match(/\{(\d+)\}\s*$/);
      if (includeLiterals && literal) {
        const size = Number(literal[1]);
        if (size > this.config.maxMessageBytes) throw new Error(`IMAP literal exceeds configured limit of ${this.config.maxMessageBytes} bytes`);
        lines.push(await this.io.readBytes(size));
      }
      const result = parseTagged(line);
      if (result?.tag === tag) {
        if (result.status !== "OK") throw new Error(`IMAP ${result.status}: ${result.text.slice(0, 240)}`);
        return lines;
      }
    }
  }
  async select(mailbox = "INBOX") {
    const lines = await this.command(`SELECT ${quote(encodeImapMailbox(mailbox))}`);
    const exists = Number(lines.find((line) => /^\* \d+ EXISTS/i.test(line))?.match(/^\* (\d+)/)?.[1] ?? 0);
    const uidValidity = lines.find((line) => /UIDVALIDITY/i.test(line))?.match(/UIDVALIDITY\s+(\d+)/i)?.[1];
    this.mailbox = mailbox; this.uidValidity = uidValidity ?? this.uidValidity;
    return { mailbox, exists, uidValidity: this.uidValidity };
  }
  async list() {
    const lines = await this.command("LIST \"\" \"*\"");
    return lines.filter((line) => /^\* LIST /i.test(line)).map((line) => {
      const match = line.match(/^\* LIST \([^)]*\) \"[^\"]*\" (.+)$/i);
      return match ? decodeImapString(match[1]) : undefined;
    }).filter(Boolean);
  }
  async search(criteria = "ALL") {
    const lines = await this.command(`UID SEARCH ${criteria}`);
    const line = lines.find((item) => /^\* SEARCH(?: |$)/i.test(item));
    return line ? line.replace(/^\* SEARCH\s*/i, "").trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger) : [];
  }
  async fetch(uid, section = "BODY.PEEK[]") {
    const lines = await this.command(`UID FETCH ${Number(uid)} (UID FLAGS ${section})`);
    const text = lines.find((line) => typeof line === "string" && /^\* \d+ FETCH/i.test(line));
    const literalIndex = lines.findIndex((line) => typeof line === "string" && /^\* \d+ FETCH/i.test(line));
    const literal = literalIndex >= 0 && Buffer.isBuffer(lines[literalIndex + 1]) ? lines[literalIndex + 1] : Buffer.alloc(0);
    const flags = text?.match(/FLAGS \(([^)]*)\)/i)?.[1]?.split(/\s+/).filter(Boolean) ?? [];
    return { uid: Number(uid), flags, raw: literal };
  }
  async fetchMany(uids, section = "BODY.PEEK[]") {
    const results = [];
    for (const uid of uids) results.push(await this.fetch(uid, section));
    return results;
  }
  async store(uid, operation) { return this.command(`UID STORE ${Number(uid)} ${operation}`, false); }
  async expunge(uid) { return this.command(`UID EXPUNGE ${Number(uid)}`, false); }
  async copy(uid, mailbox) { return this.command(`UID COPY ${Number(uid)} ${quote(encodeImapMailbox(mailbox))}`, false); }
  async append(mailbox, raw, flags = []) {
    if (Buffer.byteLength(raw) > this.config.maxMessageBytes) throw new Error(`IMAP APPEND exceeds configured limit of ${this.config.maxMessageBytes} bytes`);
    const tag = `a${String(++this.tag).padStart(4, "0")}`;
    const flagText = flags.length ? ` (${flags.join(" ")})` : "";
    await this.io.write(`${tag} APPEND ${quote(encodeImapMailbox(mailbox))}${flagText} {${Buffer.byteLength(raw)}}\r\n`);
    const continuation = await this.io.readLine();
    if (!continuation.startsWith("+")) throw new Error(`IMAP APPEND rejected: ${continuation.slice(0, 240)}`);
    await this.io.write(raw);
    await this.io.write("\r\n");
    while (true) { const line = await this.io.readLine(); const result = parseTagged(line); if (result?.tag === tag) { if (result.status !== "OK") throw new Error(`IMAP ${result.status}: ${result.text.slice(0, 240)}`); return line; } }
  }
  async close() { try { if (this.io) await this.io.write(`a${String(++this.tag).padStart(4, "0")} LOGOUT\r\n`); } catch {} this.io?.end(); }
}

function decodeImapString(value) { return decodeImapMailbox(String(value).replace(/^"|"$/g, "").replaceAll('\\"', '"').replaceAll("\\\\", "\\")); }

export class SmtpClient {
  constructor(config) { this.config = config; this.io = undefined; }
  async connect() {
    if (!this.config.tls && !this.config.startTls && !this.config.allowInsecure) throw new Error("SMTP plaintext AUTH is disabled; enable STARTTLS or explicit insecure mode");
    const socket = await connectSocket({ host: this.config.host, port: this.config.port, servername: this.config.host, rejectUnauthorized: this.config.rejectUnauthorized, tls: this.config.tls, timeoutMs: this.config.timeoutMs });
    this.io = new LineSocket(socket, this.config.timeoutMs);
    await this.expect(220);
    await this.command("EHLO openbuddy.local", 250);
    if (!this.config.tls && this.config.startTls) {
      await this.command("STARTTLS", 220);
      const plainIo = this.io;
      plainIo.dispose();
      const secureSocket = await upgradeSocketToTls(socket, { host: this.config.host, rejectUnauthorized: this.config.rejectUnauthorized, timeoutMs: this.config.timeoutMs });
      this.io = new LineSocket(secureSocket, this.config.timeoutMs);
      await this.command("EHLO openbuddy.local", 250);
    }
    await this.command("AUTH LOGIN", 334);
    await this.command(Buffer.from(this.config.address).toString("base64"), 334);
    await this.command(Buffer.from(this.config.password).toString("base64"), 235);
  }
  async command(value, expected) { await this.io.write(`${value}\r\n`); const lines = []; while (true) { const line = await this.io.readLine(); lines.push(line); if (!/^\d{3}-/.test(line)) { const code = Number(line.slice(0, 3)); if (code !== expected) throw new Error(`SMTP ${code}: ${line.slice(4, 240)}`); return lines; } } }
  async expect(expected) { const line = await this.io.readLine(); const code = Number(line.slice(0, 3)); if (code !== expected) throw new Error(`SMTP ${code}: ${line.slice(4, 240)}`); return line; }
  async send(raw, recipients, from) {
    if (Buffer.byteLength(raw) > this.config.maxMessageBytes) throw new Error(`SMTP message exceeds configured limit of ${this.config.maxMessageBytes} bytes`);
    await this.command(`MAIL FROM:<${from}>`, 250);
    for (const recipient of recipients) await this.command(`RCPT TO:<${recipient}>`, 250);
    await this.command("DATA", 354);
    const body = String(raw).replace(/^\./gm, "..");
    await this.io.write(`${body}\r\n.\r\n`);
    await this.expect(250);
    await this.command("QUIT", 221);
  }
  close() { this.io?.end(); }
}

export function parseMailboxUid(id, fallbackMailbox = "INBOX") {
  const match = String(id ?? "").match(/^(.*):(\d+)$/);
  const result = match ? { mailbox: match[1], uid: Number(match[2]) } : { mailbox: fallbackMailbox, uid: Number(id) };
  if (!result.mailbox || !Number.isSafeInteger(result.uid) || result.uid <= 0) throw new Error("invalid mailbox message id");
  return result;
}

export function threadId(mailbox, uid) { return `${mailbox}:${Number(uid)}`; }
