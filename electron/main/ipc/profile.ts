/**
 * IPC surface — profile domain.
 *
 * Phase B.1 round 4 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Owns the
 * `agent:profile-*` handlers — list installed profile packages +
 * install / remove profile bundles.
 */
import { ipcMain } from "electron";

import {
  absolutePath,
  recordValue,
  requiredString,
} from "./validation";
import type { AgentHostIpcDeps } from "./_agent-host-deps";

export function registerProfileIpc(deps: AgentHostIpcDeps): void {
  const { agentHost } = deps;

  ipcMain.handle("agent:profile-packages", () => agentHost.profilePackages());
  ipcMain.handle("agent:profile-install", async (_e, args: unknown) => {
    const input = recordValue(args, "profile install payload");
    const source = input.source !== undefined
      ? requiredString(input.source, "source")
      : absolutePath(input.sourcePath, "sourcePath");
    return agentHost.installProfileBundle(source);
  });
  ipcMain.handle("agent:profile-install-default-pi", async (_e, args: unknown) => {
    const input = recordValue(args, "profile install default pi payload") as { force?: unknown } | Record<string, unknown>;
    const force = (input as { force?: unknown }).force === true;
    return agentHost.installDefaultPiPackages({ force });
  });
  ipcMain.handle("agent:profile-remove", async (_e, args: unknown) => {
    const input = recordValue(args, "profile remove payload");
    await agentHost.removeProfileBundle(requiredString(input.name, "name"));
    return { ok: true };
  });
}