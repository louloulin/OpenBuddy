/**
 * 端到端冒烟测试:模拟用户从 Sidebar 进入知识库,并搜索 docx/pptx/xlsx 笔记的完整路径。
 *
 * 路径:
 *  1. Sidebar「更多」→ 点击「知识库」→ 断言 onNavigate("知识库")(Sidebar 端入口)
 *  2. KnowledgeBasePanel:mock 一个返回 docx/pptx/xlsx zip 字节的 DirectoryReader,
 *     经「+ 添加本地文件夹」(mock dialog 选目录)注册 local provider;
 *     逐一搜索 docx/pptx/xlsx 内容关键词,断言命中标题 + 片段。
 *
 * 用 Node zlib 构造真实 OOXML zip,复用 extractOfficeText,验证端到端提取 + 搜索。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Buffer } from "node:buffer";
import { deflateRawSync } from "node:zlib";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- Mock desktop filesystem layer (让「添加本地文件夹」可在 vitest 下走通) ---
const openDialog = vi.fn();
vi.mock("@/lib/platform/electron-api", () => ({ open: (...a: unknown[]) => openDialog(...a), invoke: vi.fn() }));

// 用可控的 DirectoryReader 替代真实 desktop implementation。
const mockReader = { listDir: vi.fn(), readText: vi.fn(), readBytes: vi.fn() };
vi.mock("@/lib/files/electron-kb-reader", () => ({
  isElectronAvailable: () => true,
  createElectronDirectoryReader: () => mockReader,
}));

import { Sidebar } from "@openbuddy/ui-sidebar";
import { KnowledgeBasePanel } from "@openbuddy/ui-files";
import { resetKbRegistry, listKbProviders } from "@openbuddy/files-kb";

/** 构造一个单 entry 的 DEFLATE zip 字节。 */
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

// 三份笔记的 zip 字节(docx/pptx/xlsx),内容各含一个可搜索关键词。
const DOCX_BYTES = buildSingleEntryZip(
  "word/document.xml",
  `<w:document><w:p><w:r><w:t>季度财务总结报告</w:t></w:r></w:p></w:document>`,
);
const PPTX_BYTES = Buffer.concat([
  buildSingleEntryZip("ppt/slides/slide1.xml", `<a:p><a:t>产品路线图规划</a:t></a:p>`),
]);
const XLSX_BYTES = Buffer.concat([
  buildSingleEntryZip("xl/sharedStrings.xml", `<sst><si><t>客户名单</t></si></sst>`),
  buildSingleEntryZip(
    "xl/worksheets/sheet1.xml",
    `<worksheet><row><c r="A1" t="s"><v>0</v></c></row></worksheet>`,
  ),
]);

const base = {
  onNewSession: vi.fn(),
  onSelect: vi.fn(),
  onNavigate: vi.fn(),
  onOpenSettings: vi.fn(),
  onToggleCollapse: vi.fn(),
  onToggleWorkspace: vi.fn(),
  onOpenSearch: vi.fn(),
  onPlaceholder: vi.fn(),
  activeNav: "新建任务",
};

describe("知识库端到端冒烟", () => {
  beforeEach(() => {
    resetKbRegistry();
    openDialog.mockReset();
    mockReader.listDir.mockReset();
    mockReader.readText.mockReset();
    mockReader.readBytes.mockReset();
  });

  it("Sidebar「更多」→「知识库」触发 onNavigate(\"知识库\")", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<Sidebar {...base} onNavigate={onNavigate} onToast={vi.fn()} />);
    await user.hover(screen.getByText("更多"));
    const menu = await screen.findByRole("menu");
    expect(menu).toBeInTheDocument();
    fireEvent.click(screen.getByText("知识库"));
    expect(onNavigate).toHaveBeenCalledWith("知识库");
  });

  it("添加本地知识源后,可搜索 docx/pptx/xlsx 并命中(含片段)", async () => {
    // mock 目录:含三种笔记文件。
    mockReader.listDir.mockResolvedValue([
      { name: "report.docx", path: "/notes/report.docx", isDir: false },
      { name: "roadmap.pptx", path: "/notes/roadmap.pptx", isDir: false },
      { name: "clients.xlsx", path: "/notes/clients.xlsx", isDir: false },
    ]);
    mockReader.readBytes.mockImplementation(async (path: string) => {
      if (path.endsWith(".docx")) return DOCX_BYTES;
      if (path.endsWith(".pptx")) return PPTX_BYTES;
      if (path.endsWith(".xlsx")) return XLSX_BYTES;
      return null;
    });
    // mock dialog:选目录。
    openDialog.mockResolvedValue("/notes");

    render(<KnowledgeBasePanel onToast={vi.fn()} />);

    // 1. 初始未配置。
    expect(screen.getByText("未配置知识源")).toBeInTheDocument();

    // 2. 添加本地文件夹。
    fireEvent.click(screen.getByRole("button", { name: /添加本地文件夹/ }));
    await waitFor(() => expect(listKbProviders().length).toBe(1));
    expect(screen.getByText(/1 个源/)).toBeInTheDocument();

    // 3. 搜索 docx 内容。
    const input = screen.getByRole("textbox", { name: "搜索知识库" });
    fireEvent.change(input, { target: { value: "财务" } });
    await waitFor(() => expect(screen.getByText("report")).toBeInTheDocument());
    // 片段含命中关键词。
    expect(screen.getByText(/财务总结报告/)).toBeInTheDocument();

    // 4. 搜索 pptx 内容。
    fireEvent.change(input, { target: { value: "路线图" } });
    await waitFor(() => expect(screen.getByText("roadmap")).toBeInTheDocument());
    expect(screen.getByText(/产品路线图规划/)).toBeInTheDocument();

    // 5. 搜索 xlsx 内容。
    fireEvent.change(input, { target: { value: "客户" } });
    await waitFor(() => expect(screen.getByText("clients")).toBeInTheDocument());
    expect(screen.getByText(/客户名单/)).toBeInTheDocument();

    // 6. 无命中显示空态。
    fireEvent.change(input, { target: { value: "不存在的内容zzz" } });
    await waitFor(() => expect(screen.getByText("无匹配结果")).toBeInTheDocument());
  });

  it("移除已添加的本地知识源后回到未配置态", async () => {
    mockReader.listDir.mockResolvedValue([]);
    openDialog.mockResolvedValue("/notes");
    render(<KnowledgeBasePanel onToast={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /添加本地文件夹/ }));
    await waitFor(() => expect(screen.getByText(/1 个源/)).toBeInTheDocument());
    // 点击移除按钮。
    fireEvent.click(screen.getByRole("button", { name: "移除知识源 本地文件夹" }));
    await waitFor(() => expect(screen.getByText("未配置知识源")).toBeInTheDocument());
    expect(listKbProviders().length).toBe(0);
  });
});
