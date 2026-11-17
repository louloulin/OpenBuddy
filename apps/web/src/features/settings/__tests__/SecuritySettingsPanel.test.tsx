import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SecuritySettingsPanel } from "../sections/SecuritySettingsPanel";

const { list, save, protectedGet, protectedSet } = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  protectedGet: vi.fn(),
  protectedSet: vi.fn(),
}));
vi.mock("@openbuddy/client/agent-client", () => ({
  permissionList: list,
  permissionSave: save,
  permissionProtectedGet: protectedGet,
  permissionProtectedSet: protectedSet,
}));

beforeEach(() => {
  list.mockReset();
  save.mockReset();
  protectedGet.mockReset();
  protectedSet.mockReset();
  list.mockResolvedValue([
    { action: "allow", tool: "write", pattern: "/ws/report.md" },
    { action: "deny", tool: "bash", pattern: "rm -rf" },
    { action: "ask", tool: "mcp__sales" },
    { action: "allow", tool: "any" },
  ]);
  protectedGet.mockResolvedValue({ paths: [".env", "*.pem"], defaults: [".env", ".git", "*.pem"] });
  save.mockResolvedValue(undefined);
  protectedSet.mockImplementation(async (paths: string[]) => ({ paths }));
});

describe("安全中心 (pii W6.1 / W6.2)", () => {
  it("列出分组规则与受保护路径", async () => {
    render(<SecuritySettingsPanel />);
    await waitFor(() => expect(screen.getByText("受保护路径")).toBeInTheDocument());
    expect(screen.getByText(".env", { selector: ".sec-chip code" })).toBeInTheDocument();
    expect(screen.getByText("*.pem", { selector: ".sec-chip code" })).toBeInTheDocument();
    expect(screen.getByText("写入")).toBeInTheDocument();
    expect(screen.getByText("命令")).toBeInTheDocument();
    expect(screen.getByText("MCP 工具")).toBeInTheDocument();
    expect(screen.getByText("所有工具")).toBeInTheDocument();
  });

  it("把一条规则改成拒绝会保存整份规则", async () => {
    render(<SecuritySettingsPanel />);
    await waitFor(() => expect(screen.getByText("写入")).toBeInTheDocument());
    const group = screen.getByRole("group", { name: "write 的处理方式" });
    fireEvent.click(within(group).getByRole("button", { name: "拒绝" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const saved = save.mock.calls[0][0] as Array<{ action: string; tool: string; pattern?: string }>;
    expect(saved).toHaveLength(4);
    expect(saved.find((rule) => rule.tool === "write")).toMatchObject({ action: "deny", pattern: "/ws/report.md" });
  });

  it("删除规则", async () => {
    render(<SecuritySettingsPanel />);
    await waitFor(() => expect(screen.getByText("命令")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "删除规则 bash" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0].some((rule: { tool: string }) => rule.tool === "bash")).toBe(false);
  });

  it("添加与移除受保护路径", async () => {
    render(<SecuritySettingsPanel />);
    await waitFor(() => expect(screen.getByText(".env", { selector: ".sec-chip code" })).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(".env / *.pem / .git / config/secrets.json"), {
      target: { value: "config/secrets.json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加", exact: true }));
    await waitFor(() => expect(protectedSet).toHaveBeenCalledWith([".env", "*.pem", "config/secrets.json"]));
    fireEvent.click(screen.getByRole("button", { name: "移除受保护路径 .env" }));
    await waitFor(() => expect(protectedSet).toHaveBeenLastCalledWith(["*.pem", "config/secrets.json"]));
  });

  it("恢复默认", async () => {
    render(<SecuritySettingsPanel />);
    await waitFor(() => expect(screen.getByText("恢复默认")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    await waitFor(() => expect(protectedSet).toHaveBeenCalledWith([".env", ".git", "*.pem"]));
  });
});
