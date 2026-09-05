import { describe, it, expect, beforeEach } from "vitest";
import { Buffer } from "node:buffer";
import { deflateRawSync } from "node:zlib";
import {
  isKnowledgeFile,
  isDocxFile,
  isPptxFile,
  isSheetFile,
  isOfficeFile,
  isAnyKnowledgeFile,
  makeSnippet,
  fileToEntry,
  collectKnowledgeFiles,
  createLocalKbProvider,
  extractDocxText,
  extractPptxText,
  extractSheetText,
  extractOfficeText,
  KB_TEXT_EXTS,
  KB_DOCX_EXTS,
  KB_PPTX_EXTS,
  KB_SHEET_EXTS,
  KB_OFFICE_EXTS,
  type DirectoryReader,
} from "@openbuddy/files-kb";
import { resetKbRegistry } from "@openbuddy/files-kb";

/** 构造一个单 entry 的 method-8(DEFLATE) zip 字节,供 docx 提取测试。 */
function buildDocxZip(documentXml: string): Uint8Array {
  return buildSingleEntryZip("word/document.xml", documentXml);
}

/** 构造任意 entry 名的 zip(用于测试各 OOXML 类型 / 缺关键 entry)。 */
function buildSingleEntryZip(entryName: string, xml: string): Uint8Array {
  const content = Buffer.from(xml, "utf-8");
  const compressed = deflateRawSync(content);
  const name = Buffer.from(entryName, "utf-8");
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0, 6);
  h.writeUInt16LE(8, 8); h.writeUInt16LE(0, 10); h.writeUInt16LE(0, 12);
  h.writeUInt32LE(0, 14); h.writeUInt32LE(compressed.length, 18);
  h.writeUInt32LE(content.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
  return Buffer.concat([h, name, compressed]);
}

/** 构造多 entry 的 zip(pptx 多幻灯片 / xlsx 多 sheet + 共享字符串)。 */
function buildMultiEntryZip(entries: Array<{ name: string; xml: string }>): Uint8Array {
  return Buffer.concat(entries.map((e) => buildSingleEntryZip(e.name, e.xml)));
}

describe("isKnowledgeFile", () => {
  it("支持 md/txt/markdown/mdx/rst/log", () => {
    expect(isKnowledgeFile("a.md")).toBe(true);
    expect(isKnowledgeFile("b.TXT")).toBe(true);
    expect(isKnowledgeFile("c.markdown")).toBe(true);
    expect(isKnowledgeFile("d.mdx")).toBe(true);
    expect(isKnowledgeFile("e.rst")).toBe(true);
  });
  it("不支持其它扩展名(含 docx —— docx 走 isDocxFile)", () => {
    expect(isKnowledgeFile("a.docx")).toBe(false);
    expect(isKnowledgeFile("a.pdf")).toBe(false);
    expect(isKnowledgeFile("noext")).toBe(false);
  });
  it("KB_TEXT_EXTS 含 .md/.txt", () => {
    expect(KB_TEXT_EXTS).toContain(".md");
    expect(KB_TEXT_EXTS).toContain(".txt");
  });
});

describe("isDocxFile / isPptxFile / isSheetFile / isOfficeFile / isAnyKnowledgeFile", () => {
  it("isDocxFile 识别 .docx(大小写不敏感)", () => {
    expect(isDocxFile("note.docx")).toBe(true);
    expect(isDocxFile("NOTE.DOCX")).toBe(true);
    expect(isDocxFile("note.doc")).toBe(false);
    expect(isDocxFile("note.txt")).toBe(false);
  });
  it("isPptxFile 识别 .pptx", () => {
    expect(isPptxFile("deck.pptx")).toBe(true);
    expect(isPptxFile("DECK.PPTX")).toBe(true);
    expect(isPptxFile("deck.ppt")).toBe(false);
  });
  it("isSheetFile 识别 .xlsx", () => {
    expect(isSheetFile("data.xlsx")).toBe(true);
    expect(isSheetFile("DATA.XLSX")).toBe(true);
    expect(isSheetFile("data.xls")).toBe(false);
  });
  it("isOfficeFile 覆盖 docx/pptx/xlsx", () => {
    expect(isOfficeFile("a.docx")).toBe(true);
    expect(isOfficeFile("a.pptx")).toBe(true);
    expect(isOfficeFile("a.xlsx")).toBe(true);
    expect(isOfficeFile("a.pdf")).toBe(false);
  });
  it("KB_OFFICE_EXTS 含三种", () => {
    expect(KB_OFFICE_EXTS).toEqual([".docx", ".pptx", ".xlsx"]);
    expect(KB_DOCX_EXTS).toContain(".docx");
    expect(KB_PPTX_EXTS).toContain(".pptx");
    expect(KB_SHEET_EXTS).toContain(".xlsx");
  });
  it("isAnyKnowledgeFile 覆盖文本 + 全部 OOXML", () => {
    expect(isAnyKnowledgeFile("a.md")).toBe(true);
    expect(isAnyKnowledgeFile("a.txt")).toBe(true);
    expect(isAnyKnowledgeFile("a.docx")).toBe(true);
    expect(isAnyKnowledgeFile("a.pptx")).toBe(true);
    expect(isAnyKnowledgeFile("a.xlsx")).toBe(true);
    expect(isAnyKnowledgeFile("a.pdf")).toBe(false);
  });
});

describe("extractDocxText", () => {
  it("从真实结构 docx zip 提取段落文本", () => {
    const zip = buildDocxZip(
      `<w:document><w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:document>`,
    );
    const text = extractDocxText(zip);
    expect(text).toContain("第一段");
    expect(text).toContain("第二段");
  });
  it("无 word/document.xml 返回 null", () => {
    const zip = buildSingleEntryZip("other.xml", `<x>foo</x>`);
    expect(extractDocxText(zip)).toBeNull();
  });
  it("非 zip 字节返回 null(不抛错)", () => {
    expect(extractDocxText(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});

describe("extractPptxText / extractSheetText / extractOfficeText", () => {
  it("extractPptxText 提取幻灯片文本(按数字序)", () => {
    const zip = buildMultiEntryZip([
      { name: "ppt/slides/slide2.xml", xml: `<a:p><a:t>第二页</a:t></a:p>` },
      { name: "ppt/slides/slide1.xml", xml: `<a:p><a:t>第一页</a:t></a:p>` },
    ]);
    const text = extractPptxText(zip);
    expect(text).toContain("第一页");
    expect(text).toContain("第二页");
  });

  it("extractSheetText 提取表格文本(共享字符串)", () => {
    const zip = buildMultiEntryZip([
      { name: "xl/sharedStrings.xml", xml: `<sst><si><t>姓名</t></si><si><t>年龄</t></si></sst>` },
      {
        name: "xl/worksheets/sheet1.xml",
        xml: `<worksheet><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></worksheet>`,
      },
    ]);
    const text = extractSheetText(zip);
    expect(text).toContain("姓名");
    expect(text).toContain("年龄");
  });

  it("extractOfficeText 按扩展名分发(docx/pptx/xlsx)", () => {
    const docx = buildSingleEntryZip(
      "word/document.xml",
      `<w:p><w:r><w:t>doc</w:t></w:r></w:p>`,
    );
    const pptx = buildMultiEntryZip([
      { name: "ppt/slides/slide1.xml", xml: `<a:p><a:t>slide</a:t></a:p>` },
    ]);
    const xlsx = buildMultiEntryZip([
      { name: "xl/worksheets/sheet1.xml", xml: `<worksheet><row><c><v>cell</v></c></row></worksheet>` },
    ]);
    expect(extractOfficeText(docx, ".docx")).toContain("doc");
    expect(extractOfficeText(pptx, ".pptx")).toContain("slide");
    expect(extractOfficeText(xlsx, ".xlsx")).toContain("cell");
  });

  it("extractOfficeText 未知扩展名返回 null", () => {
    expect(extractOfficeText(buildSingleEntryZip("a", "x"), ".pdf")).toBeNull();
  });

  it("extractPptxText 无幻灯片返回 null", () => {
    expect(extractPptxText(buildSingleEntryZip("other.xml", "<x/>"))).toBeNull();
  });

  it("extractSheetText 无 worksheet 返回 null", () => {
    expect(extractSheetText(buildSingleEntryZip("other.xml", "<x/>"))).toBeNull();
  });
});

describe("makeSnippet", () => {
  it("无 query 返回首行(去标题井号)", () => {
    expect(makeSnippet("# 标题\n正文")).toBe("标题");
  });
  it("命中 query 返回片段(带省略号)", () => {
    const text = "前缀内容 关键词 后续内容".repeat(3);
    const s = makeSnippet(text, "关键词");
    expect(s).toContain("关键词");
  });
  it("命中在开头不加前省略号", () => {
    const s = makeSnippet("关键词在开头", "关键词");
    expect(s.startsWith("…")).toBe(false);
  });
  it("截断到 maxLen", () => {
    const s = makeSnippet("a".repeat(300), "", 50);
    expect(s.length).toBeLessThanOrEqual(51); // 50 + …
  });
  it("空文本返回空串", () => {
    expect(makeSnippet("", "")).toBe("");
  });
  it("去 markdown 标题井号", () => {
    expect(makeSnippet("### 深度标题\n")).toBe("深度标题");
  });
});

describe("fileToEntry", () => {
  it("构造条目(标题去扩展名,source=local)", () => {
    const e = fileToEntry({ name: "笔记.md", path: "/a/笔记.md" }, "内容");
    expect(e?.title).toBe("笔记");
    expect(e?.source).toBe("local");
    expect(e?.url).toBe("/a/笔记.md");
    expect(e?.snippet).toBeDefined();
  });
  it("无 query 总是返回条目", () => {
    expect(fileToEntry({ name: "x.md", path: "/x" }, null)).not.toBeNull();
  });
  it("有 query 且命中标题 → 返回", () => {
    expect(fileToEntry({ name: "React.md", path: "/r" }, null, "react")).not.toBeNull();
  });
  it("有 query 且命中内容 → 返回", () => {
    expect(fileToEntry({ name: "x.md", path: "/x" }, "讲 React 框架", "React")).not.toBeNull();
  });
  it("有 query 且未命中 → null", () => {
    expect(fileToEntry({ name: "x.md", path: "/x" }, "无关内容", "React")).toBeNull();
  });
});

describe("collectKnowledgeFiles", () => {
  // 内存 mock 文件系统。
  function mockReader(fs: Record<string, Array<{ name: string; isDir: boolean }>>, files: Record<string, string> = {}): DirectoryReader {
    return {
      listDir: async (path) => (fs[path] ?? []).map((e) => ({ name: e.name, path: joinPath(path, e.name), isDir: e.isDir })),
      readText: async (path) => files[path] ?? null,
    };
  }
  function joinPath(dir: string, name: string) {
    return dir.endsWith("/") || dir.endsWith("\\") ? dir + name : dir + "/" + name;
  }

  it("递归收集知识文件(跳过非文本)", async () => {
    const reader = mockReader({
      "/root": [
        { name: "a.md", isDir: false },
        { name: "sub", isDir: true },
        { name: "b.pdf", isDir: false },
      ],
      "/root/sub": [
        { name: "c.txt", isDir: false },
      ],
    });
    const files = await collectKnowledgeFiles("/root", reader);
    expect(files.map((f) => f.name).sort()).toEqual(["a.md", "c.txt"]);
  });

  it("遵守 maxDepth", async () => {
    const reader = mockReader({
      "/r": [{ name: "d1", isDir: true }],
      "/r/d1": [{ name: "d2", isDir: true }],
      "/r/d1/d2": [{ name: "deep.md", isDir: false }],
    });
    const files = await collectKnowledgeFiles("/r", reader, { maxDepth: 1 });
    expect(files).toEqual([]);
  });

  it("遵守 maxFiles", async () => {
    const reader = mockReader({
      "/r": Array.from({ length: 10 }, (_, i) => ({ name: `f${i}.md`, isDir: false })),
    });
    const files = await collectKnowledgeFiles("/r", reader, { maxFiles: 3 });
    expect(files).toHaveLength(3);
  });

  it("listDir 失败的目录被跳过", async () => {
    const reader: DirectoryReader = {
      listDir: async () => {
        throw new Error("io");
      },
      readText: async () => null,
    };
    expect(await collectKnowledgeFiles("/r", reader)).toEqual([]);
  });

  it("去重已访问目录", async () => {
    const reader = mockReader({
      "/r": [{ name: "a.md", isDir: false }],
    });
    const files = await collectKnowledgeFiles("/r", reader);
    expect(files).toHaveLength(1);
  });
});

describe("createLocalKbProvider", () => {
  beforeEach(resetKbRegistry);

  it("空 root → isEnabled false,list 返回空", async () => {
    const p = createLocalKbProvider("", { listDir: async () => [], readText: async () => null });
    expect(p.isEnabled()).toBe(false);
    expect(await p.list()).toEqual([]);
  });

  it("有 root → isEnabled true,无 query 列出标题", async () => {
    const reader: DirectoryReader = {
      listDir: async (path) =>
        path === "/kb"
          ? [
              { name: "note.md", path: "/kb/note.md", isDir: false },
              { name: "doc.txt", path: "/kb/doc.txt", isDir: false },
              { name: "img.png", path: "/kb/img.png", isDir: false },
            ]
          : [],
      readText: async () => null,
    };
    const p = createLocalKbProvider("/kb", reader);
    expect(p.isEnabled()).toBe(true);
    const list = await p.list();
    expect(list.map((e) => e.title).sort()).toEqual(["doc", "note"]);
    expect(list.every((e) => e.source === "local")).toBe(true);
  });

  it("有 query → 读内容做命中 + 片段", async () => {
    const reader: DirectoryReader = {
      listDir: async () => [
        { name: "react.md", path: "/kb/react.md", isDir: false },
        { name: "vue.md", path: "/kb/vue.md", isDir: false },
      ],
      readText: async (p) => (p === "/kb/react.md" ? "本文讲解 React Hooks" : "讲 Vue 组合式 API"),
    };
    const p = createLocalKbProvider("/kb", reader);
    const list = await p.list("React");
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("react");
    expect(list[0].snippet).toContain("React");
  });

  it("缓存:多次 list 只扫描一次目录", async () => {
    let scanCount = 0;
    const reader: DirectoryReader = {
      listDir: async () => {
        scanCount++;
        return [{ name: "a.md", path: "/kb/a.md", isDir: false }];
      },
      readText: async () => null,
    };
    const p = createLocalKbProvider("/kb", reader);
    await p.list();
    await p.list();
    expect(scanCount).toBe(1);
  });

  it("rebuild:清缓存并重新扫描(返回新条目数,反映内容变化)", async () => {
    // 目录内容会在两次扫描间变化。
    let files = [{ name: "a.md", path: "/kb/a.md", isDir: false }];
    let scanCount = 0;
    const reader: DirectoryReader = {
      listDir: async () => {
        scanCount++;
        return files;
      },
      readText: async () => null,
    };
    const p = createLocalKbProvider("/kb", reader);
    expect((await p.list()).map((e) => e.title)).toEqual(["a"]);
    expect(scanCount).toBe(1);
    // 模拟目录变化:新增一个文件。
    files = [
      { name: "a.md", path: "/kb/a.md", isDir: false },
      { name: "b.md", path: "/kb/b.md", isDir: false },
    ];
    // 不 rebuild 前,缓存仍是旧的(只 1 个)。
    expect((await p.list()).map((e) => e.title)).toEqual(["a"]);
    expect(scanCount).toBe(1);
    // rebuild:重新扫描 → 2 个,scanCount +1。
    const count = await p.rebuild!();
    expect(count).toBe(2);
    expect(scanCount).toBe(2);
    expect((await p.list()).map((e) => e.title).sort()).toEqual(["a", "b"]);
  });

  it("rebuild 空 root 返回 0", async () => {
    const p = createLocalKbProvider("", { listDir: async () => [], readText: async () => null });
    expect(await p.rebuild!()).toBe(0);
  });

  it("getStats:未扫描时无 fileCount/lastRebuiltAt;list 后有;rebuild 后更新", async () => {
    const reader: DirectoryReader = {
      listDir: async () => [{ name: "a.md", path: "/kb/a.md", isDir: false }],
      readText: async () => null,
    };
    const p = createLocalKbProvider("/kb", reader);
    const stats = async () => await p.getStats!();
    // 未扫描:stats 空。
    let s = await stats();
    expect(s.fileCount).toBeUndefined();
    expect(s.lastRebuiltAt).toBeUndefined();
    // list 触发首次扫描 → fileCount=1,有 lastRebuiltAt。
    await p.list();
    s = await stats();
    expect(s.fileCount).toBe(1);
    expect(typeof s.lastRebuiltAt).toBe("number");
    const t1 = s.lastRebuiltAt!;
    // 等一小段时间再 rebuild,lastRebuiltAt 应更新。
    await new Promise((r) => setTimeout(r, 5));
    await p.rebuild!();
    s = await stats();
    expect(s.fileCount).toBe(1);
    expect(s.lastRebuiltAt!).toBeGreaterThanOrEqual(t1);
  });

  it("getStats 反映目录变化后的新文件数", async () => {
    let files = [{ name: "a.md", path: "/kb/a.md", isDir: false }];
    const reader: DirectoryReader = {
      listDir: async () => files,
      readText: async () => null,
    };
    const p = createLocalKbProvider("/kb", reader);
    await p.list();
    expect((await p.getStats!()).fileCount).toBe(1);
    files = [
      { name: "a.md", path: "/kb/a.md", isDir: false },
      { name: "b.md", path: "/kb/b.md", isDir: false },
      { name: "c.md", path: "/kb/c.md", isDir: false },
    ];
    await p.rebuild!();
    expect((await p.getStats!()).fileCount).toBe(3);
  });

  it("docx 索引:经 readBytes + zip-reader 提取文本并命中 query", async () => {
    const docxBytes = buildDocxZip(
      `<w:document><w:p><w:r><w:t>本文讲解 React Hooks 用法</w:t></w:r></w:p></w:document>`,
    );
    const reader: DirectoryReader = {
      listDir: async () => [{ name: "note.docx", path: "/kb/note.docx", isDir: false }],
      readText: async () => null,
      readBytes: async () => docxBytes,
    };
    const p = createLocalKbProvider("/kb", reader);
    // 无 query:列出标题(docx 标题 = note)。
    const all = await p.list();
    expect(all.map((e) => e.title)).toEqual(["note"]);
    // 有 query 命中 docx 内容。
    const hit = await p.list("React");
    expect(hit).toHaveLength(1);
    expect(hit[0].title).toBe("note");
    expect(hit[0].snippet).toContain("React");
  });

  it("docx 无 readBytes 支持时降级:有 query 不命中内容(标题未命中则跳过)", async () => {
    const reader: DirectoryReader = {
      listDir: async () => [{ name: "note.docx", path: "/kb/note.docx", isDir: false }],
      readText: async () => null,
      // 无 readBytes
    };
    const p = createLocalKbProvider("/kb", reader);
    const hit = await p.list("React");
    expect(hit).toEqual([]);
    // 无 query 仍列出标题。
    expect((await p.list()).map((e) => e.title)).toEqual(["note"]);
  });

  it("collectKnowledgeFiles 同时收集文本与全部 OOXML(docx/pptx/xlsx)", async () => {
    const reader: DirectoryReader = {
      listDir: async (path) =>
        path === "/kb"
          ? [
              { name: "a.md", path: "/kb/a.md", isDir: false },
              { name: "b.docx", path: "/kb/b.docx", isDir: false },
              { name: "c.pptx", path: "/kb/c.pptx", isDir: false },
              { name: "d.xlsx", path: "/kb/d.xlsx", isDir: false },
              { name: "e.pdf", path: "/kb/e.pdf", isDir: false },
            ]
          : [],
      readText: async () => null,
      readBytes: async () => null,
    };
    const files = await collectKnowledgeFiles("/kb", reader);
    expect(files.map((f) => f.name).sort()).toEqual(["a.md", "b.docx", "c.pptx", "d.xlsx"]);
  });

  it("pptx 索引:经 readBytes 提取幻灯片文本并命中 query", async () => {
    const pptxBytes = buildMultiEntryZip([
      { name: "ppt/slides/slide1.xml", xml: `<a:p><a:t>本页讲 React 性能优化</a:t></a:p>` },
    ]);
    const reader: DirectoryReader = {
      listDir: async () => [{ name: "deck.pptx", path: "/kb/deck.pptx", isDir: false }],
      readText: async () => null,
      readBytes: async () => pptxBytes,
    };
    const p = createLocalKbProvider("/kb", reader);
    const all = await p.list();
    expect(all.map((e) => e.title)).toEqual(["deck"]);
    const hit = await p.list("React");
    expect(hit).toHaveLength(1);
    expect(hit[0].title).toBe("deck");
    expect(hit[0].snippet).toContain("React");
  });

  it("xlsx 索引:经 readBytes 提取表格文本并命中 query", async () => {
    const xlsxBytes = buildMultiEntryZip([
      { name: "xl/sharedStrings.xml", xml: `<sst><si><t>销售额</t></si></sst>` },
      {
        name: "xl/worksheets/sheet1.xml",
        xml: `<worksheet><row><c r="A1" t="s"><v>0</v></c></row></worksheet>`,
      },
    ]);
    const reader: DirectoryReader = {
      listDir: async () => [{ name: "data.xlsx", path: "/kb/data.xlsx", isDir: false }],
      readText: async () => null,
      readBytes: async () => xlsxBytes,
    };
    const p = createLocalKbProvider("/kb", reader);
    const hit = await p.list("销售");
    expect(hit).toHaveLength(1);
    expect(hit[0].title).toBe("data");
    expect(hit[0].snippet).toContain("销售");
  });

  it("pptx/xlsx 无 readBytes 支持时降级:有 query 不命中内容,无 query 仍列标题", async () => {
    const reader: DirectoryReader = {
      listDir: async () => [
        { name: "a.pptx", path: "/kb/a.pptx", isDir: false },
        { name: "b.xlsx", path: "/kb/b.xlsx", isDir: false },
      ],
      readText: async () => null,
      // 无 readBytes
    };
    const p = createLocalKbProvider("/kb", reader);
    expect(await p.list("任意内容")).toEqual([]);
    expect((await p.list()).map((e) => e.title).sort()).toEqual(["a", "b"]);
  });
});
