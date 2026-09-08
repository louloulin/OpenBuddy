/**
 * host-modules/facade/prompt-facade.ts
 *
 * v6-G M1 (facade 化) — 把 agent-host.ts 中 prompt / steer / follow-up /
 * abort / model forwarders 提取到独立 facade.
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import type { AgentHostState } from "../_state-shape";
import type { OpenBuddyThinkingLevel } from "../../../ipc/validation";
import {
  prompt as promptImpl,
  promptContent as promptContentImpl,
  updateSessionQueue as updateSessionQueueImpl,
  readSessionAttachment as readSessionAttachmentImpl,
  steer as steerImpl,
  followUp as followUpImpl,
  abort as abortImpl,
  getSession as getSessionImpl,
  onEvent as onEventImpl,
  onPluginEvent as onPluginEventImpl,
} from "../agent-prompt";
import {
  setModel as setModelImpl,
  setThinkingLevel as setThinkingLevelImpl,
  getModel as getModelImpl,
  getModelRuntime as getModelRuntimeImpl,
  getCwd as getCwdImpl,
  authStatus as authStatusImpl,
  providerCatalog as providerCatalogImpl,
} from "../agent-model";
import {
  listCommands as listCommandsImpl,
  listSkills as listSkillsImpl,
  resourceInventory as resourceInventoryImpl,
} from "../harness-cursors";
import { listRunningTasks as listRunningTasksImpl } from "../subagent-runtime";

export function buildPromptFacade(_state: AgentHostState) {
  return {
    prompt: (text: string, options?: { traceId?: string; sessionId?: string }) =>
      promptImpl(text, options),
    promptContent: (content: readonly any[], mode: "queue" | "steer" = "queue") =>
      promptContentImpl(content, mode),
    updateSessionQueue: (sessionId: string, itemId: string, action: { kind: "edit" | "remove" | "steer"; content?: readonly any[] }) =>
      updateSessionQueueImpl(sessionId, itemId, action),
    readSessionAttachment: (sessionId: string, attachmentId: string) =>
      readSessionAttachmentImpl(sessionId, attachmentId),
    steer: (text: string, options?: { traceId?: string; sessionId?: string }) =>
      steerImpl(text, options),
    followUp: (text: string, options?: { traceId?: string; sessionId?: string }) =>
      followUpImpl(text, options),
    abort: (options?: { traceId?: string; sessionId?: string }) => abortImpl(options),
    setModel: (modelId: string, options?: { traceId?: string; sessionId?: string }) =>
      setModelImpl(modelId, options),
    setThinkingLevel: (level: OpenBuddyThinkingLevel, options?: { traceId?: string; sessionId?: string }) =>
      setThinkingLevelImpl(level, options),
    getSession: () => getSessionImpl(),
    getModel: () => getModelImpl(),
    getModelRuntime: () => getModelRuntimeImpl(),
    getCwd: () => getCwdImpl(),
    authStatus: () => authStatusImpl(),
    providerCatalog: () => providerCatalogImpl(),
    listCommands: () => listCommandsImpl(),
    listRunningTasks: () => listRunningTasksImpl(),
    onEvent: (handler: any) => onEventImpl(handler),
    onPluginEvent: (handler: any) => onPluginEventImpl(handler),
    listSkills: (requestedCwd?: string | null) => listSkillsImpl(requestedCwd),
    resourceInventory: () => resourceInventoryImpl(),
  };
}
