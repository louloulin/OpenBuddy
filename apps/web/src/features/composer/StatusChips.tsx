import { useEffect, useRef, useState } from "react";
import { Check, Image as ImageIcon, Palette, X } from "lucide-react";
import {
  DESIGN_STYLES,
  IMAGE_MODES,
  designStyleLabel,
  imageModeLabel,
  useStatusStore,
} from "@/shared/state/status-store";

/**
 * 状态 chip (G1-17): WorkBuddy's `wb-status-chips` — the 设计风格 and 补图方式 chips that
 * sit right after the model selector in the input toolbar.
 *
 * The labels and hints are WorkBuddy's own (from `input.wbStatusChips.*` and
 * `settings.personalization.style.*`), and the chips show the way WorkBuddy shows them:
 * 设计风格 in the design scene, 补图方式 when the model can take images.
 */
export function StatusChips({
  showDesignStyle,
  showImageMode,
}: {
  /** The design scene is active (WorkBuddy: the design tab). */
  showDesignStyle: boolean;
  /** The current model accepts images. */
  showImageMode: boolean;
}) {
  const designStyle = useStatusStore((state) => state.designStyle);
  const imageMode = useStatusStore((state) => state.imageMode);
  const setDesignStyle = useStatusStore((state) => state.setDesignStyle);
  const setImageMode = useStatusStore((state) => state.setImageMode);
  const [open, setOpen] = useState<"design" | "image" | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(null); };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  if (!showDesignStyle && !showImageMode) return null;

  return (
    <div className="wb-status-chips" ref={ref} role="group" aria-label="状态">
      {showDesignStyle && (
        <div className="wb-status-chip__wrap">
          <span className="wb-status-chip">
            <button
              type="button"
              className="wb-status-chip__trigger"
              aria-haspopup="listbox"
              aria-expanded={open === "design"}
              aria-label={`设计风格：${designStyleLabel(designStyle)}`}
              onClick={() => setOpen(open === "design" ? null : "design")}
            >
              <Palette size={14} aria-hidden className="wb-footer-item__icon" />
              <span className="wb-footer-item__label">{designStyleLabel(designStyle)}</span>
            </button>
            {designStyle !== "default" && (
              <button
                type="button"
                className="wb-status-chip__close"
                aria-label={`取消选中设计风格 ${designStyleLabel(designStyle)}`}
                onClick={() => setDesignStyle("default")}
              >
                <X size={12} aria-hidden />
              </button>
            )}
          </span>
          {open === "design" && (
            <div className="wb-footer-menu" role="listbox" aria-label="设计风格">
              {DESIGN_STYLES.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  role="option"
                  aria-selected={style.id === designStyle}
                  className="wb-footer-menu__item"
                  onClick={() => { setDesignStyle(style.id); setOpen(null); }}
                >
                  <span>
                    {style.label}
                    <span className="wb-footer-menu__desc">{style.hint}</span>
                  </span>
                  {style.id === designStyle && <Check size={14} />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {showImageMode && (
        <div className="wb-status-chip__wrap">
          <span className="wb-status-chip">
            <button
              type="button"
              className="wb-status-chip__trigger"
              aria-haspopup="listbox"
              aria-expanded={open === "image"}
              aria-label={`补图方式：${imageMode ? imageModeLabel(imageMode) : "默认"}`}
              onClick={() => setOpen(open === "image" ? null : "image")}
            >
              <ImageIcon size={14} aria-hidden className="wb-footer-item__icon" />
              <span className="wb-footer-item__label">{imageMode ? imageModeLabel(imageMode) : "补图方式"}</span>
            </button>
            {imageMode && (
              <button
                type="button"
                className="wb-status-chip__close"
                aria-label={`回退补图方式 ${imageModeLabel(imageMode)} 为默认`}
                onClick={() => setImageMode(null)}
              >
                <X size={12} aria-hidden />
              </button>
            )}
          </span>
          {open === "image" && (
            <div className="wb-footer-menu" role="listbox" aria-label="补图方式">
              {IMAGE_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  role="option"
                  aria-selected={mode.id === imageMode}
                  className="wb-footer-menu__item"
                  onClick={() => { setImageMode(mode.id); setOpen(null); }}
                >
                  <span>
                    {mode.label}
                    <span className="wb-footer-menu__desc">{mode.hint}</span>
                  </span>
                  {mode.id === imageMode && <Check size={14} />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
