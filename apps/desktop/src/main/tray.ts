import { app, Menu, nativeImage, Tray } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * 托盘常驻 (20261116-pii W4.4).
 *
 * 偏好存 `userData/tray.json`，与渲染层「设置 · 通用 · 托盘常驻」通过
 * `tray_get / tray_set` 同步。开启后关闭窗口只隐藏窗口，引擎与自动化继续运行；
 * 托盘菜单提供「打开 OpenBuddy / 退出 OpenBuddy」。
 */

// 18×18 单色圆环，macOS 上作为 template image 自动适配深浅色。
const ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAPElEQVR4nGNgGErgNQ5MsQEkGYhPA0mGEaOIoBpSwgGvWqobRCygn0GDJ4yINYzkdERRgsSlgSZ5bogAALhBWCESbBcMAAAAAElFTkSuQmCC';

export class TrayController {
  private tray: Tray | null = null;
  private enabledValue = false;
  private readonly file: string;

  constructor(private readonly actions: { show(): void; quit(): void }) {
    this.file = join(app.getPath('userData'), 'tray.json');
    this.enabledValue = this.load();
    this.sync();
  }

  get enabled(): boolean {
    return this.enabledValue;
  }

  /** Renderer preference (设置 · 通用). Persisted so it survives a restart. */
  setEnabled(enabled: boolean): void {
    this.enabledValue = !!enabled;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify({ enabled: this.enabledValue }));
    } catch (error) {
      console.error('Tray preference write failed', error);
    }
    this.sync();
  }

  /** Rebuild the tray icon after a state change (e.g. window shown again). */
  refresh(): void {
    this.sync();
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  private load(): boolean {
    try {
      if (!existsSync(this.file)) return false;
      return JSON.parse(readFileSync(this.file, 'utf8'))?.enabled === true;
    } catch {
      return false;
    }
  }

  private sync(): void {
    if (!this.enabledValue) {
      this.destroy();
      return;
    }
    if (this.tray) {
      this.updateMenu();
      return;
    }
    const image = nativeImage.createFromDataURL(ICON_DATA_URL);
    if (process.platform === 'darwin') image.setTemplateImage(true);
    this.tray = new Tray(image);
    this.tray.setToolTip('OpenBuddy');
    this.tray.on('click', () => this.actions.show());
    this.updateMenu();
  }

  private updateMenu(): void {
    if (!this.tray) return;
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开 OpenBuddy', click: () => this.actions.show() },
        { type: 'separator' },
        { label: '退出 OpenBuddy', click: () => this.actions.quit() },
      ]),
    );
  }
}
