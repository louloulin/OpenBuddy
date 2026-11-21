/**
 * What apps/desktop serves itself rather than the host (20261115-md §5.3 `native`), reported to
 * clients through `host_capabilities`. apps/desktop/test/native-commands.test.ts keeps this list
 * equal to the commands registered by ./{export,clipboard,window,dialog}.ts.
 */
export const NATIVE_COMMANDS = [
  'export_text_file', 'agent_export_html',
  'clipboard_write_text', 'clipboard_save_image',
  'window_minimize', 'window_toggle_maximize', 'window_close', 'window_is_maximized', 'window_edit',
  // 窗口与唤起 (20261116-pii W7.1 / W7.2).
  'window_open_session', 'window_open_quick', 'quick_shortcut_get', 'quick_shortcut_set',
  'dialog_open', 'dialog_save', 'dialog_ask',
  // 托盘常驻 (20261116-pii W4.4).
  'tray_get', 'tray_set',
  // 手机接入 (20261115-mobile.md §4.4): pairing code + device list + revoke.
  'mobile_pair_start', 'mobile_devices_list', 'mobile_device_revoke',
] as const;
/** Events sent by apps/desktop itself (window resize, notification click → focus session). */
export const DESKTOP_EVENTS = ['window://resized', 'app://focus-session'] as const;
