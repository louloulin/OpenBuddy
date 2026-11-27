/**
 * 应用安装来源记录与回滚 (20261127-upup U6)。
 *
 * 升级前不知道"原来是什么版本"，失败后只能卸载重装——这里把每次安装/更新后的
 * `{source, version, commit}` 记进宿主设置，升级时保留上一份，回滚即按记录的
 * commit 重新安装（Git 源用 `#<sha>` 固定；npm/本地源按原 source 重装）。
 *
 * 纯声明式数据与字符串处理：git 读取在宿主侧完成，UI 只消费类型。
 */
export interface AppInstallRecord {
  /** Configured install source (may carry a `#ref`). */
  source: string;
  /** `package.json#version` when readable. */
  version?: string;
  /** Git HEAD sha for git installs. */
  commit?: string;
  /** ISO timestamp when this state was observed. */
  at: string;
}

export interface AppInstallHistory {
  current: AppInstallRecord;
  /** The state before the most recent update; absent after a fresh install/rollback. */
  previous?: AppInstallRecord;
}

/** 去重键：同一个仓库的普通源与固定 ref 视为同一个应用（Pi 的 ref 写法是 `@ref`）。 */
export const installKey = (source: string): string =>
  source.replace(/#.*$/, "").replace(/@[^/@]+$/, "");

export const isGitSource = (source: string): boolean =>
  /^(?:git:|git@|ssh:\/\/)/i.test(source) || /^https?:\/\/.+\.git(?:[#@].*)?$/i.test(source) || /^https?:\/\/gitcode\.com\//i.test(source);

/**
 * 把 Git 源固定到某个 commit。
 *
 * Pi 的解析规则：GitHub 等托管站点认 `#ref`，通用 URL 只认 `@ref`（实测 2026-11-27，
 * `#` 会被并进 clone URL）；统一用 `@`，两处都能到达固定版本。
 */
export function pinSource(source: string, commit: string): string {
  return `${installKey(source)}@${commit}`;
}

/** 回滚时需要重新安装的源；没有上一份记录、或 Git 源缺少 commit 时返回 null。 */
export function rollbackSource(history: AppInstallHistory | undefined): string | null {
  const previous = history?.previous;
  if (!previous) return null;
  if (previous.commit) return pinSource(previous.source, previous.commit);
  // Git 源没有 commit 就无法回到旧版本；npm/local 直接按原 source 重装。
  return isGitSource(previous.source) ? null : previous.source;
}

const sameState = (a: AppInstallRecord, b: AppInstallRecord): boolean =>
  a.source === b.source && (a.commit ?? "") === (b.commit ?? "") && (a.version ?? "") === (b.version ?? "");

/**
 * 记录一次安装/更新。内容没变时保留原有的 previous，避免连续检查更新把回滚目标覆盖掉。
 */
export function recordInstall(existing: AppInstallHistory | undefined, next: AppInstallRecord): AppInstallHistory {
  if (existing && sameState(existing.current, next)) return existing;
  const previous = existing?.current;
  return previous ? { current: next, previous } : { current: next };
}

/**
 * 升级前后各拍一次快照：内容变了就把升级前的状态记为回滚目标，
 * 这样第一次更新后 UI 立刻就能「回滚到上一版本」，不必等第二次更新。
 */
export function recordUpdate(
  before: AppInstallRecord | undefined,
  after: AppInstallRecord | undefined,
  existing?: AppInstallHistory,
): AppInstallHistory | undefined {
  if (!after) return existing;
  if (existing && sameState(existing.current, after)) return existing;
  if (before && !sameState(before, after)) return { current: after, previous: before };
  return recordInstall(existing, after);
}

/** 回滚成功后：当前 = 旧记录，previous 清空（避免来回互换）。 */
export function afterRollback(record: AppInstallRecord): AppInstallHistory {
  return { current: record };
}
