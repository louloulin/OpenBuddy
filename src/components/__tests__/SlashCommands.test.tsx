import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SlashCommands } from "@openbuddy/ui-workbench";

const commandsListMock = vi.fn();

vi.mock("@/lib/agent/pi-client", () => ({
  commandsList: (...args: unknown[]) => commandsListMock(...args),
  // assistant-facade forwards collaborationOnUpdate to the component; mock
  // must include it so the facade import resolves.
  collaborationOnUpdate: () => () => undefined,
}));

const useRendererContributionsMock = vi.fn();

vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({
  useRendererContributions: (...args: unknown[]) => useRendererContributionsMock(...args),
}));

async function renderAndFlush(ui: React.ReactElement) {
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(ui);
    // Let the mount-time commandsList() promise resolve.
    await Promise.resolve();
    await Promise.resolve();
  });
  if (!result) throw new Error("render did not produce a result");
  return result;
}

describe("SlashCommands", () => {
  beforeEach(() => {
    commandsListMock.mockReset();
    useRendererContributionsMock.mockReset();
    useRendererContributionsMock.mockReturnValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the adapter badge for adapter-projected Pi slash commands", async () => {
    commandsListMock.mockResolvedValue([
      { name: "mcp", description: "Manage MCP servers", source: "adapter:openbuddy-mcp-client", isAdapter: true },
      { name: "commit", description: "Create a commit", source: "builtin", isAdapter: false },
    ]);

    await renderAndFlush(<SlashCommands text="/m" cursor={2} onPick={() => undefined} />);

    await waitFor(() => expect(commandsListMock).toHaveBeenCalledTimes(1));

    const adapterBadge = await screen.findByTestId("slash-cmd-adapter-mcp");
    expect(adapterBadge.textContent).toBe("Adapter");
    expect(adapterBadge.getAttribute("title")).toContain("OpenBuddy");

    // The native commit command should NOT have an adapter badge.
    expect(screen.queryByTestId("slash-cmd-adapter-commit")).toBeNull();

    // Both adapter commands surface, since /m matches both.
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it("invokes onPick with the slash command name when an item is clicked", async () => {
    commandsListMock.mockResolvedValue([
      { name: "compact", description: "Compact conversation", source: "builtin", isAdapter: false },
    ]);

    const onPick = vi.fn();
    await renderAndFlush(<SlashCommands text="/co" cursor={3} onPick={onPick} />);

    const item = await screen.findByText("/compact");
    act(() => {
      fireEvent.click(item);
    });
    expect(onPick).toHaveBeenCalledWith("/compact");
  });

  it("does not render when the user has not typed a slash command", async () => {
    commandsListMock.mockResolvedValue([
      { name: "mcp", description: "MCP", source: "builtin", isAdapter: false },
    ]);
    await renderAndFlush(<SlashCommands text="hello world" cursor={11} onPick={() => undefined} />);
    // commandsList should still be called once on mount, but the menu is hidden.
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
