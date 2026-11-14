/**
 * Host capabilities the Markdown package uses (20261115-md §5.2 / R6): copying code, opening
 * links and local paths, reading and writing files for 应用到文件, and dialogs. The package does
 * not reach the client, platform or the app itself; the app installs its implementation with
 * <MarkdownHostProvider>. Non-React code in the package (createMarkdownHostConfig,
 * openLocalPath) reads the same host through getMarkdownHost().
 */
import { createContext, useContext, type ReactNode } from "react";

/** Result of a path lookup (moved from markdown-host.ts). */
export type PathStat = {
  path: string;
  exists: boolean;
  kind: string;
  absolute: string;
};

export interface MarkdownDialogFilter { name: string; extensions: string[] }
export interface MarkdownSaveDialogOptions { title?: string; defaultPath?: string; filters?: MarkdownDialogFilter[] }
export interface MarkdownAskDialogOptions { title?: string; kind?: "info" | "warning" | "error"; okLabel?: string; cancelLabel?: string }
export interface MarkdownConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Shown as a diff under the message (应用到文件 shows what would change). */
  diff?: { before: string; after: string };
}

export interface MarkdownHost {
  /** Code block 复制 button. */
  copyText(text: string): Promise<void>;
  /** http(s) and mailto links. */
  openUrl(url: string): Promise<unknown>;
  /** Open a local file or folder with the OS (relative paths resolve against `cwd`). */
  openPath(path: string, cwd?: string): Promise<unknown>;
  /** Show a local file in the OS file manager. */
  revealInFolder(path: string, cwd?: string): Promise<unknown>;
  /** Whether an inline-code token names a real file or folder. */
  pathStat(path: string, cwd?: string): Promise<PathStat>;
  /** 应用到文件: the file's current text; rejects when it does not exist. */
  readTextFile(path: string, maxBytes: number): Promise<string>;
  /** 应用到文件 outside a session: write inside the workspace. Resolves with the written path. */
  writeTextFile(path: string, content: string, workspaceRoot: string): Promise<string>;
  /** 应用到文件 in a session: write through the checkpoint store so it can be undone. */
  artifactSave(sessionId: string, path: string, content: string, origin?: "apply"): Promise<void>;
  /** Write to a path the user picked in the save dialog. Resolves with the written path. */
  exportTextFile(path: string, content: string): Promise<string>;
  /** Native save dialog; null when cancelled. */
  saveDialog(options?: MarkdownSaveDialogOptions): Promise<string | null>;
  /** Native yes / no dialog. */
  askDialog(message: string, options?: MarkdownAskDialogOptions): Promise<boolean>;
  /** In-app confirm dialog. */
  confirm(options: MarkdownConfirmOptions): Promise<boolean>;
}

const unavailable = (capability: string) => () => Promise.reject(new Error(`Markdown host has no ${capability}`));

/**
 * Used until the app installs a host (e.g. a test that renders Markdown on its own): nothing
 * crashes, host actions fail, and copying uses the browser clipboard when there is one.
 */
const fallbackHost: MarkdownHost = {
  copyText: async text => {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
    await navigator.clipboard.writeText(text);
  },
  openUrl: unavailable("openUrl"),
  openPath: unavailable("openPath"),
  revealInFolder: unavailable("revealInFolder"),
  pathStat: unavailable("pathStat"),
  readTextFile: unavailable("readTextFile"),
  writeTextFile: unavailable("writeTextFile"),
  artifactSave: unavailable("artifactSave"),
  exportTextFile: unavailable("exportTextFile"),
  saveDialog: unavailable("saveDialog"),
  askDialog: unavailable("askDialog"),
  confirm: unavailable("confirm"),
};

let current: MarkdownHost = fallbackHost;

/** Install the host for the whole package (MarkdownHostProvider does this for you). */
export function setMarkdownHost(host: MarkdownHost): void {
  current = host;
}

/** The installed host, for code outside React. */
export function getMarkdownHost(): MarkdownHost {
  return current;
}

const MarkdownHostContext = createContext<MarkdownHost | null>(null);

export function MarkdownHostProvider({ host, children }: { host: MarkdownHost; children?: ReactNode }) {
  // Only the outermost provider installs the package-wide host, so a nested provider (say a
  // preview pane with its own host) changes what its own subtree reads from context but never
  // what code outside React (createMarkdownHostConfig, openLocalPath) uses for the whole app.
  // Installed while rendering, not in an effect: children's effects and callbacks must
  // already see it.
  const outer = useContext(MarkdownHostContext);
  if (!outer) setMarkdownHost(host);
  return <MarkdownHostContext.Provider value={host}>{children}</MarkdownHostContext.Provider>;
}

/** The host for this subtree: the nearest provider's, else the installed one. */
export function useMarkdownHost(): MarkdownHost {
  return useContext(MarkdownHostContext) ?? current;
}
