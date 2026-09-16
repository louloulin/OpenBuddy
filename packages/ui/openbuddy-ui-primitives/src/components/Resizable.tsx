/**
 * @openbuddy/ui-primitives/Resizable — a draggable splitter primitive.
 *
 * Wraps a sidebar / panel and lets the user resize it by dragging a handle
 * on one edge. Persists the last width to localStorage under a caller-named
 * key, with min/max clamps so the panel can never collapse by accident or
 * grow beyond the viewport.
 *
 * Inspired by cabinet's sidebar (220–420px clamp + localStorage
 * `cabinet-sidebar-width`), but generalized: the side, min, max, storage
 * key and label are all configurable.
 *
 * Keyboard accessible: focus the handle, then use ArrowLeft/ArrowRight to
 * nudge the width, Home/End to jump to min/max.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import styles from "./Resizable.module.css";

export interface ResizableProps {
  children: ReactNode;
  /** Which edge the handle sits on. `right` resizes the item by dragging its
   *  right edge; `left` resizes its left edge. */
  edge?: "left" | "right";
  min?: number;
  max?: number;
  defaultWidth?: number;
  /** localStorage key for persistence. When omitted, width is in-memory only. */
  storageKey?: string;
  /** Fixed width when `disabled` (no handle rendered). */
  disabled?: boolean;
  /** Extra class on the wrapper. */
  className?: string;
  /** Extra class on the handle. */
  handleClassName?: string;
  /** Called whenever the width settles (pointerup / keyboard). */
  onWidthChange?(width: number): void;
  /** Handle aria-label. */
  handleLabel?: string;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function readStoredWidth(
  key: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!key || typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp(n, min, max) : fallback;
  } catch {
    return fallback;
  }
}

export function Resizable({
  children,
  edge = "right",
  min = 180,
  max = 520,
  defaultWidth = 280,
  storageKey,
  disabled = false,
  className,
  handleClassName,
  onWidthChange,
  handleLabel = "Resize panel",
}: ResizableProps) {
  const [width, setWidth] = useState<number>(() =>
    readStoredWidth(storageKey, defaultWidth, min, max),
  );
  const [dragging, setDragging] = useState(false);
  // When storageKey changes (e.g. HMR / remount with a different scope),
  // re-read the stored width.
  useEffect(() => {
    setWidth(readStoredWidth(storageKey, defaultWidth, min, max));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  const persist = useCallback(
    (next: number) => {
      if (!storageKey || typeof window === "undefined") return;
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      dragRef.current = { startX: e.clientX, startWidth: widthRef.current };
      setDragging(true);
    },
    [disabled],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = e.clientX - d.startX;
      const next =
        edge === "right"
          ? clamp(d.startWidth + delta, min, max)
          : clamp(d.startWidth - delta, min, max);
      setWidth(next);
    },
    [edge, min, max],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragging(false);
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      persist(widthRef.current);
      onWidthChange?.(widthRef.current);
    },
    [persist, onWidthChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const step = e.shiftKey ? 32 : 8;
      let next: number | null = null;
      const forward = edge === "right" ? 1 : -1;
      if (e.key === "ArrowRight") next = widthRef.current + step * forward;
      else if (e.key === "ArrowLeft") next = widthRef.current - step * forward;
      else if (e.key === "Home") next = min;
      else if (e.key === "End") next = max;
      if (next === null) return;
      e.preventDefault();
      const clamped = clamp(next, min, max);
      setWidth(clamped);
      persist(clamped);
      onWidthChange?.(clamped);
    },
    [disabled, edge, min, max, persist, onWidthChange],
  );

  const wrapperStyle = useMemo(
    () => ({ width: disabled ? undefined : `${width}px` }),
    [disabled, width],
  );

  const handle = disabled ? null : (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={handleLabel}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={
        styles.handle +
        (edge === "left" ? " " + styles.handleLeft : "") +
        (dragging ? " " + styles.handleActive : "") +
        (handleClassName ? " " + handleClassName : "")
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      data-dragging={dragging ? "true" : "false"}
    />
  );

  return (
    <div
      className={styles.wrapper + (className ? " " + className : "")}
      style={wrapperStyle}
      data-resizable-edge={edge}
    >
      {edge === "left" ? handle : null}
      <div className={styles.content}>{children}</div>
      {edge === "right" ? handle : null}
    </div>
  );
}

/** Imperative helper for consumers that render their own wrapper. */
export function clampWidth(v: number, min: number, max: number): number {
  return clamp(v, min, max);
}
