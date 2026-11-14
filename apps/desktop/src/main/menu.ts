import { app, Menu, type MenuItemConstructorOptions } from 'electron';

/** Application menu: standard edit roles everywhere; reload/devtools only in development. */
export function installMenu(): void {
  const dev = !app.isPackaged;
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ label: 'OpenBuddy', submenu: [{ role: 'about' as const, label: '关于 OpenBuddy' }, { type: 'separator' as const }, { role: 'hide' as const, label: '隐藏 OpenBuddy' }, { role: 'hideOthers' as const, label: '隐藏其他' }, { type: 'separator' as const }, { role: 'quit' as const, label: '退出 OpenBuddy' }] }] : []),
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '视图', submenu: [...(dev ? [{ role: 'reload' as const, label: '重新加载' }, { role: 'toggleDevTools' as const, label: '开发者工具' }, { type: 'separator' as const }] : []), { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { type: 'separator' }, { role: 'togglefullscreen', label: '全屏' }] },
    { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' }, ...(process.platform === 'darwin' ? [{ role: 'front' as const, label: '前置全部窗口' }] : [{ role: 'close' as const, label: '关闭' }])] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
