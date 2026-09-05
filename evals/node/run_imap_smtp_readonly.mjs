import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const address = String(process.env.OPENBUDDY_EMAIL_ADDRESS ?? "").trim();
const password = String(process.env.OPENBUDDY_EMAIL_PASSWORD ?? process.env.OPENBUDDY_EMAIL_AUTH_CODE ?? "");
const serverPath = String(process.env.OPENBUDDY_IMAP_SMTP_MCP_SERVER ?? "scripts/email/imap-smtp-mcp-server.mjs").trim();
if (!address || !password) {
  console.error("OPENBUDDY_EMAIL_ADDRESS and OPENBUDDY_EMAIL_PASSWORD/AUTH_CODE are required");
  process.exit(2);
}

const digest = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], cwd: process.cwd(), env: { ...process.env } });
const client = new Client({ name: "openbuddy-imap-smtp-readonly-eval", version: "1.0.0" }, { capabilities: {} });
const call = async (name, args = {}) => {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) throw new Error(String(response.content?.[0]?.text ?? "MCP tool failed").slice(0, 300));
  return JSON.parse(response.content?.find((item) => item.type === "text")?.text ?? "{}");
};

try {
  await client.connect(transport);
  const toolList = await client.listTools();
  const accounts = await call("list_accounts");
  const account = accounts.find((item) => item.address === address) ?? accounts[0];
  if (!account?.id) throw new Error("provider returned no account");
  const mailboxes = await call("list_mailboxes");
  const firstPage = await call("list_emails", { accountId: account.id, mailbox: process.env.OPENBUDDY_EMAIL_DEFAULT_MAILBOX ?? "INBOX", limit: 10 });
  const secondPage = firstPage.nextCursor ? await call("list_emails", { accountId: account.id, mailbox: process.env.OPENBUDDY_EMAIL_DEFAULT_MAILBOX ?? "INBOX", limit: 10, cursor: firstPage.nextCursor }) : { items: [] };
  const first = firstPage.items?.[0];
  const thread = first ? await call("get_email", { accountId: account.id, threadId: first.id }) : undefined;
  const ids = [...(firstPage.items ?? []), ...(secondPage.items ?? [])].map((item) => item.id);
  const report = {
    schema: "openbuddy.imap-smtp-readonly.v1",
    evidenceLevel: "real-external",
    provider: "imap-smtp",
    accountDomain: String(account.address).split("@")[1] ?? "unknown",
    toolCount: toolList.tools.length,
    mailboxCount: mailboxes.length,
    mailboxNames: mailboxes.map((item) => item.name).slice(0, 20),
    firstPageItems: firstPage.items?.length ?? 0,
    secondPageItems: secondPage.items?.length ?? 0,
    duplicateCount: ids.length - new Set(ids).size,
    threadMessages: thread?.messages?.length ?? 0,
    threadDigest: first ? digest(first.id) : null,
    capabilities: account.capabilities,
    writeDisabledByDefault: account.capabilities?.write === false,
    sendDisabledByDefault: String(process.env.OPENBUDDY_EMAIL_ALLOW_SEND ?? "0") !== "1",
  };
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ schema: "openbuddy.imap-smtp-readonly.v1", evidenceLevel: "real-external", status: "failed", error: String(error?.message ?? error).slice(0, 300) }, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
