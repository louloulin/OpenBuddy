/**
 * PermissionInlineCard — 20261031 Phase 0.5/0.7:
 *   - Esc 只在焦点位于卡片内时取消(此前 window 级监听:关 slash/mention 菜单的
 *     Esc 会顺带拒绝审批);
 *   - 只有宿主接受决议后才从队列移除(此前先移除再调 IPC,失败即丢失审批)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const resolveMock = vi.fn();
vi.mock("@/lib/agent/pi-client", () => ({
  piResolvePermission: (...args: unknown[]) => resolveMock(...args),
  permissionModeGet: () => Promise.resolve("default"),
}));

import { usePermissionStore } from "@/stores/permission-store";
import { PermissionInlineCard } from "../PermissionDialog";

const SID = "s-1";

function seed() {
  usePermissionStore.getState().request({
    requestId: "r-1",
    sessionId: SID,
    toolCallId: "",
    toolKind: "apply_command",
    title: "执行命令",
    message: "rm -rf build",
    options: [
      { optionId: "allow", kind: "allow", title: "允许" },
      { optionId: "deny", kind: "deny", title: "拒绝" },
    ],
  } as never);
}

const queued = () => usePermissionStore.getState().queues[SID]?.length ?? 0;

describe("PermissionInlineCard", () => {
  beforeEach(() => {
    resolveMock.mockReset();
    seed();
  });
  afterEach(() => {
    usePermissionStore.setState({ queues: {} });
  });

  it("ignores Esc pressed outside the card", async () => {
    render(
      <>
        <input data-testid="elsewhere" />
        <PermissionInlineCard sessionId={SID} variant="inline" />
      </>,
    );
    screen.getByTestId("elsewhere").focus();
    fireEvent.keyDown(window, { key: "Escape" });
    await act(async () => {});
    expect(resolveMock).not.toHaveBeenCalled();
    expect(queued()).toBe(1);
  });

  it("Esc inside the card cancels the request", async () => {
    resolveMock.mockResolvedValue(undefined);
    render(<PermissionInlineCard sessionId={SID} variant="inline" />);
    (screen.getByTestId("permission-allow") as HTMLButtonElement).focus();
    fireEvent.keyDown(window, { key: "Escape" });
    await act(async () => {});
    expect(resolveMock).toHaveBeenCalledWith("r-1", { optionId: undefined, cancelled: true });
    expect(queued()).toBe(0);
  });

  it("keeps the request when the host rejects the decision", async () => {
    resolveMock.mockRejectedValue(new Error("ipc down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<PermissionInlineCard sessionId={SID} variant="inline" />);
    fireEvent.click(screen.getByTestId("permission-allow"));
    await act(async () => {});
    expect(resolveMock).toHaveBeenCalled();
    expect(queued()).toBe(1);
    expect(screen.getByTestId("permission-card")).toBeTruthy();
  });
});
