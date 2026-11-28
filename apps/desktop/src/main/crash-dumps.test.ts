import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseMinidump, pruneCrashDumps, reportNewCrashDumps } from './crash-dumps';

/** Minimal MDMP: header, 3-stream directory, exception, one module, misc info. */
function fakeMinidump(code: number, flags: number, address: bigint): Buffer {
  const buf = Buffer.alloc(1024);
  buf.writeUInt32LE(0x504d444d, 0);
  buf.writeUInt32LE(3, 8);
  buf.writeUInt32LE(32, 12);
  const dir = (i: number, type: number, size: number, rva: number) => { buf.writeUInt32LE(type, 32 + i * 12); buf.writeUInt32LE(size, 36 + i * 12); buf.writeUInt32LE(rva, 40 + i * 12); };
  dir(0, 6, 168, 100);
  dir(1, 4, 112, 300);
  dir(2, 15, 24, 500);
  buf.writeUInt32LE(4242, 100); // thread id
  buf.writeUInt32LE(code, 108);
  buf.writeUInt32LE(flags, 112);
  buf.writeBigUInt64LE(address, 124);
  buf.writeUInt32LE(1, 300); // one module
  buf.writeBigUInt64LE(0x1000n, 304);
  buf.writeUInt32LE(0x10000, 312);
  buf.writeUInt32LE(600, 324); // name rva
  buf.writeUInt32LE(24, 500); buf.writeUInt32LE(1, 504); buf.writeUInt32LE(777, 508);
  const name = Buffer.from('/Applications/OpenBuddy.app/Contents/MacOS/OpenBuddy', 'utf16le');
  buf.writeUInt32LE(name.length, 600); name.copy(buf, 604);
  return buf;
}

const reader = (buf: Buffer) => async (offset: number, length: number) => buf.subarray(offset, offset + length);

describe('原生崩溃转储摘要', () => {
  it('解析异常码、故障模块偏移和 pid，路径只留文件名', async () => {
    const s = await parseMinidump(reader(fakeMinidump(1, 0, 0x1234n)), 'darwin');
    expect(s).toMatchObject({ kind: 'crash', exceptionName: 'EXC_BAD_ACCESS', fault: 'OpenBuddy+0x234', executable: 'OpenBuddy', processId: 777, crashThreadId: 4242 });
    expect(JSON.stringify(s)).not.toContain('/Applications');
    expect((await parseMinidump(reader(fakeMinidump(0x43507378, 11, 0x1n)), 'darwin'))?.exceptionName).toBe('SIGSEGV');
    expect((await parseMinidump(reader(fakeMinidump(0xc0000005, 0, 0x1n)), 'win32'))?.exceptionName).toBe('ACCESS_VIOLATION');
    expect(await parseMinidump(reader(Buffer.from('not a dump')), 'darwin')).toBeUndefined();
    // Chromium 杀掉卡死进程时写的转储没有异常流，靠 crashpad 注解识别。
    const killed = fakeMinidump(1, 0, 0x1n);
    killed.writeUInt32LE(0x43500001, 32); killed.writeUInt32LE(64, 36); killed.writeUInt32LE(700, 40);
    killed.writeUInt32LE(760, 740); // simple annotations dictionary rva
    killed.writeUInt32LE(1, 760); killed.writeUInt32LE(780, 764); killed.writeUInt32LE(830, 768);
    const key = Buffer.from('is-dump-process-without-crashing'); killed.writeUInt32LE(key.length, 780); key.copy(killed, 784);
    killed.writeUInt32LE(4, 830); Buffer.from('true').copy(killed, 834);
    expect(await parseMinidump(reader(killed), 'darwin')).toMatchObject({ kind: 'dump-without-crash', executable: 'OpenBuddy', processId: 777 });
  });

  it('只报告新转储，重复启动不重复报；坏文件记为未解析', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ob-dumps-'));
    mkdirSync(join(root, 'completed'));
    writeFileSync(join(root, 'completed', 'a.dmp'), fakeMinidump(1, 0, 0x1100n));
    writeFileSync(join(root, 'completed', 'b.dmp'), 'garbage');
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const stateFile = join(root, 'state.json');
    const first = await reportNewCrashDumps({ crashpadDir: root, stateFile, log, platform: 'darwin' });
    expect(first.map(r => r.file).sort()).toEqual(['a.dmp', 'b.dmp']);
    expect(log.error).toHaveBeenCalledWith('crash', 'native-crash-dump', expect.objectContaining({ file: 'b.dmp', parsed: false }));
    expect(await reportNewCrashDumps({ crashpadDir: root, stateFile, log, platform: 'darwin' })).toEqual([]);
  });

  it('清理超出数量或过期的转储', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ob-dumps-'));
    mkdirSync(join(root, 'completed'));
    const now = Date.now();
    for (let i = 0; i < 4; i++) {
      const file = join(root, 'completed', `${i}.dmp`);
      writeFileSync(file, 'x');
      const at = new Date(now - i * 60_000);
      utimesSync(file, at, at);
    }
    const old = join(root, 'completed', 'old.dmp');
    writeFileSync(old, 'x');
    utimesSync(old, new Date(now - 40 * 86_400_000), new Date(now - 40 * 86_400_000));
    const removed = await pruneCrashDumps(root, { keep: 3 });
    expect(removed.sort()).toEqual(['3.dmp', 'old.dmp']);
    expect(readdirSync(join(root, 'completed')).sort()).toEqual(['0.dmp', '1.dmp', '2.dmp']);
  });
});
