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
    const model = agentHost.getModel();
    // 一个 provider 都没配置时,pi 会给出一个占位 Model:provider / id / name
    // 全是字面量 "unknown"。把它当"当前模型"透给渲染层,模型选择器就显示
    // "unknown/unknown"(2026-10-11 真实启动截图里看到的),用户以为存在这么个模型。
    // 占位不是模型 —— 返回 null,让 UI 走它自己的"未配置"分支(只显示思考档位)。
    const placeholder = !model
      || !model.provider || !model.id
      || model.provider === "unknown" || model.id === "unknown";
    return placeholder ? null : model;
  });
  ipcMain.handle("agent:thinking-levels", async () => {
    await ensureAgentHost();
    return agentHost.getAvailableThinkingLevels();
  });
}