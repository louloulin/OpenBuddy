const { contextBridge, ipcRenderer, webUtils } = require('electron');
// Generated from the shared contract by build-electron.mjs.
const commands = new Set(/* COMMANDS */ []);
const events = new Set(/* EVENTS */ []);
const nativeFileGrants = new Map();
const getPathForFile = file => {
  const path = webUtils.getPathForFile(file);
  if (!path) throw new Error('native_file_required');
  if (nativeFileGrants.size >= 256) nativeFileGrants.delete(nativeFileGrants.keys().next().value);
  const pending = ipcRenderer.invoke('openbuddy:grant-file', path).then(() => true, () => false);
  nativeFileGrants.set(path, pending);
  return path;
};
const invoke = async (command, payload) => {
  if (!commands.has(command)) throw new Error(`not_implemented: ${command}`);
  if (command === 'agent_extensions_add') {
    const pending = nativeFileGrants.get(payload?.path);
    if (pending && !await pending) throw new Error('native_file_grant_failed: select the file again');
  }
  if (['agent_send', 'agent_steer', 'agent_follow_up'].includes(command) && Array.isArray(payload?.attachments)) {
    for (const reference of payload.attachments) {
      const pending = nativeFileGrants.get(reference?.path);
      if (pending && !await pending) throw new Error('native_file_grant_failed: select the file again');
    }
  }
  return ipcRenderer.invoke('openbuddy:invoke', command, payload);
};
const listen = (event, callback) => {
  if (!events.has(event) || typeof callback !== 'function') throw new Error('invalid_event');
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(event, listener);
  return () => ipcRenderer.removeListener(event, listener);
};
contextBridge.exposeInMainWorld('openbuddy', Object.freeze({
  invoke,
  listen,
  dialog: Object.freeze({
    open: options => invoke('dialog_open', options),
    save: options => invoke('dialog_save', options),
    ask: (message, options) => invoke('dialog_ask', { ...options, message }),
  }),
  window: Object.freeze({
    minimize: () => invoke('window_minimize'),
    toggleMaximize: () => invoke('window_toggle_maximize'),
    close: () => invoke('window_close'),
    isMaximized: () => invoke('window_is_maximized'),
    onResized: callback => listen('window://resized', callback),
  }),
  getPathForFile,
}));
