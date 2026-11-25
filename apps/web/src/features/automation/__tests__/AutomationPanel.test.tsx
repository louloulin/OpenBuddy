import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AutomationPanel } from "../AutomationPanel";
import { setPendingAutomationDraft } from "../pending-draft";
import type { AutomationSnapshot } from "@openbuddy/protocol/dto";

const emptySnapshot: AutomationSnapshot = { automations: [], records: [] };
let snapshot: AutomationSnapshot = emptySnapshot;

vi.mock("@openbuddy/client/agent-client", () => ({
  automationsSnapshot: vi.fn(async () => snapshot),
  automationsSave: vi.fn(async (a: unknown) => a),
  automationsDelete: vi.fn(async () => {}),
  automationsSetStatus: vi.fn(async () => {}),
  automationsRun: vi.fn(async () => {}),
  automationRecordsArchive: vi.fn(async () => {}),
  automationRecordsDelete: vi.fn(async () => {}),
  agentListWorkspaces: vi.fn(async () => []),
  providersList: vi.fn(async () => []),
  skillsList: vi.fn(async () => []),
  agentsList: vi.fn(async () => []),
  mcpList: vi.fn(async () => []),
}));

beforeEach(() => {
  snapshot = emptySnapshot;
});

describe("AutomationPanel（截图 1/3 空态）", () => {
  it("渲染 定时任务/运行记录 页签", async () => {
    render(<AutomationPanel />);
    expect(screen.getByText("定时任务")).toBeInTheDocument();
    expect(screen.getByText("运行记录")).toBeInTheDocument();
  });

  it("定时任务空态：hero 文案 + 添加按钮 + 12 个模板", async () => {
    render(<AutomationPanel />);
    await waitFor(() => expect(screen.getByText("开启你的第一个自动化任务吧")).toBeInTheDocument());
    expect(screen.getByText("+ 添加自动化")).toBeInTheDocument();
    expect(screen.getByText("自动化任务模版")).toBeInTheDocument();
    expect(screen.getByText("每日 AI 新闻推送")).toBeInTheDocument();
    expect(screen.getByText("可爱萌宠手机壁纸")).toBeInTheDocument();
  });

  it("运行记录空态：暂无运行记录", async () => {
    render(<AutomationPanel />);
    fireEvent.click(screen.getByText("运行记录"));
    await waitFor(() => expect(screen.getByText("暂无运行记录")).toBeInTheDocument());
  });

  it("点击「+ 添加自动化」进入表单（截图 2 字段）", async () => {
    render(<AutomationPanel />);
    await waitFor(() => screen.getByText("+ 添加自动化"));
    fireEvent.click(screen.getByText("+ 添加自动化"));
    await waitFor(() => expect(screen.getByText("添加自动化任务")).toBeInTheDocument());
    expect(screen.getByText("名称")).toBeInTheDocument();
    expect(screen.getByText(/工作空间/)).toBeInTheDocument();
    expect(screen.getByText("提示词")).toBeInTheDocument();
    expect(screen.getByText("执行频率")).toBeInTheDocument();
    expect(screen.getByText("周期")).toBeInTheDocument();
    expect(screen.getByText("按间隔")).toBeInTheDocument();
    expect(screen.getByText("单次")).toBeInTheDocument();
    expect(screen.getByText(/生效日期区间/)).toBeInTheDocument();
    expect(screen.getByText(/推送到微信小程序/)).toBeInTheDocument();
    expect(screen.getByText("取消")).toBeInTheDocument();
    expect(screen.getByText("保存")).toBeInTheDocument();
    // 提示词工具条 chips
    expect(screen.getByText("Auto")).toBeInTheDocument();
    expect(screen.getByText(/技能/)).toBeInTheDocument();
    expect(screen.getByText("召唤专家")).toBeInTheDocument();
    expect(screen.getByText("完全访问权限")).toBeInTheDocument();
  });

  it("保存为自动化：会话 ⋯ 菜单交来的草稿直接预填创建表单", async () => {
    setPendingAutomationDraft({ name: "季度销售自动化", prompt: "把季度销售数据整理成报告", cwds: "/ws" });
    render(<AutomationPanel />);
    await waitFor(() => expect(screen.getByText("执行频率")).toBeInTheDocument());
    expect((document.querySelector(".atm-modal-input") as HTMLInputElement).value).toBe("季度销售自动化");
    expect((document.querySelector(".atm-prompt-textarea") as HTMLTextAreaElement).value).toBe("把季度销售数据整理成报告");
  });

  it("点击模板卡片预填进入创建表单", async () => {
    render(<AutomationPanel />);
    await waitFor(() => screen.getByText("每日 AI 新闻推送"));
    fireEvent.click(screen.getByText("每日 AI 新闻推送"));
    await waitFor(() => {
      const nameInput = document.querySelector(".atm-modal-input") as HTMLInputElement;
      expect(nameInput?.value).toBe("每日 AI 新闻推送");
    });
  });

  it("工作空间留空也能保存：留空 = 默认空间（宿主补齐），界面不拦", async () => {
    // 回归修复：以前留空工作空间会被服务层打回 invalid_payload: cwds，
    // 界面只弹一条看不懂的错。现在留空是合法的（默认空间）。
    const { automationsSave } = await import("@openbuddy/client/agent-client");
    render(<AutomationPanel />);
    await waitFor(() => screen.getByText("+ 添加自动化"));
    fireEvent.click(screen.getByText("+ 添加自动化"));
    await waitFor(() => screen.getByText("添加自动化任务"));
    const nameInput = document.querySelector(".atm-modal-input") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "每日 5 个英语单词" } });
    const promptInput = document.querySelector(".atm-modal-chat-input textarea") as HTMLTextAreaElement;
    fireEvent.change(promptInput, { target: { value: "给我 5 个英语单词" } });
    fireEvent.click(screen.getByText("保存"));
    // 完全访问权限的确认弹窗：勾选风险后确认创建。
    await waitFor(() => expect(screen.getByText("我已了解风险，并愿意为该任务的执行结果负责。")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("确认创建"));
    await waitFor(() => expect(automationsSave).toHaveBeenCalled());
    const calls = (automationsSave as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const payload = calls.at(-1)![0] as { name: string; cwds: string };
    expect(payload.name).toBe("每日 5 个英语单词");
    expect(payload.cwds).toBe("");
  });

  it("频率切换：按间隔显示 每 N 小时，单次显示日期选择", async () => {
    render(<AutomationPanel />);
    await waitFor(() => screen.getByText("+ 添加自动化"));
    fireEvent.click(screen.getByText("+ 添加自动化"));
    await waitFor(() => screen.getByText("执行频率"));
    fireEvent.click(screen.getByText("按间隔"));
    expect(screen.getByText("每")).toBeInTheDocument();
    expect(screen.getByText("小时")).toBeInTheDocument();
    fireEvent.click(screen.getByText("单次"));
    // 单次模式下隐藏生效日期区间
    expect(screen.queryByText(/生效日期区间/)).not.toBeInTheDocument();
    // 切回周期恢复
    fireEvent.click(screen.getByText("周期"));
    expect(screen.getByText(/生效日期区间/)).toBeInTheDocument();
  });
});

describe("AutomationPanel（有任务/有记录）", () => {
  const baseAutomation = {
    id: "a1",
    name: "每日 AI 新闻推送",
    prompt: "整理 AI 新闻",
    cwds: "",
    status: "ACTIVE" as const,
    skills: [],
    connectorIds: [],
    permissionMode: "fullAccess" as const,
    scheduleType: "recurring" as const,
    schedule: {
      freq: "DAILY" as const,
      interval: 1,
      byday: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"],
      bymonthday: [],
      bymonth: [],
      byhour: 9,
      byminute: 0,
      intervalHours: 1,
    },
    pushToWeChat: false,
    createdAt: new Date().toISOString(),
  };

  it("任务列表：显示名称与调度摘要", async () => {
    snapshot = { automations: [baseAutomation], records: [] };
    render(<AutomationPanel />);
    await waitFor(() => expect(screen.getByText("每日 AI 新闻推送")).toBeInTheDocument());
    expect(screen.getByText("当前")).toBeInTheDocument();
    expect(screen.getByText("每天 09:00")).toBeInTheDocument();
    // 有任务时工具栏出现搜索/批量管理/添加自动化
    expect(screen.getByPlaceholderText("搜索自动化/记录")).toBeInTheDocument();
    expect(screen.getByText("批量管理")).toBeInTheDocument();
    expect(screen.getByText("添加自动化")).toBeInTheDocument();
  });

  it("运行记录：按天分组显示", async () => {
    snapshot = {
      automations: [baseAutomation],
      records: [
        {
          id: "r1",
          automationId: "a1",
          automationName: "每日 AI 新闻推送",
          status: "success",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          archived: false,
        },
      ],
    };
    render(<AutomationPanel />);
    fireEvent.click(screen.getByText("运行记录"));
    await waitFor(() => expect(screen.getByText("今天")).toBeInTheDocument());
    expect(screen.getByText("每日 AI 新闻推送")).toBeInTheDocument();
    expect(screen.getByText("成功")).toBeInTheDocument();
  });
});

describe("运行记录分组与失败原因聚合 (G4-1)", () => {
  const withRecords: AutomationSnapshot = {
    automations: [
      { id: "a1", name: "每日新闻", status: "ACTIVE" } as never,
      { id: "a2", name: "周报生成", status: "ACTIVE" } as never,
    ],
    records: [
      { id: "r1", automationId: "a1", automationName: "每日新闻", status: "failed", startedAt: new Date().toISOString(), error: "automation_timeout", archived: false },
      { id: "r2", automationId: "a1", automationName: "每日新闻", status: "failed", startedAt: new Date().toISOString(), error: "automation_timeout", archived: false },
      { id: "r3", automationId: "a2", automationName: "周报生成", status: "success", startedAt: new Date().toISOString(), archived: false },
    ],
  };

  it("可切换「按任务」分组，并聚合失败原因", async () => {
    snapshot = withRecords;
    render(<AutomationPanel />);
    fireEvent.click(screen.getByText("运行记录"));
    await waitFor(() => expect(screen.getByRole("group", { name: "失败原因" })).toBeInTheDocument());
    // 同一错误文本归并成一条，计数 2。
    const chip = screen.getByRole("button", { name: /automation_timeout/ });
    expect(chip.textContent).toContain("2");

    fireEvent.click(screen.getByRole("tab", { name: "按任务" }));
    await waitFor(() => expect(screen.getAllByText("每日新闻").length).toBeGreaterThan(0));
    expect(screen.getAllByText("周报生成").length).toBeGreaterThan(0);
  });

  it("点失败原因只保留该原因的记录", async () => {
    snapshot = withRecords;
    render(<AutomationPanel />);
    fireEvent.click(screen.getByText("运行记录"));
    const chip = await screen.findByRole("button", { name: /automation_timeout/ });
    fireEvent.click(chip);
    await waitFor(() => expect(screen.queryAllByText("周报生成")).toHaveLength(0));
  });
});
