/** Last path segment of a working directory, used as a 空间 node label. */
export function basename(p: string): string {
  if (!p) return "默认空间";
  const norm = p.replace(/[\\/]+$/, "");
  const i = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  const name = i >= 0 ? norm.slice(i + 1) : norm;
  return name || "默认空间";
}

/** Compact, locale-friendly relative time for the sidebar row tail. */
export function relativeTime(iso: string, locale: "zh-CN" | "en-US" = "zh-CN"): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 60) return locale === "en-US" ? "just now" : "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return locale === "en-US" ? `${min} min ago` : `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return locale === "en-US" ? `${hr} h ago` : `${hr}小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return locale === "en-US" ? "yesterday" : "昨天";
  if (day < 7) return locale === "en-US" ? `${day} d ago` : `${day}天前`;
  const d = new Date(t);
  return locale === "en-US"
    ? `${d.getMonth() + 1}/${d.getDate()}`
    : `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** Pinned entries first; within a pin tier, most-recently-active first
 *  (by `updatedAt`) so a session you just chatted in rises to the top and its
 *  relative-time tail stays honest. Insertion order breaks remaining ties. */
export function sortPinnedFirst<
  T extends { pinned?: boolean; updatedAt?: string },
>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const pin = Number(!!b.pinned) - Number(!!a.pinned);
    if (pin !== 0) return pin;
    const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bt - at;
  });
}

/** Small project icon for sidebar nodes (three connected circles). */
export function ProjectNodeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="6" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="17.5" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.7 8.4 10.5 15.6M16.3 8.4 13.5 15.6M8 7h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
