import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// MarketplacePanel pulls from electron preload at import time. Provide a
// minimal stub so the component can render in a JSDOM environment.
vi.mock("@openbuddy/ui-mcp", () => ({
  MarketplacePanel: ({ sessionId, onToast }: { sessionId?: string; onToast?: (msg: string) => void }) => (
    <div data-testid="marketplace-panel" data-session-id={sessionId ?? ""}>
      Marketplace stub
    </div>
  ),
}));

import { ExpertsPanel } from "../src/ExpertsPanel";

describe("ExpertsPanel (专家·技能·连接器)", () => {
  it("默认显示 '专家' tab", () => {
    render(<ExpertsPanel />);
    const pill = screen.getByRole("tab", { name: /专家/ });
    expect(pill.getAttribute("aria-selected")).toBe("true");
  });

  it("点击 '插件·市场' tab 渲染 MarketplacePanel", () => {
    render(<ExpertsPanel sessionId="abc-123" />);
    fireEvent.click(screen.getByRole("tab", { name: /插件·市场/ }));
    // After the state update ExpertsTab unmounts and PluginsTabContent mounts
    // a fresh MarketPills; re-query so we read the post-update DOM.
    expect(screen.getByRole("tab", { name: /插件·市场/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("marketplace-panel")).toBeInTheDocument();
    expect(screen.getByTestId("marketplace-panel").getAttribute("data-session-id")).toBe("abc-123");
  });

  it("包含全部 4 个 tab 标签", () => {
    render(<ExpertsPanel />);
    expect(screen.getByRole("tab", { name: /专家/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /技能/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /连接器/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /插件·市场/ })).toBeInTheDocument();
  });

  it("tablist aria-label 覆盖全部 4 个面板", () => {
    render(<ExpertsPanel />);
    expect(screen.getByRole("tablist").getAttribute("aria-label")).toBe(
      "专家·技能·连接器·插件·市场",
    );
  });
});
