import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FileTreeView } from "../workspace-panel/FileTreeView";

const { listDir } = vi.hoisted(() => ({ listDir: vi.fn() }));
vi.mock("@openbuddy/client/agent-client", () => ({ listDir }));

const entry = (path: string, name: string, kind: "file" | "directory" = "file") => ({ path, name, kind });

beforeEach(() => {
  listDir.mockReset();
});

describe("FileTreeView (U1.8)", () => {
  it("reloads the root and open folders when artifacts change", async () => {
    listDir.mockResolvedValue([entry("/ws/src", "src", "directory"), entry("/ws/a.md", "a.md")]);
    const { rerender } = render(<FileTreeView rootPath="/ws" onFileSelect={() => {}} refreshKey={0} />);
    await screen.findByText("a.md");
    expect(listDir).toHaveBeenCalledTimes(1);

    // The agent wrote a file: the sidebar must see it without a manual collapse/expand.
    listDir.mockResolvedValue([entry("/ws/src", "src", "directory"), entry("/ws/a.md", "a.md"), entry("/ws/new.md", "new.md")]);
    rerender(<FileTreeView rootPath="/ws" onFileSelect={() => {}} refreshKey={1} />);
    await screen.findByText("new.md");
    expect(listDir).toHaveBeenCalledTimes(2);

    // A later refresh with the same key must not refetch.
    rerender(<FileTreeView rootPath="/ws" onFileSelect={() => {}} refreshKey={1} />);
    await waitFor(() => expect(listDir).toHaveBeenCalledTimes(2));
  });
});
