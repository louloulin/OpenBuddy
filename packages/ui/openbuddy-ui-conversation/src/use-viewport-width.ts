/**
 * 视口宽度(px)—— 面板宽度/布局求解的输入。
 *
 * 用 `resize` 事件而不是 ResizeObserver:面板宽度是相对**视口**收敛的,
 * 与容器无关;而且窗口 resize 在 Electron 里频率低、无需节流。
 */
import { useEffect, useState } from "react";

function readViewportWidth(): number {
  if (typeof window === "undefined") return 1280;
  const vw = window.innerWidth;
  return Number.isFinite(vw) && vw > 0 ? vw : 1280;
}

export function useViewportWidth(): number {
  const [width, setWidth] = useState(readViewportWidth);
  useEffect(() => {
    const onResize = () => setWidth(readViewportWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}
