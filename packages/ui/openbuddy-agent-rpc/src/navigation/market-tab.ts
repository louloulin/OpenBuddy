/**
 * 跨视图导航意图 —— 「专家·技能·连接器」面板的子 tab 深链。
 *
 * 为什么需要它:R39 把侧栏的「腾讯文档 / 乐享知识库」从死入口改成了
 * `onNavigate("专家·技能·连接器")`,但那个面板的 tab 是 `useState("experts")`
 * 写死的 —— 用户点了「腾讯文档」,提示说"已打开连接器目录",**落到的却是专家
 * 页**。承诺与结果不一致,和"点不动"是同一种体验缺陷,只是更隐蔽。
 *
 * 这里把"我要看哪个 tab"做成一条独立的、无 React 依赖的意图通道
 * (localStorage 持久 + window 事件即时),于是:
 *   - 面板**尚未挂载**时(从聊天页跳过来):写入 localStorage,挂载时消费;
 *   - 面板**已经挂载**时(就停在这一页再点一次):事件到达,当场切 tab;
 *   - 消费即清空,所以"下次正常进入"不会被上一次的意图挟持。
 *
 * 放在内核侧(`src/lib/`)而不是某个 ui-* 包里:这是**视图间的中立契约**,
 * 任何入口(侧栏、命令面板、插件、未来的快捷键)都可以请求,任何实现
 * (ui-experts 的 ExpertsPanel,或插件注册的替换实现)都可以消费。
 */
import type { MarketTab } from "@openbuddy/ui-experts";

/** localStorage key。与 `openbuddy.assistant.activeTab` / `openbuddy.email.*`
 *  同族:这些 key 都是"一次性跨视图意图"。 */
export const MARKET_TAB_STORAGE_KEY = "openbuddy.market.tab";

/** 面板已挂载时的即时通道;`event.detail` 为请求的 tab。 */
export const MARKET_TAB_EVENT = "openbuddy:market-tab";

/**
 * 合法 tab 白名单 —— 同时是 localStorage 反序列化的校验表。
 * `satisfies` 保证每一项都仍在 `MarketTab` 联合里;完整性由
 * `MARKET_TAB_KEYS`(ui-experts 的 pill 列表)对照测试守住。
 */
export const MARKET_TABS = ["experts", "skills", "connectors", "plugins"] as const satisfies readonly MarketTab[];

/** 任意值 → 是否合法 tab。localStorage 里可能有历史值或被手改的垃圾。 */
export function isMarketTab(value: unknown): value is MarketTab {
  return typeof value === "string" && (MARKET_TABS as readonly string[]).includes(value);
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Safari 隐私模式 / 沙箱 iframe:访问 localStorage 会抛。
    return null;
  }
}

/** 读取"待消费"的意图,不改变状态。非法值一律当作没有。 */
export function readRequestedMarketTab(): MarketTab | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(MARKET_TAB_STORAGE_KEY);
    return isMarketTab(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** 清空待消费意图(消费后 / 普通导航进入时)。 */
export function clearRequestedMarketTab(): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(MARKET_TAB_STORAGE_KEY);
  } catch {
    /* 存储不可用:意图本来就没写进去 */
  }
}

/**
 * 请求面板切到某个 tab。返回是否被接受(非法 tab 名直接拒绝,不写存储也不
 * 发事件),调用方可以据此决定要不要提示用户。两件事都要做:持久化负责
 * "面板还没挂载",事件负责"面板已在屏幕上"。
 */
export function requestMarketTab(tab: unknown): tab is MarketTab {
  if (!isMarketTab(tab)) return false;
  try {
    safeStorage()?.setItem(MARKET_TAB_STORAGE_KEY, tab);
  } catch {
    /* 存储不可用:事件通道仍能生效 */
  }
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent<MarketTab>(MARKET_TAB_EVENT, { detail: tab }));
  }
  return true;
}

/** 消费待消费意图:读 + 清。面板挂载时调用,保证一次性。 */
export function consumeRequestedMarketTab(): MarketTab | null {
  const tab = readRequestedMarketTab();
  if (tab) clearRequestedMarketTab();
  return tab;
}
