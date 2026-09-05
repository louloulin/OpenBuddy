/**
 * MVP-3 — SubagentIndicator unit tests.
 *
 * Covers:
 *   1. Pure helpers (subagentStatusGlyph / subagentStatusClass /
 *      formatSubagentDuration / shortSubagentId)
 *   2. SubagentIndicator component behaviour: hides when empty, shows compact
 *      badge when collapsed, expands into list with per-child rows.
 *   3. SessionRowWithSubagents forwards every SessionRow prop verbatim.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useSubagentStore } from "@/stores/subagent-store";
import {
  SubagentIndicator,
  SessionRowWithSubagents,
} from "../src/SubagentIndicator";
import {
  subagentStatusGlyph,
  subagentStatusClass,
  formatSubagentDuration,
  shortSubagentId,
} from "@/lib/agent/subagents";

beforeEach(() => {
  cleanup();
  // Reset the subagent store between tests so bySession doesn't leak.
  useSubagentStore.setState({ bySession: {} }, false);
});

// ---------- 1. pure helpers ----------

describe("subagentStatusGlyph", () => {
  it("returns ▶ for running", () => {
    expect(subagentStatusGlyph("running")).toBe("▶");
  });
  it("returns ✓ for completed variants", () => {
    expect(subagentStatusGlyph("completed")).toBe("✓");
    expect(subagentStatusGlyph("done")).toBe("✓");
    expect(subagentStatusGlyph("success")).toBe("✓");
  });
  it("returns ✗ for failed variants", () => {
    expect(subagentStatusGlyph("failed")).toBe("✗");
    expect(subagentStatusGlyph("error")).toBe("✗");
  });
  it("returns ○ for cancelled variants", () => {
    expect(subagentStatusGlyph("cancelled")).toBe("○");
    expect(subagentStatusGlyph("canceled")).toBe("○");
  });
  it("falls back gracefully on undefined / unknown", () => {
    expect(subagentStatusGlyph(undefined)).toBe("•");
    expect(subagentStatusGlyph("frobnicating")).toBe("•");
  });
});

describe("subagentStatusClass", () => {
  it("maps status strings to CSS class suffix", () => {
    expect(subagentStatusClass("running")).toBe("running");
    expect(subagentStatusClass("completed")).toBe("completed");
    expect(subagentStatusClass("failed")).toBe("failed");
    expect(subagentStatusClass("cancelled")).toBe("cancelled");
    expect(subagentStatusClass(undefined)).toBe("unknown");
  });
});

describe("formatSubagentDuration", () => {
  it("renders '—' for invalid input", () => {
    expect(formatSubagentDuration(undefined)).toBe("—");
    expect(formatSubagentDuration(-1)).toBe("—");
    expect(formatSubagentDuration(Number.NaN)).toBe("—");
  });
  it("renders sub-second durations in milliseconds", () => {
    expect(formatSubagentDuration(0)).toBe("0ms");
    expect(formatSubagentDuration(540)).toBe("540ms");
  });
  it("renders seconds for < 60s", () => {
    expect(formatSubagentDuration(1000)).toBe("1s");
    expect(formatSubagentDuration(45_000)).toBe("45s");
  });
  it("renders mm:ss for ≥ 60s", () => {
    expect(formatSubagentDuration(60_000)).toBe("1m00s");
    expect(formatSubagentDuration(83_500)).toBe("1m24s");
    expect(formatSubagentDuration(600_000)).toBe("10m00s");
  });
});

describe("shortSubagentId", () => {
  it("returns last 6 chars for long ids", () => {
    expect(shortSubagentId("abcdef123456")).toBe("123456");
  });
  it("returns the id verbatim for short ids", () => {
    expect(shortSubagentId("abc")).toBe("abc");
    expect(shortSubagentId("123456")).toBe("123456");
  });
});

// ---------- 2. SubagentIndicator component ----------

function seedSubagents(parentSessionId: string) {
  useSubagentStore.setState({
    bySession: {
      [parentSessionId]: {
        "sa-running-001": {
          id: "sa-running-001",
          childSessionId: "child-running",
          description: "Explore codebase",
          subagentType: "explore",
          status: "running",
          durationMs: 12_500,
        },
        "sa-completed-002": {
          id: "sa-completed-002",
          childSessionId: "child-completed",
          description: "Run smoke",
          subagentType: "general-purpose",
          status: "completed",
          durationMs: 65_000,
        },
        "sa-failed-003": {
          id: "sa-failed-003",
          childSessionId: "child-failed",
          description: "Build artifact",
          subagentType: "general-purpose",
          status: "failed",
          durationMs: 8_000,
          error: "exit code 1",
        },
      },
    },
  });
}

describe("SubagentIndicator — empty state", () => {
  it("renders nothing when there are no subagents for the session", () => {
    const { container } = render(
      <SubagentIndicator parentSessionId="no-subagents-here" />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("SubagentIndicator — collapsed", () => {
  it("renders the compact summary badge with counts", () => {
    seedSubagents("p1");
    const { container } = render(<SubagentIndicator parentSessionId="p1" />);
    // The summary sits inside .sidebar__subagent-summary and contains
    // three stat spans plus the "子代理" label. Query structurally because
    // text is split across multiple <span> nodes (▶/1, ✓/1, ✗/1, 子代理).
    const summary = container.querySelector(".sidebar__subagent-summary");
    expect(summary).toBeTruthy();
    expect(summary!.textContent).toMatch(/▶\s*1/);
    expect(summary!.textContent).toMatch(/✓\s*1/);
    expect(summary!.textContent).toMatch(/✗\s*1/);
    expect(summary!.textContent).toContain("子代理");
  });

  it("hides the child list by default (aria-expanded=false)", () => {
    seedSubagents("p2");
    const { container } = render(<SubagentIndicator parentSessionId="p2" />);
    const toggle = container.querySelector(
      ".sidebar__subagent-toggle",
    ) as HTMLElement;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector(".sidebar__subagent-list")).toBeNull();
  });
});

describe("SubagentIndicator — expanded", () => {
  it("renders every child row with description, type, duration and id suffix", () => {
    seedSubagents("p3");
    const { container } = render(<SubagentIndicator parentSessionId="p3" />);
    // Expand the list.
    const toggle = container.querySelector(
      ".sidebar__subagent-toggle",
    ) as HTMLElement;
    fireEvent.click(toggle);
    const rows = container.querySelectorAll(".sidebar__subagent-row");
    expect(rows.length).toBe(3);
    // Concatenated textContent of each row carries description + type + duration + id suffix.
    const rowText = Array.from(rows).map((r) => r.textContent ?? "");
    expect(rowText[0]).toContain("Explore codebase");
    expect(rowText[0]).toContain("explore");
    expect(rowText[0]).toContain("13s"); // 12_500ms
    expect(rowText[0]).toContain("ng-001"); // last 6 chars of "sa-running-001"
    expect(rowText[1]).toContain("Run smoke");
    expect(rowText[1]).toContain("general-purpose");
    expect(rowText[1]).toContain("1m05s"); // 65_000ms
    expect(rowText[1]).toContain("ed-002"); // last 6 chars of "sa-completed-002"
    expect(rowText[2]).toContain("Build artifact");
    expect(rowText[2]).toContain("8s");
    expect(rowText[2]).toContain("ed-003");
    // Status class on each row.
    expect(rows[0]!.className).toContain("sidebar__subagent-row--running");
    expect(rows[1]!.className).toContain("sidebar__subagent-row--completed");
    expect(rows[2]!.className).toContain("sidebar__subagent-row--failed");
  });

  it("toggles the chevron + aria-expanded when the badge is clicked", () => {
    seedSubagents("p4");
    const { container } = render(<SubagentIndicator parentSessionId="p4" />);
    const toggle = container.querySelector(
      ".sidebar__subagent-toggle",
    ) as HTMLElement;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("navigates to child session when a row button is clicked", () => {
    seedSubagents("p5");
    let captured: { id: string; cwd: string } | null = null;
    const { container } = render(
      <SubagentIndicator
        parentSessionId="p5"
        parentCwd="/repo"
        onSelect={(id, cwd) => {
          captured = { id, cwd };
        }}
      />,
    );
    const toggle = container.querySelector(
      ".sidebar__subagent-toggle",
    ) as HTMLElement;
    fireEvent.click(toggle);
    const rowButtons = container.querySelectorAll(
      ".sidebar__subagent-row-btn",
    ) as NodeListOf<HTMLButtonElement>;
    expect(rowButtons.length).toBe(3);
    fireEvent.click(rowButtons[0]!);
    expect(captured).toEqual({ id: "child-running", cwd: "/repo" });
  });

  it("disables the row button when childSessionId is missing", () => {
    useSubagentStore.setState({
      bySession: {
        p6: {
          "sa-orphan-007": {
            id: "sa-orphan-007",
            description: "Spawning…",
            subagentType: "explore",
            status: "running",
            durationMs: 200,
          },
        },
      },
    });
    const { container } = render(
      <SubagentIndicator parentSessionId="p6" onSelect={() => undefined} />,
    );
    const toggle = container.querySelector(
      ".sidebar__subagent-toggle",
    ) as HTMLElement;
    fireEvent.click(toggle);
    const orphan = container.querySelector(
      ".sidebar__subagent-row-btn",
    ) as HTMLButtonElement;
    expect(orphan).toBeDisabled();
    expect(orphan.title).toMatch(/还未生成会话/);
  });
});

// ---------- 3. SessionRowWithSubagents wrapper ----------

describe("SessionRowWithSubagents", () => {
  it("forwards every SessionRow prop and renders the indicator when subagents exist", () => {
    seedSubagents("p7");
    const onSelect = () => undefined;
    const { container } = render(
      <SessionRowWithSubagents
        session={
          {
            sessionId: "p7",
            title: "Parent session",
            cwd: "/repo",
          } as never
        }
        isCurrent={true}
        onSelect={onSelect}
        onMenuFromButton={() => undefined}
        onArchive={() => undefined}
        onPin={() => undefined}
        onUnarchive={() => undefined}
        isSelected={false}
      />,
    );
    // Indicator should render (we seeded subagents for p7).
    expect(container.querySelector(".sidebar__subagent")).toBeTruthy();
    // SessionRow should still render the title.
    expect(screen.getByText("Parent session")).toBeInTheDocument();
  });
});
