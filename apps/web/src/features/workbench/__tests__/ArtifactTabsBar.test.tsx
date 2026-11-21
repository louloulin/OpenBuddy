import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ArtifactTabsBar } from "../workspace-panel/ArtifactTabsBar";
import type { UnifiedTab } from "@/features/workbench/use-unified-tabs";

const tabs: UnifiedTab[] = [
  { id: "file:a", kind: "file", label: "a.md", filePath: "/w/a.md", viewWhenActive: "fileTree" },
  { id: "file:b", kind: "file", label: "b.ts", filePath: "/w/b.ts", viewWhenActive: "fileTree" },
  { id: "preview:c", kind: "preview", label: "预览", subtitle: "http://localhost", viewWhenActive: "preview" },
];

function setNarrow(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => setNarrow(false));

describe("ArtifactTabsBar · 窄窗口折叠 (pii W1.9 / U1.2)", () => {
  it("narrow: shows the active tab as a dropdown with every tab inside", () => {
    setNarrow(true);
    const onSelect = vi.fn();
    render(<ArtifactTabsBar tabs={tabs} activeTabId="file:b" onSelect={onSelect} onClose={vi.fn()} />);
    const picker = screen.getByRole("button", { expanded: false });
    expect(picker).toHaveTextContent("b.ts");
    expect(picker).toHaveTextContent("3");
    fireEvent.click(picker);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /a\.md/ }));
    expect(onSelect).toHaveBeenCalledWith("file:a");
  });

  it("wide: keeps the horizontal list and no dropdown", () => {
    render(<ArtifactTabsBar tabs={tabs} activeTabId="file:a" onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("narrow but a single tab: still a plain row", () => {
    setNarrow(true);
    render(<ArtifactTabsBar tabs={[tabs[0]]} activeTabId="file:a" onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });
});
