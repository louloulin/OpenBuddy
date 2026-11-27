import { BUILTIN_APP_ID, builtinApp } from "./builtin.js";
import { readAppEntry, type AppEntry } from "./manifest.js";

/** `extensionPackages()` 的一项（只用到这几个字段）。 */
export interface InstalledPackage {
  source: string;
  installedPath?: string;
  /** Pi 的资源过滤；`extensions: false` 表示应用被整体停用。 */
  filters?: { extensions?: unknown };
}

/**
 * 全部应用 (UP-2.2)：内置永远第一，其后是 `pi.app` 的 Pi 包，没有 manifest 的记为扩展包。
 * 宿主的 `apps_list` 与引擎的 `ob_app_recommend` 共用这一份，保证推荐只来自真实安装的应用。
 */
export function collectApps(packages: InstalledPackage[]): AppEntry[] {
  const entries: AppEntry[] = [builtinApp()];
  for (const pkg of packages) {
    if (!pkg.installedPath) continue;
    const entry = readAppEntry(pkg.installedPath, "pi", pkg.source);
    if (entry) entries.push(entry);
  }
  // 内置 → 应用 → 扩展包；同 id@路径 只留一条。
  const rank = (entry: AppEntry) => (entry.id === BUILTIN_APP_ID ? 0 : entry.kind === "extension" ? 2 : 1);
  const seen = new Set<string>();
  return entries
    .sort((a, b) => rank(a) - rank(b))
    .filter((entry) => {
      const key = `${entry.id}@${entry.installedPath ?? entry.source}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** 应用是否启用：Pi 包把扩展资源过滤成 `false` 时视为停用；内置应用永远启用。 */
export function appEnabled(app: AppEntry, packages: InstalledPackage[]): boolean {
  if (!app.packageSource) return true;
  const pkg = packages.find((item) => item.source === app.packageSource);
  return pkg?.filters?.extensions !== false;
}
