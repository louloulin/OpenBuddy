/**
 * 输入历史 —— 对齐 WorkBuddy `cb-chat-ui/chat-input/use-input-history.ts`
 * (arrow-key recall:↑/↓ 在输入框回溯历史 prompt)。
 *
 * 核心是纯函数历史管理(去重、上限、导航游标),便于单测;附带一个 React hook
 * 把游标逻辑接到键盘事件。
 */

/** 历史记录容器(纯数据)。 */
export interface InputHistory {
  /** 按时间顺序的历史条目(最旧在前)。 */
  items: string[];
  /** 最大保留条数。 */
  limit: number;
}

/** 创建一个空的历史容器。 */
export function createInputHistory(limit = 50): InputHistory {
  return { items: [], limit: Math.max(1, limit) };
}

/** 追加一条历史(去空白、去重、超限截断;返回新容器)。 */
export function pushHistory(hist: InputHistory, text: string): InputHistory {
  const t = (text ?? "").trim();
  if (!t) return hist;
  // 去重:若与最后一条相同则不重复追加(保持原顺序)。
  if (hist.items.length > 0 && hist.items[hist.items.length - 1] === t) {
    return hist;
  }
  // 已存在则先移除旧位置(挪到末尾)。
  const filtered = hist.items.filter((x) => x !== t);
  filtered.push(t);
  // 超限截断(保留最新的 limit 条)。
  const overflow = filtered.length - hist.limit;
  const items = overflow > 0 ? filtered.slice(overflow) : filtered;
  return { ...hist, items };
}

/** 清空历史。 */
export function clearHistory(hist: InputHistory): InputHistory {
  return { ...hist, items: [] };
}

/** 导航游标结果。 */
export interface NavigateResult {
  /** 导航后的文本(游标指向的历史条目)。 */
  text: string;
  /** 当前游标位置(items.length = 未在历史中/回到输入框;items.length-1 = 最新)。 */
  cursor: number;
}

/**
 * 从当前游标导航(↑ 上翻 / ↓ 下翻)。
 *  - cursor === items.length 表示「回到输入框」(最新位置之外)。
 *  - ↑ 从 items.length 出发跳到最新一条(items.length-1)。
 *  - ↓ 到 items.length 时返回 draft(回到用户当前输入)。
 *
 * @param hist 历史
 * @param cursor 当前游标
 * @param direction "up" | "down"
 * @param draft 回到输入框时的回填文本(默认空串)
 */
export function navigateHistory(
  hist: InputHistory,
  cursor: number,
  direction: "up" | "down",
  draft = "",
): NavigateResult {
  if (hist.items.length === 0) return { text: draft, cursor: hist.items.length };
  if (direction === "up") {
    // 上翻:clamp 到 0。
    const next = Math.max(0, cursor >= hist.items.length ? hist.items.length - 1 : cursor - 1);
    return { text: hist.items[next], cursor: next };
  }
  // 下翻:clamp 到 items.length(回到输入框)。
  const next = Math.min(hist.items.length, cursor + 1);
  return { text: next >= hist.items.length ? draft : hist.items[next], cursor: next };
}
