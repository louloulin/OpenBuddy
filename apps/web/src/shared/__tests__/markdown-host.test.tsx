import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { OpenBuddyBridge } from "@openbuddy/client/ipc";
import { Markdown } from "@openbuddy/markdown";
import { MarkdownHostProvider, getMarkdownHost, setMarkdownHost, type MarkdownHost } from "@openbuddy/markdown/host";
import { createMarkdownHostConfig } from "@openbuddy/markdown/markdown-host";
import { webMarkdownHost } from "../markdown-host";

const block = "```ts\nconst a = 1;\n```";

function stubBridge() {
  const invoke = vi.fn(async (command: string, _payload?: unknown) => (command === "path_stat" ? { exists: true, kind: "file", path: "", absolute: "" } : null));
  window.openbuddy = { invoke } as unknown as OpenBuddyBridge;
  return invoke;
}

afterEach(() => {
  delete window.openbuddy;
  setMarkdownHost(webMarkdownHost);
});

describe("Markdown host (20261115-md R6)", () => {
  it("is the web host in renderer tests, as in the app", () => {
    expect(getMarkdownHost()).toBe(webMarkdownHost);
  });

  it("code block 复制 makes exactly one clipboard_write_text call and flips to 已复制", async () => {
    const invoke = stubBridge();
    render(<MarkdownHostProvider host={webMarkdownHost}><Markdown>{block}</Markdown></MarkdownHostProvider>);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "复制" })); });
    const copies = invoke.mock.calls.filter(([command]) => command === "clipboard_write_text");
    expect(copies).toHaveLength(1);
    expect(copies[0][1]).toEqual({ text: expect.stringContaining("const a = 1;") });
    expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();
  });

  it("non-React helpers reach the same host (path_stat for inline code)", async () => {
    const invoke = stubBridge();
    const config = createMarkdownHostConfig({ cwd: "/w", sessionId: "s" });
    expect(await config.resolveCode!("s", "src/a.ts")).toBe("file");
    expect(invoke).toHaveBeenCalledWith("path_stat", { path: "src/a.ts", cwd: "/w" });
  });

  it("a provider's host serves its subtree", async () => {
    const invoke = stubBridge();
    const copyText = vi.fn(async () => {});
    const host: MarkdownHost = { ...webMarkdownHost, copyText };
    render(<MarkdownHostProvider host={host}><Markdown>{block}</Markdown></MarkdownHostProvider>);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "复制" })); });
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalledWith("clipboard_write_text", expect.anything());
    expect(getMarkdownHost()).toBe(host);
  });
});
