import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 应用 manifest (20261126-upup UP-2.1)。
 *
 * Pi 只读 `pi.extensions / skills / prompts / themes`；OpenBuddy 另读可选的 `pi.app`：
 * 有它就是"应用"（有卡片、可整体启停），没有就只是普通扩展包。字段全部可选，
 * 坏 JSON 或字段类型不对时**降级为普通扩展包**，绝不让一个坏 manifest 拖垮列表。
 */
export type AppKind = "app" | "connector" | "skill-pack" | "extension";

export interface AppEntry {
  id: string;
  name: string;
  version?: string;
  kind: AppKind;
  /**
   * `pi` = Pi 包；`pack` = 能力包（WorkBuddy 插件包导入）；`builtin` = 宿主内置应用
   * （OpenBuddy 自己，无安装路径、不可启停）。
   */
  source: "pi" | "pack" | "builtin";
  /** Where the package lives (Pi packages only). */
  installedPath?: string;
  /** The configured package source string (what `agent_extensions_*` commands take). */
  packageSource?: string;
  tagline?: string;
  category?: string;
  /** Icon path relative to the package root (NOT read here; the UI resolves it). */
  icon?: string;
  toolPolicy?: { readonly?: string[]; deny?: string[] };
  /** `pi.app.scenes` 指向的 scenes.json（相对包根）。 */
  scenes?: string;
  /** 解析后的场景卡（没有 scenes.json 或文件坏掉时为空数组）。 */
  sceneList?: AppScene[];
}

/** 应用自带场景 (UP-4.1)：选中即把 prompt 填进输入框，由用户确认后发送。 */
export interface AppScene {
  id: string;
  name: string;
  group?: string;
  prompt: string;
}

const KINDS: AppKind[] = ["app", "connector", "skill-pack", "extension"];

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item.trim()).map((item) => item.trim()) : undefined;

function policyOf(value: unknown): AppEntry["toolPolicy"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const readonly = strings(record.readonly);
  const deny = strings(record.deny);
  return readonly || deny ? { ...(readonly ? { readonly } : {}), ...(deny ? { deny } : {}) } : undefined;
}

/** 读包内 scenes.json；坏文件/坏结构一律返回空数组，绝不抛错。 */
export function readAppScenes(pkgRoot: string, relative: string): AppScene[] {
  const path = join(pkgRoot, relative);
  if (!existsSync(path)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : (raw as { scenes?: unknown } | null)?.scenes;
  if (!Array.isArray(list)) return [];
  const scenes: AppScene[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.name !== "string" || typeof record.prompt !== "string") continue;
    if (!record.id.trim() || !record.name.trim() || !record.prompt.trim()) continue;
    scenes.push({
      id: record.id.trim().slice(0, 64),
      name: record.name.trim().slice(0, 40),
      ...(typeof record.group === "string" && record.group.trim() ? { group: record.group.trim().slice(0, 24) } : {}),
      prompt: record.prompt,
    });
  }
  return scenes.slice(0, 24);
}

/** 读一个 Pi 包目录；目录没有 package.json 时返回 null（调用方跳过）。 */
export function readAppEntry(pkgRoot: string, source = "pi", packageSource?: string): AppEntry | null {
  const manifestPath = join(pkgRoot, "package.json");
  if (!existsSync(manifestPath)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const pkg = raw as Record<string, unknown>;
  const name = typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : pkgRoot.split(/[\\/]/).pop() ?? pkgRoot;
  const version = typeof pkg.version === "string" ? pkg.version : undefined;
  const pi = pkg.pi && typeof pkg.pi === "object" && !Array.isArray(pkg.pi) ? (pkg.pi as Record<string, unknown>) : {};
  const app = pi.app && typeof pi.app === "object" && !Array.isArray(pi.app) ? (pi.app as Record<string, unknown>) : undefined;
  const kind: AppKind = app && typeof app.kind === "string" && KINDS.includes(app.kind as AppKind) ? (app.kind as AppKind) : app ? "app" : "extension";
  return {
    id: name,
    name,
    ...(version ? { version } : {}),
    kind,
    source: source as AppEntry["source"],
    installedPath: pkgRoot,
    ...(packageSource ? { packageSource } : {}),
    ...(app && typeof app.tagline === "string" && app.tagline.trim() ? { tagline: app.tagline.trim() } : {}),
    ...(app && typeof app.category === "string" && app.category.trim() ? { category: app.category.trim() } : {}),
    ...(app && typeof app.icon === "string" && app.icon.trim() ? { icon: app.icon.trim() } : {}),
    ...(app && typeof app.scenes === "string" && app.scenes.trim()
      ? { scenes: app.scenes.trim(), sceneList: readAppScenes(pkgRoot, app.scenes.trim()) }
      : {}),
    ...(app && policyOf(app.toolPolicy) ? { toolPolicy: policyOf(app.toolPolicy) } : {}),
  };
}
