import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { EngineContext } from "../engine-context.js";

/**
 * 消息级操作 (G1-27): 删除该消息 / 继续生成.
 *
 * Pi 的会话是只追加的树：条目不能改也不能删，只能移动叶子。删除消息用的是 Pi 的
 * `context_edit`（`replacement: null` = 该条目不再进入模型上下文）：条目本身留在会话文件里
 * 作为一次删除记录，历史分支因此完好，而这一轮从对话里消失。
 *
 * 同一个机制也用来「继续生成」：Pi 把被输出上限截断的回答从上下文里摘掉（它不想让半截
 * 回答进入下一次请求），继续生成时把这段内容放回去，模型才能从断点接着写。
 */

/** Pi 的消息条目（对话正文）。 */
type MessageEntry = Extract<SessionEntry, { type: "message" }>;

/** 用户提问条目：删除一轮时，它和它产生的回答一起走。 */
function isUserMessage(entry: SessionEntry): boolean {
  return entry.type === "message" && (entry.message as { role?: string }).role === "user";
}

/** 可以被 context_edit 改写的消息条目（Pi 只允许这三种角色）。 */
function isEditableMessage(entry: SessionEntry): boolean {
  if (entry.type !== "message") return false;
  const role = (entry.message as { role?: string }).role;
  return role === "assistant" || role === "toolResult";
}

/**
 * 一轮对话的全部条目：用户提问 + 它之后（时间上）产生的所有回答，直到下一条提问。
 *
 * `branch` 是 Pi 的路径顺序（先旧后新），所以这一轮在目标条目「更新」的一侧。
 */
function turnEntries(branch: SessionEntry[], entryId: string): SessionEntry[] {
  const index = branch.findIndex((entry) => entry.id === entryId);
  if (index < 0) return [];
  const target = branch[index];
  if (!isUserMessage(target)) return [target];
  const out: SessionEntry[] = [target];
  for (let i = index + 1; i < branch.length; i++) {
    const entry = branch[i];
    if (isUserMessage(entry)) break;
    if (isEditableMessage(entry)) out.push(entry);
  }
  return out;
}

/**
 * 删除该消息 (G1-27): 把这一轮从模型上下文里摘掉。
 *
 * - 提问：提问和它产生的回答一起删（一轮问答）。
 * - 回答：只删回答，提问保留。
 *
 * 返回被移除的条目数，渲染层据此重建转录。
 */
export async function deleteMessage(engine: EngineContext, id: string, entryId: string) {
  const slot = engine.slot(id);
  if (slot.busy) throw Error("会话忙碌");
  const manager = slot.session.sessionManager;
  if (!manager.getEntry(entryId)) throw Error("entry_not_found: 该消息不存在");
  const entries = turnEntries(manager.getBranch(), entryId);
  if (!entries.length) throw Error("entry_not_found: 该消息不在当前分支");
  for (const entry of entries) manager.appendContextEdit(entry.id, null);
  slot.session.refreshContext();
  engine.invalidateList();
  engine.emitEvent(slot, { type: "session_rewound", messages: slot.session.messages });
  return { removed: entries.length };
}

/** 最后一个被输出上限截断的回答条目（Pi 的 `stopReason: "length"`）。 */
function truncatedEntry(branch: SessionEntry[]): MessageEntry | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "message") continue;
    const message = entry.message as { role?: string; stopReason?: string };
    if (message.role === "user") return undefined; // 只看最后一轮
    if (message.role === "assistant" && message.stopReason === "length") return entry as MessageEntry;
  }
  return undefined;
}

/**
 * 清空上下文并新开 (G1-30): 任务本身留着，对话从头开始。
 *
 * 用 Pi 的分支：把叶子移回第一条提问之前，上下文里就只剩系统的开场白，下一条消息从
 * 新的根开始。旧对话留在会话文件的另一条分支上（历史里还能找到），任务条目本身不删。
 */
export async function clearContext(engine: EngineContext, id: string) {
  const slot = engine.slot(id);
  if (slot.busy) throw Error("会话忙碌");
  const branch = slot.session.sessionManager.getBranch();
  const firstUser = branch.find((entry) => isUserMessage(entry));
  if (!firstUser?.parentId) throw Error("nothing_to_clear: 这一轮还没有对话");
  await engine.navigateBefore(slot, firstUser.parentId);
  return { cleared: true };
}

/**
 * 继续生成 (G1-27): 回答被截断时，从断点接着写。
 *
 * Pi 在截断后把这段回答从模型上下文里摘掉了（`context_edit` 的 replacement 为 null），
 * 所以继续之前要把它放回去：模型得先看见写了一半的内容，才接得上。
 */
export async function continueAnswer(engine: EngineContext, id: string) {
  const slot = engine.slot(id);
  if (slot.busy) throw Error("会话忙碌");
  const manager = slot.session.sessionManager;
  const branch = manager.getBranch();
  const entry = truncatedEntry(branch);
  if (!entry) throw Error("not_truncated: 这一轮没有被截断");
  const index = branch.findIndex((item) => item.id === entry.id);
  const omitted = branch
    .slice(index + 1)
    .some((item) => item.type === "context_edit" && item.targetId === entry.id && item.replacement === null);
  if (omitted) {
    const content = (entry.message as { content?: unknown }).content;
    if (Array.isArray(content)) manager.appendContextEdit(entry.id, { content: content as never });
    slot.session.refreshContext();
  }
  await engine.send(id, "请从被截断的地方接着写完上面的回答，不要重复已经输出的内容。");
  return { continued: true };
}
