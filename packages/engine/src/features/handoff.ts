import type { HandoffResult } from "@openbuddy/protocol/handoff";
import type { EngineContext } from "../engine-context.js";

/** Pull plain text out of a Pi message (string content, or a text-part array). */
function textOf(message: unknown): string {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .filter((part): part is { type: "text"; text: string } => !!part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string")
      .map((part) => part.text)
      .join("\n");
  return "";
}
function clip(text: string, max: number): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
function firstLine(text: string, max = 240): string {
  const line = text.split("\n").map((value) => value.trim()).find(Boolean) ?? "";
  return clip(line, max);
}

/**
 * 交接到新任务 (W1.7, the Pi `handoff` pattern).
 *
 * Extracts what still matters from the current branch, opens a new session in the
 * same workspace and returns a self-contained draft. The old session is untouched
 * and nothing is sent: the renderer only pre-fills the composer.
 */
export async function handoff(engine: EngineContext, id: string, goal: string): Promise<HandoffResult> {
  const slot = engine.slot(id);
  if (slot.busy) throw Error("session_busy: 会话正在运行，请等这一轮结束后再交接");
  const cwd = slot.session.sessionManager.getCwd();
  const title = engine.settings.config.read().sessions[id]?.title ?? slot.session.sessionName ?? "原任务";

  const messages = slot.session.messages as Array<{ role?: string }>;
  const userTurns = messages
    .filter((message) => message?.role === "user")
    .map((message) => textOf(message))
    .filter(Boolean);
  const assistantTurns = messages
    .filter((message) => message?.role === "assistant")
    .map((message) => textOf(message))
    .filter(Boolean);

  const background: string[] = [];
  if (userTurns.length) {
    background.push("### 已确认的需求");
    // Oldest first, keep the recent thread compact.
    for (const turn of userTurns.slice(-12)) background.push(`- ${firstLine(turn)}`);
  }
  const lastAnswer = assistantTurns.at(-1);
  if (lastAnswer) {
    background.push("", "### 最近进展", clip(lastAnswer, 2000));
  }

  const prompt = [
    `## 背景接手（来自「${clip(title, 120)}」）`,
    `工作空间：\`${cwd}\``,
    background.join("\n"),
    "",
    "## 下一步任务",
    goal.trim(),
  ]
    .filter((section, index, all) => section !== "" || (index > 0 && all[index - 1] !== ""))
    .join("\n");

  const newId = await engine.newSession(cwd);
  const from = { sessionId: id, title };
  // A custom entry keeps the provenance visible in the session file itself.
  engine.slots.get(newId)?.session.sessionManager.appendCustomEntry("openbuddy.handoff", { ...from, goal: goal.trim() });
  engine.metadata(newId, { title: `交接 · ${clip(goal.trim(), 40) || title}`, handoffFrom: from });
  engine.invalidateList();
  return { sessionId: newId, prompt, from };
}
