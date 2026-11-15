/**
 * One registry for every keyboard shortcut (20261115-ui §5.10 / U8.2). Handlers match through
 * `matchShortcut`, and 设置·快捷键 plus the Ctrl/Cmd+/ panel are generated from this list,
 * so what is shown is exactly what works.
 */
export type ShortcutScope = "全局" | "对话" | "输入框" | "工作台";
export type ShortcutId =
  | "newTask" | "search" | "settings" | "toggleSidebar" | "shortcuts"
  | "find" | "copyLast" | "togglePanel"
  | "send" | "newline" | "steer" | "stop" | "history" | "slash" | "cycleModel"
  | "save";
export interface Shortcut {
  id: ShortcutId;
  /** Display tokens; "Mod" is ⌘ on macOS and Ctrl elsewhere. */
  keys: string[];
  label: string;
  scope: ShortcutScope;
}

export const SHORTCUTS: Shortcut[] = [
  { id: "newTask", keys: ["Mod", "N"], label: "新建任务", scope: "全局" },
  { id: "search", keys: ["Mod", "K"], label: "搜索任务", scope: "全局" },
  { id: "settings", keys: ["Mod", ","], label: "打开设置", scope: "全局" },
  { id: "toggleSidebar", keys: ["Mod", "B"], label: "展开 / 收起侧边栏", scope: "全局" },
  { id: "shortcuts", keys: ["Mod", "/"], label: "快捷键一览", scope: "全局" },
  { id: "find", keys: ["Mod", "F"], label: "在对话中查找", scope: "对话" },
  { id: "copyLast", keys: ["Mod", "Shift", "C"], label: "复制最后一条回答", scope: "对话" },
  { id: "togglePanel", keys: ["Mod", "\\"], label: "展开 / 收起工作台", scope: "对话" },
  { id: "send", keys: ["Enter"], label: "发送（回复中则加入队列）", scope: "输入框" },
  { id: "newline", keys: ["Shift", "Enter"], label: "换行", scope: "输入框" },
  { id: "steer", keys: ["Mod", "Enter"], label: "回复中立即插话", scope: "输入框" },
  { id: "stop", keys: ["Esc"], label: "停止回复", scope: "输入框" },
  { id: "history", keys: ["↑"], label: "调出上一条提问（光标在开头时）", scope: "输入框" },
  { id: "slash", keys: ["/"], label: "技能与命令", scope: "输入框" },
  { id: "cycleModel", keys: ["Mod", "P"], label: "在收藏的模型间切换", scope: "输入框" },
  { id: "save", keys: ["Mod", "S"], label: "保存正在编辑的文件", scope: "工作台" },
];

export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");

export function keyLabel(key: string, mac = IS_MAC): string {
  if (key === "Mod") return mac ? "⌘" : "Ctrl";
  if (key === "Shift") return mac ? "⇧" : "Shift";
  if (key === "Alt") return mac ? "⌥" : "Alt";
  return key;
}

const byId = new Map(SHORTCUTS.map((s) => [s.id, s]));

/** Whether a keydown is this shortcut (Mod accepts Ctrl or ⌘; Shift / Alt must match exactly). */
export function matchShortcut(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">, id: ShortcutId): boolean {
  const s = byId.get(id);
  if (!s) return false;
  const mod = s.keys.includes("Mod"), shift = s.keys.includes("Shift");
  if (mod !== (e.ctrlKey || e.metaKey) || shift !== e.shiftKey || e.altKey) return false;
  const key = s.keys[s.keys.length - 1];
  const pressed = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === "Esc") return pressed === "Escape";
  if (key === "↑") return pressed === "ArrowUp";
  // Shift+/ is "?" on most layouts; "/" with Mod only.
  return pressed === key.toLowerCase();
}
