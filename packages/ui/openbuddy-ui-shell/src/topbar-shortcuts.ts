/**
 * @openbuddy/ui-shell/topbar-shortcuts — 顶栏动作菜单里展示的快捷键和弦。
 *
 * 这里只登记"展示用"的和弦串(平台无关写法,由 <ShortcutHint> 按平台渲染),
 * 不负责注册监听 —— 真正的事件绑定仍在宿主(如 `useAppShellRuntime` 的全局
 * keydown)。宿主应当直接引用同一份常量来注册,避免菜单文案与真实绑定漂移。
 */
export const TOPBAR_ACTION_SHORTCUTS = {
  /** 导出当前会话为 Markdown。 */
  exportMarkdown: "mod+shift+e",
  /** 置顶 / 取消置顶当前会话。 */
  togglePin: "mod+shift+p",
  /** 归档当前会话。 */
  archive: "mod+shift+a",
  /**
   * 打开键盘快捷键面板。宿主目前的绑定是裸 `?`(见 useAppShellRuntime),
   * 所以这里也保持裸键,不做 mod 组合。
   */
  shortcutsHelp: "?",
} as const;

export type TopbarActionShortcut = keyof typeof TOPBAR_ACTION_SHORTCUTS;
