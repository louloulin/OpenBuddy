import type { BrowserWindow } from 'electron';
import type { FileAccess } from '@openbuddy/host/security/file-access';
import type { MobileGateway } from '../main/mobile-gateway.js';

export type WorkspaceGrants = { grant(path: string): Promise<void>; allows(path: string): Promise<boolean> };
export type NativeOptions = {
  attachmentsDir?: string;
  exportHtml?: (sessionId: string, path: string) => Promise<string>;
  /** 托盘常驻 (W4.4): persisted behind tray.json, owned by the main process. */
  tray?: { get(): boolean; set(enabled: boolean): void };
  /** 手机接入 (§4.4): gateway admin client, absent without a gateway address. */
  mobileGateway?: MobileGateway;
  /** 窗口与唤起 (W7): main-process window factory + global quick-input shortcut. */
  openSessionWindow?: (sessionId: string) => void;
  /** G3-3: an artifact in its own window (side-by-side reading). */
  openArtifactWindow?: (sessionId: string, path: string) => void;
  openQuickWindow?: () => void;
  quickShortcut?: { get(): string; set(accelerator: string): boolean };
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
