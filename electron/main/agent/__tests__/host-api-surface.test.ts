/**
 * host-api-surface.test.ts — static guard over the public agentHost API surface.
 *
 * Docs: docs/agent-host-microkernel-modularization.md §5.2. Prevents parallel
 * agent refactors from silently adding/removing a public `agentHost` method
 * (which would break `Object.keys(agentHost)` consumers in `electron/main/ipc/*`
 * and the renderer facade contract) without an explicit surface change review.
 *
 * How it works (no app launch, no side effects):
 *   1. Parse the `AgentHostFacade` interface keys from build-agent-host-facade.ts.
 *   2. Assert they equal a committed stable allowlist (the 109-key snapshot).
 *   3. Parse the keys actually wired in `agentHost = buildAgentHostFacade({...})`
 *      from agent-host.ts and assert every facade key has a provider (no silent stub).
 *   4. Parse `agentHost.<key>` usages across electron/main/ipc/** and assert every
 *      used key is declared on the facade (no IPC→facade drift).
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", ".."); // electron/main/agent/__tests__ → repo root
const FACADE_FILE = join(ROOT, "electron", "main", "agent", "host-modules", "bootstrap", "build-agent-host-facade.ts");
const AGENT_HOST_FILE = join(ROOT, "electron", "main", "agent", "agent-host.ts");
const IPC_DIR = join(ROOT, "electron", "main", "ipc");

/** Extract the body of the first balanced `{...}` after `marker`. */
function balancedBody(src: string, marker: string): string {
  const start = src.indexOf(marker);
  if (start < 0) return "";
  const open = src.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (; end < src.length; end++) {
    const c = src[end];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(open + 1, end);
}

/** Parse `  key:` lines (2-space top-level interface members). */
function interfaceKeys(src: string): string[] {
  const block = balancedBody(src, "export interface AgentHostFacade {");
  return [...block.matchAll(/^\s{2}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1]);
}

/** Parse top-level keys of the `buildAgentHostFacade({ ... })` object. */
function facadeObjectKeys(src: string): string[] {
  const block = balancedBody(src, "buildAgentHostFacade({");
  const keys = new Set<string>();
  for (const m of block.matchAll(/^\s{2}([A-Za-z_][A-Za-z0-9_]*)\s*(?::|,)|^\s{2}([A-Za-z_][A-Za-z0-9_]*)\s*$/gm)) {
    keys.add((m[1] ?? m[2])!);
  }
  return [...keys];
}

/** All `agentHost.<key>(` call sites + `agentHost["<key>"]` accesses in the ipc layer. */
function ipcUses(src: string): Set<string> {
  const uses = new Set<string>();
  for (const m of src.matchAll(/agentHost\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(|agentHost\s*\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g)) {
    uses.add((m[1] ?? m[2])!);
  }
  return uses;
}

function readIpcSources(): string {
  if (!existsSync(IPC_DIR)) return "";
  const read = (dir: string): string =>
    readdirSync(dir, { withFileTypes: true }).map((e) => {
      const p = join(dir, e.name);
      return e.isDirectory() ? read(p) : e.isFile() && e.name.endsWith(".ts") ? readFileSync(p, "utf8") : "";
    }).join("\n");
  return read(IPC_DIR);
}

// Stable snapshot of the public agentHost surface (2026-09, Batch A).
// Regenerated intentionally only when the API contract changes on purpose.
const STABLE_SURFACE = new Set(
  "abort archiveWorkspaceSession authorizeMcp authStatus bindCurrentSessionToTenant cancelMcpAuthorization clearSessionMetadata createWorkspace currentAgentPreset deepSeekCordisSnapshot deepSeekPiBridgeDescription deleteModel deleteProvider deleteSession deleteWorkspace dispose ensureNewSession ensureTypertReady extensionsBound followUp getContext getCwd getHarnessResumeToken getHarnessSessionCursors getModel getModelRuntime getSession getStoredPluginState getToolRegistry init insertWorkspaceBefore insertWorkspaceSessionBefore inspirationGenerate installDefaultPiPackages installProfileBundle interruptSubagent invokeConnection invokeDeepSeekCordis invokeRemote killTask listActivePluginTransactions listAgentPresets listCommands listPlugins listProfileRemoteContributions listRendererPluginEntries listRunningTasks listSessionJobs listSessions listSkills listSubagentChildren listTools listWorkspaces loadSession mcpCapabilityGovernance mcpStatus newSession onEvent onPluginEvent pluginEvents pluginInventory pluginReadiness pluginSnapshot profilePackages prompt promptContent promptSubagent providerCatalog readSessionAttachment readSessionEntries registerRemote reloadMcp reloadPiExtensions reloadPiRuntime reloadPlugin removeProfileBundle renameSession renameWorkspace rendererPluginBootGraph reportActivePluginTransaction resetPluginState resolveRendererPluginModule resolveUiRequest resourceInventory rewindSession saveModel saveProvider selectAgentPreset sessionBaselines sessionFile sessionInfo sessionProjectionBaseline sessionUsage setAllArchived setHarnessResumeToken setHarnessSessionCursors setModel setPluginEnabled setSessionArchived setSessionExpert setSessionPinned setThinkingLevel steer subagentHistory syncWorkbenchScope unregisterRemote updatePluginConfig updateSessionQueue waitUntilReady"
    .split(/\s+/)
    .filter(Boolean),
);

describe("agentHost public API surface", () => {
  const facadeSrc = readFileSync(FACADE_FILE, "utf8");
  const hostSrc = readFileSync(AGENT_HOST_FILE, "utf8");

  it("facade interface matches the stable surface allowlist", () => {
    const declared = new Set(interfaceKeys(facadeSrc));
    expect([...declared].sort()).toEqual(
      [...STABLE_SURFACE].sort(),
    );
  });

  it("every facade method is wired in agentHost (no silent stub)", () => {
    const provided = new Set(facadeObjectKeys(hostSrc));
    const declared = new Set(interfaceKeys(facadeSrc));
    const missing = [...declared].filter((k) => !provided.has(k));
    expect(missing).toEqual([]);
  });

  it("every ipc usage of agentHost resolves to a declared facade method", () => {
    const declared = new Set(interfaceKeys(facadeSrc));
    const used = ipcUses(readIpcSources());
    const unresolved = [...used].filter((k) => !declared.has(k));
    expect(unresolved).toEqual([]);
  });
});
