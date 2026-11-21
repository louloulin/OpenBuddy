import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { OpenBuddyBridge } from "@openbuddy/client/ipc";
import type { SessionSearchHit } from "@openbuddy/protocol/search";
import { SearchPalette } from "../ShortcutsPanel";
import { findTermFor, searchable } from "../use-content-search";
import { useCapabilitiesStore } from "../../state/capabilities-store";
import { useFindRequestStore } from "../../state/find-request-store";

const hit: SessionSearchHit = {
  sessionId: "s-content", cwd: "/work/reports", title: "整理材料", snippet: "…上周的季度报告已经写完，季度报告里有三张表…",
  matches: [[4, 8], [13, 17]], matchedIn: "content", matchCount: 2, rank: 4, updatedAt: new Date().toISOString(), archived: false,
};
function install(invoke: OpenBuddyBridge["invoke"]) {
  window.openbuddy = {
    invoke,
    listen: () => () => {},
    dialog: { open: async () => null, save: async () => null, ask: async () => false },
    window: { minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {}, isMaximized: async () => false, onResized: () => () => {} },
    getPathForFile: (file) => file.name,
  };
}
const serve = (commands: string[]) => useCapabilitiesStore.getState().apply({ protocolVersion: 1, platform: "desktop", commands, events: [], features: [] });
afterEach(() => { delete window.openbuddy; useCapabilitiesStore.getState().apply(null); useFindRequestStore.setState({ request: undefined }); });

describe("Ctrl/Cmd+K 内容 group (pii W1.4)", () => {
  it("lists message-text hits with highlighted snippets and opens the hit with a find request", async () => {
    const invoke = vi.fn(async (command: string) => (command === "session_search" ? [hit, { ...hit, sessionId: "s-title", matchedIn: "title" as const }] : null));
    install(invoke);
    serve(["host_capabilities", "session_search"]);
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<SearchPalette sessions={[{ sessionId: "s1", title: "季度报告周会", cwd: "" } as never]} onOpen={onOpen} onNewTask={vi.fn()} onClose={onClose} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "季度报告" } });
    expect(await screen.findByText("内容")).toBeInTheDocument();
    expect(screen.getByText("任务")).toBeInTheDocument();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("session_search", { query: "季度报告", cwd: null, limit: 20 }));
    const marks = [...document.querySelectorAll("mark.search-hit__mark")].map((m) => m.textContent);
    expect(marks).toEqual(["季度报告", "季度报告"]);
    // Title-only hits stay in the 任务 group.
    expect(document.querySelector('[data-hit-session="s-title"]')).toBeNull();
    fireEvent.click(document.querySelector('[data-hit-session="s-content"]')!);
    expect(onOpen).toHaveBeenCalledWith({ sessionId: "s-content", cwd: "/work/reports" });
    expect(useFindRequestStore.getState().request).toMatchObject({ sessionId: "s-content", query: "季度报告" });
    expect(onClose).toHaveBeenCalled();
  });

  it("keyboard reaches content hits after the title results", async () => {
    install(vi.fn(async () => [hit]));
    serve(["session_search"]);
    const onOpen = vi.fn();
    render(<SearchPalette sessions={[]} onOpen={onOpen} onNewTask={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "季度" } });
    await screen.findByText("内容");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith({ sessionId: "s-content", cwd: "/work/reports" });
  });

  it("without session_search there is no 内容 group and no search request", async () => {
    const invoke = vi.fn(async () => []);
    install(invoke);
    serve(["host_capabilities"]);
    render(<SearchPalette sessions={[]} onOpen={vi.fn()} onNewTask={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "季度报告" } });
    expect(await screen.findByText(/没有标题包含/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByText("内容")).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("session_search", expect.anything());
  });

  it("picks what the chat find bar should look for", () => {
    expect(searchable("a")).toBe(false);
    expect(searchable("季")).toBe(true);
    expect(searchable("ab")).toBe(true);
    expect(findTermFor("季度报告", hit)).toBe("季度报告");
    expect(findTermFor("三张 季度报告", hit)).toBe("季度报告");
    expect(findTermFor("季度报告 已经", { snippet: "季度报告 已经写完" })).toBe("季度报告 已经");
  });
});
