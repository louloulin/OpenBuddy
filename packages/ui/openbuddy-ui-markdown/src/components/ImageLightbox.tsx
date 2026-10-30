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
import { useEffect, useState, type MouseEvent } from "react";

export type ImageLightboxProps = {
  src: string;
  alt?: string;
  onClose: () => void;
};

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  // false = 适配窗口（zoom-in）；true = 原始尺寸（zoom-out，遮罩可滚动）。
  const [fullSize, setFullSize] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleOverlayClick = () => onClose();
  const handleImageClick = (e: MouseEvent) => {
    e.stopPropagation();
    setFullSize((v) => !v);
  };

  return (
    <div
      className="md-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt || undefined}
      onClick={handleOverlayClick}
    >
      <img
        className={fullSize ? "md-lightbox__img md-lightbox__img--full" : "md-lightbox__img"}
        src={src}
        alt={alt || ""}
        onClick={handleImageClick}
      />
    </div>
  );
}
