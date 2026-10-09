/**
 * R2.1 — ModelSelector a11y & keyboard navigation tests.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelSelector, type ModelOption, type CapabilityHint, inferCapabilities } from "@openbuddy/ui-workbench";

const models: ModelOption[] = [
  { id: "gpt-4o", label: "GPT-4o", apiBackend: "chat_completions" },
  { id: "claude-opus-4", label: "Claude Opus 4", apiBackend: "messages" },
  { id: "o3", label: "o3", apiBackend: "responses" },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ModelSelector a11y", () => {
  it("trigger has aria-haspopup=listbox and aria-expanded=false when closed", () => {
    render(<ModelSelector modelId="gpt-4o" models={models} onModelChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: /GPT-4o/ });
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-controls")).toMatch(/-menu$/);
  });

  it("aria-expanded toggles and menu renders with role=listbox", async () => {
    render(<ModelSelector modelId="gpt-4o" models={models} onModelChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: /GPT-4o/ });
    await userEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("listbox");
    expect(menu).toBeTruthy();
    // aria-labelledby points back at the trigger
    expect(menu.getAttribute("aria-labelledby")).toBe(trigger.id);
  });

  it("options carry aria-selected reflecting the current modelId", async () => {
    render(<ModelSelector modelId="claude-opus-4" models={models} onModelChange={() => {}} />);
    await userEvent.click(screen.getByRole("button"));
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(3);
    expect(opts[0].getAttribute("aria-selected")).toBe("false");
    expect(opts[1].getAttribute("aria-selected")).toBe("true");
    expect(opts[2].getAttribute("aria-selected")).toBe("false");
  });

  it("opening focuses the menu (auto-focus inside listbox)", async () => {
    render(<ModelSelector modelId="gpt-4o" models={models} onModelChange={() => {}} />);
    await userEvent.click(screen.getByRole("button"));
    expect(document.activeElement?.getAttribute("role")).toBe("listbox");
  });

  it("ArrowDown cycles through options and updates aria-activedescendant", async () => {
    render(<ModelSelector modelId="gpt-4o" models={models} onModelChange={() => {}} />);
    await userEvent.click(screen.getByRole("button"));
    const menu = screen.getByRole("listbox");
    // Active defaults to the currently selected model (index 0)
    expect(menu.getAttribute("aria-activedescendant")).toMatch(/-opt-0$/);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(menu.getAttribute("aria-activedescendant")).toMatch(/-opt-1$/);
    fireEvent.keyDown(menu, { key: "End" });
    expect(menu.getAttribute("aria-activedescendant")).toMatch(/-opt-2$/);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    // wraps
    expect(menu.getAttribute("aria-activedescendant")).toMatch(/-opt-0$/);
  });

  it("ArrowUp wraps from first to last", async () => {
    render(<ModelSelector modelId="gpt-4o" models={models} onModelChange={() => {}} />);
    await userEvent.click(screen.getByRole("button"));
    const menu = screen.getByRole("listbox");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(menu.getAttribute("aria-activedescendant")).toMatch(/-opt-2$/);
    fireEvent.keyDown(menu, { key: "Home" });
    expect(menu.getAttribute("aria-activedescendant")).toMatch(/-opt-0$/);
  });

  it("Enter selects the active option and closes the menu", async () => {
    const onModelChange = vi.fn();
    render(<ModelSelector modelId="gpt-4o" models={models} onModelChange={onModelChange} />);
    await userEvent.click(screen.getByRole("button"));
    const menu = screen.getByRole("listbox");
    fireEvent.keyDown(menu, { key: "ArrowDown" }); // focus index 1 (claude-opus-4)
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(onModelChange).toHaveBeenCalledWith("claude-opus-4");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Escape closes the menu and returns focus to the trigger", async () => {
    render(<ModelSelector modelId="gpt-4o" models={models} onModelChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: /GPT-4o/ });
    await userEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("outside click closes the menu", async () => {
    render(
      <div>
        <ModelSelector modelId="gpt-4o" models={models} onModelChange={() => {}} />
        <button data-testid="outside">elsewhere</button>
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: /GPT-4o/ }));
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("type-ahead jumps to the option whose label starts with the typed letter", async () => {
    render(<ModelSelector modelId="gpt-4o" models={models} onModelChange={() => {}} />);
    await userEvent.click(screen.getByRole("button"));
    const menu = screen.getByRole("listbox");
    // "o" → o3 (index 2)
    fireEvent.keyDown(menu, { key: "o" });
    expect(menu.getAttribute("aria-activedescendant")).toMatch(/-opt-2$/);
    // Continue typing "o3" (still matches o3, no other match)
    fireEvent.keyDown(menu, { key: "3" });
    expect(menu.getAttribute("aria-activedescendant")).toMatch(/-opt-2$/);
  });

  it("empty state shows '未配置模型' and offers a 前往设置 affordance", async () => {
    const onOpenSettings = vi.fn();
    render(<ModelSelector models={[]} onModelChange={() => {}} onOpenSettings={onOpenSettings} />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("未配置模型")).toBeTruthy();
    await userEvent.click(screen.getByText("前往设置"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    // Menu closed after action
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("empty state without onOpenSettings hides the affordance gracefully", async () => {
    render(<ModelSelector models={[]} onModelChange={() => {}} />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("未配置模型")).toBeTruthy();
    expect(screen.queryByText("前往设置")).toBeNull();
  });
});

describe("R2.2 — ModelSelector capability hints (Plan5 B.7)", () => {
  it("inferCapabilities returns explicit capabilities when provided", () => {
    const m: ModelOption = {
      id: "custom-x", label: "Custom X", apiBackend: "chat_completions",
      capabilities: ["vision" as CapabilityHint],
    };
    expect(inferCapabilities(m)).toEqual(["vision"]);
  });

  it("messages backend → vision + tools + reasoning + json_mode", () => {
    const m: ModelOption = { id: "claude-opus-4", apiBackend: "messages" };
    expect(inferCapabilities(m)).toEqual(["vision", "tools", "reasoning", "json_mode"]);
  });

  it("responses backend → vision + tools + json_mode (no reasoning)", () => {
    const m: ModelOption = { id: "gpt-5", apiBackend: "responses" };
    expect(inferCapabilities(m)).toEqual(["vision", "tools", "json_mode"]);
  });

  it("chat_completions id-pattern falls back conservatively", () => {
    const gpt: ModelOption = { id: "gpt-4o", apiBackend: "chat_completions" };
    expect(inferCapabilities(gpt)).toContain("vision");
    expect(inferCapabilities(gpt)).toContain("tools");
    expect(inferCapabilities(gpt)).toContain("json_mode");
  });

  it("unknown chat_completions id yields empty chips (better to under-promise)", () => {
    const m: ModelOption = { id: "weird-model", apiBackend: "chat_completions" };
    expect(inferCapabilities(m)).toEqual([]);
  });

  it("renders capability chips in the dropdown for vision-capable models", async () => {
    render(<ModelSelector modelId="gpt-4o" models={models} onModelChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /GPT-4o/ }));
    // Claude (apiBackend: messages) → vision + tools + reasoning + json_mode, but
    // the dropdown caps at 3 chips per option so we should see at least vision+tools.
    const visionChips = screen.getAllByTitle(/视觉/);
    expect(visionChips.length).toBeGreaterThanOrEqual(1);
  });

  it("explicit capabilities override apiBackend-based inference", () => {
    const m: ModelOption = {
      id: "vision-only",
      apiBackend: "messages",
      capabilities: ["streaming" as CapabilityHint],
    };
    // Should NOT pick up vision/tools/reasoning from messages — explicit wins.
    expect(inferCapabilities(m)).toEqual(["streaming"]);
  });
});
