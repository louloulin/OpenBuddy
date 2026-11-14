import { useEffect } from "react";
import { create } from "zustand";
import { XCloseIcon } from "./icon/icons";

/**
 * Click an image (prompt thumbnails, markdown images) to see it large (20261115-ui U3.6).
 * One host mounted by App; ←/→ step through the images of the same message, Esc closes.
 */
export interface LightboxImage { src: string; alt?: string }
interface LightboxState {
  images: LightboxImage[];
  index: number;
  open: (images: LightboxImage[], index?: number) => void;
  step: (dir: 1 | -1) => void;
  close: () => void;
}
export const useLightbox = create<LightboxState>((set, get) => ({
  images: [],
  index: 0,
  open: (images, index = 0) => set({ images, index: Math.max(0, Math.min(index, images.length - 1)) }),
  step: (dir) => { const { images, index } = get(); if (images.length > 1) set({ index: (index + dir + images.length) % images.length }); },
  close: () => set({ images: [], index: 0 }),
}));
export const openLightbox = (images: LightboxImage[], index = 0) => useLightbox.getState().open(images, index);

export function ImageLightboxHost() {
  const { images, index, step, close } = useLightbox();
  const image = images[index];
  useEffect(() => {
    if (!image) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [image, step, close]);
  if (!image) return null;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={image.alt || "图片预览"} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <img className="lightbox__img" src={image.src} alt={image.alt ?? ""} />
      <button type="button" className="lightbox__close" onClick={close} aria-label="关闭预览" data-tip="关闭 (Esc)"><XCloseIcon size="sm" /></button>
      {images.length > 1 && (
        <>
          <button type="button" className="lightbox__nav lightbox__nav--prev" onClick={() => step(-1)} aria-label="上一张">‹</button>
          <button type="button" className="lightbox__nav lightbox__nav--next" onClick={() => step(1)} aria-label="下一张">›</button>
          <div className="lightbox__count">{index + 1} / {images.length}</div>
        </>
      )}
    </div>
  );
}
