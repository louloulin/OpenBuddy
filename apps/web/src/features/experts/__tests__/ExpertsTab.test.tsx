import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ExpertCenterCatalog, ExpertEntry } from "@openbuddy/protocol/experts";
import { ExpertsTab } from "../experts/ExpertsTab";
import { usePendingExpertStore } from "../state/pending-expert-store";
import { AppDialogHost } from "../../../shared/ui/AppDialog";

const expert = (over: Partial<ExpertEntry>): ExpertEntry => ({
  id: "x", name: "X", scope: "builtin", path: "builtin:x", raw: "", examples: [], tags: [], prompt: "persona", readonly: true, ...over,
});
const analyst = expert({ id: "data-analyst", name: "数据分析师", emoji: "📊", category: "data", description: "分析数据", examples: ["分析 sales.csv"], tags: ["数据清洗"], thinking: "high", tools: ["read", "bash"] });
const mineExpert = expert({ id: "weekly", name: "周报助手", emoji: "📅", scope: "user", readonly: false, path: "/u/pi/agents/weekly.md", category: "office", examples: ["写周报"] });
let catalog: ExpertCenterCatalog;
let mine: ExpertEntry[];
const api = vi.hoisted(() => ({
  expertsLoad: vi.fn(),
  agentsList: vi.fn(),
  agentsGet: vi.fn(),
  expertsDefaultRoot: vi.fn(async () => "/u/pi/agents"),
  agentsSave: vi.fn(),
  agentsDelete: vi.fn(async () => {}),
  agentsTemplate: vi.fn(async () => "---\nname: x\n---\n"),
  expertsLinkAgents: vi.fn(async () => 1),
  expertsImageBytes: vi.fn(async () => ""),
  expertsThumbnail: vi.fn(async () => ""),
  expertsListRoots: vi.fn(async () => []),
  expertsSetRoots: vi.fn(async () => []),
  expertsOpenDir: vi.fn(async () => {}),
  providersList: vi.fn(async () => ({ providers: [], models: [] })),
  flattenModels: vi.fn(() => []),
  skillsList: vi.fn(async () => []),
  mcpList: vi.fn(async () => []),
}));
vi.mock("@openbuddy/client/agent-client", () => api);
vi.mock("@openbuddy/client/ipc", () => ({ open: vi.fn(async () => null) }));

beforeEach(() => {
  catalog = {
    userDir: "/u/pi/agents", projectTrusted: false, problems: [], roots: [],
    categories: [{ id: "data", label: "数据分析", emoji: "📊" }, { id: "office", label: "日常办公", emoji: "🗂️" }, { id: "custom", label: "其他", emoji: "✨" }],
    experts: [mineExpert, analyst],
    scenes: [{ id: "insight", title: "数据与研究", description: "d", expertIds: ["data-analyst"], from: "#fff", to: "#eee" }],
  };
  mine = [mineExpert];
  api.expertsLoad.mockImplementation(async () => catalog);
  api.agentsList.mockImplementation(async () => mine);
  api.agentsGet.mockImplementation(async () => ({ ...mineExpert, prompt: "磁盘上改过的人设" }));
  api.agentsSave.mockImplementation(async (draft: { name: string }) => expert({ id: "new-one", name: draft.name, scope: "user", readonly: false }));
  usePendingExpertStore.getState().clear();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("专家中心 (pii W2.3)", () => {
  it("shows the catalog with scenes, categories and search", async () => {
    render(<ExpertsTab pills={null} />);
    expect(await screen.findByText("数据与研究")).toBeInTheDocument();
    expect(screen.getAllByText("数据分析师").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "🗂️ 日常办公" }));
    expect(screen.queryByText("分析数据")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    fireEvent.change(screen.getByLabelText("搜索专家"), { target: { value: "sales" } });
    expect(screen.getByText("分析数据")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索专家"), { target: { value: "没有这个" } });
    expect(screen.getByText(/没有找到/)).toBeInTheDocument();
  });

  it("召唤 sets the pending expert with a sample task and goes home, without sending", async () => {
    const onGoHome = vi.fn();
    render(<ExpertsTab pills={null} onGoHome={onGoHome} />);
    const card = (await screen.findByText("分析数据")).closest("article")!;
    fireEvent.click(card);
    const dialog = await screen.findByRole("dialog", { name: "专家：数据分析师" });
    expect(within(dialog).getByText("思考 高")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText("“分析 sales.csv”"));
    expect(onGoHome).toHaveBeenCalled();
    expect(usePendingExpertStore.getState().expert).toMatchObject({ expertId: "data-analyst", name: "数据分析师", quickPrompt: "分析 sales.csv", avatarLocal: "📊", source: "builtin" });
  });

  it("我的专家: create through the editor and delete with confirmation", async () => {
    render(<><ExpertsTab pills={null} /><AppDialogHost /></>);
    fireEvent.click(await screen.findByRole("button", { name: /我的专家/ }));
    expect(await screen.findByText("周报助手")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ 创建专家" }));
    const editor = await screen.findByRole("dialog", { name: "创建专家" });
    const create = within(editor).getByRole("button", { name: "创建" });
    expect(create).toBeDisabled();
    fireEvent.change(within(editor).getByLabelText("专家名称"), { target: { value: "合同审阅" } });
    fireEvent.change(within(editor).getByLabelText("人设"), { target: { value: "你是一名合同审阅专家。" } });
    fireEvent.change(within(editor).getByLabelText("示例任务"), { target: { value: "审一下这份合同\n列出风险条款" } });
    fireEvent.click(within(editor).getByRole("button", { name: "头像 ⚖️" }));
    fireEvent.click(create);
    await waitFor(() => expect(api.agentsSave).toHaveBeenCalled());
    expect(api.agentsSave.mock.calls[0]).toEqual([
      expect.objectContaining({ name: "合同审阅", avatar: "⚖️", prompt: "你是一名合同审阅专家。", examples: ["审一下这份合同", "列出风险条款"], category: "custom" }),
      "create",
    ]);
    // 删除 asks first.
    fireEvent.click(await screen.findByRole("button", { name: "删除 周报助手" }));
    expect(api.agentsDelete).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    await waitFor(() => expect(api.agentsDelete).toHaveBeenCalledWith("weekly"));
  });

  it("编辑 re-reads the expert file so outside edits are not overwritten", async () => {
    render(<ExpertsTab pills={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /我的专家/ }));
    fireEvent.click(await screen.findByRole("button", { name: "编辑 周报助手" }));
    const editor = await screen.findByRole("dialog", { name: /编辑/ });
    expect(api.agentsGet).toHaveBeenCalledWith("weekly");
    expect(within(editor).getByLabelText("人设")).toHaveValue("磁盘上改过的人设");
  });

  it("carries the old tab's chosen directory over once as a library root", async () => {
    localStorage.setItem("expertsRoot", "/lib/experts");
    render(<ExpertsTab pills={null} />);
    await waitFor(() => expect(api.expertsSetRoots).toHaveBeenCalledWith(["/lib/experts"]));
    await waitFor(() => expect(api.expertsLoad).toHaveBeenCalledTimes(2));
    expect(localStorage.getItem("expertsRoot")).toBeNull();
  });

  it("read-only experts are copied into 我的专家 instead of edited", async () => {
    render(<ExpertsTab pills={null} />);
    fireEvent.click((await screen.findByText("分析数据")).closest("article")!);
    fireEvent.click(within(await screen.findByRole("dialog", { name: "专家：数据分析师" })).getByRole("button", { name: "复制到我的专家" }));
    const editor = await screen.findByRole("dialog", { name: "创建专家" });
    expect(within(editor).getByLabelText("专家名称")).toHaveValue("数据分析师（副本）");
    expect(within(editor).getByLabelText("思考档位")).toHaveValue("high");
  });
});
