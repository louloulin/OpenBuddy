import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AboutSettingsPanel } from "../sections/AboutSettingsPanel";

const { updateCheck, updateDownload, openUrl, revealInFolder } = vi.hoisted(() => ({
  updateCheck: vi.fn(),
  updateDownload: vi.fn(),
  openUrl: vi.fn(),
  revealInFolder: vi.fn(),
}));
vi.mock("@openbuddy/client/api/update", () => ({ updateCheck, updateDownload }));
vi.mock("@openbuddy/client/api/files", () => ({ openUrl, revealInFolder }));

const DOWNLOAD = { url: "https://example.com/OpenBuddy-9.9.9.dmg", sha256: "a".repeat(64), size: 2048 };

beforeEach(() => {
  updateCheck.mockReset();
  updateDownload.mockReset();
  openUrl.mockReset();
  revealInFolder.mockReset();
  updateCheck.mockResolvedValue({
    status: "available", currentVersion: "1.0.0", version: "9.9.9", channel: "stable",
    notes: "修复若干问题", download: DOWNLOAD,
  });
});

describe("关于 · 下载并校验安装包 (A3)", () => {
  it("downloads through the host, shows the verified path and reveals it", async () => {
    updateDownload.mockResolvedValue({ path: "/tmp/updates/OpenBuddy-9.9.9.dmg", bytes: 2048, sha256: "b".repeat(64) });
    render(<AboutSettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /检查更新/ }));
    await waitFor(() => expect(updateCheck).toHaveBeenCalled());
    expect(await screen.findByText(/发现新版本 v9\.9\.9/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /下载安装包/ }));
    await waitFor(() => expect(updateDownload).toHaveBeenCalledWith(DOWNLOAD));
    expect(await screen.findByText(/已下载到本机并通过校验/)).toBeInTheDocument();
    expect(screen.getByText("/tmp/updates/OpenBuddy-9.9.9.dmg")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /打开所在文件夹/ }));
    expect(revealInFolder).toHaveBeenCalledWith("/tmp/updates/OpenBuddy-9.9.9.dmg");
  });

  it("keeps the download page as a secondary action and explains checksum failures", async () => {
    updateDownload.mockRejectedValue(new Error("update_checksum_mismatch"));
    render(<AboutSettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /检查更新/ }));
    await screen.findByText(/发现新版本/);
    fireEvent.click(screen.getByRole("button", { name: /下载安装包/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("安装包校验失败，已删除下载文件");

    fireEvent.click(screen.getByRole("button", { name: /打开下载页/ }));
    expect(openUrl).toHaveBeenCalledWith(DOWNLOAD.url);
  });
});
