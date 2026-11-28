import { mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { StabilityLog } from './stability.js';

/** Crashpad writes minidumps into these subfolders of app.getPath('crashDumps'). */
const DUMP_DIRS = ['completed', 'pending', 'new', 'reports'];
const MDMP = 0x504d444d;
const STREAM_MODULES = 4;
const STREAM_EXCEPTION = 6;
const STREAM_MISC = 15;

const WINDOWS_CODES: Record<number, string> = {
  0xc0000005: 'ACCESS_VIOLATION', 0xc0000374: 'HEAP_CORRUPTION', 0xc0000409: 'STACK_BUFFER_OVERRUN',
  0xc00000fd: 'STACK_OVERFLOW', 0xc000001d: 'ILLEGAL_INSTRUCTION', 0xc0000094: 'INT_DIVIDE_BY_ZERO',
  0x80000003: 'BREAKPOINT', 0xe06d7363: 'CPP_EXCEPTION',
};
// macOS: Mach exception types; Linux/macOS crashpad also records POSIX signals.
const MACH_CODES: Record<number, string> = {
  1: 'EXC_BAD_ACCESS', 2: 'EXC_BAD_INSTRUCTION', 3: 'EXC_ARITHMETIC', 5: 'EXC_SOFTWARE', 6: 'EXC_BREAKPOINT',
  10: 'EXC_CRASH', 11: 'EXC_RESOURCE', 12: 'EXC_GUARD', 0x43507378: 'POSIX_SIGNAL',
};
const SIGNALS: Record<number, string> = { 4: 'SIGILL', 5: 'SIGTRAP', 6: 'SIGABRT', 7: 'SIGBUS', 8: 'SIGFPE', 9: 'SIGKILL', 11: 'SIGSEGV' };

export interface MinidumpSummary {
  /** `crash` for a real exception; `dump-without-crash` when Chromium snapshotted a process it killed (hang, kill). */
  kind: 'crash' | 'dump-without-crash' | 'unknown';
  exceptionCode?: number;
  exceptionName?: string;
  exceptionAddress?: string;
  crashThreadId?: number;
  /** Basename + offset, e.g. `Electron Framework+0x1a2b`; paths never leave the dump. */
  fault?: string;
  executable?: string;
  processId?: number;
  product?: string;
  version?: string;
}

type Read = (offset: number, length: number) => Promise<Buffer>;

const STREAM_CRASHPAD_INFO = 0x43500001;
const hex = (value: number | bigint) => `0x${value.toString(16)}`;
const fileName = (path?: string) => path?.split(/[\\/]/).pop();

async function readString(read: Read, rva: number, encoding: 'utf16le' | 'utf8' = 'utf16le'): Promise<string | undefined> {
  const head = await read(rva, 4);
  if (head.length < 4) return undefined;
  return (await read(rva + 4, Math.min(head.readUInt32LE(0), 2048))).toString(encoding);
}

/** Crashpad's simple annotations (product, version, dump-without-crash marker). */
async function readAnnotations(read: Read, rva: number): Promise<Record<string, string>> {
  const info = await read(rva, 44);
  if (info.length < 44) return {};
  const dict = info.readUInt32LE(40);
  if (!dict) return {};
  const count = Math.min((await read(dict, 4)).readUInt32LE(0), 64);
  const entries = await read(dict + 4, count * 8);
  const out: Record<string, string> = {};
  for (let at = 0; at + 8 <= entries.length; at += 8) {
    const key = await readString(read, entries.readUInt32LE(at), 'utf8');
    const value = await readString(read, entries.readUInt32LE(at + 4), 'utf8');
    if (key && value !== undefined) out[key] = value;
  }
  return out;
}

function exceptionName(platform: NodeJS.Platform, code: number, flags: number): string {
  if (platform === 'win32') return WINDOWS_CODES[code] ?? 'UNKNOWN';
  if (platform === 'linux') return SIGNALS[code] ?? `SIGNAL_${code}`;
  // macOS crashpad stores signal crashes as 'CPsx' with the signal number in the flags.
  return MACH_CODES[code] === 'POSIX_SIGNAL' ? SIGNALS[flags] ?? `SIGNAL_${flags}` : MACH_CODES[code] ?? 'UNKNOWN';
}

/** Parse the few streams a crash triage needs: exception, faulting module, process id, crashpad annotations. */
export async function parseMinidump(read: Read, platform: NodeJS.Platform = process.platform): Promise<MinidumpSummary | undefined> {
  const header = await read(0, 32);
  if (header.length < 32 || header.readUInt32LE(0) !== MDMP) return undefined;
  const count = Math.min(header.readUInt32LE(8), 1024);
  const directory = await read(header.readUInt32LE(12), count * 12);
  const streams = new Map<number, { size: number; rva: number }>();
  for (let at = 0; at + 12 <= directory.length; at += 12) {
    streams.set(directory.readUInt32LE(at), { size: directory.readUInt32LE(at + 4), rva: directory.readUInt32LE(at + 8) });
  }
  const summary: MinidumpSummary = { kind: 'unknown' };
  let address: bigint | undefined;
  const exception = streams.get(STREAM_EXCEPTION);
  if (exception) {
    const record = await read(exception.rva, 48);
    if (record.length >= 40) {
      const code = record.readUInt32LE(8);
      address = record.readBigUInt64LE(24);
      Object.assign(summary, { kind: 'crash', exceptionCode: code, exceptionName: exceptionName(platform, code, record.readUInt32LE(12)), exceptionAddress: hex(address), crashThreadId: record.readUInt32LE(0), fault: `<unknown>@${hex(address)}` });
    }
  }
  const modules = streams.get(STREAM_MODULES);
  if (modules) {
    const n = Math.min((await read(modules.rva, 4)).readUInt32LE(0), 4096);
    const list = await read(modules.rva + 4, n * 108);
    for (let at = 0; at + 108 <= list.length; at += 108) {
      const base = list.readBigUInt64LE(at);
      const size = BigInt(list.readUInt32LE(at + 8));
      const nameRva = list.readUInt32LE(at + 20);
      if (at === 0) summary.executable = fileName(await readString(read, nameRva));
      if (address !== undefined && address >= base && address < base + size) summary.fault = `${fileName(await readString(read, nameRva))}+${hex(address - base)}`;
    }
  }
  const misc = streams.get(STREAM_MISC);
  if (misc && misc.size >= 12) {
    const info = await read(misc.rva, 12);
    if (info.length === 12 && (info.readUInt32LE(4) & 1) === 1) summary.processId = info.readUInt32LE(8);
  }
  const crashpad = streams.get(STREAM_CRASHPAD_INFO);
  if (crashpad) {
    const notes = await readAnnotations(read, crashpad.rva);
    if (notes['is-dump-process-without-crashing'] === 'true' && summary.kind !== 'crash') summary.kind = 'dump-without-crash';
    if (notes._productName ?? notes.prod) summary.product = notes._productName ?? notes.prod;
    if (notes._version ?? notes.ver) summary.version = notes._version ?? notes.ver;
  }
  return summary;
}

async function summarizeFile(path: string, platform: NodeJS.Platform) {
  const handle = await open(path, 'r');
  try {
    return await parseMinidump(async (offset, length) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    }, platform);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function listDumps(crashpadDir: string) {
  const found: Array<{ file: string; path: string; mtimeMs: number; size: number }> = [];
  for (const sub of DUMP_DIRS) {
    let names: string[];
    try { names = await readdir(join(crashpadDir, sub)); } catch { continue; }
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.dmp')) continue;
      const path = join(crashpadDir, sub, name);
      const info = await stat(path).catch(() => undefined);
      if (info?.isFile()) found.push({ file: name, path, mtimeMs: info.mtimeMs, size: info.size });
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export interface CrashDumpReport { file: string; mtime: string; sizeKb: number; summary?: MinidumpSummary }

/**
 * Log native crash dumps not reported before (state lives in stateFile), newest first.
 * Runs at startup for the previous session and again after any child/renderer crash.
 */
export async function reportNewCrashDumps(options: {
  crashpadDir: string; stateFile: string; log: StabilityLog;
  platform?: NodeJS.Platform; maxAgeMs?: number; maxDumps?: number; now?: () => number;
}): Promise<CrashDumpReport[]> {
  const now = (options.now ?? Date.now)();
  const maxAgeMs = options.maxAgeMs ?? 7 * 86_400_000;
  let seen: string[] = [];
  try { const parsed = JSON.parse(await readFile(options.stateFile, 'utf8')); if (Array.isArray(parsed)) seen = parsed.filter(v => typeof v === 'string'); } catch { /* first run */ }
  const fresh = (await listDumps(options.crashpadDir)).filter(d => !seen.includes(d.file) && now - d.mtimeMs <= maxAgeMs).slice(0, options.maxDumps ?? 5);
  const reports: CrashDumpReport[] = [];
  for (const dump of fresh) {
    const report: CrashDumpReport = { file: dump.file, mtime: new Date(dump.mtimeMs).toISOString(), sizeKb: Math.round(dump.size / 1024) };
    try { report.summary = await summarizeFile(dump.path, options.platform ?? process.platform); } catch { /* unreadable dump */ }
    const record = { ...report, ...(report.summary ? {} : { parsed: false }) };
    if (report.summary?.kind === 'dump-without-crash') options.log.warn('crash', 'native-crash-dump', record);
    else options.log.error('crash', 'native-crash-dump', record);
    reports.push(report);
    seen.push(dump.file);
  }
  if (reports.length) {
    await mkdir(dirname(options.stateFile), { recursive: true });
    await writeFile(options.stateFile, JSON.stringify(seen.slice(-100)));
  }
  return reports;
}

/** Bound disk use: keep at most `keep` dumps and none older than maxAgeMs. */
export async function pruneCrashDumps(crashpadDir: string, options: { keep?: number; maxAgeMs?: number; now?: () => number } = {}): Promise<string[]> {
  const now = (options.now ?? Date.now)();
  const keep = options.keep ?? 20;
  const maxAgeMs = options.maxAgeMs ?? 30 * 86_400_000;
  const removed: string[] = [];
  for (const [index, dump] of (await listDumps(crashpadDir)).entries()) {
    if (index < keep && now - dump.mtimeMs <= maxAgeMs) continue;
    await rm(dump.path, { force: true }).catch(() => undefined);
    removed.push(basename(dump.path));
  }
  return removed;
}
