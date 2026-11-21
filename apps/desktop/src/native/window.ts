import type { CommandHandlers } from '@openbuddy/protocol/contract';
import type { NativeContext } from './context.js';

/** Native `window` commands (20261115-md §5.3). Frameless window controls and edit roles. */
export function windowCommands(ctx: NativeContext): CommandHandlers {
  // `ctx.window` is a getter: every command talks to the window that sent it (W7 multi-window).
  const win = () => ctx.window;
  const commands: CommandHandlers = {
    window_edit: payload => {
      const action = String(payload.action);
      if (!['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].includes(action)) throw new Error('invalid_payload: action');
      win().webContents[action as 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll']();
    },
    window_minimize: () => win().minimize(),
    window_toggle_maximize: () => (win().isMaximized() ? win().unmaximize() : win().maximize()),
    window_close: () => win().close(),
    window_is_maximized: () => win().isMaximized(),
    // 独立会话窗口 (W7.1) + 全局快速输入 (W7.2).
    window_open_session: payload => {
      const sessionId = String(payload.sessionId);
      if (!ctx.options.openSessionWindow) throw new Error('not_supported: window_open_session');
      ctx.options.openSessionWindow(sessionId);
    },
    window_open_quick: () => {
      if (!ctx.options.openQuickWindow) throw new Error('not_supported: window_open_quick');
      ctx.options.openQuickWindow();
    },
    quick_shortcut_get: () => ctx.options.quickShortcut?.get() ?? '',
    quick_shortcut_set: payload => {
      if (!ctx.options.quickShortcut) throw new Error('not_supported: quick_shortcut_set');
      const accelerator = String(payload.accelerator);
      if (!ctx.options.quickShortcut.set(accelerator)) throw new Error('invalid_shortcut: 无法注册这个快捷键');
      return ctx.options.quickShortcut.get();
    },
  };
  return commands;
}
