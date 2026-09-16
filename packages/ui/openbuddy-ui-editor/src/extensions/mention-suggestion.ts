/**
 * mention-suggestion —— 在编辑器里输入 `@` 弹出候选并插入 mention 节点。
 *
 * 为什么不用 `@tiptap/extension-mention` 自带的 suggestion:
 *   - 官方 Mention 的 suggestion 会把选中项写回节点属性,但它只支持一条
 *     候选来源;OpenBuddy 需要"文件 / 专家 / skill / MCP 工具"多来源聚合。
 *   - 这里把候选聚合与渲染都留成注入点,而节点本身仍然复用官方
 *     `Mention`(保证 `data-type="mention"` 的 DOM 契约稳定)。
 */
import { Extension, type Extensions } from "@tiptap/core";
import { Mention } from "@tiptap/extension-mention";
import { Suggestion, type SuggestionOptions } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { createRoot } from "react-dom/client";
import { createElement, type ReactNode } from "react";
import {
  filterMentionItems,
  type EditorMentionItem,
} from "../lib/mention";
import { createSuggestionPopup } from "../lib/suggestion-popup";
import { SuggestionMenu } from "../components/SuggestionMenu";

export interface MentionExtensionOptions {
  /** 候选来源。可以是同步数组,也可以是按 query 拉取的异步函数。 */
  getItems: (
    query: string,
  ) => EditorMentionItem[] | Promise<EditorMentionItem[]>;
  /** 触发字符,默认 `@`。 */
  char?: string;
  /** 自定义菜单渲染。 */
  renderMenu?: (state: {
    items: EditorMentionItem[];
    query: string;
    activeIndex: number;
    setActiveIndex: (index: number) => void;
    onPick: (item: EditorMentionItem) => void;
    rect: DOMRect | null;
  }) => ReactNode;
  /** 选中后的回调(宿主可用于记录最近使用)。 */
  onSelect?: (item: EditorMentionItem) => void;
}

/** mention 菜单的默认渲染器。 */
export function createMentionMenuRenderer(options: MentionExtensionOptions) {
  return () => {
    let popup: ReturnType<typeof createSuggestionPopup> | null = null;
    let state = {
      items: [] as EditorMentionItem[],
      query: "",
      activeIndex: 0,
      rect: null as DOMRect | null,
    };
    let pick: ((item: EditorMentionItem) => void) | null = null;

    const draw = () => {
      if (!popup) return;
      popup.render(
        options.renderMenu !== undefined
          ? options.renderMenu({
              ...state,
              setActiveIndex: (index) => {
                state = { ...state, activeIndex: index };
                draw();
              },
              onPick: (item) => pick?.(item),
            })
          : createElement(SuggestionMenu, {
              items: state.items.map((item) => ({
                id: item.id,
                title: item.label,
                description: item.detail,
                icon: item.kind === "folder" ? "▸" : item.kind === "agent" ? "◈" : "▤",
                kind: "insert" as const,
                group: item.group ?? "候选",
              })),
              query: state.query,
              activeIndex: state.activeIndex,
              onHover: (index) => {
                state = { ...state, activeIndex: index };
                draw();
              },
              onPick: (command) => {
                const found = state.items.find((item) => item.id === command.id);
                if (found) pick?.(found);
              },
              emptyLabel: "没有匹配项",
            }),
      );
    };

    const ensure = () => {
      if (popup) return popup;
      popup = createSuggestionPopup({
        createRenderer: (container) => {
          const root = createRoot(container);
          return { render: (node) => root.render(node), unmount: () => root.unmount() };
        },
      });
      return popup;
    };

    return {
      onStart(props: { items: EditorMentionItem[]; query: string; clientRect?: (() => DOMRect | null) | null; command: (item: EditorMentionItem) => void }) {
        const instance = ensure();
        pick = props.command;
        state = { items: props.items, query: props.query, activeIndex: 0, rect: props.clientRect?.() ?? null };
        draw();
        instance.position(state.rect);
      },
      onUpdate(props: { items: EditorMentionItem[]; query: string; clientRect?: (() => DOMRect | null) | null; command: (item: EditorMentionItem) => void }) {
        const instance = ensure();
        pick = props.command;
        state = {
          items: props.items,
          query: props.query,
          activeIndex: Math.min(state.activeIndex, Math.max(0, props.items.length - 1)),
          rect: props.clientRect?.() ?? null,
        };
        draw();
        instance.position(state.rect);
      },
      onKeyDown(props: { event: KeyboardEvent }) {
        const { event } = props;
        if (event.key === "Escape") {
          popup?.destroy();
          popup = null;
          return true;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const length = state.items.length;
          if (length === 0) return true;
          const delta = event.key === "ArrowDown" ? 1 : -1;
          state = { ...state, activeIndex: (state.activeIndex + delta + length) % length };
          draw();
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const selected = state.items[state.activeIndex];
          if (!selected) return false;
          pick?.(selected);
          return true;
        }
        return false;
      },
      onExit() {
        popup?.destroy();
        popup = null;
        pick = null;
      },
    };
  };
}

/** 创建 mention 扩展集合:官方 Mention 节点 + 我们的 suggestion 插件。 */
export function createMentionExtensions(options: MentionExtensionOptions): Extensions {
  const char = options.char ?? "@";
  // 只复用官方 Mention 的**节点**定义(保证 data-type="mention" 的 DOM 契约),
  // 但把它自带的 suggestion 插件清空 —— 候选聚合由下面自己的插件负责,
  // 否则同一个编辑器里会挂两个 `@` 触发器。
  const mention = Mention.extend({ addProseMirrorPlugins: () => [] }).configure({
    HTMLAttributes: { class: "ob-editor-mention" },
  });

  const suggestion = Extension.create({
    name: "mentionSuggestion",
    addProseMirrorPlugins() {
      const config: Partial<SuggestionOptions<EditorMentionItem>> = {
        editor: this.editor,
        char,
        allowSpaces: false,
        items: async ({ query }) => {
          const items = await options.getItems(query);
          return filterMentionItems(items, query);
        },
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: "mention",
                attrs: { id: props.id, label: props.label },
              },
              { type: "text", text: " " },
            ])
            .run();
          options.onSelect?.(props);
        },
        render: createMentionMenuRenderer(options),
      };
      return [Suggestion({ ...(config as SuggestionOptions<EditorMentionItem>) })];
    },
  });

  return [mention, suggestion];
}
