/**
 * pi-market/format — pi.dev 风格的格式化与时间/下载量/命令辅助函数。
 *
 * 与 marketplace-model.ts 完全独立,不依赖 React/DOM/CSS Modules,纯函数,
 * 方便 vitest 单测覆盖每个分支。所有时间使用相对当前时刻,以便 SSR/CSR 一致。
 */

export type CompactDownloads = string;

/** 把整数下载量压缩成 "1M/mo" 这种 pi.dev/npm 风格。 */
export function formatDownloads(count: number | undefined | null): CompactDownloads | undefined {
  if (count === undefined || count === null || !Number.isFinite(count) || count < 0) {
    return undefined;
  }
  if (count < 1000) return `${Math.round(count)}/mo`;
  if (count < 10_000) {
    const value = count / 1000;
    return `${(value >= 10 ? Math.round(value) : Math.round(value * 10) / 10)}K/mo`;
  }
  if (count < 1_000_000) {
    const value = count / 1000;
    return `${Math.round(value)}K/mo`;
  }
  if (count < 10_000_000) {
    const value = count / 1_000_000;
    return `${(value >= 10 ? Math.round(value) : Math.round(value * 10) / 10)}M/mo`;
  }
  return `${Math.round(count / 1_000_000)}M/mo`;
}

export type RelativeAge = string;

/** 把 ISO 时间戳或 Date 转成 pi.dev 风格的相对时间 ("1h ago" / "3d ago" / "5m ago")。 */
export function formatRelative(
  input: string | number | Date | undefined | null,
  now: Date = new Date(),
): RelativeAge | undefined {
  if (input === undefined || input === null) return undefined;
  const date = input instanceof Date ? input : new Date(input);
  const stamp = date.getTime();
  if (!Number.isFinite(stamp)) return undefined;
  const deltaMs = now.getTime() - stamp;
  if (deltaMs < 0) return undefined;
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 45) return `${sec || 1}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  const year = Math.floor(day / 365);
  return `${year}y ago`;
}

/** 构造 pi.dev 风格的安装命令。npmName 是必填(没有就回退到 id)。 */
export function buildInstallCommand(npmName: string | undefined, id: string): string {
  const target = npmName && npmName.trim().length > 0 ? npmName : id;
  return `pi install npm:${target}`;
}

/** 给纯文本/HTML 取安全的预览颜色,留 theme preview stub 用。 */
export function previewAccent(seed: string, themeAccent: string): string {
  if (!seed) return themeAccent;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue}deg 60% 55%)`;
}

/** 给一组条目拼 pi.dev 风格的 searchBlob(name + description + publisher + tags)。 */
export function buildSearchBlob(
  parts: ReadonlyArray<string | undefined | null>,
): string {
  return parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part): part is string => part.length > 0)
    .join(" ")
    .toLowerCase();
}

/** 把字节数格式化为 "1.4 MB" 之类,与 marketplace-model.formatBytes 同形但允许 KB。 */
export function formatSize(bytes: number | undefined | null): string | undefined {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return undefined;
  }
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[index]}`;
}
