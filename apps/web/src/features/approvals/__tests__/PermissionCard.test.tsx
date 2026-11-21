import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PermissionRequest } from "@openbuddy/protocol/dto";
import { agentResolvePermission } from "@openbuddy/client/agent-client";
import { PermissionCard } from "../PermissionDialog";

vi.mock("@openbuddy/client/agent-client", () => ({ agentResolvePermission: vi.fn(async () => {}) }));
beforeEach(() => { vi.mocked(agentResolvePermission).mockReset().mockResolvedValue(undefined); });

/** `!rm -rf build`: the strong confirmation of a typed command. */
const typed: PermissionRequest = {
  requestId: "typed", sessionId: "s", toolCallId: "user-bash:1", toolKind: "bash", title: "bash",
  rawInput: { command: "rm -rf build" }, destructive: { command: "rm -rf build", paths: ["build"] },
  options: [{ optionId: "allow", kind: "allow", title: "仍要执行" }, { optionId: "deny", kind: "deny", title: "取消" }],
};
/** The agent wants to delete files. */
const deletion: PermissionRequest = {
  requestId: "agent-rm", sessionId: "s", toolCallId: "t1", toolKind: "bash", title: "bash",
  rawInput: { command: "rm -rf out" }, destructive: { command: "rm -rf out", paths: ["out"] },
  options: [
    { optionId: "allow", kind: "allow", title: "允许本次" }, { optionId: "allow_session", kind: "allow_always", title: "本任务允许" },
    { optionId: "deny", kind: "deny", title: "拒绝" },
  ],
};
const ordinary: PermissionRequest = {
  requestId: "write", sessionId: "s", toolCallId: "t2", toolKind: "edit", title: "write", rawInput: { path: "a.md" },
  options: [
    { optionId: "allow", kind: "allow", title: "允许本次" }, { optionId: "allow_session", kind: "allow_always", title: "本任务允许" },
    { optionId: "allow_always", kind: "allow_always", title: "始终允许" }, { optionId: "deny", kind: "deny", title: "拒绝" },
  ],
};

/** The composer was just cleared by the Enter that sent the command; then the card arrives. */
function arrive(request: PermissionRequest) {
  let show: (v: boolean) => void = () => {};
  function Harness() {
    const [visible, setVisible] = useState(false);
    show = setVisible;
    return <><textarea aria-label="composer" defaultValue="" />{visible && <PermissionCard request={request} />}</>;
  }
  render(<Harness />);
  screen.getByLabelText("composer").focus();
  act(() => show(true));
}
const optionIds = () => vi.mocked(agentResolvePermission).mock.calls.map(([, r]) => (r as { optionId: string }).optionId);

describe("PermissionCard keyboard safety", () => {
  it("a second Enter after `!rm -rf build` cancels instead of running it", async () => {
    const user = userEvent.setup();
    arrive(typed);
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(optionIds()).toEqual(["deny"]);
  });

  it("the danger action answers Enter only after a Tab or a click", async () => {
    const user = userEvent.setup();
    arrive(typed);
    const danger = screen.getByRole("button", { name: "仍要执行" });
    act(() => danger.focus()); // programmatic focus is not the user's choice
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(optionIds()).toEqual([]);
    act(() => screen.getByRole("button", { name: "取消" }).focus());
    await user.tab();
    expect(danger).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(optionIds()).toEqual(["allow"]);
  });

  it("a click runs it", async () => {
    const user = userEvent.setup();
    arrive(typed);
    await user.click(screen.getByRole("button", { name: "仍要执行" }));
    expect(optionIds()).toEqual(["allow"]);
  });

  it("the agent's deletions focus 拒绝, also when leaving the reason field", async () => {
    const user = userEvent.setup();
    arrive(deletion);
    expect(screen.getByRole("button", { name: "拒绝" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "拒绝并说明…" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "拒绝" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(optionIds()).toEqual(["deny"]);
  });

  it("ordinary approvals keep Enter on 允许本次", async () => {
    const user = userEvent.setup();
    arrive(ordinary);
    expect(screen.getByRole("button", { name: "允许本次" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(optionIds()).toEqual(["allow"]);
  });
});
