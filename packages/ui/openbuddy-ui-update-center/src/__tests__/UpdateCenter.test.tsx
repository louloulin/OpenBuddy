import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { UpdateCenter } from "../components/index.js";

const releases = [
  { id: "r1", channel: "stable" as const, version: "0.16.1", releasedAt: "2026-09-23", notes: [{ locale: "en", title: "Bug fixes", body: "Tons of fixes." }] },
  { id: "r2", channel: "stable" as const, version: "0.16.0", releasedAt: "2026-09-10", notes: [{ locale: "en", title: "Initial", body: "First GA." }] },
  { id: "r3", channel: "beta" as const, version: "0.17.0-beta.3", releasedAt: "2026-09-22", notes: [{ locale: "en", title: "Beta preview", body: "Work panels." }] },
];

describe("UpdateCenter", () => {
  it("renders the current version + channel", () => {
    render(<UpdateCenter currentVersion="0.16.0" currentChannel="stable" releases={releases} />);
    expect(screen.getByText(/Currently running v0\.16\.0/)).toBeTruthy();
  });

  it("filters releases by channel", () => {
    render(<UpdateCenter currentVersion="0.16.0" currentChannel="stable" releases={releases} />);
    expect(screen.getByTestId("release-r1")).toBeTruthy();
    expect(screen.queryByTestId("release-r3")).toBeNull();
  });

  it("switches to the beta channel", () => {
    render(<UpdateCenter currentVersion="0.16.0" currentChannel="stable" releases={releases} />);
    fireEvent.click(screen.getByTestId("channel-beta"));
    expect(screen.getByTestId("release-r3")).toBeTruthy();
    expect(screen.queryByTestId("release-r1")).toBeNull();
  });

  it("sorts releases newest first", () => {
    render(<UpdateCenter currentVersion="0.16.0" currentChannel="stable" releases={releases} />);
    const items = screen.getAllByTestId(/^release-/);
    expect(items[0].getAttribute("data-testid")).toBe("release-r1");
  });

  it("fires onInstall with the release descriptor", () => {
    const fn = vi.fn();
    render(<UpdateCenter currentVersion="0.16.0" currentChannel="stable" releases={releases} onInstall={fn} />);
    fireEvent.click(screen.getByTestId("release-install-r1"));
    expect(fn.mock.calls[0][0].version).toBe("0.16.1");
  });

  it("calls onSelectChannel when a channel tab is clicked", () => {
    const fn = vi.fn();
    render(<UpdateCenter currentVersion="0.16.0" currentChannel="stable" releases={releases} onSelectChannel={fn} />);
    fireEvent.click(screen.getByTestId("channel-nightly"));
    expect(fn).toHaveBeenCalledWith("nightly");
  });

  it("shows the empty state when no releases match", () => {
    render(<UpdateCenter currentVersion="0.16.0" currentChannel="stable" releases={[]} />);
    expect(screen.getByTestId("update-empty")).toBeTruthy();
  });
});
