import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { ChatMessage } from "@/features/chat/state/session-store";
import { FindBar } from "../FindBar";
import { requestFind, useFindRequestStore } from "@/app/state/find-request-store";

const message = (id: string, role: "user" | "assistant", text: string): ChatMessage => ({ id, role, parts: [{ kind: "text", text }], complete: true });
const messages = [message("u1", "user", "写一份周报"), message("a1", "assistant", "好的，季度报告如下"), message("u2", "user", "再补充季度报告的风险")];

/** Mirrors ChatView: it owns `open`, and closes the bar when the session changes. */
function Harness({ sessionId, onActive }: { sessionId: string; onActive: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [sid, setSid] = useState(sessionId);
  if (sid !== sessionId) { setSid(sessionId); setOpen(false); }
  return <FindBar messages={messages} sessionId={sessionId} onRequestOpen={() => setOpen(true)} open={open} onClose={() => setOpen(false)} onActiveChange={onActive} />;
}
afterEach(() => useFindRequestStore.setState({ request: undefined }));

describe("FindBar takes a find request from the Ctrl/Cmd+K 内容 group (pii W1.4)", () => {
  it("opens, fills the query and jumps to the first matching message of that session", async () => {
    const onActive = vi.fn();
    requestFind("s1", "季度报告");
    render(<Harness sessionId="s1" onActive={onActive} />);
    const input = await screen.findByRole("textbox", { name: "查找" });
    await waitFor(() => expect(input).toHaveValue("季度报告"));
    expect(screen.getByText("1/2")).toBeInTheDocument();
    await waitFor(() => expect(onActive).toHaveBeenLastCalledWith("a1"));
    expect(useFindRequestStore.getState().request).toBeUndefined();
  });

  it("survives the session switch that closes the bar in the same commit", async () => {
    const { rerender } = render(<Harness sessionId="s0" onActive={vi.fn()} />);
    act(() => requestFind("s2", "风险"));
    rerender(<Harness sessionId="s2" onActive={vi.fn()} />);
    const input = await screen.findByRole("textbox", { name: "查找" });
    await waitFor(() => expect(input).toHaveValue("风险"));
    expect(screen.getByText("1/1")).toBeInTheDocument();
  });

  it("ignores requests for other sessions and stale ones", async () => {
    requestFind("other", "季度报告");
    const { unmount } = render(<Harness sessionId="s1" onActive={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("textbox", { name: "查找" })).toBeNull();
    unmount();
    useFindRequestStore.setState({ request: { sessionId: "s1", query: "季度报告", at: Date.now() - 60_000 } });
    render(<Harness sessionId="s1" onActive={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("textbox", { name: "查找" })).toBeNull();
  });
});
