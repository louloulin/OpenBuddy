/**
 * IPC surface — profile domain.
 *
 * Phase B.1 round 4 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Owns the
 * `agent:profile-*` handlers — list installed profile packages +
 * install / remove profile bundles.
 */
import { ipcMain } from "electron";

import { confirmDangerousAction } from "./native-confirm";
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
    // P0.2(2026-10-19 生产评审 B4):任意来源的 profile 安装 = 任意代码执行,
    // 必须原生确认(市场路径自带签名校验,这里管的是裸 install 入口)。
    await confirmDangerousAction({
      window: deps.getWindow(),
      title: "安装 profile 包",
      message: "应用请求安装一个 profile 包(将执行其中的代码)",
      detail: `来源:${source}\n请确认来源可信。`,
      confirmLabel: "允许安装",
    });
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