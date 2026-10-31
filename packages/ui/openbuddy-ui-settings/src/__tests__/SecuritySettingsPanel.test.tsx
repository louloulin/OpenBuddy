/**
 * 20261031 Phase 1.4 — 安全中心可撤销持久权限规则,撤销即写回规则文件。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  permissionList: vi.fn(),
  permissionSave: vi.fn(),
}));
vi.mock("@/lib/agent/pi-client", () => api);
vi.mock("@openbuddy/ui-locale/client", async (orig) => {
  const zh = (await import("../../../../../src/locales/zh-CN.json")).default as Record<string, unknown>;
  const t = (key: string, params: Record<string, unknown> = {}) => {
    const raw = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], zh);
    return typeof raw === "string" ? raw.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? "")) : key;
  };
  return { ...(await orig<object>()), useLocale: () => ({ t, current: () => "zh-CN", subscribe: () => () => {} }) };
});

import { SecuritySettingsPanel } from "../SettingsSections";

afterEach(() => cleanup());

const RULES = [
  { action: "allow", tool: "bash", pattern: "ls *" },
  { action: "deny", tool: "write" },
];

describe("SecuritySettingsPanel", () => {
  it("撤销一条规则后写回其余规则并从列表移除", async () => {
    api.permissionList.mockResolvedValue(RULES);
    api.permissionSave.mockResolvedValue(undefined);
    render(<SecuritySettingsPanel />);
    const revoke = await screen.findByRole("button", { name: "撤销规则 allow bash ls *" });
    fireEvent.click(revoke);
    await waitFor(() => expect(api.permissionSave).toHaveBeenCalledWith([RULES[1]]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "撤销规则 allow bash ls *" })).toBeNull());
  });

  it("写回失败时保留规则并提示", async () => {
    api.permissionList.mockResolvedValue(RULES);
    api.permissionSave.mockRejectedValue(new Error("disk full"));
    render(<SecuritySettingsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "撤销规则 deny write" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(screen.getByRole("button", { name: "撤销规则 deny write" })).toBeTruthy();
  });
});
