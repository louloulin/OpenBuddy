import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), cycle: vi.fn() }));
vi.mock("@openbuddy/client/agent-client", () => ({
  THINKING_LABELS: { off: "关闭", low: "低", high: "高" },
  settingsAgentGet: mocks.get,
  settingsAgentSet: mocks.set,
  agentCycleModel: mocks.cycle,
}));

import { ModelRuntimeContext, ModelSelector, type ModelRuntimeControls } from "../ModelSelector";
import { nextFavorite, useFavoriteModels } from "../state/favorite-models";

const models = [
  { id: "model:a/shared", modelId: "shared", providerId: "a", providerLabel: "Provider A", label: "Shared model" },
  { id: "model:b/vision", modelId: "vision", providerId: "b", providerLabel: "Provider B", label: "Vision", reasoning: true },
  { id: "model:b/plain", modelId: "plain", providerId: "b", providerLabel: "Provider B", label: "Plain" },
];
const settings = (favoriteModels: string[]) => ({ favoriteModels });
function renderSelector(props: { modelId?: string; onModelChange?: (id: string) => void; controls?: Partial<ModelRuntimeControls> } = {}) {
  const change = props.onModelChange ?? vi.fn();
  render(
    <ModelRuntimeContext.Provider value={{ busy: false, thinkingLevels: [], ...props.controls }}>
      <ModelSelector models={models} modelId={props.modelId ?? "model:a/shared"} onModelChange={change} />
    </ModelRuntimeContext.Provider>,
  );
  return change;
}
const pressCtrlP = () => act(() => { fireEvent.keyDown(window, { key: "p", ctrlKey: true }); });

beforeEach(() => {
  vi.clearAllMocks();
  useFavoriteModels.setState({ keys: [], loaded: false });
  mocks.get.mockResolvedValue(settings([]));
  mocks.set.mockImplementation(async (patch: { favoriteModels: string[] }) => settings(patch.favoriteModels));
});

describe("favourite models (pii W1.6)", () => {
  it("stars a model from the menu and saves the favourites in order", async () => {
    renderSelector();
    fireEvent.click(screen.getByRole("button", { name: /选择模型/ }));
    const star = screen.getByRole("button", { name: "收藏 Vision" });
    expect(star).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(star);
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith({ favoriteModels: ["model:b/vision"] }));
    expect(await screen.findByRole("button", { name: "取消收藏 Vision" })).toHaveAttribute("aria-pressed", "true");
    // Starring does not pick the model.
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("shows an error and keeps the old list when saving fails", async () => {
    mocks.set.mockRejectedValue(new Error("model_not_found: 收藏的模型不存在"));
    renderSelector();
    fireEvent.click(screen.getByRole("button", { name: /选择模型/ }));
    fireEvent.click(screen.getByRole("button", { name: "收藏 Plain" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("收藏失败");
    expect(screen.getByRole("button", { name: "收藏 Plain" })).toHaveAttribute("aria-pressed", "false");
  });

  it("Ctrl/Cmd+P on the home page moves to the next favourite", async () => {
    mocks.get.mockResolvedValue(settings(["model:a/shared", "model:b/vision"]));
    const change = renderSelector();
    await waitFor(() => expect(useFavoriteModels.getState().keys).toHaveLength(2));
    pressCtrlP();
    await waitFor(() => expect(change).toHaveBeenCalledWith("model:b/vision"));
  });

  it("Ctrl/Cmd+P in a task cycles through the host (Pi's cycleModel)", async () => {
    mocks.get.mockResolvedValue(settings(["model:a/shared", "model:b/vision"]));
    mocks.cycle.mockResolvedValue({ changed: true, state: { sessionId: "s1", modelKey: "model:b/vision" } });
    const change = renderSelector({ controls: { sessionId: "s1" } });
    await waitFor(() => expect(useFavoriteModels.getState().keys).toHaveLength(2));
    pressCtrlP();
    expect(mocks.cycle).toHaveBeenCalledWith("s1");
    expect(change).not.toHaveBeenCalled();
    expect(await screen.findByText("已切换到 Vision")).toBeInTheDocument();
  });

  it("explains how to add favourites when Ctrl/Cmd+P has nothing to cycle", async () => {
    renderSelector({ controls: { sessionId: "s1" } });
    await waitFor(() => expect(useFavoriteModels.getState().loaded).toBe(true));
    pressCtrlP();
    expect(mocks.cycle).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("先在模型菜单中点 ☆ 收藏模型");
  });

  it("greys out the thinking control when the model cannot think", async () => {
    renderSelector({ modelId: "model:b/plain", controls: { thinkingLevels: ["off"], supportsThinking: false } });
    await waitFor(() => expect(useFavoriteModels.getState().loaded).toBe(true));
    expect(screen.getByRole("img", { name: "当前模型不支持思考" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: /思考等级/ })).toBeNull();
  });

  it("keeps the live thinking control for a model that can think", async () => {
    renderSelector({ modelId: "model:b/vision", controls: { thinkingLevels: ["off", "low", "high"], thinkingLevel: "low", supportsThinking: true, onThinkingChange: vi.fn(async () => {}) } });
    await waitFor(() => expect(useFavoriteModels.getState().loaded).toBe(true));
    // WorkBuddy 对齐：思考等级是一个药丸按钮，展开后才是等级列表。
    const pill = screen.getByRole("button", { name: "思考等级：低" });
    expect(pill).toBeInTheDocument();
    fireEvent.click(pill);
    expect(screen.getByRole("listbox", { name: "思考等级" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "当前模型不支持思考" })).toBeNull();
  });

  it("nextFavorite wraps around and skips models that no longer exist", () => {
    const all = models.map((m) => m.id);
    expect(nextFavorite(["model:a/shared", "model:b/vision"], all, "model:b/vision")).toBe("model:a/shared");
    expect(nextFavorite(["model:gone/x", "model:b/vision"], all, "model:a/shared")).toBe("model:b/vision");
    expect(nextFavorite(["model:b/vision"], all, "model:b/vision")).toBeUndefined();
    expect(nextFavorite([], all, "model:a/shared")).toBeUndefined();
  });
});
