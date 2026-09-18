/**
 * src/lib/changelog/app-changelog.ts
 *
 * 应用内更新日志的**唯一数据源**:构建期把仓库根的 `CHANGELOG.md` 内联进来,
 * 再用纯函数解析成结构化条目。发布流程不需要额外维护第二份 JSON —— CHANGELOG
 * 改完,应用内摘要自动跟着变。
 *
 * 同时提供"该不该弹更新摘要"的判定:只要用户上次看过的版本 ≠ 当前版本,就弹。
 * 判定写成纯函数(不读 localStorage),存储访问留在宿主侧,方便单测。
 */
import rawChangelog from "../../../CHANGELOG.md?raw";

import { parseChangelog, type ChangelogItem, type ChangelogRelease } from "./parse-changelog";

export type { ChangelogItem, ChangelogRelease };

/** 应用内展示的发布条目(最新在前)。 */
export const APP_RELEASES: readonly ChangelogRelease[] = parseChangelog(rawChangelog, {
  maxReleases: 4,
  maxItems: 6,
});

/** 取某个版本的条目。找不到时返回 undefined(版本号可能还没进 CHANGELOG)。 */
export function releaseFor(version: string): ChangelogRelease | undefined {
  return APP_RELEASES.find((release) => release.version === version);
}

/**
 * 当前版本在 CHANGELOG 里**已知**的条目(不一定是当前版本本身)。
 *
 * 为什么不是严格相等:开发期 `package.json` 的版本常常比 CHANGELOG 提前(先 bump
 * 再补日志),严格相等会让开发版永远弹不出摘要。取"最新的已知版本"既能覆盖这种情况,
 * 也不会把更老的历史重新弹一遍 —— 用户看过的版本号记在 `lastSeen` 里。
 */
export function latestKnownRelease(): ChangelogRelease | undefined {
  return APP_RELEASES[0];
}

export interface WhatsNewDecision {
  show: boolean;
  release?: ChangelogRelease;
}

/**
 * 判定是否要展示"本次更新"摘要。
 *
 * @param appVersion   当前应用版本(`package.json` 的 version)
 * @param lastSeenVersion 用户上次看过的版本(localStorage);从未看过传 undefined
 */
export function decideWhatsNew(
  appVersion: string,
  lastSeenVersion: string | null | undefined,
): WhatsNewDecision {
  const release = releaseFor(appVersion) ?? latestKnownRelease();
  if (!release) return { show: false };
  if (lastSeenVersion === release.version) return { show: false };
  // 首次安装(没有任何记录)也不弹 —— 首启已经有引导向导,two 层浮层叠一起
  // 会挡住用户真正要看的首页。摘要只在"从旧版本升上来"时出现。
  if (!lastSeenVersion) return { show: false, release };
  return { show: true, release };
}

export const WHATS_NEW_STORAGE_KEY = "openbuddy.whats-new.lastSeen";
