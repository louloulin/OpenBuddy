import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlaceholderPage } from "../PlaceholderPage";
import { useCapabilitiesStore } from "../../state/capabilities-store";

afterEach(() => useCapabilitiesStore.getState().apply(null));

describe("PlaceholderPage (FeatureRegistry routes, pii W0.2)", () => {
  it("an unknown view shows a plain notice, never 即将上线", () => {
    render(<PlaceholderPage label="某个未实现功能" />);
    expect(screen.getByText("某个未实现功能")).toBeInTheDocument();
    expect(screen.getByText("当前版本不提供这个功能")).toBeInTheDocument();
    expect(screen.queryByText(/即将上线/)).toBeNull();
  });

  it("renders a route only when the host serves its commands", () => {
    useCapabilitiesStore.getState().apply(null);
    // 通知渠道 (W4.6) needs the host's channel commands: without them the entry stays dark.
    const { unmount } = render(<PlaceholderPage label="通知渠道" />);
    expect(screen.getByText("当前版本不提供这个功能")).toBeInTheDocument();
    unmount();
    useCapabilitiesStore.getState().apply({ protocolVersion: 1, platform: "desktop", commands: ["notify_channels_list"], events: [], features: [] });
    const { unmount: unmount2 } = render(<PlaceholderPage label="通知渠道" />);
    expect(screen.getByRole("region", { name: "通知渠道" })).toBeInTheDocument();
    unmount2();
    render(<PlaceholderPage label="自动化" />);
    expect(screen.getByText("当前版本不提供这个功能")).toBeInTheDocument();
  });

  it("never renders an offline entry (云存储 / 助理)", () => {
    useCapabilitiesStore.getState().apply({ protocolVersion: 1, platform: "desktop", commands: [], events: [], features: [] });
    for (const label of ["云存储", "助理"]) {
      const { unmount } = render(<PlaceholderPage label={label} />);
      expect(screen.getByText("当前版本不提供这个功能")).toBeInTheDocument();
      unmount();
    }
  });
});
