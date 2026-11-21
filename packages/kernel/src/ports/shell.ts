/** Host shell port (moved from services/files `DesktopShell`, R2). Desktop: Electron's `shell`. */
export interface HostShell {
  openPath(path: string): Promise<string>;
  openExternal(url: string): Promise<void>;
  showItemInFolder(path: string): void;
  /** Move a file to the OS trash. Optional: without it (tests) the engine moves the file into `<settings.dir>/trash`. */
  trash?(path: string): Promise<void>;
}
