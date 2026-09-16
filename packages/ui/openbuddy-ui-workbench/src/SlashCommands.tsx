/**
 * Slash 命令补全菜单 - Composer 输入 / 时弹出
 *
 * 数据来自 pi 的 `x.ai/commands/list`（builtin + skills + plugins 注入的命令）。
 * 用户选中后会把命令名插入到 Composer 输入框。
 */
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { commandsList } from "@/lib/agent/pi-client";
import type { SlashCommand } from "@openbuddy/shared-types";
import { pluginCommandLabel, type PluginCommandPayload } from "./plugin-commands";
import { useRendererContributions } from "@/lib/runtime/renderer-plugin-runtime";

interface SlashCommandsProps {
  /** 当前的输入文本（Composer 的 value）。 */
  text: string;
  /** 光标位置。 */
  cursor: number;
  /** 选中某命令时的回调，参数是完整命令文本（如 "/commit"）。 */
  onPick: (command: string) => void;
  /** Textarea bounding rect (viewport coords). When provided, the menu is
   *  portaled to document.body with fixed positioning so it is never clipped
   *  by the composer input card's `overflow: hidden` and always floats above
   *  sibling toolbars (e.g. the + / skills / file picker row). */
  anchorRect?: DOMRect | null;
  /**
   * Plugin SDK 注册的命令(内核 `plugin.command` 的数据型 payload)。
   * 由宿主注入 —— 它们排在 Pi 命令之后,同名时 Pi 赢(与发送路径的保留名单一致)。
   */
  pluginCommands?: readonly PluginCommandPayload[];
}

/**
 * Pi 自带的命令。总是出现在补全菜单里,这样动态列表还没加载完时 picker 也是可用的。
 * 导出给宿主用:发送路径靠这份名单判断「这个 /xxx 归 Pi,插件不许截胡」。
 */
export const NATIVE_PI_COMMANDS: SlashCommand[] = [
  { name: "plan", description: "切换计划模式(让 agent 先写计划再执行)", source: "Pi" },
  { name: "fork", description: "从当前用户消息分叉出一个新会话", source: "Pi" },
  { name: "tree", description: "在会话树中浏览/导航(支持搜索和书签)", source: "Pi" },
  { name: "label", description: "为当前轮次添加书签(label)", source: "Pi" },
  { name: "compact", description: "手动压缩当前会话的上下文", source: "Pi" },
  { name: "reload", description: "热重载扩展、技能、主题和快捷键", source: "Pi" },
  { name: "session", description: "显示当前会话信息(id / 消息数 / tokens)", source: "Pi" },
];

export function SlashCommands({ text, cursor, onPick, anchorRect, pluginCommands }: SlashCommandsProps) {
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const pluginCommandContributions = useRendererContributions("command");
  const loadedRef = useRef(false);

  // Load commands once on mount.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    commandsList()
      .then(setCommands)
      .catch(() => setCommands([]));
  }, []);

  // Detect if the user just typed "/xxx" at the start of a token.
  const { visible, query, matches } = useMemo(() => {
    // Find the start of the current "word" (back to whitespace or start).
    const before = text.slice(0, cursor);
    const wordStart = before.search(/[/\S]*$/);
    if (wordStart === -1) {
      return { visible: false, query: "", matches: [] as SlashCommand[] };
    }
    const word = before.slice(wordStart);
    if (!word.startsWith("/") || word.includes(" ") || word.length < 1) {
      return { visible: false, query: "", matches: [] as SlashCommand[] };
    }
    const q = word.slice(1).toLowerCase();
    // 两类「插件」来源:
    //   - 渲染端 contribution:只是插入文本的模板(insertText);
    //   - Plugin SDK 命令(plugin.command):回车由插件在渲染端执行的动作。
    const contributionCommands = pluginCommandContributions.flatMap((contribution) => {
      const payload = contribution.payload;
      const raw = payload.command ?? payload.insertText;
      if (typeof raw !== "string") return [];
      const name = raw.replace(/^\//, "").split(/\s/, 1)[0];
      return name ? [{ name, description: payload.description, source: "插件", isAdapter: false, pluginContribution: contribution }] : [];
    });
    const sdkCommands = (pluginCommands ?? []).map((command) => ({
      name: command.id,
      description: pluginCommandLabel(command),
      source: "插件",
      isAdapter: false,
    }));
    // Pi 优先:同名时 Pi 的实现赢(发送路径用同一份名单判保留)。
    const available = [...NATIVE_PI_COMMANDS, ...commands, ...contributionCommands, ...sdkCommands].filter((command, index, list) =>
      list.findIndex((candidate) => candidate.name === command.name) === index,
    );
    const m = available.filter(
      (c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.description ?? "").toLowerCase().includes(q),
    );
    return { visible: m.length > 0, query: q, matches: m };
  }, [text, cursor, commands, pluginCommandContributions, pluginCommands]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Keyboard nav is handled by the parent Composer via onPick — we only
  // render; the Composer calls our handlers through refs below if needed.
  // Simpler approach: expose up/down/enter via window event the Composer can
  // dispatch. For now, click-only.

  if (!visible) return null;

  return createPortal(
    <div
      className="slash-commands"
      role="listbox"
      style={
        anchorRect
          ? {
              // Portal mode: disable CSS positioning (bottom/right/max-height
              // defined for absolute layout) and reposition as a fixed popup
              // anchored above the textarea. `maxHeight` is bounded by the
              // space above the textarea so the menu never overflows the
              // viewport top.
              position: "fixed",
              top: Math.max(8, anchorRect.top - 6 - Math.min(320, Math.max(120, anchorRect.top - 14))),
              left: anchorRect.left + 12,
              width: Math.max(280, anchorRect.width - 24),
              bottom: "auto",
              right: "auto",
              maxHeight: Math.min(320, Math.max(120, anchorRect.top - 14)),
              zIndex: 1100,
            }
          : undefined
      }
    >
      <div className="slash-commands__header">命令（来自 pi 内置/技能/插件）</div>
      <ul className="slash-commands__list">
        {matches.slice(0, 12).map((cmd, idx) => (
          <li key={cmd.name}>
            <button
              type="button"
              className={`slash-commands__item ${idx === activeIdx ? "slash-commands__item--active" : ""}`}
              onClick={() => {
                onPick(`/${cmd.name}`);
                const contribution = (cmd as SlashCommand & { pluginContribution?: { payload: { onActivate?: () => void } } }).pluginContribution;
                contribution?.payload.onActivate?.();
              }}
              onMouseEnter={() => setActiveIdx(idx)}
            >
              <span className="slash-commands__name">
                /{cmd.name}
                {cmd.isAdapter ? (
                  <span
                    className="slash-commands__adapter-badge"
                    title="OpenBuddy 把这个 Pi 扩展投影到 canonical 能力后端，handler 委托给 OpenBuddy 服务"
                    data-testid={`slash-cmd-adapter-${cmd.name}`}
                  >
                    Adapter
                  </span>
                ) : null}
              </span>
              {cmd.description && (
                <span className="slash-commands__desc">{cmd.description}</span>
              )}
              {cmd.source && (
                <span className="slash-commands__source">{cmd.source}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}

/** Expose a keyboard handler so the Composer can route ↑↓Enter to the menu.
 *  Returns true if the key was consumed. */
export function slashCommandsKeyHandler(
  e: KeyboardEvent,
  matchCount: number,
  activeIdx: number,
  setActiveIdx: (n: number) => void,
  onPickActive: () => void,
): boolean {
  if (matchCount === 0) return false;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    setActiveIdx((activeIdx + 1) % matchCount);
    return true;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    setActiveIdx((activeIdx - 1 + matchCount) % matchCount);
    return true;
  }
  if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    onPickActive();
    return true;
  }
  return false;
}
