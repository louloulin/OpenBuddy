/**
 * slash-command 扩展 —— 在编辑器里输入 `/` 弹出块级命令菜单。
 *
 * 与 Composer 的 `/` 菜单差异:Composer 插入纯文本命令名,编辑器这里
 * 直接改写文档结构(标题 / 列表 / 表格 / 图表 / 公式),因此需要走
 * `@tiptap/suggestion` 拿到 `range` 并在 `command` 里替换。
 *
 * 菜单渲染是插槽友好的:`getItems` 与 `renderMenu` 都可以由宿主替换,
 * ui-editor 只提供一套默认实现。
 */
import { Extension } from "@tiptap/core";
import { Suggestion, type SuggestionOptions } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { createRoot } from "react-dom/client";
import { createElement, type ReactNode } from "react";
import {
  DEFAULT_SLASH_COMMANDS,
  filterSlashCommands,
  type EditorSlashCommand,
} from "../lib/slash-command";
import { createSuggestionPopup } from "../lib/suggestion-popup";
import { SuggestionMenu } from "../components/SuggestionMenu";
import { applySlashCommand, type SlashCommandEnv } from "./apply-slash-command";

export interface SlashCommandMenuState {
  items: EditorSlashCommand[];
  query: string;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  onPick: (command: EditorSlashCommand) => void;
  /** 锚点矩形;jsdom 下可能为 null。 */
  rect: DOMRect | null;
}

/** suggestion 回调收到的 props(只列我们真正用到的字段)。 */
export interface SlashCommandSuggestionProps {
  items: EditorSlashCommand[];
  query: string;
  clientRect?: (() => DOMRect | null) | null;
  command: (command: EditorSlashCommand) => void;
}

export interface SlashCommandExtensionOptions {
  /** 命令来源,默认 `DEFAULT_SLASH_COMMANDS`。 */
  commands?: readonly EditorSlashCommand[];
  /** 异步检索(如从 PI 拉取 skill 命令);返回空数组表示用本地过滤结果。 */
  getItems?: (query: string) => EditorSlashCommand[] | Promise<EditorSlashCommand[]>;
  /** 替换菜单渲染。 */
  renderMenu?: (state: SlashCommandMenuState) => ReactNode;
  /** 执行命令时用到的宿主能力(如请求图片 URL)。 */
  env?: SlashCommandEnv;
  /** 触发字符,默认 `/`。 */
  char?: string;
  /** 选中后的额外回调(遥测 / 关闭其它浮层)。 */
  onSelect?: (command: EditorSlashCommand) => void;
}

/** 默认菜单渲染器:创建浮层 + React 根 + SuggestionMenu。 */
export function createSlashCommandMenuRenderer(
  options: SlashCommandExtensionOptions = {},
): () => {
  onStart: (props: SlashCommandSuggestionProps) => void;
  onUpdate: (props: SlashCommandSuggestionProps) => void;
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
  onExit: () => void;
} {
  return () => {
    let popup: ReturnType<typeof createSuggestionPopup> | null = null;
    let state: SlashCommandMenuState = {
      items: [],
      query: "",
      activeIndex: 0,
      setActiveIndex: () => {},
      onPick: () => {},
      rect: null,
    };
    let pick: ((command: EditorSlashCommand) => void) | null = null;

    const draw = () => {
      if (!popup) return;
      const node =
        options.renderMenu !== undefined
          ? options.renderMenu(state)
          : createElement(SuggestionMenu, {
              items: state.items,
              query: state.query,
              activeIndex: state.activeIndex,
              onHover: state.setActiveIndex,
              onPick: state.onPick,
              emptyLabel: "没有匹配的命令",
            });
      popup.render(node);
    };

    const ensure = () => {
      if (popup) return popup;
      popup = createSuggestionPopup({
        createRenderer: (container) => {
          const root = createRoot(container);
          return {
            render: (node) => root.render(node),
            unmount: () => root.unmount(),
          };
        },
      });
      return popup;
    };

    return {
      onStart(props) {
        const instance = ensure();
        pick = (command) => props.command(command);
        state = {
          items: props.items,
          query: props.query,
          activeIndex: 0,
          setActiveIndex: (index) => {
            state = { ...state, activeIndex: index };
            draw();
          },
          onPick: (command) => pick?.(command),
          rect: props.clientRect?.() ?? null,
        };
        draw();
        instance.position(state.rect);
      },
      onUpdate(props) {
        const instance = ensure();
        pick = (command) => props.command(command);
        const activeIndex = Math.min(state.activeIndex, Math.max(0, props.items.length - 1));
        state = {
          ...state,
          items: props.items,
          query: props.query,
          activeIndex,
          rect: props.clientRect?.() ?? null,
        };
        draw();
        instance.position(state.rect);
      },
      onKeyDown(props) {
        const { event } = props;
        if (event.key === "Escape") {
          popup?.destroy();
          popup = null;
          return true;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const delta = event.key === "ArrowDown" ? 1 : -1;
          const length = state.items.length;
          if (length === 0) return true;
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

/**
 * 创建 slash 命令扩展。返回的是标准 TipTap `Extension`,可直接进
 * `extensions` 数组。
 */
export function createSlashCommandExtension(
  options: SlashCommandExtensionOptions = {},
): Extension {
  const commands = options.commands ?? DEFAULT_SLASH_COMMANDS;
  const char = options.char ?? "/";

  return Extension.create({
    name: "slashCommand",

    addProseMirrorPlugins() {
      const editor = this.editor;
      const suggestion: Partial<SuggestionOptions<EditorSlashCommand>> = {
        editor,
        // 必须给独立 plugin key:同一个编辑器里 `@` mention 也会挂一个
        // Suggestion 插件,共用默认 key 会直接抛 "different instances of a
        // keyed plugin"。
        pluginKey: new PluginKey("obSlashCommand"),
        char,
        allowSpaces: false,
        startOfLine: false,
        items: async ({ query }) => {
          if (options.getItems) {
            try {
              const remote = await options.getItems(query);
              if (remote.length > 0) return filterSlashCommands(remote, query);
            } catch {
              // 远端失败时静默回退到本地命令表 —— 菜单必须始终可用。
            }
          }
          return filterSlashCommands(commands, query);
        },
        command: ({ editor: target, range, props }) => {
          applySlashCommand(target, props, range, options.env);
          options.onSelect?.(props);
        },
        render: createSlashCommandMenuRenderer(options),
      };
      return [Suggestion({ ...(suggestion as SuggestionOptions<EditorSlashCommand>) })];
    },
  });
}
