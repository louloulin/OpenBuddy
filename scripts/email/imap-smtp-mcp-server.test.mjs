import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import net from "node:net";
import { describe, expect, it } from "vitest";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function startImapFixture(mailboxes) {
  const state = { appended: [], removed: [], searches: [], selected: [], nextUid: 10 };
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let pendingAppend;
    socket.write("* OK fake MCP IMAP ready\r\n");
    const tagged = (tag, text = "OK completed") => socket.write(`${tag} ${text}\r\n`);
    const process = () => {
      while (true) {
        if (pendingAppend) {
          if (buffer.length < pendingAppend.size + 2) return;
          const raw = buffer.subarray(0, pendingAppend.size).toString("utf8");
          buffer = buffer.subarray(pendingAppend.size + 2);
          const uid = state.nextUid++;
          state.appended.push({ uid, raw });
          tagged(pendingAppend.tag);
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
        if (/^LOGIN\b/i.test(command)) tagged(tag);
        else if (/^LIST\b/i.test(command)) {
          for (const mailbox of mailboxes) socket.write(`* LIST (\\HasNoChildren) "/" "${mailbox}"\r\n`);
          tagged(tag);
        } else if (/^SELECT\b/i.test(command)) {
          state.selected.push(command.replace(/^SELECT\s+/i, "").replace(/^"|"$/g, ""));
          socket.write("* 0 EXISTS\r\n* OK [UIDVALIDITY 42] fake\r\n");
          tagged(tag);
        } else if (/^UID SEARCH\b/i.test(command)) {
          state.searches.push(command.replace(/^UID SEARCH\s+/i, ""));
          const draftId = command.match(/X-OpenBuddy-Draft-ID\s+"?([^"\s]+)"?/i)?.[1];
          const matching = draftId
            ? state.appended.filter((item) => !state.removed.includes(item.uid) && item.raw.includes(draftId)).map((item) => item.uid)
            : [];
          socket.write(`* SEARCH ${matching.join(" ")}\r\n`);
          tagged(tag);
        } else if (/^UID STORE\b/i.test(command)) tagged(tag);
        else if (/^UID EXPUNGE\s+(\d+)/i.test(command)) {
          state.removed.push(Number(command.match(/^UID EXPUNGE\s+(\d+)/i)[1]));
          tagged(tag);
        } else if (/^APPEND\b/i.test(command)) {
          const literal = command.match(/\{(\d+)\}$/);
          if (!literal) tagged(tag, "BAD missing literal");
          else {
            pendingAppend = { tag, size: Number(literal[1]) };
            socket.write("+ Ready for literal\r\n");
          }
        } else if (/^LOGOUT\b/i.test(command)) {
          socket.write("* BYE fake\r\n");
          tagged(tag, "OK logout");
          socket.end();
        } else tagged(tag);
      }
    };
    socket.on("data", (chunk) => { buffer = Buffer.concat([buffer, chunk]); process(); });
  });
  return { server, state };
}

async function callJson(client, name, argumentsValue) {
  const response = await client.callTool({ name, arguments: argumentsValue });
  const text = response.content?.find((item) => item.type === "text")?.text ?? "{}";
  if (response.isError) throw new Error(text);
  return JSON.parse(text);
}

describe("OpenBuddy IMAP/SMTP MCP server", () => {
  it("reports mailbox-backed management capabilities and updates a remote draft idempotently", async () => {
    const fixture = startImapFixture(["INBOX", "Drafts", "Deleted Messages", "Junk"]);
    const port = await listen(fixture.server);
    const client = new Client({ name: "imap-mcp-test", version: "1.0.0" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["scripts/email/imap-smtp-mcp-server.mjs"],
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENBUDDY_EMAIL_ADDRESS: "test@example.com",
        OPENBUDDY_EMAIL_AUTH_CODE: "fixture-secret",
        OPENBUDDY_EMAIL_ALLOW_WRITE: "1",
        OPENBUDDY_EMAIL_ALLOW_SEND: "0",
        OPENBUDDY_IMAP_HOST: "127.0.0.1",
        OPENBUDDY_IMAP_PORT: String(port),
        OPENBUDDY_IMAP_TLS: "0",
        OPENBUDDY_IMAP_REJECT_UNAUTHORIZED: "0",
        OPENBUDDY_EMAIL_TIMEOUT_MS: "1000",
        OPENBUDDY_EMAIL_ARCHIVE_MAILBOX: "Archive",
        OPENBUDDY_EMAIL_TRASH_MAILBOX: "Trash",
        OPENBUDDY_EMAIL_SPAM_MAILBOX: "Junk",
      },
    });
    try {
      await client.connect(transport);
      const accounts = await callJson(client, "list_accounts", {});
      expect(accounts[0]).toMatchObject({
        capabilities: {
          write: true,
          management: true,
          managementOperations: ["mark-read", "mark-unread", "star", "restore", "trash", "spam"],
        },
      });
      const draftInput = {
        accountId: "test@example.com",
        draftId: "draft:fixture1234",
        to: [{ address: "recipient@example.com" }],
        subject: "First draft",
        body: "first body",
      };
      await callJson(client, "create_draft", draftInput);
      await callJson(client, "create_draft", { ...draftInput, subject: "Updated draft", body: "updated body" });
      expect(fixture.state.appended).toHaveLength(2);
      expect(fixture.state.removed).toEqual([10]);
      expect(fixture.state.appended[1].raw).toContain("Subject: Updated draft");
      expect(fixture.state.appended[1].raw).toContain("X-OpenBuddy-Draft-ID: draft:fixture1234");
    } finally {
      await client.close().catch(() => {});
      await closeServer(fixture.server);
    }
  });

  it("maps structured search filters and logical folders to IMAP commands", async () => {
    const fixture = startImapFixture(["INBOX", "Sent", "Drafts", "Archive", "Junk"]);
    const port = await listen(fixture.server);
    const client = new Client({ name: "imap-search-test", version: "1.0.0" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["scripts/email/imap-smtp-mcp-server.mjs"],
      cwd: process.cwd(),
      env: { ...process.env, OPENBUDDY_EMAIL_ADDRESS: "test@example.com", OPENBUDDY_EMAIL_AUTH_CODE: "fixture-secret", OPENBUDDY_IMAP_HOST: "127.0.0.1", OPENBUDDY_IMAP_PORT: String(port), OPENBUDDY_IMAP_TLS: "0", OPENBUDDY_EMAIL_TIMEOUT_MS: "1000" },
    });
    try {
      await client.connect(transport);
      await callJson(client, "list_emails", { accountId: "test@example.com", folder: "archive", query: "报价", from: "customer@example.com", to: "test@example.com", unread: true, hasAttachment: true, since: "2026-08-01T00:00:00.000Z", until: "2026-08-30T00:00:00.000Z", limit: 10 });
      expect(fixture.state.selected.at(-1)).toBe("Archive");
      expect(fixture.state.searches.at(-1)).toContain("TEXT \"报价\"");
      expect(fixture.state.searches.at(-1)).toContain("FROM \"customer@example.com\"");
      expect(fixture.state.searches.at(-1)).toContain("TO \"test@example.com\"");
      expect(fixture.state.searches.at(-1)).toContain("UNSEEN");
      expect(fixture.state.searches.at(-1)).toContain("HEADER Content-Type \"multipart\"");
      expect(fixture.state.searches.at(-1)).toContain("SINCE \"01-Aug-2026\"");
      expect(fixture.state.searches.at(-1)).toContain("BEFORE \"30-Aug-2026\"");
    } finally {
      await client.close().catch(() => {});
      await closeServer(fixture.server);
    }
  });
});
