import { Type } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createTaskAwareTool, normalizeHarnessPostResult, normalizeHarnessToolResult, toolExecutionMode } from "./task-aware-tool";

const tool: ToolDefinition = {
  name: "wait",
  label: "Wait",
  description: "Wait until cancelled.",
  parameters: Type.Object({}),
  execute: async (_toolCallId, _params, signal) => {
    await new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      signal?.addEventListener("abort", () => resolve(), { once: true });
    });
    return { content: [{ type: "text", text: "cancelled" }], details: {} };
  },
};

describe("task-aware Pi tools", () => {
  it("defaults tools to fail-closed sequential execution", () => {
    expect(toolExecutionMode(tool)).toBe("sequential");
    expect(toolExecutionMode({ ...tool, isConcurrencySafe: () => true })).toBe("sequential");
    expect(toolExecutionMode({ ...tool, executionMode: "parallel" })).toBe("parallel");
    expect(createTaskAwareTool(tool, () => undefined).executionMode).toBe("sequential");
  });

  it("propagates task cancellation without changing the caller signal", async () => {
    const taskController = new AbortController();
    const callerController = new AbortController();
    const wrapped = createTaskAwareTool(tool, () => taskController.signal);
    const result = wrapped.execute("call-1", {}, callerController.signal, undefined, {} as never);
    taskController.abort();
    await expect(result).resolves.toMatchObject({
      content: [{ text: "Error: tool call aborted" }],
      details: { code: "ABORTED" },
      isError: true,
    });
    expect(callerController.signal.aborted).toBe(false);
  });

  it("returns a durable error result for cancellation before dispatch", async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = vi.fn(tool.execute);
    const wrapped = createTaskAwareTool({ ...tool, execute }, () => undefined);

    await expect(wrapped.execute("call-2", {}, controller.signal, undefined, {} as never)).resolves.toMatchObject({
      content: [{ text: "Error: tool call aborted before dispatch" }],
      details: { code: "ABORTED_BEFORE_DISPATCH" },
      isError: true,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("normalizes tool failures and cooperative timeouts", async () => {
    const failing = createTaskAwareTool({
      ...tool,
      execute: async () => { throw new Error("boom"); },
    }, () => undefined);
    await expect(failing.execute("call-3", {}, undefined, undefined, {} as never)).resolves.toMatchObject({
      content: [{ text: "Error: boom" }],
      details: { code: "TOOL_FAILURE" },
      isError: true,
    });

    const timed = createTaskAwareTool({
      ...tool,
      timeoutMs: 5,
    }, () => undefined);
    await expect(timed.execute("call-4", {}, undefined, undefined, {} as never)).resolves.toMatchObject({
      content: [{ text: "Error: tool timed out after 5ms" }],
      details: { code: "TOOL_TIMEOUT" },
      isError: true,
    });
  });

  it("normalizes invalid and blocked post-execute results", () => {
    expect(normalizeHarnessToolResult(undefined)).toMatchObject({
      details: { code: "INVALID_TOOL_OUTPUT" },
      isError: true,
    });
    expect(normalizeHarnessPostResult({ kind: "block", feedback: [{ type: "text", text: "policy denied" }] })).toMatchObject({
      content: [{ text: "Error: policy denied" }],
      details: { code: "TOOL_REJECTED" },
      isError: true,
    });
    expect(normalizeHarnessPostResult({ kind: "accept", content: [{ type: "text", text: "replaced" }] }, {
      content: [{ type: "text", text: "original" }],
      details: {},
    })).toMatchObject({ content: [{ text: "replaced" }] });
  });
});
