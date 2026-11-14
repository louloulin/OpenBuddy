import { dialog, shell, type BrowserWindow } from 'electron';

export function external(url: string): void {
  try {
    const parsed = new URL(url);
    // mailto: hands a share intent to the mail client (20261115-ui U8.1); nothing else leaves the app.
    if ((['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) || parsed.protocol === 'mailto:') void shell.openExternal(parsed.href);
  } catch { /* Invalid destinations are blocked. */ }
}

/** Ask before closing while tasks are still running in background sessions. */
export async function confirmQuit(win: BrowserWindow | null, runningTasks: (() => Promise<unknown[]>) | undefined): Promise<boolean> {
  if (process.env.OPENBUDDY_SMOKE_TEST === '1' || !runningTasks) return true;
  const tasks = await runningTasks();
  if (!tasks.length) return true;
  const options = { type: 'warning' as const, title: 'OpenBuddy', message: `还有 ${tasks.length} 个任务正在运行`, detail: '退出将停止这些任务，已生成的内容会保留。', buttons: ['取消', '停止并退出'], defaultId: 0, cancelId: 0 };
  const result = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  return result.response === 1;
}
