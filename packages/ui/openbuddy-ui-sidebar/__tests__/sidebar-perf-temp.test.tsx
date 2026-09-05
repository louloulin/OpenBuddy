// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

vi.mock("@openbuddy/ui-theme/client", () => ({ useTheme: () => ({ setTheme: () => {} }) }));
vi.mock("@openbuddy/shared-types", () => ({}));

import { Sidebar } from "../src/Sidebar";

function makeSessions(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `session-${i}`,
    title: `Session ${i}`,
    cwd: `/cwd/${i}`,
    createdAt: Date.now() - i * 1000,
    updatedAt: Date.now() - i * 1000,
    status: "idle" as const,
    workspaceId: "ws-1",
  }));
}

describe("Sidebar perf", () => {
  it("renders 1000 sessions", () => {
    const t1 = Date.now();
    const { container } = render(<Sidebar sessions={makeSessions(1000)} workspaces={[]} />);
    const t2 = Date.now();
    console.log(`Sidebar 1000 sessions: ${t2-t1}ms`);
  }, 30000);
});
