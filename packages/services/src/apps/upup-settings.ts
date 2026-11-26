import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * UpUp 插件开关 (20261126-upup UP-1.2 / UP-1.3)。
 *
 * UpUp 的 dispatcher 从 `<agentDir>/settings.json` 的 `upupPlugins` 读取要关掉的子包，
 * 而 `<agentDir>` 由 `UPUP_CODING_AGENT_DIR`（引擎已指向本应用的 settings 目录）决定。
 * 这里只**合并**这个键，不覆盖文件里的其它内容——那个 settings.json 可能还放着
 * 别的 Pi 宿主字段。
 */
export const UPUP_SETTINGS_FILE = "settings.json";

/**
 * 默认关闭的子包（目录名）。只放"确定与 OpenBuddy 重复或涉及账户"的：
 * - pi-portfolio 组合/持仓
 * - pi-notify 通知（OpenBuddy 有自己的通知渠道）
 * - pi-mobile-host-extension 手机宿主（OpenBuddy 有自己的手机接入）
 * - pi-openminis-skills-bridge 技能桥（与 OpenBuddy 技能体系重复）
 *
 * pi-config / pi-cache / pi-management 是别的子包的运行时依赖，默认不动，
 * 由实测决定；pi-finance-sdk 保持启用并靠 toolPolicy deny 交易工具。
 */
export const UPUP_DEFAULT_DISABLED = [
  "pi-portfolio",
  "pi-notify",
  "pi-mobile-host-extension",
  "pi-openminis-skills-bridge",
] as const;

export interface UpupPluginsState {
  /** Keys as UpUp stores them (`@upup/<dir>` or bare directory). */
  disabled: string[];
  enabled: string[];
  /** Where the switches live, so the UI can show the real file. */
  settingsPath: string;
  defaults: string[];
  /** True when the file exists (UpUp will read it). */
  settingsExists: boolean;
}

function settingsPathFor(agentDir: string): string {
  return join(agentDir, UPUP_SETTINGS_FILE);
}

/** UpUp 规范化：`@upup/<dir>`；这里写入时统一成这个形式。 */
export function normalizeUpupKey(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  const stripped = raw.toLowerCase().startsWith("builtin:") ? raw.slice("builtin:".length) : raw;
  return stripped.toLowerCase().startsWith("@upup/") ? stripped.toLowerCase() : `@upup/${stripped}`.toLowerCase();
}

export function readUpupPlugins(agentDir: string): UpupPluginsState {
  const settingsPath = settingsPathFor(agentDir);
  const state: UpupPluginsState = {
    disabled: [],
    enabled: [],
    settingsPath,
    defaults: [...UPUP_DEFAULT_DISABLED],
    settingsExists: existsSync(settingsPath),
  };
  if (!state.settingsExists) return state;
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as { upupPlugins?: unknown };
    const node = parsed?.upupPlugins;
    if (!node || typeof node !== "object" || Array.isArray(node)) return state;
    const pick = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string").map(normalizeUpupKey).filter(Boolean)
        : [];
    state.disabled = pick((node as Record<string, unknown>).disabled);
    state.enabled = pick((node as Record<string, unknown>).enabled);
  } catch {
    /* 坏 JSON：当作没有开关，避免把引擎带崩 */
  }
  return state;
}

/** 只改 `upupPlugins`，保留文件里的其它键；返回写入后的状态。 */
export function writeUpupPlugins(agentDir: string, next: { disabled?: string[]; enabled?: string[] }): UpupPluginsState {
  const settingsPath = settingsPathFor(agentDir);
  let current: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
    } catch {
      /* 坏文件：覆盖成一个只含 upupPlugins 的合法文件 */
    }
  }
  // 只改调用方给的那一项：没传 enabled 就保留文件里原有的 enabled（反之亦然）。
  const previousNode =
    current.upupPlugins && typeof current.upupPlugins === "object" && !Array.isArray(current.upupPlugins)
      ? (current.upupPlugins as { disabled?: unknown; enabled?: unknown })
      : {};
  const previous = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map(normalizeUpupKey).filter(Boolean) : [];
  const upupPlugins: Record<string, string[]> = {};
  const disabled = [...new Set((next.disabled ?? previous(previousNode.disabled)).map(normalizeUpupKey).filter(Boolean))];
  const enabled = [...new Set((next.enabled ?? previous(previousNode.enabled)).map(normalizeUpupKey).filter(Boolean))];
  if (disabled.length) upupPlugins.disabled = disabled;
  if (enabled.length) upupPlugins.enabled = enabled;
  const merged = { ...current, upupPlugins };
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  return readUpupPlugins(agentDir);
}
