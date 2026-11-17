/**
 * What apps/desktop serves itself rather than the host (20261115-md §5.3 `native`), reported to
 * clients through `host_capabilities`. apps/desktop/test/native-commands.test.ts keeps this list
 * equal to the commands registered by ./{export,clipboard,window,dialog}.ts.
 */
export const NATIVE_COMMANDS = [
  'export_text_file', 'agent_export_html',
  'clipboard_write_text', 'clipboard_save_image',
  'window_minimize', 'window_toggle_maximize', 'window_close', 'window_is_maximized', 'window_edit',
  'dialog_open', 'dialog_save', 'dialog_ask',
  // 托盘常驻 (20261116-pii W4.4).
  'tray_get', 'tray_set',
] as const;
/** Events sent by apps/desktop itself (window resize, notification click → focus session). */
export const DESKTOP_EVENTS = ['window://resized', 'app://focus-session'] as const;
