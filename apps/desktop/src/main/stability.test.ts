import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRendererRecovery, guardRenderer, startEventLoopMonitor, startMainHangWatchdog, startMemoryMonitor } from './stability';

const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('渲染进程自愈预算', () => {
  it('窗口期内前 3 次重载，第 4 次放弃；过期后重新计数；正常退出忽略', () => {
    let t = 0;
    const r = createRendererRecovery({ budget: 3, windowMs: 60_000, now: () => t });
    expect(r.onGone('clean-exit')).toBe('ignore');
    expect([r.onGone('crashed'), r.onGone('oom'), r.onGone('crashed')]).toEqual(['reload', 'reload', 'reload']);
    expect(r.onGone('crashed')).toBe('give-up');
    t = 120_000;
    expect(r.onGone('crashed')).toBe('reload');
  });

  it('guardRenderer 崩溃即重载，超预算调用 onGiveUp，并记录无响应时长', () => {
    let t = 0;
    const win = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      webContents: Object.assign(new EventEmitter(), { reload: vi.fn() }),
    });
    const l = log();
    const onGiveUp = vi.fn();
    guardRenderer(win, l, { onGiveUp, now: () => t, recovery: createRendererRecovery({ budget: 1, now: () => t }) });
    win.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    expect(win.webContents.reload).toHaveBeenCalledTimes(1);
    win.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    expect(win.webContents.reload).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledWith('crashed');
    win.emit('unresponsive');
    t = 4_200;
    win.emit('responsive');
    expect(l.warn).toHaveBeenLastCalledWith('renderer', 'responsive', { hungMs: 4_200 });
  });

  const fakeWin = () => {
    const wc = Object.assign(new EventEmitter(), { reload: vi.fn(), forcefullyCrashRenderer: vi.fn() });
    wc.forcefullyCrashRenderer.mockImplementation(() => wc.emit('render-process-gone', {}, { reason: 'killed', exitCode: 9 }));
    return Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: wc });
  };
  const manualSchedule = () => {
    const queue: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
    return { queue, schedule: (fn: () => void, ms: number) => { const job = { fn, ms, cancelled: false }; queue.push(job); return { cancel() { job.cancelled = true; } }; } };
  };

  it('无响应超过宽限期强制重启渲染进程，10 分钟内超 2 次交给用户，且不占崩溃预算', () => {
    let t = 0;
    const win = fakeWin();
    const { queue, schedule } = manualSchedule();
    const onGiveUp = vi.fn();
    const l = log();
    const recovery = guardRenderer(win, l, { onGiveUp, now: () => t, schedule, unresponsiveGraceMs: 1000 });
    win.emit('unresponsive'); win.emit('responsive');
    expect(queue[0].cancelled).toBe(true);
    for (let i = 0; i < 3; i++) { win.emit('unresponsive'); t += 1000; queue.at(-1)!.fn(); }
    expect(win.webContents.forcefullyCrashRenderer).toHaveBeenCalledTimes(2);
    expect(win.webContents.reload).toHaveBeenCalledTimes(2);
    expect(recovery.recent).toBe(0);
    expect(onGiveUp).toHaveBeenCalledWith('unresponsive');
  });

  it('主框架加载失败按退避重试，ERR_ABORTED 与子框架忽略，成功加载后清零', () => {
    const win = fakeWin();
    const { queue, schedule } = manualSchedule();
    const onGiveUp = vi.fn();
    guardRenderer(win, log(), { onGiveUp, schedule, maxLoadRetries: 2 });
    win.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'x', true);
    win.webContents.emit('did-fail-load', {}, -105, 'NAME', 'x', false);
    expect(queue).toHaveLength(0);
    win.webContents.emit('did-fail-load', {}, -102, 'REFUSED', 'x', true);
    win.webContents.emit('did-fail-load', {}, -102, 'REFUSED', 'x', true);
    expect(queue.map(j => j.ms)).toEqual([1000, 2000]);
    win.webContents.emit('did-fail-load', {}, -102, 'REFUSED', 'x', true);
    expect(onGiveUp).toHaveBeenCalledWith('load-failed:-102');
    win.webContents.emit('did-finish-load');
    win.webContents.emit('did-fail-load', {}, -102, 'REFUSED', 'x', true);
    expect(queue).toHaveLength(3);
  });
});

describe('主进程卡死看门狗', () => {
  it('主线程阻塞超过阈值写 main-hang.log，恢复后写持续时长', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ob-hang-'));
    const dog = startMainHangWatchdog(dir, { thresholdMs: 300, heartbeatMs: 50, checkMs: 50 });
    await new Promise(r => setTimeout(r, 150));
    const until = Date.now() + 800;
    while (Date.now() < until) { /* block the main thread */ }
    await new Promise(r => setTimeout(r, 400));
    await dog.stop();
    expect(existsSync(dog.file)).toBe(true);
    const events = readFileSync(dog.file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(events[0].event).toBe('main-hang');
    const recovered = events.find(e => e.event === 'main-recovered');
    expect(recovered.hungMs).toBeGreaterThanOrEqual(500);
  });
});

describe('内存监测', () => {
  it('越过阈值只告警一次，回落到 80% 以下记恢复并重新武装', () => {
    const l = log();
    let renderer = 500 * 1024;
    const metrics = () => [
      { pid: 1, type: 'Browser', memory: { workingSetSize: 200 * 1024 } },
      { pid: 2, type: 'Tab', memory: { workingSetSize: renderer } },
    ];
    const m = startMemoryMonitor(l, metrics, { warnTotalMb: 1000, warnProcessMb: 900 });
    expect(m.sample()).toMatchObject({ totalMb: 700, topType: 'Tab', topMb: 500, processes: 2 });
    renderer = 950 * 1024;
    m.sample(); m.sample();
    expect(l.warn).toHaveBeenCalledTimes(1);
    expect(l.warn).toHaveBeenCalledWith('main', 'memory-high', expect.objectContaining({ totalMb: 1150, byType: { Browser: 200, Tab: 950 } }));
    renderer = 400 * 1024;
    expect(m.sample().peakMb).toBe(1150);
    expect(l.info).toHaveBeenCalledWith('main', 'memory-recovered', expect.objectContaining({ totalMb: 600 }));
    m.stop();
  });
});

describe('事件循环延迟摘要', () => {
  it('p99 超过阈值记 warn', async () => {
    const l = log();
    const m = startEventLoopMonitor(l, { intervalMs: 60_000, warnMs: 50 });
    await new Promise(r => setTimeout(r, 30));
    const until = Date.now() + 150;
    while (Date.now() < until) { /* lag */ }
    await new Promise(r => setTimeout(r, 30));
    const s = m.sample();
    m.stop();
    expect(s.maxMs).toBeGreaterThanOrEqual(100);
    expect(l.warn).toHaveBeenCalledWith('main', 'event-loop-lag', s);
  });
});
