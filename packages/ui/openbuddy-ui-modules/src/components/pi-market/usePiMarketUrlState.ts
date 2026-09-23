/**
 * usePiMarketUrlState — 把 usePiMarketPage 的 query/type/sort/page
 * 同步到 URL search params,使页面可分享 / 书签化 / 浏览器前进后退可用。
 *
 * 设计:
 *   - 只读 URL 是单向的(host 加载时把 params 翻译成 initialXXX);
 *   - 写 URL 是单向的(用户操作后 push 新的 params,replaceState 不污染历史栈);
 *   - 中间不需要 round-trip,避免「改 URL → setState → 改 URL」循环。
 *   - 不依赖 react-router / next.js,直接读 `window.location.search`,
 *     用 `window.history.replaceState` 写;SSR / worker 里没有 window 时静默跳过。
 *
 * 为什么单独一个 hook:
 *   - `usePiMarketPage` 自身保持纯派生,不引入副作用,可继续单测;
 *   - URL 层是宿主决策(用 searchParams / hash / 自定义 storage 都行),
 *     这里只给一个最朴素的实现 + 约定参数名(pi.q / pi.t / pi.s / pi.p)。
 */
import { useEffect, useMemo, useRef } from "react";
import type { MarketplaceKind } from "../marketplace-model";
import type { PiMarketSortKey } from "./PiMarketToolbar";

const PARAM_QUERY = "pi.q";
const PARAM_TYPE = "pi.t";
const PARAM_SORT = "pi.s";
const PARAM_PAGE = "pi.p";

const VALID_TYPES: ReadonlyArray<MarketplaceKind | "all"> = [
  "all",
  "extension",
  "skill",
  "theme",
  "prompt",
  "mcp",
  "plugin",
];

const VALID_SORTS: ReadonlyArray<PiMarketSortKey> = ["downloads", "recent", "name"];

export interface PiMarketUrlInitialState {
  initialQuery?: string;
  initialType?: MarketplaceKind | "all";
  initialSort?: PiMarketSortKey;
  initialPage?: number;
}

/** 从 URLSearchParams(可空)读出 Pi-market 状态;参数缺失或非法时回退到 undefined。 */
export function readPiMarketUrlState(search: string | URLSearchParams | null | undefined): PiMarketUrlInitialState {
  const params = typeof search === "string" ? new URLSearchParams(search) : search ?? null;
  if (!params) return {};
  const out: PiMarketUrlInitialState = {};
  const q = params.get(PARAM_QUERY);
  if (q !== null) out.initialQuery = q;
  const t = params.get(PARAM_TYPE);
  if (t && (VALID_TYPES as readonly string[]).includes(t)) {
    out.initialType = t as MarketplaceKind | "all";
  }
  const s = params.get(PARAM_SORT);
  if (s && (VALID_SORTS as readonly string[]).includes(s)) {
    out.initialSort = s as PiMarketSortKey;
  }
  const p = params.get(PARAM_PAGE);
  if (p !== null) {
    const n = Number(p);
    if (Number.isFinite(n) && n >= 1) out.initialPage = Math.floor(n);
  }
  return out;
}

/**
 * 把当前 state 写到 window.location,保留其它参数。
 * SSR 安全:没有 window / history 时直接返回。
 */
export function writePiMarketUrlState(next: PiMarketUrlInitialState): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const apply = (key: string, value: string | null | undefined) => {
    if (value === null || value === undefined || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  };
  apply(PARAM_QUERY, next.initialQuery);
  apply(PARAM_TYPE, next.initialType);
  apply(PARAM_SORT, next.initialSort);
  apply(PARAM_PAGE, next.initialPage === 1 ? null : next.initialPage);
  // replaceState 不污染历史栈;用户操作不应每次按键都 push 一条 history。
  window.history.replaceState(window.history.state, "", url.toString());
}

export interface UsePiMarketUrlStateOptions {
  /** 是否启用 URL 同步;默认 true。宿主可以传 false 禁用(比如嵌入式预览)。 */
  enabled?: boolean;
  /** 初始 search,默认 `window.location.search`。SSR / 测试时可显式传入。 */
  initialSearch?: string;
}

/**
 * 单一入口:返回 readPiMarketUrlState() 的结果,首次 mount 时把当前 state 写回 URL
 * (保证 URL 总能反映真实状态,避免空参时显示成 "pi.q=" 这种污染)。
 */
export function usePiMarketUrlState(options: UsePiMarketUrlStateOptions = {}): PiMarketUrlInitialState {
  const enabled = options.enabled !== false;
  const initialSearch = options.initialSearch;
  const initialRef = useRef<PiMarketUrlInitialState | null>(null);

  const initial = useMemo<PiMarketUrlInitialState>(() => {
    if (!enabled) return {};
    const search =
      initialSearch ?? (typeof window !== "undefined" ? window.location.search : "");
    return readPiMarketUrlState(search);
  }, [enabled, initialSearch]);

  initialRef.current = initial;

  useEffect(() => {
    if (!enabled) return;
    // mount 时如果 URL 没有这些参数,主动写一次确保后续 setState 的 diff 基准清晰;
    // 但只有真的存在 state 时才写(避免空状态也强行塞 search params)。
    if (typeof window === "undefined") return;
    if (!initial.initialQuery && !initial.initialType && !initial.initialSort && !initial.initialPage) return;
    writePiMarketUrlState(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return initial;
}
