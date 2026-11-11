import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Composer } from "../Composer";

vi.mock("@/lib/ipc", () => ({
  getPathForFile: (file: File) => `/workspace/${file.name}`,
  open: vi.fn(),
}));
const base = { streaming: false, onSend: vi.fn(), onCancel: vi.fn() };
const section = () => document.querySelector(".wb-composer")!;
const drop = (...names: string[]) => fireEvent.drop(section(), { dataTransfer: { files: names.map(name => new File(["content"], name)) } });

describe("Electron DOM file drop", () => {
  beforeEach(() => vi.clearAllMocks());
  it("shows and clears the hover overlay", () => {
    render(<Composer {...base} />);
    fireEvent.dragOver(section());
    expect(screen.getByText("松开以添加文件到对话")).toBeInTheDocument();
    fireEvent.dragLeave(section());
    expect(screen.queryByText("松开以添加文件到对话")).toBeNull();
  });
  it("resolves File paths through preload and deduplicates attachments", () => {
    render(<Composer {...base} />);
    drop("a.ts", "a.ts", "b.md");
    expect(screen.getAllByText("a.ts")).toHaveLength(1);
    expect(screen.getByText("b.md")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "查看文件" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(base.onSend.mock.calls[0][0]).toContain("/workspace/a.ts");
    expect(screen.queryByText("a.ts")).toBeNull();
  });
  it("does not attach dropped files while streaming or disabled", () => {
    render(<Composer {...base} streaming />);
    drop("blocked.ts");
    expect(screen.queryByText("blocked.ts")).toBeNull();
  });
});
