import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@openbuddy/client/agent-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openbuddy/client/agent-client")>()),
  commandsList: vi.fn(async () => [
    { name: "commit", description: "Create a git commit", source: "skill" },
    { name: "compact", description: "Compact context", source: "builtin" },
    { name: "review", description: "Review changes", source: "skill" },
  ]),
}));

import { Composer } from "../Composer";
import { slashToken } from "../SlashCommands";
import { commandsList } from "@openbuddy/client/agent-client";

const base = { streaming: false, onCancel: vi.fn() };
const type = (input: HTMLElement, value: string) =>
  fireEvent.change(input, { target: { value, selectionStart: value.length, selectionEnd: value.length } });

describe("slash commands in the composer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("only treats a slash at the start of a token as a command", () => {
    expect(slashToken("/com", 4)).toEqual({ start: 0, query: "com" });
    expect(slashToken("please /rev", 11)).toEqual({ start: 7, query: "rev" });
    expect(slashToken("see src/app", 11)).toBeNull();
    expect(slashToken("https://x.dev/a", 15)).toBeNull();
  });

  it("does not swallow Enter for paths that contain a slash", () => {
    const onSend = vi.fn();
    render(<Composer {...base} onSend={onSend} />);
    const input = screen.getByRole("textbox");
    type(input, "look at src/app");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("look at src/app");
  });

  it("navigates the menu with arrows and picks with Enter without sending", async () => {
    const onSend = vi.fn();
    render(<Composer {...base} onSend={onSend} />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    type(input, "/co");
    expect(await screen.findByRole("listbox", { name: "可用命令" })).toBeInTheDocument();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringContaining("/commit"),
      expect.stringContaining("/compact"),
    ]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(input.value).toBe("/compact ");
    expect(screen.queryByRole("listbox", { name: "可用命令" })).toBeNull();
  });

  it("closes the menu with Escape so the next Enter sends", async () => {
    const onSend = vi.fn();
    render(<Composer {...base} onSend={onSend} />);
    const input = screen.getByRole("textbox");
    type(input, "/review");
    await screen.findByRole("listbox", { name: "可用命令" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "可用命令" })).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("/review");
  });

  it("never sends an empty message (no silent 你好)", () => {
    const onSend = vi.fn();
    render(<Composer {...base} onSend={onSend} />);
    const input = screen.getByRole("textbox");
    type(input, "   ");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });

  it("reloads the command list every time the menu opens (new skills show up, U4.8)", async () => {
    render(<Composer {...base} onSend={vi.fn()} />);
    const input = screen.getByRole("textbox");
    type(input, "/co");
    await screen.findByRole("listbox", { name: "可用命令" });
    type(input, "/com");
    expect(commandsList).toHaveBeenCalledTimes(1);
    type(input, "");
    vi.mocked(commandsList).mockResolvedValueOnce([{ name: "newskill", description: "刚装的技能", source: "skill" }] as never);
    type(input, "/new");
    expect(await screen.findByText("刚装的技能")).toBeInTheDocument();
    expect(commandsList).toHaveBeenCalledTimes(2);
  });
});
