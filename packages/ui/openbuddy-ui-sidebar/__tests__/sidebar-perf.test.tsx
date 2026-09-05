// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@openbuddy/ui-theme/client", () => ({
  useTheme: () => ({ setTheme: () => {}, theme: "dark" }),
}));
vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({
  useRendererContributions: () => [],
  useRendererSlot: () => [],
}));
vi.mock("@/components/StatusIndicator", () => ({
  StatusIndicator: () => null,
}));
vi.mock("@/lib/agent/pi-client", () => ({
  piRenameSession: vi.fn(),
  piDeleteSession: vi.fn(),
  piSetSessionPinned: vi.fn(),
  piSetSessionArchived: vi.fn(),
  piRenameWorkspace: vi.fn(),
  piDeleteWorkspace: vi.fn(),
  piListSessions: vi.fn(async () => []),
  piListWorkspaces: vi.fn(async () => []),
  piNewSession: vi.fn(),
  piLoadSession: vi.fn(),
  piInit: vi.fn(),
  piDispose: vi.fn(),
  piAbort: vi.fn(),
  piPrompt: vi.fn(),
  piSteer: vi.fn(),
  piFollowUp: vi.fn(),
  piSetModel: vi.fn(),
  piSubscribe: vi.fn(() => () => {}),
  collaborationOnUpdate: () => () => {},
  collaborationSnapshot: vi.fn(async () => ({})),
  collaborationPropose: vi.fn(async () => ({})),
  collaborationExecute: vi.fn(),
  assistantFacade: {
    snapshot: vi.fn(async () => ({})),
    onUpdate: () => () => {},
    propose: vi.fn(async () => ({})),
    execute: vi.fn(),
  },
}));

import { Sidebar } from "../src/Sidebar";
import { useSessionsStore } from "@/stores/sessions-store";
import { useProjectsStore } from "@/stores/projects-store";

function makeSessions(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    sessionId: `session-${i}`,
    title: `Session ${i} ${"abc".repeat(20)}`,
    cwd: "",
    updatedAt: new Date(Date.now() - i * 1000).toISOString(),
    pinned: i % 50 === 0,
    archived: false,
    status: i % 3 === 0 ? ("working" as const) : ("completed" as const),
  }));
}

function noop() {}

const PROPS = {
  onNewSession: noop,
  onSelect: noop,
  onNavigate: noop,
  onOpenSettings: noop,
  onToggleCollapse: noop,
  onToggleWorkspace: noop,
  onOpenSearch: noop,
  onPlaceholder: noop,
  activeNav: "助理",
};

describe("Sidebar perf", () => {
  beforeEach(() => {
    useProjectsStore.setState({ projects: [] });
    useSessionsStore.setState({
      independent: [],
      workspaces: [],
      workspaceSessions: {},
      tasksOpen: true,
      spacesOpen: true,
      expanded: {},
      homeCwd: "",
      currentSessionId: null,
      filterStatus: null,
      filterDate: null,
      query: "",
    });
  });

  it("renders 1000 independent sessions under a reasonable budget", () => {
    useSessionsStore.setState({ independent: makeSessions(1000) });
    const t1 = performance.now();
    const { container } = render(<Sidebar {...PROPS} />);
    const t2 = performance.now();
    const rows = container.querySelectorAll(".sidebar__conv");
    console.log(`Sidebar 1000 rows render: ${(t2 - t1).toFixed(1)}ms, rows=${rows.length}`);
    expect(rows.length).toBe(1000);
    expect(t2 - t1).toBeLessThan(2000);
  });

  it("renders 2000 independent sessions under a generous budget", () => {
    useSessionsStore.setState({ independent: makeSessions(2000) });
    const t1 = performance.now();
    const { container } = render(<Sidebar {...PROPS} />);
    const t2 = performance.now();
    const rows = container.querySelectorAll(".sidebar__conv");
    console.log(`Sidebar 2000 rows render: ${(t2 - t1).toFixed(1)}ms, rows=${rows.length}`);
    expect(rows.length).toBe(2000);
    expect(t2 - t1).toBeLessThan(4000);
  });

  it("scales workspace sessions with lazy mount", () => {
    const cwd = "/home/me";
    useSessionsStore.setState({
      workspaces: [
        { workspaceId: "ws-1", cwd, title: "Home", path: cwd } as any,
      ],
      workspaceSessions: { [cwd]: makeSessions(500) },
      expanded: { [cwd]: true },
    });
    const t1 = performance.now();
    const { container } = render(<Sidebar {...PROPS} />);
    const t2 = performance.now();
    const rows = container.querySelectorAll(".sidebar__conv");
    console.log(`Sidebar 500 workspace rows render: ${(t2 - t1).toFixed(1)}ms, rows=${rows.length}`);
    expect(t2 - t1).toBeLessThan(1500);
  });
});
