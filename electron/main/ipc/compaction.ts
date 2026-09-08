/**
 * IPC surface — compaction domain.
 *
 * Phase B.1 round 4 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Owns the
 * snapshot-side compaction handlers:
 *   - agent:compaction-settings — get current compaction config
 *   - agent:session-stats — session token usage snapshot
 *   - agent:session-tree — branch tree snapshot
 *   - pi_set_session_expert / pi_clear_session_expert — expert binding
 *     on a session (lives here because it's a session-metadata op
 *     that the user persona switcher drives).
 *
 * `agent:compact` + `agent:set-auto-compaction` + `agent:fork-session`
 * stay in agent.ts because they share the trace logging + sessionId
 * guard + awaitExtensionsBound flow.
 */
import { ipcMain } from "electron";

import {
  recordValue,
  requiredString,
} from "./validation";
import type { AgentHostIpcDeps } from "./_agent-host-deps";

export function registerCompactionIpc(deps: AgentHostIpcDeps): void {
  const { agentHost, ensureAgentHost } = deps;

  ipcMain.handle("agent:compaction-settings", async () => {
    await ensureAgentHost();
    return agentHost.getCompactionSettings();
  });
  ipcMain.handle("agent:session-stats", async () => {
    await ensureAgentHost();
    return agentHost.getSessionStats();
  });
  ipcMain.handle("agent:session-tree", async () => {
    await ensureAgentHost();
    return agentHost.getSessionTree();
  });
  ipcMain.handle("pi_set_session_expert", async (_e, args: { sessionId: string; expertId: string; expertName: string; avatarLocal?: string }) => {
    await ensureAgentHost();
    const input = recordValue(args, "session expert payload");
    return agentHost.setSessionExpert(
      requiredString(input.sessionId, "session id"),
      {
        expertId: requiredString(input.expertId, "expert id"),
        expertName: requiredString(input.expertName, "expert name"),
        avatarLocal: input.avatarLocal === undefined ? undefined : (typeof input.avatarLocal === "string" ? input.avatarLocal : undefined),
      },
    );
  });
  ipcMain.handle("pi_clear_session_expert", async (_e, args: { sessionId: string }) => {
    await ensureAgentHost();
    return agentHost.setSessionExpert(requiredString(recordValue(args, "session expert payload").sessionId, "session id"), null);
  });
}