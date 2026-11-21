import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocalModelCard } from "../LocalModelCard";
import { providersLocalGet, providersLocalProbe, providersLocalSet } from "@openbuddy/client/agent-client";

vi.mock("@openbuddy/client/agent-client", () => ({
  providersLocalGet: vi.fn(),
  providersLocalProbe: vi.fn(),
  providersLocalSet: vi.fn(),
}));

const config = { enabled: false, baseUrl: "http://127.0.0.1:8080/v1", model: "", contextWindow: 8192, maxTokens: 4096, setDefault: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(providersLocalGet).mockResolvedValue({ config, providerId: "llama.cpp", models: [] });
  vi.mocked(providersLocalProbe).mockResolvedValue({ ok: true, models: ["qwen2.5-7b", "llama-3-8b"], endpoint: "http://127.0.0.1:8080/v1", ms: 12 });
  vi.mocked(providersLocalSet).mockResolvedValue({ config: { ...config, enabled: true, model: "qwen2.5-7b" }, providerId: "llama.cpp", models: [{ modelId: "qwen2.5-7b" }] });
});

describe("设置 · 本地模型卡片 (pii W8)", () => {
  it("probes the server and enables the selected model", async () => {
    const onSaved = vi.fn();
    render(<LocalModelCard onSaved={onSaved} />);
    await screen.findByText("已停用");
    fireEvent.click(screen.getByRole("button", { name: /探测/ }));
    await waitFor(() => expect(screen.getByText(/发现 2 个模型/)).toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "qwen2.5-7b" } });
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));
    await waitFor(() => expect(providersLocalSet).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, model: "qwen2.5-7b", baseUrl: "http://127.0.0.1:8080/v1" })));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});
