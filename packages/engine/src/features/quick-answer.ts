import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { EngineContext } from "../engine-context.js";

/**
 * 快速问答 (G1-31): answer a question about a quoted fragment without touching the task.
 *
 * The answer runs in a throwaway Pi session: `SessionManager.inMemory` keeps it off disk, so
 * it never lands in the sidebar and never joins the conversation the user is reading — the
 * main context is untouched. Tools are switched off, because a quick question is answered
 * from the quoted text rather than by reading and writing files (which would also mean
 * approval cards for a session nobody is looking at).
 *
 * The turn runs in the background; the renderer follows the streamed `agent://event`s of the
 * returned session id and shows the answer as it arrives.
 */
export async function quickAnswer(
  engine: EngineContext,
  options: { prompt: string; context?: string; cwd?: string; modelId?: string; providerId?: string },
) {
  const cwd = await engine.validCwd(options.cwd || engine.inbox);
  const slot = await engine.open(
    SessionManager.inMemory(cwd),
    options.modelId,
    options.providerId,
    undefined,
    undefined,
    // 一次性会话不是任务：不进侧栏，也不进「运行中」。
    true,
  );
  // 只回答问题：不加工具，因此不会产生审批卡，也不会动工作区。
  slot.session.setActiveToolsByName([]);
  const question = options.context
    ? `${options.context}\n\n我的问题：${options.prompt}`
    : options.prompt;
  void engine.send(slot.id, question).catch((error) => {
    engine.emit("agent://error", { sessionId: slot.id, message: error instanceof Error ? error.message : String(error) });
  });
  return { sessionId: slot.id };
}
