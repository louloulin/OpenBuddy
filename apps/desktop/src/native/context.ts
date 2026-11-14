import type { BrowserWindow } from 'electron';
import type { FileAccess } from '@openbuddy/host/security/file-access';

export type WorkspaceGrants = { grant(path: string): Promise<void>; allows(path: string): Promise<boolean> };
export type NativeOptions = { attachmentsDir?: string; exportHtml?: (sessionId: string, path: string) => Promise<string> };

/** What the native command groups close over; registerIpc builds one per window. */
export interface NativeContext {
  window: BrowserWindow;
  fileAccess: FileAccess;
  /** Paths picked in a save dialog; each export consumes its grant once. */
  exportGrants: Set<string>;
  workspaces?: WorkspaceGrants;
  options: NativeOptions;
}
