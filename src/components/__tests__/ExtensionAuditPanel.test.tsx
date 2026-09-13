/**
 * ExtensionAuditPanel.test.tsx — vitest spec for the Extension Audit
 * panel component (plan4.5 §A).
 *
 * The panel is a **display-only** consumer of `useExtensionAuditPanel()`:
 * it never writes to a store, never spawns timers, never calls back
 * into the main process. The hook is mocked here so the test pins
 * down rendering + summary tile + per-decision row rendering + the
 * empty state, all without booting electron.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { ExtensionAuditReport } from "../../lib/agent/extension-audit-event-parser";
import type { UseExtensionAuditPanelResult } from "../../hooks/useExtensionAuditPanel";

// `vi.hoisted` ensures the shared state object is created BEFORE the
// hoisted `vi.mock` factory runs (vitest hoists vi.mock above imports).
const state = vi.hoisted(() => ({
  current: {
    reports: [] as ExtensionAuditReport[],
    summary: {
      latest: null as string | null,
      reports: 0,
      totalAllowed: 0,
      totalDenied: 0,
      totalNeedsReview: 0,
      lastDecisionCount: 0,
    },
    clear: () => {},
  },
}));

vi.mock("../../hooks/useExtensionAuditPanel", () => ({
  useExtensionAuditPanel: () => state.current,
}));

// Imported after the mock so it picks up the mocked hook.
const { ExtensionAuditPanel } = await import("../ExtensionAuditPanel");

function setHookState(overrides: Partial<UseExtensionAuditPanelResult>) {
  state.current = {
    reports: overrides.reports ?? [],
    summary: overrides.summary ?? {
      latest: null,
      reports: 0,
      totalAllowed: 0,
      totalDenied: 0,
      totalNeedsReview: 0,
      lastDecisionCount: 0,
    },
    clear: overrides.clear ?? (() => {}),
  };
}

const sampleReport: ExtensionAuditReport = {
  generatedAt: "2026-09-13T02:00:00.000Z",
  total: 3,
  allowed: 1,
  denied: 1,
  needsReview: 1,
  decisions: [
    {
      id: "openbuddy-apply-patch",
      builtIn: true,
      action: "allow",
      reason: "OpenBuddy builtin extension",
    },
    {
      id: "pi-mcp-adapter",
      packageName: "pi-mcp-adapter",
      builtIn: false,
      action: "allow",
      reason: 'package "pi-mcp-adapter" is allowlisted',
    },
    {
      id: "pi-untested",
      packageName: "pi-untested",
      builtIn: false,
      action: "needs-review",
      reason: 'package "pi-untested" requires manual review',
    },
    {
      id: "pi-sketchy",
      packageName: "pi-sketchy",
      builtIn: false,
      action: "deny",
      reason: "extension is not allowlisted",
    },
  ],
};

describe("ExtensionAuditPanel (plan4.5 §A — display-only consumer of useExtensionAuditPanel)", () => {
  beforeEach(() => {
    setHookState({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders an empty state when no reports have arrived yet", () => {
    render(<ExtensionAuditPanel />);
    expect(screen.getByTestId("extension-audit-panel")).toBeDefined();
    const empty = screen.getByTestId("extension-audit-empty");
    expect(empty.textContent).toMatch(/awaiting/i);
    // Timestamp header also reads "awaiting first report" — both
    // signals are intentional so the panel never shows a misleading
    // "last updated: null".
    const timestamp = screen.getByTestId("extension-audit-timestamp");
    expect(timestamp.textContent).toMatch(/awaiting/i);
  });

  it("renders the summary tile from the latest report", () => {
    setHookState({
      reports: [sampleReport],
      summary: {
        latest: sampleReport.generatedAt,
        reports: 1,
        totalAllowed: sampleReport.allowed,
        totalDenied: sampleReport.denied,
        totalNeedsReview: sampleReport.needsReview,
        lastDecisionCount: sampleReport.decisions.length,
      },
    });
    render(<ExtensionAuditPanel />);
    expect(screen.getByTestId("extension-audit-allowed").textContent).toContain("1");
    expect(screen.getByTestId("extension-audit-denied").textContent).toContain("1");
    expect(screen.getByTestId("extension-audit-needs-review").textContent).toContain("1");
    expect(screen.getByTestId("extension-audit-last-decision-count").textContent).toContain("4");
  });

  it("renders the resolves tile from the cumulative report count", () => {
    // Two reports → `summary.reports === 2`. The panel must surface
    // this as a dedicated metric (not just `lastDecisionCount`) so ops
    // can see how many resolves have happened across the session.
    setHookState({
      reports: [sampleReport, sampleReport],
      summary: {
        latest: sampleReport.generatedAt,
        reports: 2,
        totalAllowed: sampleReport.allowed,
        totalDenied: sampleReport.denied,
        totalNeedsReview: sampleReport.needsReview,
        lastDecisionCount: sampleReport.decisions.length,
      },
    });
    render(<ExtensionAuditPanel />);
    expect(screen.getByTestId("extension-audit-resolves").textContent).toContain("2");
    // Sanity: latest-only metrics still reflect the latest report.
    expect(screen.getByTestId("extension-audit-allowed").textContent).toContain("1");
    expect(screen.getByTestId("extension-audit-last-decision-count").textContent).toContain("4");
  });

  it("renders one row per decision with an action badge", () => {
    setHookState({
      reports: [sampleReport],
      summary: {
        latest: sampleReport.generatedAt,
        reports: 1,
        totalAllowed: 1,
        totalDenied: 1,
        totalNeedsReview: 1,
        lastDecisionCount: 4,
      },
    });
    render(<ExtensionAuditPanel />);
    const rows = screen.getAllByTestId("extension-audit-row");
    expect(rows).toHaveLength(4);
    expect(screen.getByText("openbuddy-apply-patch")).toBeDefined();
    expect(screen.getByText("pi-mcp-adapter")).toBeDefined();
    expect(screen.getByText("pi-untested")).toBeDefined();
    expect(screen.getByText("pi-sketchy")).toBeDefined();
    // Action badges
    const allowBadges = screen.getAllByTestId("extension-audit-action-allow");
    const denyBadges = screen.getAllByTestId("extension-audit-action-deny");
    const reviewBadges = screen.getAllByTestId("extension-audit-action-needs-review");
    expect(allowBadges).toHaveLength(2);
    expect(denyBadges).toHaveLength(1);
    expect(reviewBadges).toHaveLength(1);
  });

  it("highlights denied and needs-review rows so they're visually scannable", () => {
    setHookState({
      reports: [sampleReport],
      summary: {
        latest: sampleReport.generatedAt,
        reports: 1,
        totalAllowed: 1,
        totalDenied: 1,
        totalNeedsReview: 1,
        lastDecisionCount: 4,
      },
    });
    render(<ExtensionAuditPanel />);
    const rows = screen.getAllByTestId("extension-audit-row");
    const rowMap = Object.fromEntries(rows.map((row) => [row.getAttribute("data-decision-id"), row]));
    expect(rowMap["pi-sketchy"]?.getAttribute("data-action")).toBe("deny");
    expect(rowMap["pi-untested"]?.getAttribute("data-action")).toBe("needs-review");
    expect(rowMap["openbuddy-apply-patch"]?.getAttribute("data-action")).toBe("allow");
  });

  it("calls the hook's clear() when the clear button is clicked", () => {
    const clear = vi.fn();
    setHookState({
      reports: [sampleReport],
      summary: {
        latest: sampleReport.generatedAt,
        reports: 1,
        totalAllowed: 1,
        totalDenied: 1,
        totalNeedsReview: 1,
        lastDecisionCount: 4,
      },
      clear,
    });
    render(<ExtensionAuditPanel />);
    fireEvent.click(screen.getByTestId("extension-audit-clear"));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("hides the clear button when no reports are present", () => {
    render(<ExtensionAuditPanel />);
    expect(screen.queryByTestId("extension-audit-clear")).toBeNull();
  });
});
