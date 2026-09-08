/**
 * IPC surface — model domain.
 *
 * Phase B.1 round 4 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Owns the
 * `agent:current-model` + `agent:thinking-levels` snapshot handlers.
 * (The `agent:set-model` + `agent:set-thinking-level` + auto-retry
 * variants stay in agent.ts because they share the inflightAbortControllers
 * + awaitExtensionsBound flow with prompt/steer/follow-up and need
 * more careful refactoring.)
 */
import { ipcMain } from "electron";

import type { AgentHostIpcDeps } from "./_agent-host-deps";

export function registerModelIpc(deps: AgentHostIpcDeps): void {
  const { agentHost, ensureAgentHost } = deps;

  ipcMain.handle("agent:current-model", async () => {
    await ensureAgentHost();
    return agentHost.getModel();
  });
  ipcMain.handle("agent:thinking-levels", async () => {
    await ensureAgentHost();
    return agentHost.getAvailableThinkingLevels();
  });
}