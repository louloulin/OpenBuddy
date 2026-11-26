import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UpupPluginsCard } from "../UpupPluginsCard";

const upupPluginsGet = vi.fn();
const upupPluginsSet = vi.fn();
vi.mock("@openbuddy/client/api/files", () => ({
  upupPluginsGet: (...args: unknown[]) => upupPluginsGet(...args),
  upupPluginsSet: (...args: unknown[]) => upupPluginsSet(...args),
}));

const state = (disabled: string[] = []) => ({
  disabled,
  enabled: [],
  settingsPath: "/tmp/agent/settings.json",
  defaults: ["pi-portfolio", "pi-notify", "pi-mobile-host-extension", "pi-openminis-skills-bridge"],
  settingsExists: true,
});

beforeEach(() => {
  upupPluginsGet.mockReset().mockResolvedValue(state());
  upupPluginsSet.mockReset().mockImplementation(async (next: { disabled?: string[] }) => state(next.disabled ?? []));
});

describe("UpUp 子包开关 (UP-1.3)", () => {
  it("没有 UpUp 且没有开关文件时不渲染", () => {
    upupPluginsGet.mockResolvedValue({ ...state(), settingsExists: false });
    const { container } = render(<UpupPluginsCard hasUpup={false} />);
    return waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("勾选默认子包会写入 @upup/ 前缀", async () => {
    render(<UpupPluginsCard hasUpup />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "禁用 pi-portfolio" }));
    await waitFor(() => expect(upupPluginsSet).toHaveBeenCalledWith({ disabled: ["@upup/pi-portfolio"] }));
    expect((screen.getByRole("checkbox", { name: "禁用 pi-portfolio" }) as HTMLInputElement).checked).toBe(true);
  });

  it("可再禁用自定义子包，取消勾选即从列表移除", async () => {
    render(<UpupPluginsCard hasUpup />);
    fireEvent.change(await screen.findByRole("textbox", { name: "额外禁用的子包目录名" }), { target: { value: "pi-quant" } });
    fireEvent.click(screen.getByRole("button", { name: "禁用" }));
    await waitFor(() => expect(upupPluginsSet).toHaveBeenCalledWith({ disabled: ["@upup/pi-quant"] }));
    expect(await screen.findByRole("checkbox", { name: "启用 @upup/pi-quant" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "启用 @upup/pi-quant" }));
    await waitFor(() => expect(upupPluginsSet).toHaveBeenLastCalledWith({ disabled: [] }));
  });

  it("「恢复默认」写回四条默认禁用项", async () => {
    upupPluginsGet.mockResolvedValue(state([]));
    render(<UpupPluginsCard hasUpup />);
    fireEvent.click(await screen.findByRole("button", { name: "恢复默认" }));
    await waitFor(() =>
      expect(upupPluginsSet).toHaveBeenCalledWith({
        disabled: ["@upup/pi-portfolio", "@upup/pi-notify", "@upup/pi-mobile-host-extension", "@upup/pi-openminis-skills-bridge"],
      }),
    );
  });
});
