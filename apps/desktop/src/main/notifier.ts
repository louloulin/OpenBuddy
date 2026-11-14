import { app, Notification, type BrowserWindow } from 'electron';

/**
 * System notifications (20261115-ui U6.1): only while the window is not
 * focused — approval needed, task finished, task failed. Clicking one brings
 * the window back and opens that session.
 */
export function notifier(win: BrowserWindow, enabled: () => boolean): (event: string, payload: unknown) => void {
  const running = new Set<string>();
  let unseen = 0;
  const show = (sessionId: string, title: string, body: string) => {
    if (win.isDestroyed() || win.isFocused() || !enabled() || !Notification.isSupported() || process.env.OPENBUDDY_SMOKE_TEST === '1') return;
    const note = new Notification({ title, body, silent: false });
    note.on('click', () => {
      if (win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('app://focus-session', { sessionId });
    });
    note.show();
    unseen++;
    if (process.platform !== 'win32') app.setBadgeCount(unseen);
  };
  win.on('focus', () => { unseen = 0; });
  return (event, payload) => {
    const data = (payload ?? {}) as { sessionId?: unknown; status?: unknown; toolKind?: unknown; destructive?: unknown };
    const sessionId = typeof data.sessionId === 'string' ? data.sessionId : '';
    if (!sessionId) return;
    if (event === 'agent://permission') {
      show(sessionId, data.destructive ? 'Buddy 想删除文件，需要你确认' : 'Buddy 需要你的确认', `等待批准：${String(data.toolKind ?? '操作')}`);
    } else if (event === 'agent://session-status') {
      if (data.status === 'running') { running.add(sessionId); return; }
      if (!running.delete(sessionId)) return;
      if (data.status === 'failed') show(sessionId, '任务失败', '点击查看出了什么问题');
      else show(sessionId, '任务完成', 'Buddy 已经完成了这个任务');
    }
  };
}
