import { useMemo } from "react";
import { agentBash } from "@openbuddy/client/agent-client";
import { checkCommandRisk, type CommandRiskResult } from "@openbuddy/chat-core/command-risk";
import { friendlyError } from "@openbuddy/chat-core/error-format";

export interface BangCommand {
  command: string;
  /** `!!cmd`: the output stays out of the model's context. */
  excluded: boolean;
}

/** `!cmd` / `!!cmd` typed in the composer → the command to run (null for ordinary prompts). */
export function parseBang(text: string): BangCommand | null {
  const t = text.trimStart();
  if (!t.startsWith("!")) return null;
  const excluded = t.startsWith("!!");
  return { command: t.slice(excluded ? 2 : 1).trim(), excluded };
}

/** Error text for a failed `agent_bash` (permission_denied / busy carry their own wording). */
export function bashErrorText(error: unknown): string {
  const raw = String(error instanceof Error ? error.message : error);
  const coded = raw.match(/(?:permission_denied|session_busy|bash_running|session_not_loaded):\s*(.+)$/);
  return coded ? coded[1] : `命令没有运行：${friendlyError(error)}`;
}

/**
 * Bash mode of the composer (20261116-pii W1.2). The risk reading (chat-core command-risk) is
 * shown while typing and handed to the engine, which can only become stricter with it: deleting
 * or risky commands wait for the strong confirmation card above the composer.
 */
export function useBangCommand(opts: { text: string; sessionId?: string; streaming: boolean; onError: (message: string) => void }) {
  const { text, sessionId, streaming, onError } = opts;
  const bang = useMemo(() => parseBang(text), [text]);
  const risk: CommandRiskResult | undefined = useMemo(() => (bang?.command ? checkCommandRisk(bang.command) : undefined), [bang?.command]);
  /**
   * Called on send: "ran" (clear the input), "blocked" (keep it, error shown), or false when
   * the text is an ordinary prompt.
   */
  const handle = (): "ran" | "blocked" | false => {
    if (!bang) return false;
    if (!bang.command) return "blocked";
    if (!sessionId) { onError("命令要在任务里运行：先发送一条消息开始任务，再用 ! 运行命令。"); return "blocked"; }
    if (streaming) { onError("回复进行中，完成后再运行命令。"); return "blocked"; }
    void agentBash(sessionId, bang.command, { excludeFromContext: bang.excluded, risk: risk?.level }).catch((error) => onError(bashErrorText(error)));
    return "ran";
  };
  return { bang, risk, handle, available: !!sessionId };
}
