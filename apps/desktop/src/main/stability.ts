import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';

/** Minimal logger surface shared with StructuredLogger. */
export interface StabilityLog {
  info(scope: string, message: string, data?: Record<string, unknown>): void;
  warn(scope: string, message: string, data?: Record<string, unknown>): void;
  error(scope: string, message: string, data?: Record<string, unknown>): void;
}

export type RecoveryDecision = 'reload' | 'give-up' | 'ignore';

/**
 * 渲染进程自愈预算：崩溃后自动重载，但 windowMs 内超过 budget 次就停手，
 * 交给用户决定，避免“崩溃→重载→崩溃”的死循环。正常退出不算崩溃。
 */
export function createRendererRecovery(options: { budget?: number; windowMs?: number; now?: () => number } = {}) {
  const budget = options.budget ?? 3;
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now;
  let crashes: number[] = [];
  return {
    onGone(reason: string): RecoveryDecision {
      if (reason === 'clean-exit') return 'ignore';
      const t = now();
      crashes = crashes.filter(at => t - at < windowMs);
      crashes.push(t);
      return crashes.length > budget ? 'give-up' : 'reload';
    },
    reset() { crashes = []; },
    get recent() { return crashes.length; },
  };
}

interface GuardedWindow {
  isDestroyed(): boolean;
  on(event: 'unresponsive' | 'responsive', listener: () => void): unknown;
  webContents: {
    on(event: 'render-process-gone', listener: (event: unknown, details: { reason: string; exitCode: number }) => void): unknown;
    on(event: 'did-fail-load', listener: (event: unknown, code: number, description: string, url: string, isMainFrame: boolean) => void): unknown;
    on(event: 'did-finish-load', listener: () => void): unknown;
    reload(): void;
    forcefullyCrashRenderer(): void;
  };
}

/**
 * 接管单个窗口：
 * - 崩溃自动重载（带预算），超预算交给 onGiveUp；
 * - 无响应超过 unresponsiveGraceMs 强制重启渲染进程（10 分钟内最多 maxHangReloads 次）；
 * - 主框架加载失败按退避重试 maxLoadRetries 次。
 */
export function guardRenderer(win: GuardedWindow, log: StabilityLog, options: {
  onGiveUp?: (reason: string) => void;
  recovery?: ReturnType<typeof createRendererRecovery>;
  now?: () => number;
  unresponsiveGraceMs?: number;
  maxHangReloads?: number;
  maxLoadRetries?: number;
  schedule?: (fn: () => void, ms: number) => { cancel(): void };
} = {}) {
  const recovery = options.recovery ?? createRendererRecovery();
  const now = options.now ?? Date.now;
  const graceMs = options.unresponsiveGraceMs ?? 60_000;
  const maxHangReloads = options.maxHangReloads ?? 2;
  const maxLoadRetries = options.maxLoadRetries ?? 2;
  const schedule = options.schedule ?? ((fn, ms) => { const t = setTimeout(fn, ms); return { cancel: () => clearTimeout(t) }; });
  let hungAt: number | undefined;
  let hangTimer: { cancel(): void } | undefined;
  let hangReloads: number[] = [];
  let killingHung = false;
  let loadRetries = 0;

  win.webContents.on('render-process-gone', (_event, details) => {
    if (killingHung) {
      killingHung = false;
      log.error('renderer', 'render-process-gone', { reason: details.reason, exitCode: details.exitCode, decision: 'hang-reload' });
      if (!win.isDestroyed()) win.webContents.reload();
      return;
    }
    const decision = recovery.onGone(details.reason);
    log.error('renderer', 'render-process-gone', { reason: details.reason, exitCode: details.exitCode, decision, recent: recovery.recent });
    if (win.isDestroyed()) return;
    if (decision === 'reload') win.webContents.reload();
    else if (decision === 'give-up') options.onGiveUp?.(details.reason);
  });

  win.on('unresponsive', () => {
    if (hungAt !== undefined) return;
    hungAt = now();
    log.warn('renderer', 'unresponsive');
    hangTimer = schedule(() => {
      hangTimer = undefined;
      if (hungAt === undefined || win.isDestroyed()) return;
      const t = now();
      hangReloads = hangReloads.filter(at => t - at < 600_000);
      if (hangReloads.length >= maxHangReloads) {
        log.error('renderer', 'unresponsive-give-up', { hungMs: t - hungAt, reloads: hangReloads.length });
        options.onGiveUp?.('unresponsive');
        return;
      }
      hangReloads.push(t);
      log.error('renderer', 'unresponsive-force-reload', { hungMs: t - hungAt, attempt: hangReloads.length });
      hungAt = undefined;
      killingHung = true;
      win.webContents.forcefullyCrashRenderer();
    }, graceMs);
  });
  win.on('responsive', () => {
    hangTimer?.cancel();
    hangTimer = undefined;
    if (hungAt === undefined) return;
    log.warn('renderer', 'responsive', { hungMs: now() - hungAt });
    hungAt = undefined;
  });

  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    log.warn('renderer', 'did-fail-load', { code, description, isMainFrame });
    // -3 (ERR_ABORTED) is a superseded navigation, not a failure.
    if (!isMainFrame || code === -3 || win.isDestroyed()) return;
    if (loadRetries >= maxLoadRetries) { log.error('renderer', 'load-give-up', { code, url }); options.onGiveUp?.(`load-failed:${code}`); return; }
    loadRetries += 1;
    schedule(() => { if (!win.isDestroyed()) win.webContents.reload(); }, 1_000 * 2 ** (loadRetries - 1));
  });
  win.webContents.on('did-finish-load', () => { loadRetries = 0; });
  return recovery;
}

// The watchdog runs on its own thread so it keeps ticking while the main thread is blocked.
const WATCHDOG_SOURCE = `
const { workerData } = require('node:worker_threads');
const { appendFileSync } = require('node:fs');
const beat = new Float64Array(workerData.buffer);
let hungSince = 0;
const write = (record) => { try { appendFileSync(workerData.file, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\\n'); } catch {} };
const { statSync, renameSync } = require('node:fs');
// Keep main-hang.log bounded: one 1 MB generation plus the previous one.
try { if (statSync(workerData.file).size > 1048576) renameSync(workerData.file, workerData.file + '.1'); } catch {}
setInterval(() => {
  const last = beat[0];
  const lag = Date.now() - last;
  if (lag >= workerData.thresholdMs) {
    if (!hungSince) { hungSince = last; write({ event: 'main-hang', lagMs: lag }); }
  } else if (hungSince) {
    write({ event: 'main-recovered', hungMs: last - hungSince });
    hungSince = 0;
  }
}, workerData.checkMs);
`;

/**
 * 主进程卡死看门狗：主线程每 heartbeatMs 写一次心跳，worker 线程发现心跳超过 thresholdMs
 * 没更新就把卡顿写进 <logDir>/main-hang.log，恢复时再写一条持续时长。
 */
export function startMainHangWatchdog(logDir: string, options: { thresholdMs?: number; heartbeatMs?: number; checkMs?: number } = {}) {
  const thresholdMs = options.thresholdMs ?? 5_000;
  const heartbeatMs = options.heartbeatMs ?? 500;
  const checkMs = options.checkMs ?? 1_000;
  mkdirSync(logDir, { recursive: true });
  const file = join(logDir, 'main-hang.log');
  const buffer = new SharedArrayBuffer(8);
  const beat = new Float64Array(buffer);
  beat[0] = Date.now();
  const timer = setInterval(() => { beat[0] = Date.now(); }, heartbeatMs);
  timer.unref();
  const worker = new Worker(WATCHDOG_SOURCE, { eval: true, workerData: { buffer, file, thresholdMs, checkMs } });
  worker.unref();
  worker.on('error', error => {
    try { appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), event: 'watchdog-error', message: error.message })}\n`); } catch { /* ignore */ }
  });
  return {
    file,
    async stop() { clearInterval(timer); await worker.terminate(); },
  };
}

export interface ProcessMetricLike { pid: number; type: string; memory: { workingSetSize: number } }
export interface MemorySample { totalMb: number; peakMb: number; topType: string; topMb: number; processes: number }

/**
 * 内存监测：每 intervalMs 汇总 app.getAppMetrics() 的工作集（KB）。总量或单进程越过阈值时记一次 warn，
 * 回落到阈值的 80% 以下才重新武装，避免每分钟刷同一条告警。
 */
export function startMemoryMonitor(log: StabilityLog, metrics: () => ProcessMetricLike[], options: { intervalMs?: number; warnTotalMb?: number; warnProcessMb?: number } = {}) {
  const intervalMs = options.intervalMs ?? 60_000;
  const warnTotalMb = options.warnTotalMb ?? 3072;
  const warnProcessMb = options.warnProcessMb ?? 1536;
  let peakMb = 0;
  let alarmed = false;
  let last: MemorySample = { totalMb: 0, peakMb: 0, topType: '', topMb: 0, processes: 0 };
  const sample = () => {
    let list: ProcessMetricLike[] = [];
    try { list = metrics(); } catch { /* app shutting down */ }
    const mb = (p: ProcessMetricLike) => Math.round(p.memory.workingSetSize / 1024);
    const totalMb = list.reduce((sum, p) => sum + mb(p), 0);
    const top = list.reduce<ProcessMetricLike | undefined>((best, p) => (!best || mb(p) > mb(best) ? p : best), undefined);
    peakMb = Math.max(peakMb, totalMb);
    last = { totalMb, peakMb, topType: top?.type ?? '', topMb: top ? mb(top) : 0, processes: list.length };
    const over = totalMb >= warnTotalMb || last.topMb >= warnProcessMb;
    if (over && !alarmed) {
      alarmed = true;
      log.warn('main', 'memory-high', { ...last, byType: summarizeByType(list, mb) });
    } else if (alarmed && totalMb < warnTotalMb * 0.8 && last.topMb < warnProcessMb * 0.8) {
      alarmed = false;
      log.info('main', 'memory-recovered', { ...last });
    }
    return last;
  };
  const timer = setInterval(sample, intervalMs);
  timer.unref();
  return {
    sample,
    get last() { return last; },
    stop() { clearInterval(timer); },
  };
}

function summarizeByType(list: ProcessMetricLike[], mb: (p: ProcessMetricLike) => number) {
  const out: Record<string, number> = {};
  for (const p of list) out[p.type] = (out[p.type] ?? 0) + mb(p);
  return out;
}

/** 事件循环延迟摘要：每 intervalMs 汇总一次，p99 超过 warnMs 记 warn，否则不刷日志。 */
export function startEventLoopMonitor(log: StabilityLog, options: { intervalMs?: number; warnMs?: number } = {}) {
  const intervalMs = options.intervalMs ?? 60_000;
  const warnMs = options.warnMs ?? 200;
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  let last = { p50Ms: 0, p99Ms: 0, maxMs: 0 };
  const sample = () => {
    last = {
      p50Ms: Math.round(histogram.percentile(50) / 1e6),
      p99Ms: Math.round(histogram.percentile(99) / 1e6),
      maxMs: Math.round(histogram.max / 1e6),
    };
    histogram.reset();
    if (last.p99Ms >= warnMs) log.warn('main', 'event-loop-lag', last);
    return last;
  };
  const timer = setInterval(sample, intervalMs);
  timer.unref();
  return {
    sample,
    get last() { return last; },
    stop() { clearInterval(timer); histogram.disable(); },
  };
}
