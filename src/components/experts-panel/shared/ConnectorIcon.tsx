import { useEffect, useRef, useState } from "react";
import { connectorsIcon } from "@/lib/agent-client";
import { LetterAvatar } from "./LetterAvatar";

/** path -> resolved data URL. Survives across cards / remounts. */
const cache = new Map<string, string>();
/** path -> in-flight promise, so concurrent cards share one invoke. */
const inflight = new Map<string, Promise<string>>();

function loadIcon(path: string): Promise<string> {
  const hit = cache.get(path);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(path);
  if (!p) {
    p = connectorsIcon(path)
      .then((url) => {
        if (url) cache.set(path, url);
        return url;
      })
      .catch(() => "")
      .finally(() => {
        inflight.delete(path);
      });
    inflight.set(path, p);
  }
  return p;
}

interface ConnectorIconProps {
  /** Absolute local icon path (preferred). */
  local?: string;
  /** Connector display name — drives the letter fallback + color seed. */
  name: string;
  size?: number;
  shape?: "circle" | "square";
  className?: string;
}

/** Icon that prefers a local svg/png file (lazy-loaded as a cached data URL,
 *  only when scrolled near the viewport) and falls back to a colored letter
 *  tile. Mirrors `ThumbImg` but without image resizing (icons are already
 *  tiny). */
export function ConnectorIcon({
  local, name, size = 36, shape = "square", className,
}: ConnectorIconProps) {
  const [src, setSrc] = useState<string | undefined>(() =>
    local ? cache.get(local) : undefined,
  );
  const wrapRef = useRef<HTMLSpanElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    startedRef.current = false;
    if (!local) {
      setSrc(undefined);
      return;
    }
    const hit = cache.get(local);
    if (hit) {
      setSrc(hit);
      return;
    }
    setSrc(undefined);
    const start = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      loadIcon(local).then((u) => setSrc(u || undefined));
    };
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      start();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            start();
            io.disconnect();
          }
        }
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [local]);

  return (
    <span ref={wrapRef} className="um-thumb-wrap"
      style={{ width: size, height: size, display: "inline-flex" }}>
      <LetterAvatar name={name} src={src} size={size} shape={shape} className={className} />
    </span>
  );
}
