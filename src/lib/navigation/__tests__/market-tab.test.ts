/**
 * 市场子 tab 深链契约 —— 「我要看连接器」必须真的到得了连接器。
 *
 * 背景(为什么值得一条 spec):R39 把侧栏的「腾讯文档 / 乐享知识库」从死入口
 * 改成了跳「专家·技能·连接器」并提示"已打开连接器目录",但那个面板的 tab 是
 * `useState("experts")` 写死的 —— **提示在撒谎**:用户落到专家页,还得自己找。
 * 这条契约把"要哪个 tab"变成可传递的意图,并且:
 *   - 面板没挂载 → localStorage 持久,挂载时消费;
 *   - 面板已挂载 → window 事件即时切换;
 *   - 消费即清空 → 下次正常进入不会被上一次意图挟持;
 *   - 非法值一律拒绝(存储里可能是历史值或被手改的垃圾)。
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MARKET_TAB_KEYS } from "@openbuddy/ui-experts";
import {
  MARKET_TABS,
  MARKET_TAB_EVENT,
  MARKET_TAB_STORAGE_KEY,
  clearRequestedMarketTab,
  consumeRequestedMarketTab,
  isMarketTab,
  readRequestedMarketTab,
  requestMarketTab,
} from "../market-tab";

beforeEach(() => {
  window.localStorage.clear();
});

describe("requestMarketTab / readRequestedMarketTab", () => {
  it("合法 tab 会同时写存储和发事件", () => {
    const seen: unknown[] = [];
    const onRequest = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener(MARKET_TAB_EVENT, onRequest);

    expect(requestMarketTab("connectors")).toBe(true);
    expect(window.localStorage.getItem(MARKET_TAB_STORAGE_KEY)).toBe("connectors");
    expect(readRequestedMarketTab()).toBe("connectors");
    expect(seen).toEqual(["connectors"]);

    window.removeEventListener(MARKET_TAB_EVENT, onRequest);
  });

  it("非法 tab 名被拒绝:不写存储、不发事件(调用方可以据此提示)", () => {
    const spy = vi.fn();
    window.addEventListener(MARKET_TAB_EVENT, spy);

    expect(requestMarketTab("nope")).toBe(false);
    expect(requestMarketTab(undefined)).toBe(false);
    expect(requestMarketTab(42)).toBe(false);
    expect(window.localStorage.getItem(MARKET_TAB_STORAGE_KEY)).toBeNull();
    expect(spy).not.toHaveBeenCalled();

    window.removeEventListener(MARKET_TAB_EVENT, spy);
  });

  it("存储里的脏值只当作「没有意图」,不抛错", () => {
    window.localStorage.setItem(MARKET_TAB_STORAGE_KEY, "skills; alert(1)");
    expect(readRequestedMarketTab()).toBeNull();
    expect(consumeRequestedMarketTab()).toBeNull();
  });

  it("消费是一次性的:读完即清,免得下次进入被上一次挟持", () => {
    requestMarketTab("plugins");
    expect(consumeRequestedMarketTab()).toBe("plugins");
    expect(window.localStorage.getItem(MARKET_TAB_STORAGE_KEY)).toBeNull();
    expect(consumeRequestedMarketTab()).toBeNull();
  });

  it("clearRequestedMarketTab 幂等", () => {
    requestMarketTab("skills");
    clearRequestedMarketTab();
    clearRequestedMarketTab();
    expect(readRequestedMarketTab()).toBeNull();
  });

  it("isMarketTab 只认白名单里的字符串", () => {
    expect(isMarketTab("experts")).toBe(true);
    expect(isMarketTab("EXPERTS")).toBe(false);
    expect(isMarketTab(null)).toBe(false);
    expect(isMarketTab({})).toBe(false);
  });
});

describe("深链白名单与面板真实 tab 不漂移", () => {
  it("MARKET_TABS 与 ExpertsPanel 的 pill 列表完全一致", () => {
    expect([...MARKET_TABS].sort()).toEqual([...MARKET_TAB_KEYS].sort());
  });

  it("没有重复项(否则白名单会掩盖一个渲染不出来的 tab)", () => {
    expect(new Set(MARKET_TABS).size).toBe(MARKET_TABS.length);
  });
});
