import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { commandsList } from "@/lib/agent-client";
import type { SlashCommand } from "@/lib/types";

/**
 * The "/xxx" token being typed at the cursor, or null. A slash only opens the
 * menu at the start of a token (start of text or after whitespace), so paths
 * like "src/app" or URLs never trigger it.
 */
/** Where a command comes from, in the UI's words. */
const SOURCE_LABELS: Record<string, string> = { builtin: "内置", extension: "扩展", skill: "技能", prompt: "模板" };

export function slashToken(text: string, cursor: number): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const match = before.match(/(^|\s)\/([^\s/]*)$/);
  if (!match) return null;
  const start = before.length - match[2].length - 1;
  return { start, query: match[2] };
}

export interface SlashCommandsHandle {
  /** Route a key to the menu; true when the menu consumed it. */
  handleKey: (e: { key: string; preventDefault: () => void }) => boolean;
}

interface SlashCommandsProps {
  /** 当前的输入文本（Composer 的 value）。 */
  text: string;
  /** 光标位置。 */
  cursor: number;
  /** Menu is suppressed (streaming, not ready). */
  disabled?: boolean;
  /** 选中某命令时的回调，参数是完整命令文本（如 "/commit"）。 */
  onPick: (command: string) => void;
}

const MAX_ITEMS = 12;

export const SlashCommands = forwardRef<SlashCommandsHandle, SlashCommandsProps>(function SlashCommands(
  { text, cursor, disabled, onPick },
  ref,
) {
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  // Escape hides the menu for the current token until it changes.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const loadedRef = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);

  const token = useMemo(() => slashToken(text, cursor), [text, cursor]);

  // Load lazily the first time a slash token appears so new extensions show up.
  useEffect(() => {
    if (!token || loadedRef.current) return;
    loadedRef.current = true;
    commandsList()
      .then(setCommands)
      .catch(() => {
        loadedRef.current = false;
        setCommands([]);
      });
  }, [token]);

  const matches = useMemo(() => {
    if (!token) return [] as SlashCommand[];
    const q = token.query.toLowerCase();
    if (!q) return commands.slice(0, MAX_ITEMS);
    const prefix = commands.filter((c) => c.name.toLowerCase().startsWith(q));
    const rest = commands.filter(
      (c) =>
        !c.name.toLowerCase().startsWith(q) &&
        (c.name.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q)),
    );
    return [...prefix, ...rest].slice(0, MAX_ITEMS);
  }, [token, commands]);

  const visible = !disabled && !!token && matches.length > 0 && dismissedAt !== token.start;

  useEffect(() => {
    setActiveIdx(0);
  }, [token?.query]);

  useEffect(() => {
    if (dismissedAt !== null && token?.start !== dismissedAt) setDismissedAt(null);
  }, [token?.start, dismissedAt]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(".slash-commands__item--active")?.scrollIntoView?.({ block: "nearest" });
  }, [activeIdx]);

  useImperativeHandle(
    ref,
    () => ({
      handleKey: (e) => {
        if (!visible) return false;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIdx((i) => (i + 1) % matches.length);
          return true;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIdx((i) => (i - 1 + matches.length) % matches.length);
          return true;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const cmd = matches[Math.min(activeIdx, matches.length - 1)];
          if (cmd) onPick(`/${cmd.name}`);
          return true;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setDismissedAt(token!.start);
          return true;
        }
        return false;
      },
    }),
    [visible, matches, activeIdx, onPick, token],
  );

  if (!visible) return null;

  return (
    <div className="slash-commands" role="listbox" aria-label="可用命令">
      <div className="slash-commands__header">可用命令 · ↑↓ 选择 · Enter 确认 · Esc 关闭</div>
      <ul className="slash-commands__list" ref={listRef}>
        {matches.map((cmd, idx) => (
          <li key={cmd.name}>
            <button
              type="button"
              role="option"
              aria-selected={idx === activeIdx}
              className={`slash-commands__item ${idx === activeIdx ? "slash-commands__item--active" : ""}`}
              // Keep focus in the textarea so the caret position survives the click.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(`/${cmd.name}`)}
              onMouseEnter={() => setActiveIdx(idx)}
            >
              <span className="slash-commands__name">/{cmd.name}</span>
              {cmd.description && <span className="slash-commands__desc">{cmd.description}</span>}
              {cmd.source && <span className="slash-commands__source">{SOURCE_LABELS[cmd.source] ?? cmd.source}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
});
