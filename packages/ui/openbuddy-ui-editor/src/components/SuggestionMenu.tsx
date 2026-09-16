/**
 * SuggestionMenu —— `/` 与 `@` 共用的补全列表。
 *
 * 纯展示 + 受控高亮:键盘事件由 suggestion 扩展处理,本组件只负责渲染,
 * 因此可以在 jsdom 里直接单测(不需要真实编辑器)。
 */
import { useEffect, useRef } from "react";
import { groupSlashCommands, type EditorSlashCommand } from "../lib/slash-command";
import styles from "./SuggestionMenu.module.css";

export interface SuggestionMenuProps {
  items: readonly EditorSlashCommand[];
  query: string;
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (command: EditorSlashCommand) => void;
  /** 无结果时的文案。 */
  emptyLabel?: string;
  /** 是否显示分组标题。 */
  grouped?: boolean;
  className?: string;
}

export function SuggestionMenu({
  items,
  query,
  activeIndex,
  onHover,
  onPick,
  emptyLabel = "没有匹配项",
  grouped = true,
  className,
}: SuggestionMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // 高亮项滚入视野 —— 与其它补全菜单一致的手感。
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    node?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  if (items.length === 0) {
    return (
      <div
        className={[styles.menu, className].filter(Boolean).join(" ")}
        role="listbox"
        aria-label="命令补全"
      >
        <div className={styles.empty}>{emptyLabel}</div>
      </div>
    );
  }

  let flatIndex = -1;
  const groups = grouped
    ? groupSlashCommands(items)
    : [{ group: "", commands: [...items] }];

  return (
    <div
      ref={listRef}
      className={[styles.menu, className].filter(Boolean).join(" ")}
      role="listbox"
      aria-label="命令补全"
      data-query={query}
    >
      {groups.map((group) => (
        <div className={styles.group} key={group.group || "__flat"}>
          {group.group ? <div className={styles.groupTitle}>{group.group}</div> : null}
          {group.commands.map((command) => {
            flatIndex += 1;
            const index = flatIndex;
            const active = index === activeIndex;
            return (
              <button
                type="button"
                key={command.id}
                data-index={index}
                role="option"
                aria-selected={active}
                className={active ? `${styles.item} ${styles.itemActive}` : styles.item}
                onMouseEnter={() => onHover(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(command)}
              >
                <span className={styles.icon} aria-hidden>
                  {command.icon}
                </span>
                <span className={styles.text}>
                  <span className={styles.title}>{command.title}</span>
                  {command.description ? (
                    <span className={styles.description}>{command.description}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
