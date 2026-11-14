import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { invoke } from "@openbuddy/client/ipc";
import { ModelsSettingsPanel } from "../models-settings/ModelsSettingsPanel";
import { formatTokens, levelsOf, mapFromLevels, uniqueProviderId } from "../models-settings/model-config";

vi.mock("../AppDialog", () => ({ appConfirm: vi.fn(async () => true) }));

type Call = { command: string; args: any };
let calls: Call[] = [];
let db: { providers: any[]; models: any[] };
let defaults: any;
const fetched = [
  { id: "deepseek-flash", contextWindow: 1000000, maxTokens: 384000, reasoning: true, input: ["text", "image"], thinkingLevels: ["off", "high", "max"], suggested: { contextWindow: 1000000, maxTokens: 384000, reasoning: true, input: ["text", "image"], thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" }, compat: { thinkingFormat: "deepseek", supportsReasoningEffort: true } } },
  { id: "glm-5.3-flash", name: "GLM-5.3-Flash", reasoning: true, thinkingLevels: ["low", "high", "max"], suggested: { name: "GLM-5.3-Flash", reasoning: true } },
];

vi.mock("@openbuddy/client/ipc", () => ({
  invoke: vi.fn(async (command: string, args: any) => {
    calls.push({ command, args });
    switch (command) {
      case "providers_list": return structuredClone(db);
      case "agents_defaults_get": return { ...defaults };
      case "agents_defaults_save": defaults = { ...args.defaults }; return null;
      case "providers_test":
        if (args.modelId) return { ok: true, latencyMs: 820, reply: "OK", usage: { input: 9, output: 2 } };
        return { ok: true, latencyMs: 230, modelCount: 2, baseUrl: args.baseUrl?.endsWith("/v1") ? args.baseUrl : `${args.baseUrl}/v1` };
      case "providers_fetch_models": return fetched;
      case "providers_save_provider":
        db.providers = db.providers.filter((p) => p.id !== args.provider.id).concat({ ...args.provider, apiKey: args.provider.apiKey ? "••••" : undefined });
        return null;
      case "providers_save_model":
        db.models = db.models.filter((m) => m.modelId !== args.model.modelId || m.providerId !== args.model.providerId).concat({ ...args.model, modelKey: `model:${args.model.providerId}/${args.model.modelId}` });
        return null;
      default: return null;
    }
  }),
  listen: vi.fn(async () => () => {}),
}));

beforeEach(() => {
  calls = [];
  db = { providers: [], models: [] };
  defaults = { defaultModel: "", defaultPermission: "ask" };
  vi.mocked(invoke).mockClear();
});

describe("模型配置", () => {
  it("adds a gateway: detects the /v1 base, saves the key once, imports models with their capabilities and makes one the default", async () => {
    const onModelsChanged = vi.fn();
    render(<ModelsSettingsPanel onModelsChanged={onModelsChanged} />);
    fireEvent.click((await screen.findAllByRole("button", { name: /添加厂商/ }))[0]);
    const dialog = screen.getByRole("dialog", { name: "添加厂商" });
    fireEvent.change(within(dialog).getByPlaceholderText(/公司网关/), { target: { value: "taotoken" } });
    fireEvent.change(within(dialog).getByPlaceholderText("https://api.example.com/v1"), { target: { value: "https://api.taotoken.net/coding" } });
    fireEvent.change(within(dialog).getByPlaceholderText("sk-..."), { target: { value: "sk-test" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(calls.some((c) => c.command === "providers_save_provider")).toBe(true));
    const saved = calls.find((c) => c.command === "providers_save_provider")!.args.provider;
    expect(saved).toMatchObject({ id: "taotoken", label: "taotoken", providerKind: "custom", baseUrl: "https://api.taotoken.net/coding/v1", apiBackend: "chat_completions", authScheme: "bearer", apiKey: "sk-test" });

    // The check already fetched the models: the import list opens with new ones ticked.
    const panel = await screen.findByLabelText("拉取模型");
    expect(within(panel).getByText(/找到 2 个模型 · 已选 2/)).toBeInTheDocument();
    expect(within(panel).getByText("思考：高·极限")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "导入 2 个模型" }));
    await waitFor(() => expect(calls.filter((c) => c.command === "providers_save_model")).toHaveLength(2));
    expect(calls.find((c) => c.command === "providers_save_model")!.args.model).toMatchObject({ modelId: "deepseek-flash", providerId: "taotoken", contextWindow: 1000000, thinkingLevelMap: { high: "high", max: "max" }, compat: { thinkingFormat: "deepseek" } });
    await waitFor(() => expect(defaults.defaultModel).toBe("model:taotoken/deepseek-flash"));
    expect(await screen.findByText("默认")).toBeInTheDocument();
    expect(onModelsChanged).toHaveBeenCalled();
    // The key never comes back to the renderer.
    expect(screen.queryByText("sk-test")).not.toBeInTheDocument();
  });

  it("tests a saved model with a real request and fetches models with the saved key", async () => {
    db = {
      providers: [{ id: "taotoken", providerKind: "custom", label: "taotoken", baseUrl: "https://api.taotoken.net/coding/v1", apiBackend: "chat_completions", authScheme: "bearer", apiKey: "••••" }],
      models: [{ modelId: "deepseek-flash", providerId: "taotoken", modelKey: "model:taotoken/deepseek-flash", reasoning: true, contextWindow: 1000000, maxTokens: 384000, input: ["text", "image"], thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" } }],
    };
    defaults = { defaultModel: "model:taotoken/deepseek-flash", defaultProviderId: "taotoken", defaultPermission: "ask" };
    render(<ModelsSettingsPanel />);
    expect(await screen.findByText("1M 上下文")).toBeInTheDocument();
    expect(screen.getByText("384K 输出")).toBeInTheDocument();
    expect(screen.getByText("思考：高·极限")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "测试：deepseek-flash" }));
    expect(await screen.findByText(/连接正常 · 820ms · 回复：OK/)).toBeInTheDocument();
    expect(calls.find((c) => c.command === "providers_test")!.args).toEqual({ providerId: "taotoken", modelId: "deepseek-flash" });

    fireEvent.click(screen.getByRole("button", { name: /拉取模型/ }));
    await waitFor(() => expect(calls.some((c) => c.command === "providers_fetch_models")).toBe(true));
    expect(calls.find((c) => c.command === "providers_fetch_models")!.args).toEqual({ providerKind: "custom", providerId: "taotoken" });
    expect(screen.queryByPlaceholderText(/只用于这次拉取/)).not.toBeInTheDocument();
    expect(await screen.findByText(/已配置/)).toBeInTheDocument();
  });

  it("edits a model's thinking levels and prices", async () => {
    db = {
      providers: [{ id: "gw", providerKind: "custom", label: "网关", baseUrl: "https://gw/v1", apiBackend: "chat_completions", authScheme: "bearer", apiKey: "••••" }],
      models: [{ modelId: "m", providerId: "gw", modelKey: "model:gw/m", reasoning: true }],
    };
    render(<ModelsSettingsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑：m" }));
    const dialog = screen.getByRole("dialog", { name: /编辑模型/ });
    fireEvent.click(within(dialog).getByLabelText("只提供这些档位"));
    for (const l of ["最少", "低", "中"]) fireEvent.click(within(dialog).getByLabelText(new RegExp(`^${l}`)));
    fireEvent.click(within(dialog).getByLabelText(/^极限/));
    fireEvent.change(within(dialog).getAllByPlaceholderText("0")[0], { target: { value: "0.5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls.some((c) => c.command === "providers_save_model")).toBe(true));
    expect(calls.find((c) => c.command === "providers_save_model")!.args.model).toMatchObject({
      modelId: "m", reasoning: true,
      thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" },
      cost: { input: 0.5, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
  });
});

describe("模型配置工具函数", () => {
  it("formats tokens, ids and thinking levels", () => {
    expect([formatTokens(1000000), formatTokens(131072), formatTokens(384000), formatTokens(8192)]).toEqual(["1M", "128K", "384K", "8K"]);
    expect(uniqueProviderId("custom", "Tao Token!", ["tao-token"])).toBe("tao-token-2");
    expect(uniqueProviderId("openai", "OpenAI", [])).toBe("openai");
    expect(uniqueProviderId("custom", "公司网关", [])).toBe("custom");
    expect(levelsOf(true, { off: null, minimal: null, low: "low", medium: null, high: "high", max: "max" })).toEqual(["low", "high", "max"]);
    expect(levelsOf(false)).toEqual(["off"]);
    expect(mapFromLevels(["off", "high"], { medium: "high", high: "turbo" })).toEqual({ minimal: null, low: null, medium: null, high: "turbo" });
  });
});
