import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppSwitcher } from "../AppSwitcher";
import { useAppsStore } from "../state/apps-store";

const appsList = vi.fn();
const appsIcon = vi.fn();
vi.mock("@openbuddy/client/api/files", () => ({
  appsList: (...args: unknown[]) => appsList(...args),
  appsIcon: (...args: unknown[]) => appsIcon(...args),
}));

beforeEach(() => {
  useAppsStore.setState({ currentAppId: null, recentAppIds: [] });
  appsList.mockReset().mockResolvedValue([
    { id: "upup", name: "upup", kind: "app", source: "pi", packageSource: "/repo/upup", tagline: "证券智能投研助手" },
    { id: "pi-memory", name: "pi-memory", kind: "extension", source: "pi", installedPath: "/r/pi-memory" },
  ]);
  appsIcon.mockReset().mockResolvedValue({ dataUri: null });
});

describe("Buddy 应用切换器 (WorkBuddy 1:1)", () => {
  it("默认显示第一个真实应用（upup），扩展包不进列表", async () => {
    render(<AppSwitcher />);
    expect(await screen.findByRole("button", { name: /当前应用 upup/ })).toBeInTheDocument();
  });

  it("展开面板：当前应用落在「最近使用」，扩展包不出现", async () => {
    render(<AppSwitcher />);
    fireEvent.click(await screen.findByRole("button", { name: /当前应用 upup/ }));
    const panel = await screen.findByRole("dialog", { name: "Buddy 应用" });
    expect(within(panel).getByText("最近使用")).toBeInTheDocument();
    expect(within(panel).getByText("upup")).toBeInTheDocument();
    expect(within(panel).queryByText("pi-memory")).toBeNull();
  });

  it("选中应用后写入当前应用并回调", async () => {
    const onSelectApp = vi.fn();
    render(<AppSwitcher onSelectApp={onSelectApp} />);
    fireEvent.click(await screen.findByRole("button", { name: /当前应用 upup/ }));
    const panel = await screen.findByRole("dialog", { name: "Buddy 应用" });
    fireEvent.click(within(panel).getByText("upup"));
    await waitFor(() => expect(onSelectApp).toHaveBeenCalledWith(expect.objectContaining({ id: "upup" })));
    expect(useAppsStore.getState().currentAppId).toBe("upup");
  });

  it("搜索按名称/定位过滤", async () => {
    render(<AppSwitcher />);
    fireEvent.click(await screen.findByRole("button", { name: /当前应用 upup/ }));
    const box = screen.getByRole("searchbox", { name: "搜索应用" });
    fireEvent.change(box, { target: { value: "证券" } });
    expect(screen.getByText("最近使用")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "不存在" } });
    expect(screen.getByText("没有匹配的应用")).toBeInTheDocument();
  });
});
