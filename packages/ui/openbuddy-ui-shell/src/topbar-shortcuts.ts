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
  /**
   * R72 — 打开「📝 新草稿」入口(DraftEditor)。与 exportMarkdown / togglePin /
   * archive 同一族:Mod + Shift + 单字母,与浏览器原生 D(收藏)/Shift+D 都不冲突。
   * 真正的事件绑定由 TopbarActions 内的 useShortcut 挂上,本文件只持有展示和弦。
   */
  draft: "mod+shift+d",
} as const;

export type TopbarActionShortcut = keyof typeof TOPBAR_ACTION_SHORTCUTS;
