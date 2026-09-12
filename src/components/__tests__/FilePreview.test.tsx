import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FilePreview } from "@openbuddy/ui-workbench";

// Mock the pdfjs lazy loader — jsdom has no real canvas/worker, so unit
// tests drive either a fake pdfjs (canvas path) or a rejection (iframe
// fallback). The loader module itself is never evaluated.
const { loadPdfJsMock } = vi.hoisted(() => ({
  loadPdfJsMock: vi.fn(),
}));
vi.mock("../../../packages/ui/openbuddy-ui-workbench/src/pdfjs-loader", () => ({
  loadPdfJs: loadPdfJsMock,
}));

// Univer is a ~5MB lazy chunk with a real render engine — never loaded in
// jsdom. Default both runtimes to "unavailable" so the read-only preview
// assertions below exercise the fallback, and let the Univer-specific
// tests opt into a fake runtime.
const { loadUniverSheetMock, loadUniverDocMock } = vi.hoisted(() => ({
  loadUniverSheetMock: vi.fn(),
  loadUniverDocMock: vi.fn(),
}));
vi.mock("../../../packages/ui/openbuddy-ui-workbench/src/univer-loader", () => ({
  loadUniverSheet: loadUniverSheetMock,
  loadUniverDoc: loadUniverDocMock,
}));

beforeEach(() => {
  loadPdfJsMock.mockReset();
  // Default: pdfjs unavailable → FilePreview falls back to the iframe.
  loadPdfJsMock.mockRejectedValue(new Error("pdfjs unavailable"));
  loadUniverSheetMock.mockReset();
  loadUniverDocMock.mockReset();
  loadUniverSheetMock.mockRejectedValue(new Error("univer unavailable"));
  loadUniverDocMock.mockRejectedValue(new Error("univer unavailable"));
});

/** Fake Univer runtime: records the data it was handed, exposes dispose. */
function fakeUniverRuntime() {
  const dispose = vi.fn();
  const created: unknown[] = [];
  return {
    dispose,
    created,
    runtime: {
      create(container: HTMLElement, data: unknown) {
        created.push(data);
        const marker = document.createElement("div");
        marker.className = "univer-mounted";
        container.appendChild(marker);
        return { univer: { dispose }, univerAPI: {} };
      },
    },
  };
}

function fakePdfPage(width = 300, height = 400) {
  return {
    getViewport: ({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale,
    }),
    render: () => ({ promise: Promise.resolve() }),
    cleanup: vi.fn(),
  };
}

function fakePdfDoc(numPages: number) {
  return {
    numPages,
    getPage: vi.fn(async () => fakePdfPage()),
    destroy: vi.fn(async () => {}),
  };
}

describe("FilePreview", () => {
  it("markdown 渲染文件名 + Markdown 标签 + 正文", () => {
    render(<FilePreview filename="readme.md" content="# 标题" />);
    expect(screen.getByText("readme.md")).toBeInTheDocument();
    expect(screen.getByText("Markdown")).toBeInTheDocument();
    expect(screen.getByText("标题")).toBeInTheDocument();
  });

  it("image 渲染 <img>", () => {
    render(<FilePreview filename="pic.png" content="data:image/png;base64,xxx" />);
    const img = screen.getByAltText("pic.png") as HTMLImageElement;
    expect(img.src).toContain("data:image/png;base64,xxx");
  });

  it("code 渲染语言标签 + 复制按钮", () => {
    render(<FilePreview filename="app.tsx" content="const x = 1;" />);
    expect(screen.getByText("tsx")).toBeInTheDocument();
    expect(screen.getByText("const x = 1;")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制内容" })).toBeInTheDocument();
  });

  it("复制按钮回调 onCopyText 并切换文案", () => {
    const onCopyText = vi.fn();
    render(
      <FilePreview filename="a.txt" content="hello" onCopyText={onCopyText} />,
    );
    const btn = screen.getByRole("button", { name: "复制内容" });
    fireEvent.click(btn);
    expect(onCopyText).toHaveBeenCalledWith("hello");
    expect(screen.getByText("已复制")).toBeInTheDocument();
  });

  it("text 渲染 lang=text", () => {
    render(<FilePreview filename="notes.txt" content="一行文本" />);
    expect(screen.getByText("text")).toBeInTheDocument();
    expect(screen.getByText("一行文本")).toBeInTheDocument();
  });

  it("audio 渲染 HTML5 <audio>", () => {
    render(<FilePreview filename="song.mp3" content="data:audio/mp3;base64,xxx" />);
    const audio = document.querySelector("audio") as HTMLAudioElement;
    expect(audio).not.toBeNull();
    expect(audio.getAttribute("src")).toContain("data:audio/mp3");
    expect(audio.hasAttribute("controls")).toBe(true);
  });

  it("video 渲染 HTML5 <video>", () => {
    render(<FilePreview filename="clip.mp4" content="data:video/mp4;base64,xxx" />);
    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.getAttribute("src")).toContain("data:video/mp4");
    expect(video.hasAttribute("controls")).toBe(true);
  });

  it("audio/video 不走 binary 占位", () => {
    render(<FilePreview filename="song.mp3" content="x" />);
    expect(screen.queryByText(/暂不支持内嵌预览/)).toBeNull();
  });

  it("pdf 优先 PDF.js canvas 渲染并显示页数", async () => {
    const doc = fakePdfDoc(2);
    loadPdfJsMock.mockResolvedValue({
      getDocument: () => ({ promise: Promise.resolve(doc) }),
    } as never);
    render(<FilePreview filename="doc.pdf" content="data:application/pdf;base64,eA==" />);

    await waitFor(() =>
      expect(
        document.querySelectorAll("canvas.file-preview__pdf-page"),
      ).toHaveLength(2),
    );
    expect(screen.getByText("共 2 页")).toBeInTheDocument();
    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("pdf 在 pdfjs 不可用时降级为 <iframe>(浏览器原生预览)", async () => {
    render(<FilePreview filename="doc.pdf" content="data:application/pdf;base64,xxx" />);
    const iframe = (await screen.findByTitle("doc.pdf")) as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toContain("data:application/pdf");
  });

  it("pdf 解析损坏文件时同样降级 <iframe>", async () => {
    loadPdfJsMock.mockResolvedValue({
      getDocument: () => ({
        promise: Promise.reject(new Error("Invalid PDF structure")),
      }),
    } as never);
    render(<FilePreview filename="doc.pdf" content="data:application/pdf;base64,xxxx" />);
    const iframe = (await screen.findByTitle("doc.pdf")) as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toContain("data:application/pdf");
  });

  it("pdf 不走 binary 占位", () => {
    render(<FilePreview filename="doc.pdf" content="x" />);
    expect(screen.queryByText(/暂不支持内嵌预览/)).toBeNull();
  });

  // ---------- 文档预览(docx/pptx/sheet)----------
  it("docx 无 docExtractor 时显示降级占位", () => {
    render(<FilePreview filename="report.docx" content="binary" />);
    expect(screen.getByText("Word")).toBeInTheDocument();
    expect(screen.getByText(/需要文档解析器/)).toBeInTheDocument();
  });

  // 注:docx/xlsx 现在默认先尝试挂载 Univer 编辑器(office1 阶段 1),
  // 只读文本/表格是 Univer 不可用后的降级视图,所以断言要 await。
  it("docx 有 docExtractor 时渲染提取的段落文本", async () => {
    const zip = {
      readText: () => `<w:p><w:r><w:t>第一段</w:t></w:r></w:p>`,
      listEntries: () => ["word/document.xml"],
    };
    render(
      <FilePreview
        filename="report.docx"
        content="binary"
        docExtractor={() => zip}
      />,
    );
    expect(await screen.findByText("第一段")).toBeInTheDocument();
  });

  it("pptx 有 docExtractor 时渲染幻灯片文本", () => {
    const zip = {
      readText: () => `<a:p><a:t>幻灯片标题</a:t></a:p>`,
      listEntries: () => ["ppt/slides/slide1.xml"],
    };
    render(
      <FilePreview
        filename="deck.pptx"
        content="binary"
        docExtractor={() => zip}
      />,
    );
    expect(screen.getByText("幻灯片标题")).toBeInTheDocument();
  });

  it("sheet 有 docExtractor 时渲染表格(<table>)", async () => {
    const zip = {
      readText: (p: string) =>
        p.includes("sharedStrings")
          ? `<sst><si><t>姓名</t></si></sst>`
          : `<worksheet><row><c t="s"><v>0</v></c></row></worksheet>`,
      listEntries: () => ["xl/sharedStrings.xml", "xl/worksheets/sheet1.xml"],
    };
    render(
      <FilePreview
        filename="data.xlsx"
        content="binary"
        docExtractor={() => zip}
      />,
    );
    expect(await screen.findByText("姓名")).toBeInTheDocument();
    expect(document.querySelector("table")).not.toBeNull();
  });

  it("docx 复制文本按钮回调 onCopyText", async () => {
    const onCopyText = vi.fn();
    const zip = {
      readText: () => `<w:p><w:r><w:t>内容</w:t></w:r></w:p>`,
      listEntries: () => ["word/document.xml"],
    };
    render(
      <FilePreview
        filename="r.docx"
        content="binary"
        docExtractor={() => zip}
        onCopyText={onCopyText}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "复制文本" }));
    expect(onCopyText).toHaveBeenCalledWith("内容");
  });

  it("docx 默认解压器:从 data: URL(base64 zip)提取文本(运行时路径)", async () => {
    // 用 Node zlib 构造一个真实 DEFLATE docx zip,转 base64 data: URL。
    const { Buffer } = await import("node:buffer");
    const { deflateRawSync } = await import("node:zlib");
    const docXml = Buffer.from(
      `<w:document><w:p><w:r><w:t>真实文档</w:t></w:r></w:p></w:document>`,
      "utf-8",
    );
    const compressed = deflateRawSync(docXml);
    const name = Buffer.from("word/document.xml", "utf-8");
    const crc = 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0, 6);
    h.writeUInt16LE(8, 8); h.writeUInt16LE(0, 10); h.writeUInt16LE(0, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(compressed.length, 18);
    h.writeUInt32LE(docXml.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    const zip = Buffer.concat([h, name, compressed]);
    const dataUrl = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${zip.toString("base64")}`;
    render(<FilePreview filename="report.docx" content={dataUrl} />);
    expect(await screen.findByText("真实文档")).toBeInTheDocument();
  });

  it("binary 显示占位文案", () => {
    render(<FilePreview filename="archive.zip" content="" />);
    expect(screen.getByText(/暂不支持内嵌预览/)).toBeInTheDocument();
  });

  it("zip 等未知类型也走 binary 占位", () => {
    render(<FilePreview filename="archive.zip" content="" />);
    expect(screen.getByText(/暂不支持内嵌预览/)).toBeInTheDocument();
    expect(screen.getByText("文件")).toBeInTheDocument();
  });

  // ---------- Univer 可编辑视图(office1 阶段 1)----------
  const sheetZip = {
    readText: (p: string) =>
      p.includes("sharedStrings")
        ? `<sst><si><t>姓名</t></si></sst>`
        : `<worksheet><row><c t="s"><v>0</v></c></row></worksheet>`,
    listEntries: () => ["xl/sharedStrings.xml", "xl/worksheets/sheet1.xml"],
  };
  const docxZip = {
    readText: () => `<w:p><w:r><w:t>正文段落</w:t></w:r></w:p>`,
    listEntries: () => ["word/document.xml"],
  };

  it("xlsx 在 Univer 可用时挂载可编辑表格并传入桥接后的 workbook 数据", async () => {
    const fake = fakeUniverRuntime();
    loadUniverSheetMock.mockResolvedValue(fake.runtime as never);
    render(
      <FilePreview filename="data.xlsx" content="binary" docExtractor={() => sheetZip} />,
    );

    await waitFor(() =>
      expect(document.querySelector(".univer-mounted")).not.toBeNull(),
    );
    expect(screen.getByText("可编辑")).toBeInTheDocument();
    // 桥接层应已把 sheet 转成 Univer workbook 结构。
    const wb = fake.created[0] as {
      sheetOrder: string[];
      sheets: Record<string, { cellData: Record<number, Record<number, { v: string }>> }>;
    };
    expect(wb.sheetOrder).toEqual(["sheet-1"]);
    expect(wb.sheets["sheet-1"].cellData[0][0]).toEqual({ v: "姓名" });
  });

  it("docx 在 Univer 可用时挂载可编辑文档并传入 dataStream", async () => {
    const fake = fakeUniverRuntime();
    loadUniverDocMock.mockResolvedValue(fake.runtime as never);
    render(
      <FilePreview filename="report.docx" content="binary" docExtractor={() => docxZip} />,
    );

    await waitFor(() =>
      expect(document.querySelector(".univer-mounted")).not.toBeNull(),
    );
    const doc = fake.created[0] as { body: { dataStream: string } };
    expect(doc.body.dataStream).toContain("正文段落");
    expect(doc.body.dataStream.endsWith("\r\n")).toBe(true);
  });

  it("Univer chunk 拉取失败时降级为只读表格", async () => {
    render(
      <FilePreview filename="data.xlsx" content="binary" docExtractor={() => sheetZip} />,
    );
    expect(await screen.findByText("姓名")).toBeInTheDocument();
    expect(document.querySelector("table")).not.toBeNull();
    expect(screen.queryByText("可编辑")).toBeNull();
  });

  it("univerEditing=false 强制只读,不加载 Univer", async () => {
    const fake = fakeUniverRuntime();
    loadUniverSheetMock.mockResolvedValue(fake.runtime as never);
    render(
      <FilePreview
        filename="data.xlsx"
        content="binary"
        docExtractor={() => sheetZip}
        univerEditing={false}
      />,
    );
    expect(await screen.findByText("姓名")).toBeInTheDocument();
    expect(loadUniverSheetMock).not.toHaveBeenCalled();
  });

  it("pptx 不走 Univer(无开源 slides preset),保持只读文本", async () => {
    const fake = fakeUniverRuntime();
    loadUniverSheetMock.mockResolvedValue(fake.runtime as never);
    loadUniverDocMock.mockResolvedValue(fake.runtime as never);
    const pptxZip = {
      readText: () => `<a:p><a:t>幻灯片</a:t></a:p>`,
      listEntries: () => ["ppt/slides/slide1.xml"],
    };
    render(
      <FilePreview filename="deck.pptx" content="binary" docExtractor={() => pptxZip} />,
    );
    expect(await screen.findByText("幻灯片")).toBeInTheDocument();
    expect(loadUniverSheetMock).not.toHaveBeenCalled();
    expect(loadUniverDocMock).not.toHaveBeenCalled();
  });

  it("卸载时 dispose Univer 实例(防止渲染引擎泄漏)", async () => {
    const fake = fakeUniverRuntime();
    loadUniverSheetMock.mockResolvedValue(fake.runtime as never);
    const { unmount } = render(
      <FilePreview filename="data.xlsx" content="binary" docExtractor={() => sheetZip} />,
    );
    await waitFor(() =>
      expect(document.querySelector(".univer-mounted")).not.toBeNull(),
    );
    unmount();
    expect(fake.dispose).toHaveBeenCalledTimes(1);
  });
});
