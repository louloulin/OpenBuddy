import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
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

/** Worker-side state of the hang watchdog (kept as plain numbers so it crosses into the worker source). */
export interface HangTickState { lastTick: number; resumedAt: number; hungSince: number }
export type HangRecord =
  | { event: 'main-hang'; lagMs: number }
  | { event: 'main-recovered'; hungMs: number }
  | { event: 'suspend-gap'; gapMs: number };

/**
 * 看门狗每次检查的判定（纯函数，worker 线程里跑的就是它的源码）：
 * - pausedAt > 0：主进程收到 powerMonitor suspend，整段休眠不计；
 * - 本次检查距上次超过 suspendGapMs：worker 自己也被冻住了（系统休眠、进程被挂起），
 *   视为挂起恢复，从现在重新计时，只在缺口 ≥ thresholdMs 时记一条 suspend-gap，不记卡死；
 * - 否则心跳年龄（从 max(心跳, 恢复时刻) 起算）≥ thresholdMs 记 main-hang，回落后记 main-recovered。
 */
export function evaluateHangTick(state: HangTickState, now: number, beat: number, pausedAt: number, thresholdMs: number, suspendGapMs: number): { state: HangTickState; record?: HangRecord } {
  const gap = state.lastTick > 0 ? now - state.lastTick : 0;
  if (pausedAt > 0) return { state: { lastTick: now, resumedAt: now, hungSince: 0 } };
  if (gap > suspendGapMs) {
    const next = { lastTick: now, resumedAt: now, hungSince: 0 };
    return gap >= thresholdMs ? { state: next, record: { event: 'suspend-gap', gapMs: gap } } : { state: next };
  }
  const base = Math.max(beat, state.resumedAt);
  const age = now - base;
  if (age >= thresholdMs) {
    if (state.hungSince) return { state: { ...state, lastTick: now } };
    return { state: { ...state, lastTick: now, hungSince: base }, record: { event: 'main-hang', lagMs: age } };
  }
  if (state.hungSince) return { state: { ...state, lastTick: now, hungSince: 0 }, record: { event: 'main-recovered', hungMs: base - state.hungSince } };
  return { state: { ...state, lastTick: now } };
}

// The watchdog runs on its own thread so it keeps ticking while the main thread is blocked.
// The decision is evaluateHangTick's own source, so the unit-tested function is what runs.
const WATCHDOG_SOURCE = `
const { workerData } = require('node:worker_threads');
const { appendFileSync, statSync, renameSync } = require('node:fs');
const { loadavg } = require('node:os');
const evaluate = (${evaluateHangTick.toString()});
const shared = new Float64Array(workerData.buffer);
let state = { lastTick: 0, resumedAt: 0, hungSince: 0 };
const write = (record) => { try { appendFileSync(workerData.file, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\\n'); } catch {} };
// Keep main-hang.log bounded: one 1 MB generation plus the previous one.
try { if (statSync(workerData.file).size > 1048576) renameSync(workerData.file, workerData.file + '.1'); } catch {}
setInterval(() => {
  const out = evaluate(state, Date.now(), shared[0], shared[1], workerData.thresholdMs, workerData.suspendGapMs);
  state = out.state;
  if (out.record) write({ ...out.record, rssMb: Math.round(process.memoryUsage.rss() / 1048576), load1: Math.round(loadavg()[0] * 100) / 100 });
}, workerData.checkMs);
`;

export interface HangLogRecord { ts: string; event: string; lagMs?: number; hungMs?: number; gapMs?: number }

/** main-hang.log 的最近 limit 条（诊断摘要用）；文件不存在时为空。 */
export function readHangLog(file: string, limit = 5): HangLogRecord[] {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  const out: HangLogRecord[] = [];
  for (const line of text.trim().split('\n').slice(-limit)) {
    try { const r = JSON.parse(line) as HangLogRecord; out.push({ ts: r.ts, event: r.event, ...(r.lagMs !== undefined ? { lagMs: r.lagMs } : {}), ...(r.hungMs !== undefined ? { hungMs: r.hungMs } : {}), ...(r.gapMs !== undefined ? { gapMs: r.gapMs } : {}) }); } catch { /* partial line */ }
  }
  return out;
}

/**
 * 主进程卡死看门狗：主线程每 heartbeatMs 写一次心跳，worker 线程发现心跳超过 thresholdMs
 * 没更新就把卡顿写进 <logDir>/main-hang.log，恢复时再写一条持续时长。
 * pause()/resume() 给休眠/唤醒用（power.ts）：暂停期间不判卡死，恢复时重置心跳。
 * 万一漏了 resume 事件，主线程心跳在暂停超过 maxPauseMs 后自己解除暂停。
 */
export function startMainHangWatchdog(logDir: string, options: { thresholdMs?: number; heartbeatMs?: number; checkMs?: number; suspendGapMs?: number; maxPauseMs?: number } = {}) {
  const thresholdMs = options.thresholdMs ?? 5_000;
  const heartbeatMs = options.heartbeatMs ?? 500;
  const checkMs = options.checkMs ?? 1_000;
  const suspendGapMs = options.suspendGapMs ?? Math.max(2_000, checkMs * 3);
  const maxPauseMs = options.maxPauseMs ?? 6 * 3_600_000;
  mkdirSync(logDir, { recursive: true });
  const file = join(logDir, 'main-hang.log');
  // [0] heartbeat (ms since epoch), [1] pausedAt (0 = running).
  const buffer = new SharedArrayBuffer(16);
  const shared = new Float64Array(buffer);
  shared[0] = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    shared[0] = now;
    if (shared[1] > 0 && now - shared[1] > maxPauseMs) shared[1] = 0;
  }, heartbeatMs);
  timer.unref();
  const worker = new Worker(WATCHDOG_SOURCE, { eval: true, workerData: { buffer, file, thresholdMs, checkMs, suspendGapMs } });
  worker.unref();
  worker.on('error', error => {
    try { appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), event: 'watchdog-error', message: error.message })}\n`); } catch { /* ignore */ }
  });
  return {
    file,
    pause() { if (!shared[1]) shared[1] = Date.now(); },
    resume() { shared[0] = Date.now(); shared[1] = 0; },
    get paused() { return shared[1] > 0; },
    recent(limit?: number) { return readHangLog(file, limit); },
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

/** 事件循环延迟摘要：每 intervalMs 汇总一次，p99 超过 warnMs 记 warn，否则不刷日志。pause/resume 给休眠唤醒用。 */
export function startEventLoopMonitor(log: StabilityLog, options: { intervalMs?: number; warnMs?: number } = {}) {
  const intervalMs = options.intervalMs ?? 60_000;
  const warnMs = options.warnMs ?? 200;
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  let last = { p50Ms: 0, p99Ms: 0, maxMs: 0 };
  let paused = false;
  const sample = () => {
    // 休眠期间计时器停摆，唤醒后第一个样本是整段休眠时长，不是事件循环卡顿。
    if (paused) { histogram.reset(); return last; }
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
    pause() { paused = true; },
    resume() { histogram.reset(); paused = false; },
    stop() { clearInterval(timer); histogram.disable(); },
  };
}

/** The bit of node:inspector's Session the heap trim needs (tests pass a fake). */
export interface InspectorSessionLike {
  connect(): void;
  post(method: string, callback: (error: Error | null) => void): void;
  disconnect(): void;
}
export interface HeapUsage { rss: number; heapTotal: number; heapUsed: number }

const toMb = (bytes: number) => Math.round(bytes / 1024 / 1024);

function post(session: InspectorSessionLike, method: string, timeoutMs: number): Promise<Error | null> {
  return new Promise(resolveCall => {
    let done = false;
    const finish = (error: Error | null) => { if (!done) { done = true; clearTimeout(timer); resolveCall(error); } };
    const timer = setTimeout(() => finish(new Error(`${method} timed out`)), timeoutMs);
    timer.unref?.();
    try { session.post(method, error => finish(error ?? null)); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}

export interface HeapTrimResult { at: number; reason: string; elapsedMs: number; rssMb: [number, number]; heapTotalMb: [number, number]; heapUsedMb: [number, number] }

/**
 * 一次“归还内存”的 GC：经 inspector 调 HeapProfiler.collectGarbage，比 V8 的增量 GC 更积极地
 * 压缩堆、把空页还给系统。返回回收后的 heapTotal；inspector 不可用时只记日志不抛错。
 */
export async function runHeapTrim(log: StabilityLog, reason: string, deps: { createSession: () => InspectorSessionLike; memoryUsage: () => HeapUsage; timeoutMs?: number; onResult?: (result: HeapTrimResult) => void }): Promise<number | undefined> {
  const timeoutMs = deps.timeoutMs ?? 3_000;
  let session: InspectorSessionLike;
  try { session = deps.createSession(); session.connect(); } catch {
    log.info('main', 'heap-trim-skipped', { reason, cause: 'inspector-unavailable' });
    return undefined;
  }
  try {
    const enabled = await post(session, 'HeapProfiler.enable', timeoutMs);
    if (enabled) { log.info('main', 'heap-trim-skipped', { reason, cause: enabled.message }); return undefined; }
    const before = deps.memoryUsage();
    const started = Date.now();
    const failed = await post(session, 'HeapProfiler.collectGarbage', timeoutMs);
    const elapsedMs = Date.now() - started;
    await post(session, 'HeapProfiler.disable', timeoutMs);
    if (failed) { log.warn('main', 'heap-trim-failed', { reason, message: failed.message }); return undefined; }
    const after = deps.memoryUsage();
    const result: HeapTrimResult = {
      at: Date.now(), reason, elapsedMs,
      rssMb: [toMb(before.rss), toMb(after.rss)],
      heapTotalMb: [toMb(before.heapTotal), toMb(after.heapTotal)],
      heapUsedMb: [toMb(before.heapUsed), toMb(after.heapUsed)],
    };
    log.info('main', 'heap-trim', { reason, elapsedMs, rssMb: result.rssMb, heapTotalMb: result.heapTotalMb, heapUsedMb: result.heapUsedMb });
    deps.onResult?.(result);
    return after.heapTotal;
  } finally {
    try { session.disconnect(); } catch { /* ignore */ }
  }
}

/**
 * 启动后堆回收（对标 WorkBuddy post-startup-heap-trim）：启动后 windowMs 内每 pollMs 看一次主进程堆，
 * 堆涨到 minHeapTotalMb 以上且连续 flatPolls 次不再增长（加载高峰过去）时回收一次；之后堆又反弹
 * reboundMb 以上再回收，最多 maxTrims 次。窗口结束还一次都没回收就补一次。主进程同时跑着引擎
 * （Pi SDK + 内置 UpUp 的几百个工具），加载期的临时对象不回收会一直占着 RSS。
 */
export function schedulePostStartupHeapTrim(log: StabilityLog, deps: { createSession: () => InspectorSessionLike; memoryUsage?: () => HeapUsage; onResult?: (result: HeapTrimResult) => void }, options: {
  pollMs?: number; windowMs?: number; minHeapTotalMb?: number; maxGrowthMb?: number; flatPolls?: number; reboundMb?: number; maxTrims?: number;
} = {}) {
  const pollMs = options.pollMs ?? 400;
  const windowMs = options.windowMs ?? 20_000;
  const minHeapTotal = (options.minHeapTotalMb ?? 60) * 1024 * 1024;
  const maxGrowth = (options.maxGrowthMb ?? 1) * 1024 * 1024;
  const flatPolls = options.flatPolls ?? 2;
  const rebound = (options.reboundMb ?? 16) * 1024 * 1024;
  const maxTrims = options.maxTrims ?? 2;
  const memoryUsage = deps.memoryUsage ?? (() => process.memoryUsage());
  let elapsed = 0, trims = 0, flat = 0, lastHeap = 0, baseline = 0;
  let busy = false, stopped = false;
  const trim = (reason: string) => {
    if (busy || stopped || trims >= maxTrims) return;
    trims += 1; busy = true;
    void runHeapTrim(log, reason, { createSession: deps.createSession, memoryUsage, ...(deps.onResult ? { onResult: deps.onResult } : {}) })
      .then(heap => { if (heap !== undefined) baseline = heap; })
      .catch(() => undefined)
      .finally(() => { busy = false; });
  };
  const stop = () => { stopped = true; clearInterval(timer); };
  const timer = setInterval(() => {
    elapsed += pollMs;
    if (elapsed >= windowMs) {
      clearInterval(timer);
      if (trims === 0) trim('window-end');
      stopped = true;
      return;
    }
    if (busy) return;
    const heap = memoryUsage().heapTotal;
    flat = heap - lastHeap <= maxGrowth ? flat + 1 : 0;
    lastHeap = heap;
    const due = baseline > 0 ? heap - baseline >= rebound : heap >= minHeapTotal;
    if (due && flat >= flatPolls) {
      flat = 0;
      trim(baseline > 0 ? 'rebound' : 'burst-settled');
      if (trims >= maxTrims) clearInterval(timer);
    }
  }, pollMs);
  timer.unref();
  return { stop, get trims() { return trims; } };
}
