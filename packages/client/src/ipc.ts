/** The renderer's only access to the Electron preload bridge. */
export type UnlistenFn = () => void;
export interface DialogFilter { name: string; extensions: string[] }
export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  directory?: boolean;
  multiple?: boolean;
  filters?: DialogFilter[];
  recursive?: boolean;
  canCreateDirectories?: boolean;
}
export interface SaveDialogOptions { title?: string; defaultPath?: string; filters?: DialogFilter[] }
export interface AskDialogOptions {
  title?: string;
  kind?: "info" | "warning" | "error";
  okLabel?: string;
  cancelLabel?: string;
}
export interface WindowControls {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onResized(callback: () => void): UnlistenFn;
}
export interface OpenBuddyBridge {
  invoke(command: string, payload?: unknown): Promise<unknown>;
  listen(event: string, callback: (payload: unknown) => void): UnlistenFn;
  dialog: {
    open(options?: OpenDialogOptions): Promise<string | string[] | null>;
    save(options?: SaveDialogOptions): Promise<string | null>;
    ask(message: string, options?: AskDialogOptions): Promise<boolean>;
  };
  window: WindowControls;
  getPathForFile(file: File): string;
}
declare global { interface Window { openbuddy?: OpenBuddyBridge } }
function bridge(): OpenBuddyBridge {
  if (!window.openbuddy) throw new Error("Electron preload bridge is unavailable");
  return window.openbuddy;
}
export async function invoke<T = unknown>(command: string, payload?: unknown): Promise<T> {
  const result = await bridge().invoke(command, payload);
  if (result && typeof result === "object" && "error" in result && result.error === "not_implemented") {
    throw new Error(`此功能在 Electron MVP 中暂不可用：${command}`);
  }
  return result as T;
}
/** Keep the UI event envelope local; preload only exposes serialized payloads. */
export async function listen<T>(event: string, callback: (event: { payload: T }) => void): Promise<UnlistenFn> {
  return bridge().listen(event, payload => callback({ payload: payload as T }));
}
export const open = (options?: OpenDialogOptions) => bridge().dialog.open(options);
export const save = (options?: SaveDialogOptions) => bridge().dialog.save(options);
export const ask = (message: string, options?: AskDialogOptions) => bridge().dialog.ask(message, options);
export const dialog = { open, save, ask };
export const win: WindowControls = {
  minimize: async () => bridge().window.minimize(),
  toggleMaximize: async () => bridge().window.toggleMaximize(),
  close: async () => bridge().window.close(),
  isMaximized: async () => bridge().window.isMaximized(),
  onResized: callback => bridge().window.onResized(callback),
};
export const getPathForFile = (file: File): string => bridge().getPathForFile(file);
