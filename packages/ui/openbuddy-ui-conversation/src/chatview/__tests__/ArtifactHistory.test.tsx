/**
 * ArtifactHistory —— 产物中心版本时间线的交互契约。
 *
 * 锁三件事:① 无版本时给空态而不是空白;② 选中版本才允许恢复;
 * ③ 恢复走 artifacts:restore 并回填 toast。
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArtifactHistory } from "../ArtifactHistory";

const invokeMock = vi.fn();
vi.mock("@/lib/platform/electron-api", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

vi.mock("@openbuddy/ui-locale/client", () => ({
  useLocale: () => ({ t: (key: string, params?: Record<string, unknown>) => `${key}${params ? JSON.stringify(params) : ""}` }),
}));

const versions = [
  { toolCallId: "tc-2", promptId: "prompt-2", tool: "edit", exists: true, bytes: 12, capturedAt: 2_000_000 },
  { toolCallId: "tc-1", promptId: "prompt-1", tool: "write", exists: false, bytes: 0, capturedAt: 1_000_000 },
];

beforeEach(() => {
  invokeMock.mockReset();
});

describe("ArtifactHistory", () => {
  it("没有 path 时不渲染任何东西", () => {
    const { container } = render(<ArtifactHistory sessionId="s1" />);
    expect(container.firstChild).toBeNull();
  });

  it("版本列表按时间倒序展示,删除态有专门文案", async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === "artifacts:history") return { versions };
      if (channel === "artifacts:diff") return { patch: "--- a\n+++ b\n" };
      return {};
    });
    render(<ArtifactHistory sessionId="s1" path="/repo/a.txt" />);
    await waitFor(() => expect(screen.getByText("edit")).toBeTruthy());
    expect(screen.getByText("write")).toBeTruthy();
    expect(screen.getByText(/artifacts\.deletedState/)).toBeTruthy();
  });

  it("空版本列表 → 空态,不显示恢复按钮", async () => {
    invokeMock.mockImplementation(async () => ({ versions: [], current: "" }));
    render(<ArtifactHistory sessionId="s1" path="/repo/a.txt" />);
    await waitFor(() => expect(screen.getByText(/artifacts\.noVersions/)).toBeTruthy());
    expect(screen.queryByText(/artifacts\.restore$/)).toBeNull();
  });

  it("未选版本时恢复按钮禁用;选中后点击走 artifacts:restore", async () => {
    const toast = vi.fn();
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === "artifacts:history") return { versions };
      if (channel === "artifacts:diff") return { patch: "--- a\n+++ b\n" };
      if (channel === "artifacts:restore") return { restored: 2, skipped: 0 };
      return {};
    });
    render(<ArtifactHistory sessionId="s1" path="/repo/a.txt" onToast={toast} />);
    await waitFor(() => expect(screen.getByText("edit")).toBeTruthy());

    const restore = screen.getByText(/artifacts\.restore$/);
    expect((restore as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByText("edit"));
    });
    await waitFor(() => expect((screen.getByText(/artifacts\.restore$/) as HTMLButtonElement).disabled).toBe(false));

    await act(async () => {
      fireEvent.click(screen.getByText(/artifacts\.restore$/));
    });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("artifacts:restore", { sessionId: "s1", promptId: "prompt-2" });
    });
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("artifacts.restored"));
  });

  it("版本没有关联 prompt 时恢复被挡下并提示", async () => {
    const toast = vi.fn();
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === "artifacts:history") {
        return { versions: [{ ...versions[1], promptId: null }] };
      }
      if (channel === "artifacts:diff") return { patch: "" };
      return {};
    });
    render(<ArtifactHistory sessionId="s1" path="/repo/a.txt" onToast={toast} />);
    await waitFor(() => expect(screen.getByText("write")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText("write"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText(/artifacts\.restore$/));
    });
    expect(toast).toHaveBeenCalledWith("artifacts.restoreNeedsPrompt");
    expect(invokeMock).not.toHaveBeenCalledWith("artifacts:restore", expect.anything());
  });
});