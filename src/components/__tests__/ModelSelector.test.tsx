import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModelSelector } from "../ModelSelector";

const models = [
  { id: "provider-a/shared", modelId: "shared", providerId: "provider-a", providerLabel: "Provider A", label: "Shared model" },
  { id: "provider-b/shared", modelId: "shared", providerId: "provider-b", providerLabel: "Provider B", label: "Shared model" },
  { id: "provider-b/vision", modelId: "vision", providerId: "provider-b", providerLabel: "Provider B", label: "Vision", input: ["text", "image"] as ("text" | "image")[] },
];
const open = () => fireEvent.click(screen.getByRole("button", { name: /选择模型/ }));

describe("ModelSelector identities and asynchronous selection", () => {
  it("groups duplicate model names by provider and selects the complete identity", async () => {
    const change = vi.fn();
    render(<ModelSelector models={models} modelId="provider-a/shared" onModelChange={change} />);
    open();
    const group = screen.getByRole("group", { name: "Provider B" });
    const option = within(group).getByRole("option", { name: /Shared model/ });
    expect(option).toHaveAttribute("aria-selected", "false");
    fireEvent.click(option);
    expect(change).toHaveBeenCalledWith("provider-b/shared");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });
  it("searches model and provider names and supports keyboard selection", async () => {
    const change = vi.fn();
    render(<ModelSelector models={models} onModelChange={change} />);
    open();
    const search = screen.getByRole("searchbox", { name: "搜索模型或提供商" });
    fireEvent.change(search, { target: { value: "vision" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(change).toHaveBeenCalledWith("provider-b/vision");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });
  it("shows pending state and preserves the current model after a failed change", async () => {
    let reject!: (reason: Error) => void;
    const change = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    render(<ModelSelector models={models} modelId="provider-a/shared" onModelChange={change} />);
    open();
    fireEvent.click(within(screen.getByRole("group", { name: "Provider B" })).getByRole("option", { name: /Shared model/ }));
    expect(screen.getByRole("status")).toHaveTextContent("切换中");
    reject(new Error("Error invoking remote method 'openbuddy:invoke': Error: model_auth_missing: 提供商尚未认证"));
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("该提供商尚未配置 API Key，请先在设置中配置");
    expect(error).not.toHaveTextContent("openbuddy:invoke");
    expect(within(screen.getByRole("group", { name: "Provider A" })).getByRole("option", { name: /Shared model/ })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Provider B" })).getByRole("option", { name: /Shared model/ })).toBeEnabled());
  });
});
