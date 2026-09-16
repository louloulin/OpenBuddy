import { describe, expect, it, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LazyFileTree } from "../components/LazyFileTree";
import type { LazyFileTreeEntry } from "../components/LazyFileTree";

afterEach(() => cleanup());

const ROOT = "/repo";

const TREE: Record<string, LazyFileTreeEntry[]> = {
  "/repo": [
    { name: "src", path: "/repo/src", kind: "directory", size: 0 },
    { name: "readme.md", path: "/repo/readme.md", kind: "file", size: 2048 },
  ],
  "/repo/src": [
    { name: "a.ts", path: "/repo/src/a.ts", kind: "file", size: 512 },
  ],
};

/** Records which directories were requested, so we can assert on load counts. */
function makeLoader(overrides: Record<string, () => Promise<LazyFileTreeEntry[]>> = {}) {
  const calls: string[] = [];
  const loadDir = vi.fn(async (dir: string) => {
    calls.push(dir);
    const override = overrides[dir];
    if (override) return override();
    return TREE[dir] ?? [];
  });
  return { loadDir, calls };
}

describe("@openbuddy/ui-files-tree/LazyFileTree", () => {
  it("loads and expands the root on mount", async () => {
    const { loadDir, calls } = makeLoader();
    render(<LazyFileTree rootPath={ROOT} loadDir={loadDir} />);
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());
    expect(screen.getByText("readme.md")).toBeTruthy();
    expect(calls).toEqual([ROOT]);
    // Children of the root are visible, but a nested folder is not loaded yet.
    expect(screen.queryByText("a.ts")).toBeNull();
    expect(calls).not.toContain("/repo/src");
  });

  it("loads a folder the first time it is expanded, and only once", async () => {
    const { loadDir, calls } = makeLoader();
    render(<LazyFileTree rootPath={ROOT} loadDir={loadDir} />);
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());

    act(() => {
      fireEvent.click(screen.getByText("src"));
    });
    await waitFor(() => expect(screen.getByText("a.ts")).toBeTruthy());
    expect(calls.filter((c) => c === "/repo/src")).toHaveLength(1);

    // Collapse + re-expand must not hit the loader again (cache is warm).
    act(() => {
      fireEvent.click(screen.getByText("src"));
    });
    expect(screen.queryByText("a.ts")).toBeNull();
    act(() => {
      fireEvent.click(screen.getByText("src"));
    });
    await waitFor(() => expect(screen.getByText("a.ts")).toBeTruthy());
    expect(calls.filter((c) => c === "/repo/src")).toHaveLength(1);
  });

  it("opens a file on single click but does not open a folder", async () => {
    const { loadDir } = makeLoader();
    const onFileSelect = vi.fn();
    render(
      <LazyFileTree rootPath={ROOT} loadDir={loadDir} onFileSelect={onFileSelect} />,
    );
    await waitFor(() => expect(screen.getByText("readme.md")).toBeTruthy());

    act(() => {
      fireEvent.click(screen.getByText("readme.md"));
    });
    expect(onFileSelect).toHaveBeenCalledWith("/repo/readme.md");

    act(() => {
      fireEvent.click(screen.getByText("src"));
    });
    expect(onFileSelect).toHaveBeenCalledTimes(1); // folder click = expand only
    // Let the folder's load settle, otherwise it resolves after the test ends.
    await waitFor(() => expect(screen.getByText("a.ts")).toBeTruthy());
  });

  it("toasts, collapses and allows a retry when a directory read fails", async () => {
    let attempt = 0;
    const { loadDir } = makeLoader({
      "/repo/src": async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("EACCES: permission denied");
        return TREE["/repo/src"];
      },
    });
    const onToast = vi.fn();
    render(<LazyFileTree rootPath={ROOT} loadDir={loadDir} onToast={onToast} />);
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());

    act(() => {
      fireEvent.click(screen.getByText("src"));
    });
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith("读取目录失败:EACCES: permission denied"),
    );
    // The folder must not look "open but empty".
    expect(screen.queryByText("a.ts")).toBeNull();

    act(() => {
      fireEvent.click(screen.getByText("src"));
    });
    await waitFor(() => expect(screen.getByText("a.ts")).toBeTruthy());
    expect(attempt).toBe(2);
  });

  it("offers 打开 / 复制路径 / 刷新 on a file, and no 打开 on a folder", async () => {
    const { loadDir } = makeLoader();
    render(<LazyFileTree rootPath={ROOT} loadDir={loadDir} />);
    await waitFor(() => expect(screen.getByText("readme.md")).toBeTruthy());

    act(() => {
      fireEvent.contextMenu(screen.getByText("readme.md"));
    });
    expect(screen.getByText("打开")).toBeTruthy();
    expect(screen.getByText("复制路径")).toBeTruthy();
    expect(screen.getByText("刷新")).toBeTruthy();

    act(() => {
      fireEvent.mouseDown(document.body); // dismiss
    });
    act(() => {
      fireEvent.contextMenu(screen.getByText("src"));
    });
    expect(screen.queryByText("打开")).toBeNull();
    expect(screen.getByText("刷新")).toBeTruthy();
  });

  it("copies the path through the clipboard API", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const { loadDir } = makeLoader();
    render(<LazyFileTree rootPath={ROOT} loadDir={loadDir} />);
    await waitFor(() => expect(screen.getByText("readme.md")).toBeTruthy());

    act(() => {
      fireEvent.contextMenu(screen.getByText("readme.md"));
    });
    act(() => {
      fireEvent.click(screen.getByText("复制路径"));
    });
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("/repo/readme.md"));
    delete (navigator as unknown as Record<string, unknown>).clipboard;
  });

  it("only shows 在文件夹中显示 when the host can reveal", async () => {
    const { loadDir } = makeLoader();
    const onReveal = vi.fn();
    const { unmount } = render(
      <LazyFileTree rootPath={ROOT} loadDir={loadDir} onReveal={onReveal} />,
    );
    await waitFor(() => expect(screen.getByText("readme.md")).toBeTruthy());
    act(() => {
      fireEvent.contextMenu(screen.getByText("readme.md"));
    });
    act(() => {
      fireEvent.click(screen.getByText("在文件夹中显示"));
    });
    expect(onReveal).toHaveBeenCalledWith("/repo/readme.md");
    unmount();

    const second = render(<LazyFileTree rootPath={ROOT} loadDir={loadDir} />);
    await waitFor(() => expect(screen.getByText("readme.md")).toBeTruthy());
    act(() => {
      fireEvent.contextMenu(screen.getByText("readme.md"));
    });
    expect(screen.queryByText("在文件夹中显示")).toBeNull();
    second.unmount();
  });

  it("shows a size badge for files but not for folders", async () => {
    const { loadDir } = makeLoader();
    render(<LazyFileTree rootPath={ROOT} loadDir={loadDir} />);
    await waitFor(() => expect(screen.getByText("readme.md")).toBeTruthy());
    expect(screen.getByText("2.0 KB")).toBeTruthy();
    expect(screen.queryByText("0 B")).toBeNull();
  });

  it("explains itself when the host forgot the loader or the root", () => {
    const first = render(<LazyFileTree rootPath={ROOT} />);
    expect(screen.getByText(/loadDir/)).toBeTruthy();
    first.unmount();

    const { loadDir } = makeLoader();
    render(<LazyFileTree loadDir={loadDir} />);
    expect(screen.getByText(/未设置工作区目录/)).toBeTruthy();
  });

  it("reports multi-selection when multiSelect is on", async () => {
    const { loadDir } = makeLoader();
    const onSelectionChange = vi.fn();
    render(
      <LazyFileTree
        rootPath={ROOT}
        loadDir={loadDir}
        multiSelect
        onSelectionChange={onSelectionChange}
      />,
    );
    await waitFor(() => expect(screen.getByText("readme.md")).toBeTruthy());
    act(() => {
      fireEvent.click(screen.getByText("src"));
    });
    act(() => {
      fireEvent.click(screen.getByText("readme.md"), { metaKey: true });
    });
    const last = onSelectionChange.mock.calls.at(-1)![0] as Set<string>;
    expect([...last].sort()).toEqual(["/repo/readme.md", "/repo/src"]);
    // Flush the folder load started by the first click.
    await waitFor(() => expect(screen.getByText("a.ts")).toBeTruthy());
  });

  it("clears the cache and reloads when the root changes", async () => {
    const { loadDir, calls } = makeLoader({
      "/other": async () => [
        { name: "x.md", path: "/other/x.md", kind: "file", size: 1 },
      ],
    });
    const view = render(<LazyFileTree rootPath={ROOT} loadDir={loadDir} />);
    await waitFor(() => expect(screen.getByText("readme.md")).toBeTruthy());
    view.rerender(<LazyFileTree rootPath="/other" loadDir={loadDir} />);
    await waitFor(() => expect(screen.getByText("x.md")).toBeTruthy());
    expect(screen.queryByText("readme.md")).toBeNull();
    expect(calls).toEqual([ROOT, "/other"]);
  });
});
