import { describe, it, expect } from "vitest";
import { Buffer } from "node:buffer";
import { deflateRawSync } from "node:zlib";
import {
  listZipEntries,
  extractEntry,
  readZip,
  makeDocZipReader,
  makeDocZipReaderFromBytes,
} from "@openbuddy/files-kb";

/** 构造一个本地文件头 zip 条目(method 由 caller 指定,数据由 caller 预先压缩/原样)。 */
function buildLocalEntry(name: string, method: number, data: Uint8Array): Uint8Array {
  const nameBytes = Buffer.from(name, "utf-8");
  const crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // signature
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(method, 8); // compression method
  header.writeUInt16LE(0, 10); // mod time
  header.writeUInt16LE(0, 12); // mod date
  header.writeUInt32LE(crc, 14); // crc32
  header.writeUInt32LE(data.length, 18); // compressed size
  header.writeUInt32LE(data.length, 22); // uncompressed size(同上,测试简化)
  header.writeUInt16LE(nameBytes.length, 26); // name len
  header.writeUInt16LE(0, 28); // extra len
  return Buffer.concat([header, nameBytes, Buffer.from(data)]);
}

/** 构造一个含多 entry 的 zip(各 entry 用各自 method 的数据)。 */
function buildZip(entries: Array<{ name: string; method: number; data: Uint8Array }>): Uint8Array {
  return Buffer.concat(entries.map((e) => buildLocalEntry(e.name, e.method, e.data)));
}

// CRC32 表(标准多项式 0xedb88320)。
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

describe("zip-reader — STORE (method 0)", () => {
  it("解压未压缩 entry", () => {
    const content = Buffer.from("hello world", "utf-8");
    const zip = buildZip([{ name: "a.txt", method: 0, data: content }]);
    const files = readZip(zip);
    expect(Buffer.from(files["a.txt"]).toString("utf-8")).toBe("hello world");
  });

  it("多 entry 保持名字与内容", () => {
    const zip = buildZip([
      { name: "a.txt", method: 0, data: Buffer.from("AAA") },
      { name: "b.txt", method: 0, data: Buffer.from("BBB") },
    ]);
    const files = readZip(zip);
    expect(Buffer.from(files["a.txt"]).toString()).toBe("AAA");
    expect(Buffer.from(files["b.txt"]).toString()).toBe("BBB");
  });
});

describe("zip-reader — DEFLATE (method 8)", () => {
  it("解压 DEFLATE 压缩 entry(用 zlib 压缩)", () => {
    const original = Buffer.from("a".repeat(500) + "b".repeat(200), "utf-8");
    const compressed = deflateRawSync(original);
    const zip = buildZip([{ name: "word/document.xml", method: 8, data: compressed }]);
    const files = readZip(zip);
    expect(Buffer.from(files["word/document.xml"]).equals(original)).toBe(true);
  });

  it("解压可回引数据(LZ77 距离)", () => {
    // 一段重复内容,zlib 会用回引。
    const original = Buffer.from("ABCABCABCABCABCABCABCABCABCABCABCABCABC", "utf-8");
    const compressed = deflateRawSync(original);
    const zip = buildZip([{ name: "x", method: 8, data: compressed }]);
    expect(Buffer.from(readZip(zip)["x"]).equals(original)).toBe(true);
  });

  it("解压动态 Huffman 大块", () => {
    const original = Buffer.from(
      Array.from({ length: 2000 }, (_, i) => "abcdefghijklmnopqrstuvwxyz".charCodeAt(i % 26)),
    );
    const compressed = deflateRawSync(original);
    const zip = buildZip([{ name: "x", method: 8, data: compressed }]);
    expect(Buffer.from(readZip(zip)["x"]).equals(original)).toBe(true);
  });

  it("STORE + DEFLATE 混合", () => {
    const o1 = Buffer.from("stored text");
    const o2 = Buffer.from("compressed ".repeat(50));
    const zip = buildZip([
      { name: "s.txt", method: 0, data: o1 },
      { name: "d.txt", method: 8, data: deflateRawSync(o2) },
    ]);
    const files = readZip(zip);
    expect(Buffer.from(files["s.txt"]).toString()).toBe("stored text");
    expect(Buffer.from(files["d.txt"]).equals(o2)).toBe(true);
  });
});

describe("zip-reader — listZipEntries / extractEntry", () => {
  it("列出 entry 名", () => {
    const zip = buildZip([
      { name: "a", method: 0, data: Buffer.from("x") },
      { name: "b", method: 0, data: Buffer.from("y") },
    ]);
    expect(listZipEntries(zip).map((e) => e.name)).toEqual(["a", "b"]);
  });

  it("extractEntry 单独解压", () => {
    const original = Buffer.from("hello!", "utf-8");
    const zip = buildZip([{ name: "a", method: 8, data: deflateRawSync(original) }]);
    const [entry] = listZipEntries(zip);
    expect(Buffer.from(extractEntry(zip, entry)).equals(original)).toBe(true);
  });
});

describe("zip-reader → doc-preview ZipReader 适配", () => {
  it("makeDocZipReader 提供 readText/listEntries", () => {
    const r = makeDocZipReader({ "word/document.xml": Buffer.from("<w:p><w:t>x</w:t></w:p>") });
    expect(r.readText("word/document.xml")).toContain("<w:t>x</w:t>");
    expect(r.readText("missing")).toBeNull();
    expect(r.listEntries()).toEqual(["word/document.xml"]);
  });

  it("makeDocZipReaderFromBytes 解压真实 docx 样式 zip", () => {
    const docXml = Buffer.from(
      `<w:document><w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:document>`,
      "utf-8",
    );
    const zip = buildZip([{ name: "word/document.xml", method: 8, data: deflateRawSync(docXml) }]);
    const reader = makeDocZipReaderFromBytes(zip);
    expect(reader.readText("word/document.xml") ?? "").toContain("第一段");
    expect(reader.readText("word/document.xml") ?? "").toContain("第二段");
  });
});
