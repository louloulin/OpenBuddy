import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";
import { MyFilesPanel } from "../MyFilesPanel";

const invoke = vi.fn();
const defaultOpenGet = vi.fn();
vi.mock("@openbuddy/client/ipc", () => ({ invoke: (...args: unknown[]) => invoke(...args), open: vi.fn() }));
vi.mock("@openbuddy/client/api/files", () => ({
  defaultOpenGet: (...args: unknown[]) => defaultOpenGet(...args),
  renamePath: vi.fn(),
  readTextFile: vi.fn(async () => "# notes\n\nhello"),
  readFileBase64: vi.fn(async () => ""),
}));
vi.mock("@openbuddy/client/agent-client", () => ({ memoryList: vi.fn(async () => []) }));
vi.mock("@openbuddy/client/api/artifacts", () => ({ artifactsWorkspaceList: vi.fn(async () => []) }));

beforeEach(() => {
  invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "list_dir") return [{ name: "notes.md", path: "/workspace/notes.md", kind: "file", size: 20 }];
    if (command === "read_text_file") return "# notes\n\nhello";
    if (command === "path_stat") return { exists: true, size: 20, mtimeMs: 1 };
    return undefined;
  });
  defaultOpenGet.mockReset().mockResolvedValue({});
});

describe("默认打开方式接入我的文件 (G3-6)", () => {
  it("默认（应用内预览）点文件打开就地预览，不调系统应用", async () => {
    render(<ThemeProvider><MyFilesPanel cwd="/workspace" /></ThemeProvider>);
    await screen.findByText("notes.md");
    fireEvent.click(screen.getByText("notes.md"));
    expect(await screen.findByRole("complementary", { name: "文件预览" })).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("open_path", { path: "/workspace/notes.md" });
  });

  it("偏好设为系统应用时点文件直接交给系统打开", async () => {
    defaultOpenGet.mockResolvedValue({ markdown: "system" });
    render(<ThemeProvider><MyFilesPanel cwd="/workspace" /></ThemeProvider>);
    await screen.findByText("notes.md");
    fireEvent.click(screen.getByText("notes.md"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("open_path", { path: "/workspace/notes.md" }),
    );
    expect(screen.queryByRole("complementary", { name: "文件预览" })).toBeNull();
  });
});
