/**
 * IPC surface — preset domain.
 *
 * Phase B.1 round 3 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Extracted
 * from `./agent.ts`. Owns the `agent:presets-*` and `agent:preset-*`
 * handlers — 4 self-contained calls against the agentHost facade
 * + resources helper.
 */
import { ipcMain } from "electron";

import * as resources from "../agent/pi-resources";
import {
  absolutePath,
  recordValue,
  requiredString,
} from "./validation";
import type { AgentHostIpcDeps } from "./_agent-host-deps";

export function registerPresetIpc(deps: AgentHostIpcDeps): void {
  const { agentHost, ensureAgentHost } = deps;

  ipcMain.handle("agent:presets-list", async (_e, input?: unknown) => {
    const cwd = input === undefined || input === null ? agentHost.getCwd() : absolutePath(String(input), "cwd");
    return agentHost.listAgentPresets(cwd);
  });
  ipcMain.handle("agent:preset-current", async () => {
    await ensureAgentHost();
    return { id: agentHost.currentAgentPreset() };
  });
  ipcMain.handle("agent:preset-select", async (_e, input?: unknown) => {
    const payload = recordValue(input, "preset selection payload");
    const id = requiredString(payload.id, "id");
    return agentHost.selectAgentPreset(id);
  });
  ipcMain.handle("agent:preset-default-save", async (_e, input?: unknown) => {
    const payload = input === undefined || input === null ? {} : recordValue(input, "preset default payload");
    const id = payload.id === undefined || payload.id === null ? undefined : requiredString(payload.id, "id");
    return resources.writeAgentPresetDefault(id);
  });
}