import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PiPackageCard } from "../PiPackageCard";
import type { MarketplaceEntry } from "../../marketplace-model";

afterEach(() => cleanup());

const baseEntry: MarketplaceEntry = {
  id: "pi-mcp-adapter",
  name: "pi-mcp-adapter",
  publisher: "nicopreme",
  description: "MCP adapter for Pi",
  version: "2.37.0",
  kinds: ["extension"],
  primaryKind: "extension",
  npmName: "pi-mcp-adapter",
  npmUrl: "https://www.npmjs.com/package/pi-mcp-adapter",
  repoUrl: "https://github.com/nicobailon/pi-mcp-adapter",
  reportUrl: "https://example.com/report",
  downloadsLastMonth: 1_013_749,
  updatedAt: "2026-09-23T11:00:00Z",
  sourceLabel: "npm:registry.npmjs.org",
  sourceKind: "official",
  installCommand: "pi install npm:pi-mcp-adapter",
};

describe("PiPackageCard", () => {
  it("renders name, description, author, downloads and age", () => {
    render(<PiPackageCard entry={baseEntry} />);
    expect(screen.getByTestId("pi-package-card")).toBeTruthy();
    expect(screen.getByTestId("pi-package-card")).toHaveAttribute(
      "data-entry-id",
      "pi-mcp-adapter",
    );
    expect(screen.getByText("pi-mcp-adapter")).toBeTruthy();
    expect(screen.getByText("MCP adapter for Pi")).toBeTruthy();
    expect(screen.getByText("nicopreme")).toBeTruthy();
    expect(screen.getByText("1M/mo")).toBeTruthy();
  });

  it("renders install command + copy/install actions", () => {
    render(<PiPackageCard entry={baseEntry} />);
    const cmd = screen.getByTestId("pi-package-install-cmd");
    expect(cmd.textContent).toContain("pi install npm:pi-mcp-adapter");
    expect(screen.getByTestId("pi-package-copy")).toBeTruthy();
  });

  it("does NOT render the UI Install button for official sources", () => {
    render(<PiPackageCard entry={baseEntry} onInstall={() => {}} />);
    expect(screen.queryByTestId("pi-package-install")).toBeNull();
  });

  it("renders UI Install button for community sources", () => {
    render(
      <PiPackageCard
        entry={{ ...baseEntry, sourceKind: "community" }}
        onInstall={() => {}}
      />,
    );
    expect(screen.getByTestId("pi-package-install")).toBeTruthy();
  });

  it("renders npm / repo / report links", () => {
    render(<PiPackageCard entry={baseEntry} />);
    expect(screen.getByTestId("pi-package-link-npm").getAttribute("href")).toContain("npmjs.com");
    expect(screen.getByTestId("pi-package-link-repo").getAttribute("href")).toContain("github.com");
    expect(screen.getByTestId("pi-package-link-report").getAttribute("href")).toContain("report");
  });

  it("shows update-available state when installed version < market version", () => {
    render(
      <PiPackageCard
        entry={{ ...baseEntry, installedVersion: "2.36.0" }}
      />,
    );
    const state = screen.getByTestId("pi-package-install-state");
    expect(state.textContent).toMatch(/update|可更新/);
  });

  it("calls onCopied when Copy is clicked", async () => {
    const onCopied = vi.fn();
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    render(<PiPackageCard entry={baseEntry} onCopied={onCopied} />);
    fireEvent.click(screen.getByTestId("pi-package-copy"));
    expect(clipboard).toHaveBeenCalledWith("pi install npm:pi-mcp-adapter");
    // onCopied is called via the async clipboard path; give it a microtask
    await Promise.resolve();
    expect(onCopied).toHaveBeenCalled();
  });

  it("highlights the matched query substring", () => {
    render(<PiPackageCard entry={baseEntry} query="mcp" />);
    const card = screen.getByTestId("pi-package-card");
    expect(card.innerHTML).toMatch(/<mark[^>]*>mcp<\/mark>/i);
  });

  it("highlights every occurrence of the matched substring (not just the first)", () => {
    const entry = { ...baseEntry, name: "mcp-mcp-adapter-mcp", description: "MCP MCP MCP" };
    render(<PiPackageCard entry={entry} query="mcp" />);
    const card = screen.getByTestId("pi-package-card");
    const marks = card.querySelectorAll("mark");
    expect(marks.length).toBeGreaterThan(1);
  });

  it("does not throw when query has no matches", () => {
    expect(() => render(<PiPackageCard entry={baseEntry} query="zzz-no-match" />)).not.toThrow();
  });

  it("emits blocked state when blockedReason is set", () => {
    render(
      <PiPackageCard
        entry={{ ...baseEntry, blockedReason: "engine mismatch" }}
      />,
    );
    expect(
      screen.getByTestId("pi-package-card").getAttribute("data-install-state"),
    ).toBe("blocked");
  });

  it("renders blocked note with role=note and disables Install for community sources", () => {
    const onInstall = vi.fn();
    render(
      <PiPackageCard
        entry={{ ...baseEntry, sourceKind: "community", blockedReason: "engine mismatch" }}
        onInstall={onInstall}
      />,
    );
    const note = screen.getByTestId("pi-package-blocked-note");
    expect(note.getAttribute("role")).toBe("note");
    expect(note.getAttribute("id")).toBe(`pi-package-blocked-${baseEntry.id}`);
    expect(note.textContent).toBe("engine mismatch");
    const install = screen.getByTestId("pi-package-install") as HTMLButtonElement;
    expect(install.disabled).toBe(true);
    expect(install.getAttribute("aria-describedby")).toBe(`pi-package-blocked-${baseEntry.id}`);
    expect(install.getAttribute("title")).toBe("engine mismatch");
  });

  it("renders Chinese button labels by default (Copy / Install)", () => {
    render(<PiPackageCard entry={baseEntry} />);
    expect(screen.getByTestId("pi-package-copy").textContent).toBe("复制");
  });

  it("renders 安装中… when entry is installing", () => {
    render(
      <PiPackageCard
        entry={{ ...baseEntry, sourceKind: "community" }}
        installing
        onInstall={() => {}}
      />,
    );
    const btn = screen.getByTestId("pi-package-install");
    expect(btn.textContent).toBe("安装中…");
    expect(btn.disabled).toBe(true);
  });

  it("lets hosts override labels via the labels prop", () => {
    render(
      <PiPackageCard
        entry={{ ...baseEntry, sourceKind: "community" }}
        onInstall={() => {}}
        labels={{
          copyLabel: "Copy install cmd",
          copiedLabel: "Copied ✓",
          installLabel: "Install now",
          installingLabel: "Working…",
        }}
      />,
    );
    expect(screen.getByTestId("pi-package-copy").textContent).toBe("Copy install cmd");
    expect(screen.getByTestId("pi-package-install").textContent).toBe("Install now");
  });

  it("flips to copiedLabel after the Copy button is clicked", async () => {
    const onCopied = vi.fn();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<PiPackageCard entry={baseEntry} onCopied={onCopied} />);
    fireEvent.click(screen.getByTestId("pi-package-copy"));
    // handleCopy is async: await clipboard.writeText → setCopied(true).
    // 等两个 microtask 让 setState 生效。
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByTestId("pi-package-copy").textContent).toBe("已复制");
  });
});
