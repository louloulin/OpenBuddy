// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEngineHandlers } from "@openbuddy/host/handlers";
import { createSettings } from "../src/settings/settings.js";
import { Permissions } from "@openbuddy/engine/permissions/permissions";
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s.split("").reverse().join("")),
  decryptString: (b: Buffer) => b.toString().split("").reverse().join(""),
};
async function setup(encryption = true) {
  const root = await mkdtemp(join(tmpdir(), "openbuddy-services-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const app = await createEngineHandlers({
    userDataDir: root,
    safeStorage: { ...safe, isEncryptionAvailable: () => encryption },
    emit: () => {},
    shell: {
      openPath: async () => "",
      openExternal: async () => {},
      showItemInFolder: () => {},
    },
  });
  cleanups.push(app.dispose);
  return {
    root,
    call: async (name: string, p: Record<string, unknown> = {}) =>
      app.handlers[name](p),
  };
}
it("rejects plaintext fallback storage without persisting credentials", async () => {
  const f = await setup(false);
  await expect(
    f.call("providers_save_provider", {
      provider: {
        id: "openai",
        providerKind: "openai",
        apiKey: "must-stay-secret",
      },
    }),
  ).rejects.toThrow("安全密钥存储不可用");
  expect(await f.call("providers_list")).toEqual({ providers: [], models: [] });
  await expect(
    readFile(join(f.root, "pi", "credentials.enc.json")),
  ).rejects.toThrow();
});
it("rejects parent traversal and symlink escapes before creating outside directories", async () => {
  const f = await setup();
  const workspace = join(f.root, "workspace");
  await mkdir(workspace);
  await f.call("agent_init", { cwd: workspace });
  await expect(
    f.call("write_text_file", {
      workspaceRoot: "/",
      path: join(f.root, "injected.txt"),
      content: "blocked",
    }),
  ).rejects.toThrow("工作区不匹配");
  await expect(
    f.call("write_text_file", {
      workspaceRoot: workspace,
      path: "../outside/child.txt",
      content: "blocked",
    }),
  ).rejects.toThrow();
  await expect(
    readFile(join(f.root, "outside", "child.txt")),
  ).rejects.toThrow();
  await symlink(f.root, join(workspace, "escape"), "dir");
  await expect(
    f.call("write_text_file", {
      workspaceRoot: workspace,
      path: "escape/outside.txt",
      content: "blocked",
    }),
  ).rejects.toThrow();
  const path = await f.call("write_text_file", {
    workspaceRoot: workspace,
    path: "safe/nested.txt",
    content: "safe",
  });
  expect(await readFile(String(path), "utf8")).toBe("safe");
  const alias = join(f.root, "alias");
  await symlink(workspace, alias, "dir");
  await f.call("agent_init", { cwd: alias });
  const aliased = await f.call("write_text_file", {
    workspaceRoot: alias,
    path: "safe/alias.txt",
    content: "alias-safe",
  });
  expect(await readFile(String(aliased), "utf8")).toBe("alias-safe");
});
it("bounds binary reads and preserves array return contracts", async () => {
  const f = await setup();
  await f.call("agent_init", { cwd: f.root });
  await f.call("write_text_file", {
    workspaceRoot: f.root,
    path: "hello.txt",
    content: "abcdef",
  });
  await expect(
    f.call("read_file_base64", {
      path: join(f.root, "hello.txt"),
      maxBytes: 2,
    }),
  ).rejects.toThrow("超过");
  expect(
    await f.call("read_file_base64", {
      path: join(f.root, "hello.txt"),
      maxBytes: 6,
    }),
  ).toBe("YWJjZGVm");
  expect(Array.isArray(await f.call("notification_list"))).toBe(true);
  expect(Array.isArray(await f.call("mcp_list"))).toBe(true);
  await expect(
    f.call("mcp_auth_status", { sessionId: "missing" }),
  ).rejects.toThrow("会话未加载");
  await expect(
    f.call("open_url", { url: "file:///etc/passwd" }),
  ).rejects.toThrow();
});
it("expires permission requests with a default deny and no stale resolution", async () => {
  const f = await setup(),
    settings = createSettings(f.root, safe);
  let id = "";
  const permissions = new Permissions(
    settings,
    (_name, p) => {
      id = (p as { requestId: string }).requestId;
    },
    20,
  );
  expect(
    await permissions.request("session", "tool", "write", { path: "test" }),
  ).toBe(false);
  expect(() => permissions.resolve(id, "allow", false)).toThrow("过期");
});
it("validates all MCP entries before any secret changes are persisted", async () => {
  const f = await setup();
  await expect(
    f.call("mcp_config_save", {
      content: JSON.stringify({
        mcpServers: {
          one: { command: "node", env: { TOKEN: "must-not-persist" } },
          two: {},
        },
      }),
    }),
  ).rejects.toThrow();
  expect(await f.call("mcp_list")).toEqual([]);
  await expect(
    readFile(join(f.root, "pi", "credentials.enc.json")),
  ).rejects.toThrow();
});
