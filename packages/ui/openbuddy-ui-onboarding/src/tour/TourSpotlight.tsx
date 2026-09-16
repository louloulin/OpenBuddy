/**
 * @openbuddy/ui-onboarding/TourSpotlight — 漫游的暗幕 + 高亮挖孔
 *
 * 实现方式:一块全屏 fixed 遮罩负责拦截点击,一个位于目标位置的"挖孔"元素
 * 用 `box-shadow: 0 0 0 9999px` 把四周涂暗 —— 比四块 div 拼接少一半 DOM,
 * 也天然支持圆角与过渡动画。挖孔自身 `pointer-events: none`,所以被高亮的
 * 真实控件仍然可点(漫游不是模态阻断)。
 *
 * 通过 `createPortal` 挂到 `document.body`:宿主可能在任意 overflow / transform
 * 容器里渲染它,只有 body 才能保证 fixed 定位不被祖先裁剪。
 */
import { createPortal } from "react-dom";

import styles from "./TourSpotlight.module.css";

import type { TourRect } from "./tour-steps";

export interface TourSpotlightProps {
  /** 高亮区域;为 null 时退化为整屏暗幕(居中卡片步骤)。 */
  rect: TourRect | null;
  zIndex?: number;
  /** 点击暗幕(挖孔之外)时触发 —— 通常用于关闭漫游。 */
  onScrimClick?(): void;
  className?: string;
}

export function TourSpotlight({
  rect,
  zIndex = 1800,
  onScrimClick,
  className,
}: TourSpotlightProps) {
  if (typeof document === "undefined") return null;

  const overlayClass = [styles.overlay, rect ? "" : styles.dim, className ?? ""]
    .filter(Boolean)
    .join(" ");

  return createPortal(
    <div
      className={overlayClass}
      style={{ zIndex }}
      data-testid="tour-spotlight"
      data-has-hole={rect ? "true" : "false"}
      role="presentation"
      onClick={onScrimClick}
    >
      {rect && (
        <div
          className={styles.hole}
          data-testid="tour-spotlight-hole"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      )}
    </div>,
    document.body,
  );
}
