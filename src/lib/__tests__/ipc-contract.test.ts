import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

function literalChannels(source: string, expression: RegExp): Set<string> {
  return new Set([...source.matchAll(expression)].map((match) => match[1]));
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const channelAliases: Record<string, string> = {
  open_url: "shell:open-external",
  open_path: "shellfs:open-path",
  reveal_in_folder: "shellfs:reveal",
  browse_directory: "shellfs:browse-directory",
  list_dir: "shellfs:list-dir",
  path_stat: "shellfs:stat",
  read_text_file: "shellfs:read-text",
  write_text_file: "shellfs:write-text",
  export_text_file: "shellfs:export-text",
};

describe("Electron IPC contract", () => {
  let preload: string;
  let main: string;
  let client: string;
  let root: string;
  beforeAll(async () => {
    root = resolve(process.cwd());
    preload = await readFile(resolve(root, "electron/preload/index.ts"), "utf8");
    main = await readFile(resolve(root, "electron/main/ipc/index.ts"), "utf8");
    client = await readFile(resolve(root, "src/lib/agent/pi-client.ts"), "utf8");
  });
  it("keeps renderer invoke channels allowlisted and implemented by Main", async () => {
    const root = resolve(process.cwd());
    const rendererSources = await Promise.all((await sourceFiles(resolve(root, "src"))).map((path) => readFile(path, "utf8")));
    const preload = await readFile(resolve(root, "electron/preload/index.ts"), "utf8");
    const ipcFiles = await sourceFiles(resolve(root, "electron/main/ipc"));
    const main = (await Promise.all(ipcFiles.map((file) => readFile(file, "utf8")))).join("\n");
    const invoked = new Set(rendererSources.flatMap((source) => [...literalChannels(source, /(?:invoke|ipcRenderer\.invoke)(?:<[^>]+>)?\(\s*["']([^"']+)["']/g)]));
    const allowlisted = literalChannels(preload, /\s["']([^"']+)["'],?/g);
    const handlers = literalChannels(main, /ipcMain\.handle\(\s*["']([^"']+)["']/g);
    for (const rawChannel of invoked) {
      const channel = channelAliases[rawChannel] ?? rawChannel;
      expect(allowlisted.has(channel), `preload allowlist missing ${channel}`).toBe(true);
      expect(handlers.has(channel) || channel === "shell:open-external", `main handler missing ${channel}`).toBe(true);
    }
  });

  it("keeps enterprise-capable IPC handlers behind the main-process authorization boundary", async () => {
    const ipcFiles = await sourceFiles(resolve(process.cwd(), "electron/main/ipc"));
    const source = (await Promise.all(ipcFiles.map((file) => readFile(file, "utf8")))).join("\n");
    const protectedChannels = [
      "agent:load-session", "agent:session-info", "agent:session-usage", "session_search", "session_fork",
      "sessions:list", "sessions:list-workspaces", "sessions:rename", "sessions:delete", "sessions:set-pinned", "sessions:set-archived", "sessions:set-expert",
      "subagents:get-config", "subagents:set-config",
      "permission:list", "permission:save", "permission:mode-get", "permission:mode-set",
      "casdoor:resource-list", "casdoor:resource-get", "casdoor:resource-create", "casdoor:resource-update", "casdoor:resource-delete",
      "casdoor:tenant-policy-get", "casdoor:tenant-policy-update", "casdoor:tenant-audit-list", "casdoor:member-revocation", "casdoor:member-revocations",
      "casdoor:runtime-policy-get", "casdoor:ai-capabilities", "casdoor:commercial-model-catalog", "casdoor:credits-get", "casdoor:wallets-list", "casdoor:wallet-selected", "casdoor:wallet-select", "casdoor:wallet-credits", "casdoor:wallet-ledger", "casdoor:credits-ledger", "casdoor:credits-reconciliation", "casdoor:credits-reconciliation-export", "casdoor:credits-pricing", "casdoor:credits-quote", "casdoor:credits-pricing-update", "casdoor:credits-grant", "casdoor:credits-reserve", "casdoor:credits-settle", "casdoor:credits-release", "casdoor:credits-expire", "casdoor:credits-welcome", "casdoor:billing-plans", "casdoor:billing-plan-upsert", "casdoor:billing-orders", "casdoor:billing-order-create", "casdoor:billing-order-refund", "casdoor:billing-order-expire", "casdoor:introspect-token", "casdoor:gateway-health", "casdoor:tenant-health",
    ];
    for (const channel of protectedChannels) {
      const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const handler = source.match(new RegExp(`ipcMain\\.handle\\(\\"${escaped}\\"[\\s\\S]*?(?=\\n\\s*ipcMain\\.handle\\(|\\n\\s*//|$)`))?.[0] ?? "";
      expect(handler, `missing IPC handler ${channel}`).not.toBe("");
      expect(handler, `unprotected IPC handler ${channel}`).toMatch(/assertWorkbenchAccess|authorizeSession|casdoorAuth\.(assertAuthorized|authorize|authorizeResource)|casdoorResources\.|(list|save|update|delete)Casdoor/);
    }
  });
  it("keeps the complete preload allowlist and Main handler registry in sync", async () => {
    const preload = await readFile(resolve(process.cwd(), "electron/preload/index.ts"), "utf8");
    const ipcFiles = await sourceFiles(resolve(process.cwd(), "electron/main/ipc"));
    const mainSources = await Promise.all(ipcFiles.map((file) => readFile(file, "utf8")));
    const main = mainSources.join("\n");
    const allowBlock = preload.match(/const allowedInvokeChannels = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
    const allowlisted = new Set([...allowBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
    const handlers = new Set([...main.matchAll(/ipcMain\.handle\(\s*"([^"]+)"/g)].map((match) => match[1]));
    expect([...handlers].filter((channel) => !allowlisted.has(channel))).toEqual([]);
    expect([...allowlisted].filter((channel) => !handlers.has(channel))).toEqual([]);
    expect(allowlisted.size).toBeGreaterThan(190);
  });

  it("keeps compatibility aliases executable through the preload bridge", async () => {
    for (const [alias, target] of Object.entries(channelAliases)) {
      expect(preload).toContain(`${alias}: "${target}"`);
      expect(preload).toContain("const normalized = channelAliases[channel] ?? channel");
      expect(preload).toContain("ipcRenderer.invoke(normalized, args)");
    }
  });
  it("exposes durable recovery controls through every Electron layer", async () => {
    const client = await readFile(resolve(process.cwd(), "src/lib/agent/pi-client.ts"), "utf8");
    const harnessMain = await readFile(resolve(process.cwd(), "electron/main/ipc/harness.ts"), "utf8");
    for (const channel of ["harness:recovery-status", "harness:recovery-list", "harness:recovery-claim", "harness:recovery-resolve"]) {
      expect(preload).toContain(`"${channel}"`);
      expect(harnessMain).toContain(`ipcMain.handle("${channel}"`);
    }
    expect(client).toContain("harnessRecoveryStatus");
    expect(client).toContain("harnessRecoveryList");
    expect(client).toContain("harnessRecoveryClaim");
    expect(client).toContain("harnessRecoveryResolve");
  });
  it("keeps namespaced capability handlers reachable through preload", async () => {
    const allowlisted = literalChannels(preload, /\s["']([^"']+)["'],?/g);
    const handlers = literalChannels(main, /ipcMain\.handle\(\s*["']([^"']+)["']/g);
    for (const channel of handlers) {
      if (!channel.includes(":")) continue;
      expect(allowlisted.has(channel), `preload allowlist missing Main capability ${channel}`).toBe(true);
    }
  });
  it("exposes native Pi steering commands through every Electron layer", async () => {
    for (const channel of ["agent:steer", "agent:follow-up"]) {
      expect(client).toContain(`invoke<void>("${channel}"`);
    }
  });
  it("keeps preload session creation payload-compatible with Main", async () => {
  expect(preload).toContain('newSession: (cwd?: string, modelId?: string) => ipcRenderer.invoke("agent:new-session"');
  expect(preload).toContain('selectPreset: (id: string) => ipcRenderer.invoke("agent:preset-select", { id })');
  });
  it("exposes cleanup-safe native window and drag/drop subscriptions", async () => {
    expect(preload).toContain('ipcRenderer.on("openbuddy://window-resized"');
    expect(preload).toContain('ipcRenderer.off("openbuddy://window-resized"');
    expect(preload).toContain("document.addEventListener(type, wrapped, true)");
    expect(preload).toContain("document.removeEventListener(type, wrapped, true)");
  });
  it("keeps the renderer agent API on the dedicated AgentSession event channel", async () => {
    const root = resolve(process.cwd());
    const client = await readFile(resolve(root, "src/lib/agent/pi-client.ts"), "utf8");
    const runtime = await readFile(resolve(root, "src/lib/runtime/renderer-plugin-runtime.ts"), "utf8");
    const preload = await readFile(resolve(root, "electron/preload/index.ts"), "utf8");
    const main = await readFile(resolve(root, "electron/main/ipc/index.ts"), "utf8");
    expect(client).toContain('listen<OpenBuddyPluginEvent>("openbuddy://agent-event"');
    expect(client).toContain('"agent:profile-packages"');
    expect(client).toContain('"agent:plugin-inventory"');
    expect(client).toContain('"agent:profile-install"');
    expect(client).toContain('"agent:profile-remove"');
    expect(runtime).toContain("onEvent: (handler) => agentOnEvent");
    expect(preload).toContain('ipcRenderer.on("openbuddy://agent-event"');
    expect(preload).toContain('ipcRenderer.off("openbuddy://agent-event"');
    expect(main).toContain('win.webContents.send("openbuddy://agent-event", event)');
  });
  it("keeps every renderer event subscription on the explicit preload event registry", async () => {
    const rendererSources = await Promise.all((await sourceFiles(resolve(root, "src"))).map((path) => readFile(path, "utf8")));
    const eventChannels = new Set(rendererSources.flatMap((source) => [...source.matchAll(/(?:listen|events\.on)\s*(?:<[^>]+>)?\(\s*["']([^"']+)["']/g)].map((match) => match[1])));
    const allowedBlock = preload.match(/const allowedEventChannels = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
    const allowed = new Set([...allowedBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
    for (const channel of eventChannels) {
      if (!channel.includes("://")) continue;
      if (channel.startsWith("zh-") || channel === "en") continue;
      expect(allowed.has(channel), `preload event registry missing ${channel}`).toBe(true);
    }
    expect(allowed.has("pi://plugin-event")).toBe(false);
    expect(allowed.has("pi://extension-ui")).toBe(true);
    expect(preload).toContain("ipcRenderer.on(channel, wrapped)");
    expect(preload).toContain("ipcRenderer.off(channel, wrapped)");
  });
  it("keeps renderer runtime independent from Electron, Node, Pi SDK, Tauri, and Grok imports", async () => {
    const rendererFiles = await sourceFiles(resolve(root, "src"));
    const forbiddenImport = /(?:from\s*["'](?:electron|node:[^"']+|@earendil-works\/pi-(?:ai|coding-agent|agent-core)[^"']*|@tauri-apps\/[^"']+)["']|import\s*\(\s*["'](?:electron|node:[^"']+|@earendil-works\/pi-(?:ai|coding-agent|agent-core)[^"']*|@tauri-apps\/[^"']+)["']\)|require\s*\(\s*["'](?:electron|node:[^"']+|@earendil-works\/pi-(?:ai|coding-agent|agent-core)[^"']*|@tauri-apps\/[^"']+)["'])/;
    const forbiddenBrandRuntime = /(?:^|["'`])(?:grok|xai|tauri)(?:$|["'`])/i;
    for (const path of rendererFiles) {
      const source = await readFile(path, "utf8");
      expect(source, `renderer runtime import boundary violated in ${path}`).not.toMatch(forbiddenImport);
      expect(source, `forbidden provider UI runtime reference in ${path}`).not.toMatch(forbiddenBrandRuntime);
    }
  });
  it("keeps preload invoke routes closed to unknown channels", async () => {
    expect(preload).toContain("if (!allowedInvokeChannels.has(normalized))");
    expect(preload).toContain("invalid IPC channel");
  });
});
