const { contextBridge, ipcRenderer, webUtils } = require('electron');
// Generated from the shared contract by build-electron.mjs.
const commands = new Set(/* COMMANDS */ []);
const events = new Set(/* EVENTS */ []);
const invoke = (command, payload) => {
  if (!commands.has(command)) return Promise.reject(new Error(`not_implemented: ${command}`));
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
  getPathForFile: file => webUtils.getPathForFile(file),
}));
