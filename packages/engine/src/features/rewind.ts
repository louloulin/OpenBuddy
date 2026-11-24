import type { EngineContext } from "../engine-context.js";
import { deriveTitle, messageText } from "../titles.js";
import type { Slot } from "../types.js";
import { moveLeaf } from "./branch-state.js";

/**
 * User prompts on the current branch, newest last (for 历史 / 从这里编辑).
 *
 * The list is built from the session *projection* (what the model actually sees), so its
 * order matches the transcript on screen one-to-one — including messages that were removed
 * from the context (删除该消息) and versions that live on another branch.
 */
export function rewindPoints(engine: EngineContext, id: string) {
  const manager = engine.live(id).sessionManager;
  const points: Array<{ entryId: string; index: number; preview: string }> = [];
  for (const entry of manager.buildSessionProjection().entries) {
    for (const message of entry.messages) {
      if (message.role !== "user") continue;
      const text = messageText(message as { content?: unknown });
      if (!text) continue;
      points.push({ entryId: entry.sourceEntry.id, index: points.length, preview: deriveTitle(text) ?? text.slice(0, 60) });
    }
  }
  return points;
}
/**
 * Move the branch leaf to just before `entryId`; the renderer rebuilds from `session_rewound`.
 * The prompt is about to be sent again, so the mode and expert selected now stay (`keep`).
 */
export async function navigateBefore(engine: EngineContext, slot: Slot, entryId: string) {
  if (slot.busy) throw Error("会话忙碌");
  const result = await moveLeaf(engine, slot, entryId, "keep");
  if (result.cancelled) throw Error("rewind_cancelled: 已取消");
  engine.invalidateList();
  engine.emitEvent(slot, { type: "session_rewound", messages: slot.session.messages });
  return result.editorText ?? "";
}
/** 从这里编辑: drop this prompt and everything after it; returns the prompt text. */
export async function rewind(engine: EngineContext, id: string, entryId: string) {
  const slot = engine.slot(id);
  if (!slot.session.getUserMessagesForForking().some((m) => m.entryId === entryId)) throw Error("rewind_point_not_found: 该消息不在当前分支");
  return { editorText: await engine.navigateBefore(slot, entryId) };
}
/** 重新生成: branch before the last prompt and send it again (images included). */
export async function regenerate(engine: EngineContext, id: string, modelId?: string, providerId?: string) {
  const slot = engine.slot(id);
  const last = slot.session.getUserMessagesForForking().at(-1);
  if (!last) throw Error("rewind_point_not_found: 没有可重新生成的消息");
  const entry = slot.session.sessionManager.getEntry(last.entryId) as { message?: { content?: unknown } } | undefined;
  const content = Array.isArray(entry?.message?.content) ? (entry!.message!.content as Array<{ type?: string; data?: string; mimeType?: string }>) : [];
  const images = content
    .filter((part) => part.type === "image" && part.data && part.mimeType)
    .map((part) => ({ type: "image" as const, data: part.data!, mimeType: part.mimeType! }));
  // 换模型重新生成 (G1-27): the new model applies to the branch the prompt is sent on.
  if (modelId) await engine.setModel(id, modelId, providerId);
  const text = (await engine.navigateBefore(slot, last.entryId)) || last.text;
  await engine.send(id, text, images.length ? images : undefined);
}
