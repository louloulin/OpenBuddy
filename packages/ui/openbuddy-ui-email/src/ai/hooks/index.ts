/**
 * @openbuddy/ui-email/ai/hooks — 公共 hook 出口。
 *
 * 让消费者可以从单一路径 import:
 *   import { useAiInbox, useAiLoop, AiInboxRuntime } from "@openbuddy/ui-email/ai/hooks";
 */
export { useAiInbox, createAiInboxRuntime, type AiInboxRuntime, type UseAiInboxArgs, type UseAiInboxResult } from "./useAiInbox";
export { useAiLoop, type UseAiLoopArgs, type UseAiLoopResult } from "./useAiLoop";
