import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TaskArtifactsTab } from "../TaskArtifactsTab";

const invoke = vi.fn();
const artifactsWorkspaceList = vi.fn();
vi.mock("@openbuddy/client/ipc", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@openbuddy/client/api/artifacts", () => ({
  artifactsWorkspaceList: (...args: unknown[]) => artifactsWorkspaceList(...args),
}));

describe("任务成果聚合 (G3-5)", () => {
  beforeEach(() => {
    invoke.mockReset().mockResolvedValue(undefined);
    artifactsWorkspaceList.mockReset().mockResolvedValue([
      { sessionId: "s2", sessionTitle: "做图表", path: "/w/chart.mmd", lastAt: 300, exists: true, size: 2048 },
      { sessionId: "s1", sessionTitle: "写周报", path: "/w/report.md", lastAt: 200, exists: true, size: 1024 },
    ]);
  });

  it("聚合多个任务的产物，按最近修改排序", async () => {
    render(<TaskArtifactsTab cwd="/w" searchQuery="" typeFilter="all" />);
    await screen.findByText("chart.mmd");
    const names = screen.getAllByRole("button", { name: /chart\.mmd|report\.md/ }).map((el) => el.textContent);
    expect(names).toEqual(["chart.mmd", "report.md"]);
  });

  it("搜索和类型筛选都能收窄结果", async () => {
    const { rerender } = render(<TaskArtifactsTab cwd="/w" searchQuery="周报" typeFilter="all" />);
    await screen.findByText("report.md");
    expect(screen.queryByText("chart.mmd")).toBeNull();

    rerender(<TaskArtifactsTab cwd="/w" searchQuery="" typeFilter="markdown" />);
    await waitFor(() => expect(screen.getByText("report.md")).toBeInTheDocument());
    expect(screen.queryByText("chart.mmd")).toBeNull();
  });

  it("点文件名用默认应用打开", async () => {
    render(<TaskArtifactsTab cwd="/w" searchQuery="" typeFilter="all" />);
    fireEvent.click(await screen.findByRole("button", { name: "report.md" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("open_path", { path: "/w/report.md" }));
  });

  it("没有产物时给空态", async () => {
    artifactsWorkspaceList.mockResolvedValue([]);
    render(<TaskArtifactsTab cwd="/w" searchQuery="" typeFilter="all" />);
    await screen.findByText("还没有任务成果");
  });
});
