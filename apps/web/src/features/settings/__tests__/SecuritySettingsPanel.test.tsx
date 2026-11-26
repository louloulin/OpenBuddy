import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SecuritySettingsPanel } from "../sections/SecuritySettingsPanel";

const { list, save, protectedGet, protectedSet, skillsList, readTextFile, securityPolicyGet, securityPolicySet, securityAuditList } = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  protectedGet: vi.fn(),
  protectedSet: vi.fn(),
  skillsList: vi.fn(),
  readTextFile: vi.fn(),
  securityPolicyGet: vi.fn(),
  securityPolicySet: vi.fn(),
  securityAuditList: vi.fn(),
}));
vi.mock("@openbuddy/client/agent-client", () => ({
  permissionList: list,
  permissionSave: save,
  permissionProtectedGet: protectedGet,
  permissionProtectedSet: protectedSet,
  skillsList,
}));
vi.mock("@openbuddy/client/api/files", () => ({
  readTextFile,
  appsToolPolicyGet: vi.fn(async () => ({ platformDenied: ["(^|_)(place_trade_order|cancel_trade_order)$"], denied: [], readonly: ["get_astock_price"] })),
}));
vi.mock("@openbuddy/client/api/approvals", () => ({
  securityPolicyGet: securityPolicyGet,
  securityPolicySet: securityPolicySet,
  securityAuditList: securityAuditList,
}));

beforeEach(() => {
  list.mockReset();
  save.mockReset();
  protectedGet.mockReset();
  protectedSet.mockReset();
  skillsList.mockReset();
  readTextFile.mockReset();
  skillsList.mockResolvedValue([]);
  securityPolicyGet.mockResolvedValue({ fileWriteAllow: [], commandAllow: [], networkAllow: [] });
  securityPolicySet.mockImplementation(async (policy: unknown) => policy);
  securityAuditList.mockResolvedValue([]);
  readTextFile.mockResolvedValue("");
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
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    await waitFor(() => expect(protectedSet).toHaveBeenCalledWith([".env", "*.pem", "config/secrets.json"]));
    fireEvent.click(screen.getByRole("button", { name: "移除受保护路径 .env" }));
    await waitFor(() => expect(protectedSet).toHaveBeenLastCalledWith(["*.pem", "config/secrets.json"]));
  });

  it("审批卡深链：定位并高亮对应分类 (W6.1)", async () => {
    render(<SecuritySettingsPanel />);
    await waitFor(() => expect(screen.getByText("命令")).toBeInTheDocument());
    act(() => window.dispatchEvent(new CustomEvent("openbuddy:security-focus", { detail: { category: "command" } })));
    await waitFor(() => expect(screen.getByText("命令").closest(".sec-group")).toHaveClass("is-focus"));
    act(() => window.dispatchEvent(new CustomEvent("openbuddy:security-focus", { detail: { category: "protected" } })));
    await waitFor(() => expect(screen.getByText("受保护路径").closest(".sec-card")).toHaveClass("is-focus"));
  });

  it("恢复默认", async () => {
    render(<SecuritySettingsPanel />);
    await waitFor(() => expect(screen.getByText("恢复默认")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    await waitFor(() => expect(protectedSet).toHaveBeenCalledWith([".env", ".git", "*.pem"]));
  });

  it("安全中心 2.0 (G2-1)：五个分区可切换，沙箱分区能写白名单", async () => {
    render(<SecuritySettingsPanel />);
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["工具管控", "沙箱与网络", "技能审查", "审计日志", "系统授权"]);

    fireEvent.click(screen.getByRole("tab", { name: "沙箱与网络" }));
    await waitFor(() => expect(screen.getByText("文件写入白名单")).toBeInTheDocument());
    const input = screen.getByPlaceholderText("允许写入的路径片段，例如 /work/output");
    fireEvent.change(input, { target: { value: "/work/output" } });
    const fileGroup = screen.getByText("文件写入白名单").closest(".sec-sandbox__group") as HTMLElement;
    fireEvent.click(within(fileGroup).getByRole("button", { name: "添加" }));
    await waitFor(() =>
      expect(securityPolicySet).toHaveBeenCalledWith({
        fileWriteAllow: ["/work/output"],
        commandAllow: [],
        networkAllow: [],
      }),
    );
  });

  it("审计日志分区列出事件", async () => {
    securityAuditList.mockResolvedValue([
      { ts: "2026-11-24T01:00:00.000Z", action: "policy-deny", tool: "write", target: "/etc/hosts" },
    ]);
    render(<SecuritySettingsPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "审计日志" }));
    await waitFor(() => expect(screen.getByText("策略拦截")).toBeInTheDocument());
    expect(screen.getByText("/etc/hosts")).toBeInTheDocument();
  });

  it("系统授权分区读真实授权状态", async () => {
    render(<SecuritySettingsPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "系统授权" }));
    await waitFor(() => expect(screen.getByText("麦克风")).toBeInTheDocument());
    expect(screen.getByText("摄像头")).toBeInTheDocument();
    expect(screen.getByText("通知")).toBeInTheDocument();
  });

  it("展示平台工具策略与只读清单（UP-3.2）", async () => {
    render(<SecuritySettingsPanel />);
    const card = await screen.findByRole("region", { name: "平台工具策略" }).catch(() => screen.findByLabelText("平台工具策略"));
    expect(card).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/真实交易（始终拒绝）/)).toBeInTheDocument());
    expect(screen.getByText(/get_astock_price/)).toBeInTheDocument();
  });
});
