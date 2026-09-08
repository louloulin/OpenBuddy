/**
 * IPC surface — agent-info domain.
 *
 * Phase B.1 round 3 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Owns the
 * read-only snapshot handlers that don't belong in any other capability:
 *   - agent:auth-status — auth ready/signed-in snapshot
 *   - agent:commands-list — list slash commands
 *   - agent:providers-list — provider catalog snapshot
 *   - agent:resource-inventory — resource inventory
 *   - internal_reload — internal reload dispatch
 */
import { ipcMain } from "electron";

import { recordValue } from "./validation";
import type { AgentHostIpcDeps } from "./_agent-host-deps";

export function registerAgentInfoIpc(deps: AgentHostIpcDeps): void {
  const { agentHost, ensureAgentHost } = deps;

  ipcMain.handle("agent:auth-status", async () => {
    await ensureAgentHost();
    return agentHost.authStatus();
  });
  ipcMain.handle("agent:commands-list", async () => {
    await ensureAgentHost();
    return agentHost.listCommands();
  });
  ipcMain.handle("agent:providers-list", async () => {
    await ensureAgentHost();
    return agentHost.providerCatalog();
  });
  ipcMain.handle("agent:resource-inventory", async () => {
    await ensureAgentHost();
    return agentHost.resourceInventory();
  });
  ipcMain.handle("internal_reload", async (_event, args?: { kind?: string }) => {
    if (args !== undefined) recordValue(args, "internal_reload payload");
    await ensureAgentHost();
    if (args?.kind === "skills" || args?.kind === "mcp_all" || args?.kind === "mcp_project") {
      await agentHost.reloadPiRuntime(`internal-reload:${args.kind}`);
    }
    return { ok: true, kind: args?.kind ?? "unknown" };
  });
}