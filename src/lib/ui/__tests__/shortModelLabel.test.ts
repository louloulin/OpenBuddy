/**
 * shortModelLabel — 把内部 `provider/sub-provider/model` 形状的 modelId
 * 折叠成面向用户的简短标签。Plan5 之前 MessageMeta 和 timeline-utils 都
 * 直接渲染原始 modelId(`custom_anthropic/minimax/MiniMax-M3`),把内部
 * provider 路径泄露到 UI。Codex / ChatGPT 只显示模型名本身。
 */

import { describe, expect, it } from "vitest";
import { shortModelLabel } from "../timeline-utils";

describe("shortModelLabel", () => {
  it("trims three-segment provider/sub-provider/model to model only", () => {
    expect(shortModelLabel("custom_anthropic/minimax/MiniMax-M3")).toBe("minimax/MiniMax-M3");
  });
  it("keeps two-segment provider/model intact (semantic second level matters)", () => {
    expect(shortModelLabel("openai/gpt-4o")).toBe("openai/gpt-4o");
  });
  it("keeps a single model name intact", () => {
    expect(shortModelLabel("gpt-4o")).toBe("gpt-4o");
  });
  it("returns empty string for falsy input (chat history without model)", () => {
    expect(shortModelLabel(undefined)).toBe("");
    expect(shortModelLabel(null)).toBe("");
    expect(shortModelLabel("")).toBe("");
  });
  it("does not mutate strings without a path separator", () => {
    expect(shortModelLabel("MiniMax-M3")).toBe("MiniMax-M3");
  });
});
