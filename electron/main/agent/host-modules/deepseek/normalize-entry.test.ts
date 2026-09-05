import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { on: () => undefined, getPath: () => "/tmp/openbuddy-normalize-entry-test" },
}));

import { normalizeDeepSeekRuntimeEntry } from "./normalize-entry";

describe("normalizeDeepSeekRuntimeEntry (independent module)", () => {
  it("returns entry unchanged when no default applies", () => {
    const entry = { id: "regular", name: "@deepseek-ai/dsh-regular" };
    expect(normalizeDeepSeekRuntimeEntry(entry)).toEqual(entry);
  });

  it("adds root=['.'] to cordis-plugin-hmr when config missing", () => {
    const entry: any = { id: "hmr", name: "@deepseek-ai/cordis-plugin-hmr" } as any;
    const out = normalizeDeepSeekRuntimeEntry(entry);
    expect(out.config).toEqual({ root: ["."] });
  });

  it("preserves existing cordis-plugin-hmr config", () => {
    const entry: any = { id: "hmr", name: "@deepseek-ai/cordis-plugin-hmr", config: { root: ["custom"] } };
    expect(normalizeDeepSeekRuntimeEntry(entry)).toBe(entry);
  });

  it("adds piHome-relative root to dsh-session-persistence-jsonl when config missing", () => {
    const entry: any = { id: "persistence", name: "@deepseek-ai/dsh-session-persistence-jsonl" } as any;
    const out = normalizeDeepSeekRuntimeEntry(entry);
    expect(out.config).toEqual({ root: expect.stringContaining("sessions") });
  });

  it("sets sampleOverCapGlobResults=false on openbuddy-dsh-tool-fs-search when config missing", () => {
    const entry = { id: "openbuddy-dsh-tool-fs-search", name: "@deepseek-ai/dsh-tool-fs-search" } as any;
    const out = normalizeDeepSeekRuntimeEntry(entry);
    expect(out.config).toEqual({ sampleOverCapGlobResults: false });
  });

  it("sets provider=pi, model=default on openbuddy-dsh-agent-default-model when config missing", () => {
    const entry = { id: "openbuddy-dsh-agent-default-model", name: "@deepseek-ai/dsh-agent-default-model" } as any;
    const out = normalizeDeepSeekRuntimeEntry(entry);
    expect(out.config).toEqual({ provider: "pi", model: "default" });
  });

  it("preserves user-supplied agent-default-model config", () => {
    const entry = {
      id: "openbuddy-dsh-agent-default-model",
      name: "@deepseek-ai/dsh-agent-default-model",
      config: { provider: "anthropic", model: "claude-3" },
    };
    expect(normalizeDeepSeekRuntimeEntry(entry)).toBe(entry);
  });

  it("sets provider=spawn on openbuddy-dsh-tool-subagent when config missing", () => {
    const entry = { id: "openbuddy-dsh-tool-subagent", name: "@deepseek-ai/dsh-tool-subagent" } as any;
    const out = normalizeDeepSeekRuntimeEntry(entry);
    expect(out.config).toEqual({
      provider: "spawn",
      toolName: "subagent",
      backgroundMode: "continuable",
    });
  });
});
