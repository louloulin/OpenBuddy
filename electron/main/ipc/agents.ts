/**
 * IPC surface — agents domain.
 *
 * Phase B.1 round 2 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Extracted
 * from `./agent.ts` (was lines 431-460) into a single-capability
 * module that registers only the `agents_*` handlers. Establishes
 * the pattern that B.3 will replicate for the other 9 capability
 * groups in agent.ts.
 *
 * The handlers are pure CRUD on the agent-preset registry; they do
 * not need access to `agentHost` or `casdoorAuth` so they can be
 * registered independently from the larger agent IPC surface.
 */
import { ipcMain } from "electron";

import * as resources from "../agent/pi-resources";
import {
  absolutePath,
  optionalCwd,
  recordValue,
  requiredBoolean,
  requiredString,
  stringValue,
} from "./validation";

export function registerAgentsIpc(): void {
  ipcMain.handle("agents_list", async (_e, args?: unknown) => {
    const input = args === undefined || args === null ? {} : recordValue(args, "agents list payload");
    return resources.listAgents(optionalCwd(input));
  });
  ipcMain.handle("agents_get", async (_e, args: { path: string; cwd?: string | null }) => {
    const input = recordValue(args, "agent get payload");
    return resources.getAgent(
      requiredString(input.path, "agent path"),
      input.cwd === null || input.cwd === undefined ? undefined : absolutePath(input.cwd, "cwd"),
    );
  });
  ipcMain.handle("agents_save", async (_e, args: { name: string; raw: string; cwd?: string | null }) => {
    const input = recordValue(args, "agent save payload");
    return resources.saveAgent(
      requiredString(input.name, "agent name"),
      requiredString(input.raw, "agent content"),
      input.cwd === null || input.cwd === undefined ? undefined : absolutePath(input.cwd, "cwd"),
    );
  });
  ipcMain.handle("agents_delete", async (_e, args: { path: string; cwd?: string | null }) => {
    const input = recordValue(args, "agent delete payload");
    return resources.deleteAgent(
      requiredString(input.path, "agent path"),
      input.cwd === null || input.cwd === undefined ? undefined : absolutePath(input.cwd, "cwd"),
    );
  });
  ipcMain.handle("agents_template", async (_e, args: { name: string; description: string; systemPrompt: string }) => {
    const input = recordValue(args, "agent template payload");
    return resources.agentTemplate(
      requiredString(input.name, "agent name"),
      requiredString(input.description, "agent description"),
      requiredString(input.systemPrompt, "agent prompt"),
    );
  });
  ipcMain.handle("agents_defaults_get", async () => resources.readAgentDefaults());
  ipcMain.handle("agents_defaults_save", async (_e, args: unknown) => {
    const input = recordValue(args, "agents defaults payload");
    const defaults = input.defaults === undefined ? {} : recordValue(input.defaults, "defaults");
    const patch: Partial<resources.AgentDefaults> = {};
    if (defaults.defaultModel !== undefined) patch.defaultModel = stringValue(defaults.defaultModel, "defaultModel");
    if (defaults.defaultPermission !== undefined) patch.defaultPermission = stringValue(defaults.defaultPermission, "defaultPermission");
    if (defaults.rememberToolApprovals !== undefined) patch.rememberToolApprovals = requiredBoolean(defaults.rememberToolApprovals, "rememberToolApprovals");
    return resources.writeAgentDefaults(patch);
  });
}