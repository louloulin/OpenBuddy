/**
 * @openbuddy/ui-shell/ShortcutHint — 平台自适应的快捷键 <kbd> 展示。
 *
 * 背景:WorkBuddy / cabinet 的菜单里都直接把快捷键 glyph 排在动作文案右侧,
 * 但两边的写法各不相同(Mac 用 ⌘⇧P,Win/Linux 用 Ctrl+Shift+P)。本组件把
 * "和弦描述" 与 "平台渲染" 拆开:
 *
 *   <ShortcutHint chord="mod+shift+p" />                    → ⌘ ⇧ P(或 Ctrl Shift P)
 *   <ShortcutHint chord={{ keys: ["ctrl", "k"], mac: ["cmd", "k"] }} />
 *
 * 纯函数 `formatShortcut(chord, platform)` 负责映射,可独立单测;
 * 组件只做 <kbd> 包裹 + aria-label。
 *
 * 平台判定在 jsdom 下会回落到 "other"(非 Mac),这样测试断言稳定。
 */
import styles from "./ShortcutHint.module.css";

export type ShortcutPlatform = "mac" | "other";

/** 对象形式的和弦:通用键位 + 可选的 macOS 专有键位。 */
export interface ShortcutChordSpec {
  keys: string[];
  mac?: string[];
}

/** 简单形式是 "mod+shift+p",对象形式见 `ShortcutChordSpec`。 */
export type ShortcutChord = string | ShortcutChordSpec;

const MAC_SYMBOLS: Record<string, string> = {
  mod: "⌘",
  cmd: "⌘",
  command: "⌘",
  meta: "⌘",
  super: "⌘",
  win: "⌘",
  ctrl: "⌃",
  control: "⌃",
  alt: "⌥",
  option: "⌥",
  opt: "⌥",
  shift: "⇧",
  enter: "↵",
  return: "↵",
  esc: "⎋",
  escape: "⎋",
  tab: "⇥",
  backspace: "⌫",
  delete: "⌦",
  del: "⌫",
  space: "␣",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  pageup: "⇞",
  pagedown: "⇟",
  home: "↖",
  end: "↘",
};

const OTHER_LABELS: Record<string, string> = {
  mod: "Ctrl",
  cmd: "Ctrl",
  command: "Ctrl",
  meta: "Ctrl",
  super: "Win",
  win: "Win",
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  opt: "Alt",
  shift: "Shift",
  enter: "Enter",
  return: "Enter",
  esc: "Esc",
  escape: "Esc",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Del",
  del: "Del",
  space: "Space",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  pageup: "PgUp",
  pagedown: "PgDn",
  home: "Home",
  end: "End",
};

/**
 * 判定当前运行平台。任何非 Mac 环境(含 jsdom / Node)都返回 "other",
 * 保证在没有 navigator 的宿主里也不会误判成 Mac。
 */
export function detectShortcutPlatform(): ShortcutPlatform {
  if (typeof navigator === "undefined") return "other";
  const probe = `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  return /Mac|iPhone|iPad|iPod/i.test(probe) ? "mac" : "other";
}

function formatKey(key: string, platform: ShortcutPlatform): string {
  const lower = key.trim().toLowerCase();
  if (!lower) return "";
  const table = platform === "mac" ? MAC_SYMBOLS : OTHER_LABELS;
  const mapped = table[lower];
  if (mapped) return mapped;
  if (/^f\d{1,2}$/.test(lower)) return lower.toUpperCase();
  if (lower.length === 1) return lower.toUpperCase();
  // 未知键位原样保留(例如 "F13"、"Backquote"),避免显示成空白。
  return key.trim();
}

/**
 * 把和弦解析成逐键的展示数组(每个元素对应一个 <kbd>)。
 *
 *   formatShortcut("mod+shift+p", "mac")   → ["⌘", "⇧", "P"]
 *   formatShortcut("mod+shift+p", "other") → ["Ctrl", "Shift", "P"]
 */
export function formatShortcut(
  chord: ShortcutChord,
  platform: ShortcutPlatform = detectShortcutPlatform(),
): string[] {
  const raw =
    typeof chord === "string"
      ? chord.split("+")
      : platform === "mac" && chord.mac && chord.mac.length > 0
        ? chord.mac
        : chord.keys;
  return raw.map((key) => formatKey(String(key), platform)).filter(Boolean);
}

export interface ShortcutHintProps {
  chord: ShortcutChord;
  /** 覆盖平台判定(测试 / 预览场景)。 */
  platform?: ShortcutPlatform;
  className?: string;
  /** 渲染纯文本而不是 <kbd>(用于紧凑的 tooltip 文案)。 */
  plain?: boolean;
}

export function ShortcutHint({ chord, platform, className, plain }: ShortcutHintProps) {
  const keys = formatShortcut(chord, platform ?? detectShortcutPlatform());
  if (keys.length === 0) return null;
  const text = keys.join("+");
  return (
    <span
      className={styles.hint + (className ? " " + className : "")}
      data-shortcut={text}
      aria-label={`快捷键 ${keys.join(" ")}`}
    >
      {keys.map((k, i) =>
        plain ? (
          <span key={`${k}-${i}`} className={styles.plain}>
            {k}
          </span>
        ) : (
          <kbd key={`${k}-${i}`} className={styles.key}>
            {k}
          </kbd>
        ),
      )}
    </span>
  );
}
