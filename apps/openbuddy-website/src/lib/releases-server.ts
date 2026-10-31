/**
 * apps/openbuddy-website/src/lib/releases-server.ts
 *
 * 官网「下载」页的**真实**发布数据来源。
 *
 * 为什么要有这个文件:
 *   下载页此前把文件名、大小、SHA-256 全部写死在组件里 —— 而且写的是
 *   并不存在的东西(文件名与 electron-builder 的 artifactName 规则对不上,
 *   校验和是编出来的 `7e3b…c4d2`)。一个还没发过版(releases = 0)的项目,
 *   官网首页挂着三个"下载"按钮和一行假校验和,这不是"体验待优化",
 *   是对外说假话。
 *
 * 所以这里改成:从 GitHub Releases API 取**真实**的最新 release 与它的
 * 资产清单,校验和从 release 附带的 `SHA256SUMS.txt` 里解析。
 * 没有 release 时,页面如实显示"尚无发布版本",并给出从源码构建的路径 ——
 * 而不是继续展示编造的文件名。
 *
 * 客户端组件请勿引用(用了 node:crypto / node:fs,会污染 client bundle)。
 */

const REPO_OWNER = 'louloulin';
const REPO_NAME = 'OpenBuddy';
const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;

export type ReleasePlatform = 'mac' | 'windows' | 'linux';

export interface ReleaseAsset {
  /** 资产文件名(来自 GitHub,原样) */
  name: string;
  platform: ReleasePlatform;
  /** 'x64' / 'arm64' / 'universal' / '' */
  arch: string;
  sizeBytes: number;
  downloadUrl: string;
  /** 来自 SHA256SUMS.txt;没有对应条目时为 null */
  sha256: string | null;
}

export interface ReleaseInfo {
  /** 没有 release 时为 null */
  tag: string | null;
  htmlUrl: string | null;
  publishedAt: string | null;
  isDraft: boolean;
  isPrerelease: boolean;
  assets: ReleaseAsset[];
  /** SHA256SUMS.txt 是否存在 */
  hasChecksums: boolean;
}

interface GhAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface GhRelease {
  tag_name: string;
  html_url: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
  assets: GhAsset[];
}

const EMPTY: ReleaseInfo = {
  tag: null,
  htmlUrl: null,
  publishedAt: null,
  isDraft: false,
  isPrerelease: false,
  assets: [],
  hasChecksums: false
};

/** 判定资产属于哪个平台。返回 null 表示不是可下载的安装包(源码包等)。 */
export function classifyAsset(name: string): { platform: ReleasePlatform; arch: string } | null {
  const lower = name.toLowerCase();

  // 源码包 / 校验和文件本身不算平台安装包
  if (/source|sha256sums|checksums/i.test(lower)) return null;
  if (lower.endsWith('.tar.gz') || lower.endsWith('.txt')) return null;

  const arch = lower.includes('arm64') ? 'arm64' : lower.includes('x64') || lower.includes('amd64') ? 'x64' : '';

  if (lower.endsWith('.dmg') || lower.includes('macos') || lower.includes('mac-')) {
    return { platform: 'mac', arch };
  }
  if (lower.endsWith('.exe') || lower.includes('-win') || lower.includes('windows')) {
    return { platform: 'windows', arch };
  }
  if (lower.endsWith('.appimage') || lower.endsWith('.deb') || lower.endsWith('.rpm')) {
    return { platform: 'linux', arch };
  }
  return null;
}

/** 解析 `SHA256SUMS.txt`(`<hash>  <name>` 每行一条)。 */
export function parseChecksums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m) map.set(m[2].trim(), m[1].toLowerCase());
  }
  return map;
}

/** 把 release 资产 + 校验和合成下载页需要的结构。 */
export function toReleaseInfo(
  release: GhRelease | null,
  checksums: Map<string, string>
): ReleaseInfo {
  if (!release) return { ...EMPTY };
  const assets: ReleaseAsset[] = [];
  for (const asset of release.assets ?? []) {
    const kind = classifyAsset(asset.name);
    if (!kind) continue;
    assets.push({
      name: asset.name,
      platform: kind.platform,
      arch: kind.arch,
      sizeBytes: asset.size ?? 0,
      downloadUrl: asset.browser_download_url,
      sha256: checksums.get(asset.name) ?? null
    });
  }
  return {
    tag: release.tag_name,
    htmlUrl: release.html_url,
    publishedAt: release.published_at,
    isDraft: release.draft,
    isPrerelease: release.prerelease,
    assets,
    hasChecksums: checksums.size > 0
  };
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'openbuddy-website'
      },
      next: { revalidate: 300 }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * 取最新 release(不含 draft)。
 *
 * 注意:GitHub 的 `/releases/latest` **不会**返回 draft release,也不会返回
 * prerelease。如果将来发的是 draft(P1-1 的 unsigned 首版就是 draft),
 * 这个接口拿不到 —— 所以这里再查一次 `/releases` 列表,自己挑:
 * 优先正式 release,其次 prerelease;draft 一律不展示(还没发布的东西
 * 不该出现在下载页)。
 */
export async function getLatestRelease(): Promise<ReleaseInfo> {
  const list = (await fetchJson(`${API_BASE}/releases?per_page=10`)) as GhRelease[] | null;
  const releases = Array.isArray(list) ? list : [];
  const visible = releases.filter((r) => !r.draft);
  const release =
    visible.find((r) => !r.prerelease) ??
    visible.find((r) => r.prerelease) ??
    null;

  if (!release) return { ...EMPTY };

  // 校验和:优先从 release 自己的 SHA256SUMS.txt 资产里取
  const sumsAsset = (release.assets ?? []).find((a) => /sha256sums/i.test(a.name));
  let checksums = new Map<string, string>();
  if (sumsAsset) {
    try {
      const res = await fetch(sumsAsset.browser_download_url, { next: { revalidate: 300 } });
      if (res.ok) checksums = parseChecksums(await res.text());
    } catch {
      /* 没有校验和就如实显示 null */
    }
  }

  return toReleaseInfo(release, checksums);
}

/** 把字节数格式化成人类可读(MB / GB,一位小数)。 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** 对下载页做一次完整性自检:资产 URL 必须是 github.com 的 release 资产。 */
export function isTrustedDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'github.com' || parsed.hostname === 'objects.githubusercontent.com';
  } catch {
    return false;
  }
}
