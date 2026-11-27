import type { AppEntry } from "./manifest.js";

/**
 * 标准应用结构 (2026-11-27)。
 *
 * 所有应用（内置 OpenBuddy、UpUp、第三方包）都走同一份标准：
 *
 *   <app root>/
 *     package.json        # name/version + pi.app { kind, tagline, category, icon, scenes, toolPolicy }
 *     scenes.json         # 可选，pi.app.scenes 指向它
 *     icon.png|svg|webp   # 可选，pi.app.icon 指向它
 *     extensions/         # Pi 扩展入口（package.json#pi.extensions）
 *     skills/ prompts/    # Pi 资源
 *
 * `pi.app` 是唯一权威声明；没有它 = 普通扩展包（kind: "extension"）。
 * 内置应用没有包目录，用同一 `AppEntry` 形状在内存里构造，因此 UI 只认一种结构。
 */

/** 默认应用（UpUp）的官方安装源；与 `pi install <url>` 等价。 */
export const DEFAULT_APP_SOURCE = "https://gitcode.com/lumosaigroup/upup.git";

export interface AppStandardViolation {
  field: string;
  message: string;
}

const isNonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/**
 * 校验一个 `AppEntry` 是否符合标准结构。
 *
 * 只报"声明了但结构不对"的项；缺省字段（tagline/icon/scenes/toolPolicy）是可选的，
 * 不视为违规——但一旦声明就必须是正确类型。
 */
export function validateAppEntry(entry: AppEntry): AppStandardViolation[] {
  const issues: AppStandardViolation[] = [];
  if (!isNonEmpty(entry.id)) issues.push({ field: "id", message: "应用必须有非空 id" });
  if (!isNonEmpty(entry.name)) issues.push({ field: "name", message: "应用必须有非空 name" });
  if (entry.source === "builtin") {
    if (entry.packageSource || entry.installedPath) issues.push({ field: "source", message: "内置应用不应带安装路径" });
  } else {
    if (!isNonEmpty(entry.packageSource) && !isNonEmpty(entry.installedPath))
      issues.push({ field: "packageSource", message: "外部应用必须有安装源或安装路径" });
  }
  if (entry.kind === "app" && !isNonEmpty(entry.tagline))
    issues.push({ field: "tagline", message: "kind=app 的应用必须有一句话定位" });
  if (entry.icon !== undefined && !isNonEmpty(entry.icon)) issues.push({ field: "icon", message: "icon 必须是非空相对路径" });
  if (entry.icon && (entry.icon.startsWith("/") || entry.icon.includes("..")))
    issues.push({ field: "icon", message: "icon 必须是包内相对路径且不能越界" });
  for (const scene of entry.sceneList ?? []) {
    if (!isNonEmpty(scene.id) || !isNonEmpty(scene.name) || !isNonEmpty(scene.prompt))
      issues.push({ field: "sceneList", message: `场景 ${scene.id || "?"} 缺 id/name/prompt` });
  }
  const policy = entry.toolPolicy;
  for (const key of ["readonly", "deny"] as const) {
    for (const name of policy?.[key] ?? []) {
      if (!isNonEmpty(name)) issues.push({ field: `toolPolicy.${key}`, message: "工具名不能为空" });
    }
  }
  return issues;
}

export const isStandardApp = (entry: AppEntry): boolean => validateAppEntry(entry).length === 0;
