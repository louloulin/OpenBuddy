/**
 * R1.4 — unit tests for tool-renderers enhancements.
 *
 * Covers the new `apply_patch` / `apply_command` detection + summarization
 * paths, and verifies the regex map doesn't accidentally alias away existing
 * kinds (regression guard).
 */
import { describe, expect, it } from "vitest";
import {
  detectToolRenderer,
  summarizeTool,
  rendererLabel,
  type ToolRenderer,
} from "../tool-renderers";
import type { ToolCallView } from "@/stores/session-store";

const baseView = (overrides: Partial<ToolCallView> = {}): ToolCallView => ({
  toolCallId: "tc-1",
  title: "tool",
  kind: "apply_patch",
  status: "completed",
  content: [],
  ...overrides,
});

describe("detectToolRenderer — apply_patch / apply_command", () => {
  it("routes apply_patch to the edit renderer", () => {
    expect(detectToolRenderer("apply_patch")).toBe<ToolRenderer>("edit");
  });
  it("routes apply_command to the command renderer", () => {
    expect(detectToolRenderer("apply_command")).toBe<ToolRenderer>("command");
  });
  it("still routes legacy kinds correctly", () => {
    expect(detectToolRenderer("bash")).toBe<ToolRenderer>("command");
    expect(detectToolRenderer("edit")).toBe<ToolRenderer>("edit");
    expect(detectToolRenderer("write_file")).toBe<ToolRenderer>("edit");
    expect(detectToolRenderer("task")).toBe<ToolRenderer>("task");
  });
  it("returns unknown for empty / unmapped kinds", () => {
    expect(detectToolRenderer("")).toBe<ToolRenderer>("unknown");
    expect(detectToolRenderer("definitely_not_a_tool")).toBe<ToolRenderer>("default");
  });
});

describe("summarizeTool — apply_patch", () => {
  it("renders apply_patch with file basename + hunk count", () => {
    const tc = baseView({
      kind: "apply_patch",
      rawInput: { file_path: "/Users/me/projects/foo/src/main.ts", hunks: 3 },
    });
    expect(summarizeTool(tc, "edit")).toBe("应用补丁 main.ts (3 hunks)");
  });

  it("renders apply_patch with 1 hunk (singular)", () => {
    const tc = baseView({
      kind: "apply_patch",
      rawInput: { file_path: "/a/b.ts", hunks: 1 },
    });
    expect(summarizeTool(tc, "edit")).toBe("应用补丁 b.ts (1 hunk)");
  });

  it("renders apply_patch without hunks (preview mode)", () => {
    const tc = baseView({
      kind: "apply_patch",
      rawInput: { file_path: "/a/b.ts" },
    });
    expect(summarizeTool(tc, "edit")).toBe("应用补丁 b.ts");
  });

  it("falls back to title when rawInput is missing", () => {
    const tc = baseView({ kind: "apply_patch" });
    expect(summarizeTool(tc, "edit")).toBe("tool");
  });
});

describe("summarizeTool — apply_command", () => {
  it("renders apply_command with the actual command", () => {
    const tc = baseView({
      kind: "apply_command",
      rawInput: { command: "ls -la" },
    });
    expect(summarizeTool(tc, "command")).toBe("ls -la");
  });

  it("truncates long commands at 80 chars", () => {
    const longCmd = "echo " + "x".repeat(100);
    const tc = baseView({
      kind: "apply_command",
      rawInput: { command: longCmd },
    });
    const summary = summarizeTool(tc, "command");
    expect(summary.endsWith("…")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(81); // 80 + ellipsis
  });
});

describe("rendererLabel", () => {
  it("returns human-readable labels for new renderers", () => {
    expect(rendererLabel("edit")).toBe("文件编辑");
    expect(rendererLabel("command")).toBe("终端命令");
  });
});
