/**
 * IPC surface — deepseek domain.
 *
 * Phase B.1 round 4 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Owns the
 * `agent:deepseek-*` handlers — the legacy compatibility layer for
 * callers that still expect the DeepSeek Cordis facade surface.
 */
import { ipcMain } from "electron";

import {
  recordValue,
  requiredString,
} from "./validation";
import type { AgentHostIpcDeps } from "./_agent-host-deps";

export function registerDeepSeekIpc(deps: AgentHostIpcDeps): void {
  const { agentHost, ensureAgentHost } = deps;

  ipcMain.handle("agent:deepseek-cordis-snapshot", async () => {
    await ensureAgentHost();
    return agentHost.deepSeekCordisSnapshot();
  });
  ipcMain.handle("agent:deepseek-pi-describe", async () => {
    await ensureAgentHost();
    return agentHost.deepSeekPiBridgeDescription();
  });
  ipcMain.handle("agent:deepseek-cordis-invoke", async (_e, args: unknown) => {
    const payload = recordValue(args, "DeepSeek Cordis invocation payload");
    return agentHost.invokeDeepSeekCordis({
      service: requiredString(payload.service, "service"),
      method: requiredString(payload.method, "method"),
      ...(payload.args === undefined ? {} : { args: payload.args as readonly unknown[] | Record<string, unknown> }),
      ...(payload.parameters === undefined ? {} : { parameters: payload.parameters as string[] }),
    });
  });
}