import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  agentExtensionsPackages,
  agentExtensionsSetPackageResources,
  capabilityPackSetEnabled,
  capabilityPacksList,
} from "@openbuddy/client/agent-client";
import { ApplicationPicker } from "../ApplicationPicker";

vi.mock("@openbuddy/client/agent-client", () => ({
  capabilityPacksList: vi.fn(),
  capabilityPackSetEnabled: vi.fn(),
  agentExtensionsPackages: vi.fn(),
  agentExtensionsSetPackageResources: vi.fn(),
}));

describe("应用选择器 (G1-16)", () => {
  it("lists the installed capability packs and toggles them", async () => {
    vi.mocked(capabilityPacksList).mockResolvedValue([
      { id: "pack-1", name: "写作包", version: "1.2.0", installedAt: 0, enabled: true, requires: [], contributions: [{ kind: "skill", name: "s1", enabled: true }], skipped: [] },
    ] as never);
    vi.mocked(agentExtensionsPackages).mockResolvedValue([]);
    vi.mocked(capabilityPackSetEnabled).mockResolvedValue([]);
    render(<ApplicationPicker />);
    expect(await screen.findByText("写作包")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /写作包/ }));
    await waitFor(() => expect(capabilityPackSetEnabled).toHaveBeenCalledWith("pack-1", false));
  });

  it("says so when nothing is installed", async () => {
    vi.mocked(capabilityPacksList).mockResolvedValue([]);
    vi.mocked(agentExtensionsPackages).mockResolvedValue([]);
    render(<ApplicationPicker />);
    expect(await screen.findByText("还没有安装任何应用")).toBeInTheDocument();
  });

  it("lists the installed Pi packages and can stop loading them", async () => {
    vi.mocked(capabilityPacksList).mockResolvedValue([]);
    vi.mocked(agentExtensionsPackages).mockResolvedValue([
      { source: "npm:pi-web-access", scope: "user", filtered: false },
    ] as never);
    vi.mocked(agentExtensionsSetPackageResources).mockResolvedValue([]);
    render(<ApplicationPicker cwd="/ws" />);
    expect(await screen.findByText("pi-web-access")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /pi-web-access/ }));
    await waitFor(() => expect(agentExtensionsSetPackageResources).toHaveBeenCalledWith(
      "npm:pi-web-access",
      { extensions: false, skills: false, prompts: false, themes: false },
      "/ws",
    ));
  });
});
