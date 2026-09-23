/**
 * useDebouncedValue — 通用 debounce hook(value 稳定后才回吐,适合
 * 高频输入(搜索框)→ 派生昂贵的计算 / 副作用(URL 写入、过滤)。
 *
 * 设计:
 *   - delay 为 0 时等价于直接返回 value,等价行为以便条件开关。
 *   - 输入快速变化时,timer 重置,只有「最后一次变化 + delay 静止」后才回吐新值。
 *   - SSR 安全:无 window.setTimeout 时直接返回 value。
 *   - 不依赖 React 状态:用一个 ref + forceUpdate 模式不必要,useState 足够。
 */
import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value);
      return;
    }
    if (typeof window === "undefined" || typeof window.setTimeout !== "function") {
      setDebounced(value);
      return;
    }
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
}
