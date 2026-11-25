import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ArtifactShare } from "../ArtifactShare";

const invoke = vi.fn();
const readTextFile = vi.fn();
const saveTextAs = vi.fn();
const copyText = vi.fn();
vi.mock("@openbuddy/client/ipc", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@openbuddy/client/agent-client", () => ({
  readTextFile: (...args: unknown[]) => readTextFile(...args),
  saveTextAs: (...args: unknown[]) => saveTextAs(...args),
}));
vi.mock("@openbuddy/platform/clipboard", () => ({ copyText: (...args: unknown[]) => copyText(...args) }));

describe("产物分享与可见性 (G3-4)", () => {
  beforeEach(() => {
    invoke.mockReset().mockResolvedValue(undefined);
    readTextFile.mockReset().mockResolvedValue("body");
    saveTextAs.mockReset().mockResolvedValue("/tmp/x.md");
    copyText.mockReset().mockResolvedValue(undefined);
  });

  it("可见性是只读的「仅本机」，云端链接诚实禁用", () => {
    render(<ArtifactShare path="/w/a.md" available onClose={() => {}} onToast={() => {}} />);
    expect(screen.getByRole("note")).toHaveTextContent("仅本机");
    expect(screen.getByRole("button", { name: /云端链接/ })).toBeDisabled();
  });

  it("本地分享：复制内容 / 用默认应用打开 / 在文件夹中显示都走真实命令", async () => {
    const onToast = vi.fn();
    render(<ArtifactShare path="/w/a.md" available onClose={() => {}} onToast={onToast} />);
    fireEvent.click(screen.getByRole("button", { name: /复制内容/ }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith("body"));

    fireEvent.click(screen.getByRole("button", { name: /用默认应用打开/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("open_path", { path: "/w/a.md" }));

    fireEvent.click(screen.getByRole("button", { name: /在文件夹中显示/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("reveal_in_folder", { path: "/w/a.md" }));
  });

  it("文件已删除时只保留复制路径", () => {
    render(<ArtifactShare path="/w/a.md" available={false} onClose={() => {}} onToast={() => {}} />);
    expect(screen.getByRole("button", { name: /复制内容/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /用默认应用打开/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /复制路径/ })).toBeEnabled();
  });
});
