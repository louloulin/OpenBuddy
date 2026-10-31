/**
 * ImageLightbox — markdown 图片查看器（plan1030 批 5b）。
 *
 * 背景：`.markdown-body img` 早就有 `cursor: zoom-in` 但没有任何点击
 * 处理器——空承诺（plan1030.md §0.6 P0）。本组件补上承诺：
 *   - Esc / 点击遮罩关闭；
 *   - 点击图片在「适配窗口 ↔ 原始尺寸」间切换（最小可用缩放）；
 *   - 无可见文案、无字面量（plan1030 §6 组件库不写字面量）；
 *   - z-index 走 --wb-z-lightbox token（批 3 刻度）。
 */
import { useEffect, useRef, useState } from "react";

export type ImageLightboxProps = {
  src: string;
  alt?: string;
  onClose: () => void;
  /** 关闭按钮 / 遮罩的可访问名(文案由调用方传入)。 */
  closeLabel?: string;
  /** 缩放切换按钮的可访问名。 */
  zoomLabel?: string;
};

/**
 * 所有可点区域都是真正的 <button>(键盘可达、读屏可识别):遮罩、图片缩放、
 * 右上角关闭。打开时焦点进入关闭按钮,关闭后归还给打开前的元素。
 */
export function ImageLightbox({ src, alt, onClose, closeLabel = "Close", zoomLabel = "Toggle zoom" }: ImageLightboxProps) {
  // false = 适配窗口（zoom-in）；true = 原始尺寸（zoom-out，遮罩可滚动）。
  const [fullSize, setFullSize] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="md-lightbox" role="dialog" aria-modal="true" aria-label={alt || undefined}>
      <button type="button" className="md-lightbox__backdrop" aria-label={closeLabel} tabIndex={-1} onClick={onClose} />
      <button
        type="button"
        className="md-lightbox__zoom"
        aria-label={zoomLabel}
        aria-pressed={fullSize}
        onClick={() => setFullSize((v) => !v)}
      >
        <img
          className={fullSize ? "md-lightbox__img md-lightbox__img--full" : "md-lightbox__img"}
          src={src}
          alt={alt || ""}
        />
      </button>
      <button ref={closeRef} type="button" className="md-lightbox__close" aria-label={closeLabel} onClick={onClose}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
