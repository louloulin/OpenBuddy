import { describe, expect, it } from "vitest";
import { canonicalEventNamespace, clonePayload, eventNamespace } from "./plugin-event-bus";

describe("Pi event namespace contract", () => {
  it.each([
    ["session_info_changed", "session/info-changed"],
    ["session_before_compact", "session/before-compact"],
    ["session_compact_failed", "session/compact-failed"],
    ["session_before_tree", "session/before-tree"],
    ["thinking_level_select", "model/thinking-level"],
    ["resources_discover", "resources/discover"],
    ["before_provider_request", "provider/before-request"],
    ["after_provider_response", "provider/after-response"],
    ["tool_call", "tool/call"],
    ["tool_result", "tool/result"],
    ["queue_update", "session/queue"],
    ["compaction_start", "session/compaction-start"],
    ["compaction_end", "session/compaction-end"],
    ["auto_retry_start", "turn/retry-start"],
    ["auto_retry_end", "turn/retry-end"],
    ["extension_error", "extension/error"],
    ["ui_prompt_start", "ui/prompt-start"],
    ["ui_prompt_end", "ui/prompt-end"],
  ])("maps %s to canonical %s", (raw, canonical) => {
    expect(canonicalEventNamespace(raw)).toBe(canonical);
  });

  it("keeps broad namespaces stable for unknown Pi events", () => {
    expect(eventNamespace("resources_discover")).toBe("agent/resources_discover");
    expect(eventNamespace("custom_extension_event")).toBe("agent/custom_extension_event");
    expect(eventNamespace("tool_result")).toBe("tool/tool_result");
  });

  it("bounds cloned plugin payloads before they enter the IPC/replay surface", () => {
    const safe = clonePayload({ output: "x".repeat(100_000) }) as { output: string };
    expect(safe.output).toContain("[truncated]");
    expect(new TextEncoder().encode(JSON.stringify(safe)).byteLength).toBeLessThanOrEqual(64 * 1024);
  });
});
