import type { BrowserWindow } from 'electron';
import type { FileAccess } from '@openbuddy/host/security/file-access';

export type WorkspaceGrants = { grant(path: string): Promise<void>; allows(path: string): Promise<boolean> };
export type NativeOptions = {
  attachmentsDir?: string;
  exportHtml?: (sessionId: string, path: string) => Promise<string>;
  /** 托盘常驻 (W4.4): persisted behind tray.json, owned by the main process. */
  tray?: { get(): boolean; set(enabled: boolean): void };
};

/** What the native command groups close over; registerIpc builds one per window. */
export interface NativeContext {
  window: BrowserWindow;
  fileAccess: FileAccess;
  /** Paths picked in a save dialog; each export consumes its grant once. */
  exportGrants: Set<string>;
  workspaces?: WorkspaceGrants;
  options: NativeOptions;
}
