import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as connectors from "./connectors";

const originalConnectorDir = process.env.OPENBUDDY_CONNECTORS_DIR;
const originalPiRoot = process.env.PI_CODING_AGENT_DIR;
const originalScope = process.env.OPENBUDDY_WORKBENCH_SCOPE;

afterEach(() => {
  if (originalConnectorDir === undefined) delete process.env.OPENBUDDY_CONNECTORS_DIR;
  else process.env.OPENBUDDY_CONNECTORS_DIR = originalConnectorDir;
  if (originalPiRoot === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalPiRoot;
  if (originalScope === undefined) delete process.env.OPENBUDDY_WORKBENCH_SCOPE;
  else process.env.OPENBUDDY_WORKBENCH_SCOPE = originalScope;
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openbuddy-connectors-"));
  await mkdir(join(root, ".codebuddy-connector"), { recursive: true });
  await mkdir(join(root, "icons"), { recursive: true });
  await mkdir(join(root, "connectors", "demo", "skills"), { recursive: true });
  await writeFile(join(root, ".codebuddy-connector", "connectors.json"), JSON.stringify({ connectors: [{ id: "demo", source: "demo", name: { zh: "演示" }, description_zh: "演示连接器", type: "cli", auth_mode: "token", examples_zh: ["测试"], } ] }));
  await writeFile(join(root, "icons", "demo.svg"), "<svg></svg>");
  await writeFile(join(root, "connectors", "demo", "mcp.json"), '{"mcpServers":{}}');
  await writeFile(join(root, "connectors", "demo", "token-schema.json"), JSON.stringify({ title: "Token", fields: [{ key: "DEMO_TOKEN", label: { zh: "令牌" }, required: true }] }));
  const authMarker = join(root, "connectors", "demo", ".authed");
  await writeFile(join(root, "connectors", "demo", "cli.json"), JSON.stringify({ versionCheck: { command: { darwin: "printf '1.2.3'" }, minVersion: "1.0.0" }, status: { darwin: `test -f '${authMarker}' && printf '{\"logged\":\"yes\"}'` }, statusMatchJson: { logged: "yes" }, auth: { darwin: `touch '${authMarker}' && printf 'login https://auth.example.test/device'` }, authUrlDomain: "auth.example.test" }));
  return root;
}

describe("Electron connector adapter", () => {
  it("loads manifest metadata, token schema, icon, and MCP config", async () => {
    const root = await fixture();
    const catalog = await connectors.loadCatalog(root, root);
    expect(catalog.categories.map((item) => item.id)).toEqual(["mcp", "cli", "skill", "auth", "other"]);
    expect(catalog.connectors[0]).toMatchObject({ id: "demo", kind: "cli", cat: "auth", tokenSchema: { fields: [{ key: "DEMO_TOKEN" }] } });
    await expect(connectors.readMcpConfig(root, "demo")).resolves.toContain("mcpServers");
    await expect(connectors.readImageData(catalog.connectors[0].iconLocal!)).resolves.toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("runs cli.json status and emits auth URL/log/done events", async () => {
    const root = await fixture();
    await expect(connectors.cliStatus(root, "demo")).resolves.toMatchObject({ hasSpec: true, installed: true, authed: false, cliVersion: "1.2.3" });
    const events: Array<{ channel: string; payload: unknown }> = [];
    await expect(connectors.cliAuth(root, "demo", (channel, payload) => events.push({ channel, payload }))).resolves.toMatchObject({ ok: true, authed: true });
    expect(events.some((event) => event.channel === "connector://cli-auth-url")).toBe(true);
    expect(events.some((event) => event.channel === "connector://cli-auth-done")).toBe(true);
  });

  it("rejects connector path traversal", async () => {
    const root = await fixture();
    await expect(connectors.readMcpConfig(root, "../outside")).rejects.toThrow("invalid connector path");
    await expect(connectors.cliStatus(root, "../outside")).rejects.toThrow("invalid connector path");
    await expect(readFile(join(root, "connectors", "demo", "mcp.json"), "utf8")).resolves.toContain("mcpServers");
  });

  it("uses the scoped connector marketplace for enterprise sessions", async () => {
    const scopedRoot = await fixture();
    const marketplaceRoot = join(scopedRoot, "connectors-marketplace");
    await mkdir(join(marketplaceRoot, ".codebuddy-connector"), { recursive: true });
    await writeFile(join(marketplaceRoot, ".codebuddy-connector", "connectors.json"), JSON.stringify({ connectors: [] }));
    process.env.PI_CODING_AGENT_DIR = scopedRoot;
    process.env.OPENBUDDY_WORKBENCH_SCOPE = "tenant-a-subject-u1";
    delete process.env.OPENBUDDY_CONNECTORS_DIR;
    await expect(connectors.defaultRoot(process.cwd())).resolves.toBe(join(scopedRoot, "connectors-marketplace"));
  });
});
