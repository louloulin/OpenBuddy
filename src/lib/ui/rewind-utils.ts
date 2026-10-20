/**
 * rewind-utils — 消息级回溯的纯函数(Plan5 B.10)。
 *
 * 刻意与 `pi-client` 解耦:这里**不 import 任何 IPC**。原因有两条:
 *   1. 纯函数可以直接单测,不会被 `electron-api` 的依赖链拖进 vitest 的
 *      transform(那条链目前会解析失败);
 *   2. `useChatViewRewind` 只负责副作用(拉 rewindPoints、调 rewindExecute),
 *      映射逻辑留在这一层,便于插件复用同一份语义。
 */
import type { ChatMessage } from "@/stores/session-store";

/**
 * 把消息序列映射到 prompt 序号。
 *
 * pi 的 `promptIndex` 是"第几条用户输入"(0-based)。所以第 k 条用户消息之后
 * 的 assistant 回复,其 promptIndex 就是 k。这里按**顺序计数**而不是按
 * `rewindPoints` 数组下标,因为:
 *   - 乐观用户气泡(pushOptimisticUserContent)在 IPC 落库前就已在列表里,
 *     它同样占一个 prompt 序号;
 *   - rewindPoints 可能因为 pi 侧压缩 / 截断而少于实际消息数,按下标取会错位。
 *
 * 若某个 ordinal 不在 `validPromptIndexes` 里(例如该轮已被截断),对应消息
 * 不会出现在结果 Map 中 —— 调用方据此渲染禁用态,而不是指向错误的回溯点。
 */
export function buildPromptIndexMap(
  messages: readonly ChatMessage[],
  validPromptIndexes: ReadonlySet<number>,
): Map<string, number> {
  const map = new Map<string, number>();
  let userOrdinal = -1;
  for (const m of messages) {
    if (m.role === "user") {
      userOrdinal += 1;
      continue;
    }
    // assistant 出现在了任何 user 之前 —— 没有对应的 prompt。
    if (userOrdinal < 0) continue;
    if (validPromptIndexes.has(userOrdinal)) map.set(m.id, userOrdinal);
  }
  return map;
}

/**
 * 取某一轮 prompt 的用户输入文本(用于"回溯后重发")。
 * 只拼接 text parts;图片 / 文件附件不参与重发(与 `useChatViewRetry` 一致,
 * 那两条路径都以纯文本重发为语义)。
 */
export function userTextForPromptIndex(
  messages: readonly ChatMessage[],
  promptIndex: number,
): string {
  let userOrdinal = -1;
  for (const m of messages) {
    if (m.role !== "user") continue;
    userOrdinal += 1;
    if (userOrdinal !== promptIndex) continue;
    return m.parts
      .filter((p) => p.kind === "text")
      .map((p) => p.text)
      .join("\n");
  }
  return "";
}
