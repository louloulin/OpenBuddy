// @vitest-environment node
// pii W2.4: 测试连接 opens a real connection, lists the tools and reports the duration; a broken
// server reports the error instead of throwing, and neither path needs an open task.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettings } from "../src/settings/settings.js";
import { McpService } from "../src/mcp/mcp.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s.split("").reverse().join("")),
  decryptString: (b: Buffer) => b.toString().split("").reverse().join(""),
};

/** A minimal stdio MCP server: initialize + tools/list, enough for a real handshake. */
const SERVER = `
import { createInterface } from "node:readline";
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === "initialize")
    send({ jsonrpc: "2.0", id: message.id, result: {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "fixture-mcp", version: "1.2.3" },
    } });
  else if (message.method === "tools/list")
    send({ jsonrpc: "2.0", id: message.id, result: { tools: [
      { name: "echo", description: "Echo back", inputSchema: { type: "object", properties: {} } },
      { name: "add", inputSchema: { type: "object", properties: {} } },
    ] } });
  else if (message.id !== undefined)
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method not found" } });
});
`;

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "openbuddy-mcptest-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const settings = createSettings(root, safe);
  const mcp = new McpService(settings, async () => {}, () => {});
  const script = join(root, "server.mjs");
  await writeFile(script, SERVER);
  mcp.upsert({ name: "fixture", transport: "stdio", target: process.execPath, args: [script] });
  return { root, mcp };
}

describe("MCP 测试连接 (pii W2.4)", () => {
  it("connects to a real stdio server, lists its tools and measures the time", async () => {
    const { mcp } = await setup();
    const result = await mcp.testConnect("fixture");
    expect(result).toMatchObject({
      name: "fixture",
      ok: true,
      transport: "stdio",
      serverInfo: { name: "fixture-mcp", version: "1.2.3" },
    });
    expect(result.ms).toBeGreaterThanOrEqual(0);
    expect(result.tools?.map((tool) => tool.name)).toEqual(["echo", "add"]);
    expect(result.tools?.[0].description).toBe("Echo back");
    // The server config is untouched: a test never rewrites mcp.json.
    expect(mcp.list()).toContainEqual(expect.objectContaining({ name: "fixture", enabled: true }));
  });

  it("reports a broken server as an error result instead of throwing", async () => {
    const { root, mcp } = await setup();
    mcp.upsert({ name: "broken", transport: "stdio", target: process.execPath, args: [join(root, "missing.mjs")] });
    const result = await mcp.testConnect("broken", 4000);
    expect(result.ok).toBe(false);
    expect(result.ms).toBeGreaterThanOrEqual(0);
    expect(String(result.error).length).toBeGreaterThan(0);
  });

  it("marks a URL server without a token as needing authorization", async () => {
    const { mcp } = await setup();
    mcp.upsert({ name: "remote", transport: "streamable_http", target: "https://mcp.example.test/mcp" });
    expect(mcp.list()).toContainEqual(expect.objectContaining({ name: "remote", needsAuth: true }));
  });
});

// 20261116-pii W2.4 P2 / S11: 延迟暴露保留用户配置，并可整体切换。
describe("MCP 延迟暴露 (pii W2.4 P2)", () => {
  it("defaults to direct and flips every server together", async () => {
    const { mcp } = await setup();
    expect(mcp.usesDeferred()).toBe(false);
    expect(mcp.setDeferred(true)).toBe(true);
    expect(mcp.usesDeferred()).toBe(true);
    const saved = JSON.parse(mcp.read().content) as { mcpServers: Record<string, { exposure: string }> };
    expect(saved.mcpServers.fixture.exposure).toBe("deferred");
    expect(mcp.setDeferred(false)).toBe(false);
    expect(mcp.usesDeferred()).toBe(false);
  });

  it("keeps an explicit per-server exposure from the JSON editor", async () => {
    const { mcp } = await setup();
    const config = JSON.parse(mcp.read().content) as { mcpServers: Record<string, unknown> };
    config.mcpServers.fixture = { ...config.mcpServers.fixture, exposure: "deferred" };
    mcp.save(JSON.stringify(config));
    expect(mcp.usesDeferred()).toBe(true);
    expect(() => {
      config.mcpServers.fixture = { ...config.mcpServers.fixture, exposure: "sideways" };
      mcp.save(JSON.stringify(config));
    }).toThrow(/exposure/);
  });
});
