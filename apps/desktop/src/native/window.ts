import type { CommandHandlers } from '@openbuddy/protocol/contract';
import type { NativeContext } from './context.js';

/** Native `window` commands (20261115-md §5.3). Frameless window controls and edit roles. */
export function windowCommands(ctx: NativeContext): CommandHandlers {
  const { window } = ctx;
  const commands: CommandHandlers = {
    window_edit: payload => {
      const action = String(payload.action);
      if (!['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].includes(action)) throw new Error('invalid_payload: action');
      window.webContents[action as 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll']();
    },
    window_minimize: () => window.minimize(),
    window_toggle_maximize: () => window.isMaximized() ? window.unmaximize() : window.maximize(),
    window_close: () => window.close(),
    window_is_maximized: () => window.isMaximized(),
  };
  return commands;
}
