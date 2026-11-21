import type { CommandHandlers } from '@openbuddy/protocol/contract';
import type { NativeContext } from './context.js';

/** Native `tray` commands (20261116-pii W4.4): 设置 · 通用 reads/writes the persisted preference. */
export function trayCommands(ctx: NativeContext): CommandHandlers {
  const tray = ctx.options.tray;
  const commands: CommandHandlers = {
    tray_get: () => ({ enabled: tray?.get() ?? false }),
    tray_set: payload => {
      if (typeof payload.enabled !== 'boolean') throw new Error('invalid_payload: enabled');
      tray?.set(payload.enabled);
      return { enabled: tray?.get() ?? false };
    },
  };
  return commands;
}
