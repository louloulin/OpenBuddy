import { deflateRawSync } from "node:zlib";

/**
 * Minimal ZIP writer for skill export (B1c). No third-party dependency: a skill is a small
 * directory of UTF-8 files, so deflate + a local header per file + one central directory is
 * enough. The reader side is `readWorkBuddyZip`, and tests round-trip through it.
 */
export interface ZipEntry {
  /** Relative path with `/` separators; callers reject `..`, absolute paths and NUL. */
  name: string;
  bytes: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (value: number) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff);
  return buffer;
};
const u32 = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
};

/** A fixed DOS timestamp (2026-01-01 00:00) keeps exports byte-stable for tests. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const FLAG_UTF8 = 0x0800;
const METHOD_DEFLATE = 8;

export function writeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.bytes);
    const compressed = deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(FLAG_UTF8), u16(METHOD_DEFLATE),
      u16(DOS_TIME), u16(DOS_DATE), u32(crc), u32(compressed.length), u32(raw.length),
      u16(name.length), u16(0), name, compressed,
    ]);
    locals.push(local);
    central.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(FLAG_UTF8), u16(METHOD_DEFLATE),
      u16(DOS_TIME), u16(DOS_DATE), u32(crc), u32(compressed.length), u32(raw.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(directory.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...locals, directory, end]);
}
