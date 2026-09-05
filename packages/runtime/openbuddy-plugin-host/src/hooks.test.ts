import { describe, expect, it } from "vitest";
import { decodeHookOutput, matchesHookMatcher, mergeHookOutputs, parseHookConfig } from "./hooks";

describe("DeepSeek Harness hook protocol", () => {
  it("parses Claude-style matcher groups and skips unsupported hook types", () => {
    const parsed = parseHookConfig({ hooks: {
      PreToolUse: [{ matcher: "Bash|Read", hooks: [{ type: "command", command: "echo ok", timeout: 3 }, { type: "http", url: "https://example.test" }] }],
      UnknownEvent: [{ hooks: [{ type: "command", command: "echo ignored" }] }],
    } }, "claude-code");
    expect(parsed.config.events["tool/start"]).toEqual([{ matcher: "Bash|Read", hooks: [{ command: "echo ok", timeoutSec: 3 }] }]);
    expect(parsed.diagnostics.map((item) => item.message)).toEqual(expect.arrayContaining([
      "unsupported hook type 'http'",
      "unsupported hook event 'UnknownEvent'",
    ]));
    expect(matchesHookMatcher(parsed.config.events["tool/start"]![0]!, "Bash", "claude-code")).toBe(true);
    expect(matchesHookMatcher(parsed.config.events["tool/start"]![0]!, "Edit", "claude-code")).toBe(false);
  });

  it("decodes structured hook output and merges most restrictive decisions", () => {
    const deny = decodeHookOutput(0, JSON.stringify({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "no" }, additionalContext: "context" }), "");
    const ask = decodeHookOutput(0, JSON.stringify({ hookSpecificOutput: { permissionDecision: "ask" } }), "");
    const merged = mergeHookOutputs([ask, deny, { exitCode: 2, stdout: "", stderr: "blocked", decision: "deny", reason: "fallback" }]);
    expect(merged.decision).toBe("deny");
    expect(merged.reason).toBe("no\n\nfallback");
    expect(merged.additionalContext).toEqual(["context"]);
  });

  it("merges tool input updates from structured hook output", () => {
    const merged = mergeHookOutputs([
      decodeHookOutput(0, JSON.stringify({ hookSpecificOutput: { updatedInput: { command: "safe", cwd: "/tmp" } } }), ""),
      decodeHookOutput(0, JSON.stringify({ hookSpecificOutput: { updatedInput: { command: "safer" } } }), ""),
    ]);
    expect(merged.updatedInput).toEqual({ command: "safer", cwd: "/tmp" });
  });

  it("treats malformed JSON and continue false as non-fatal protocol output", () => {
    expect(decodeHookOutput(0, "plain output", "warning")).toMatchObject({ stdout: "plain output", stderr: "warning" });
    expect(decodeHookOutput(0, JSON.stringify({ continue: false, stopReason: "stop now" }), "")).toMatchObject({ continue: false, stopReason: "stop now" });
  });

  it("ignores hook-specific fields from a different event", () => {
    const output = decodeHookOutput(0, JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "wrong event" } }), "", "Stop");
    expect(output.decision).toBeUndefined();
    expect(output.reason).toBeUndefined();
  });

  it("matches DeepSeek exit-code and strict decision semantics", () => {
    expect(decodeHookOutput(2, JSON.stringify({ decision: "approve" }), "blocked", "PreToolUse", { strictDialect: true })).toMatchObject({ decision: "block", reason: "blocked" });
    const nonZero = decodeHookOutput(1, JSON.stringify({ decision: "deny" }), "warning", "PreToolUse", { strictDialect: true });
    expect(nonZero.stderr).toBe("warning");
    expect(nonZero.decision).toBeUndefined();
    expect(decodeHookOutput(0, JSON.stringify({ decision: "deny" }), "", "PreToolUse", { strictDialect: true }).decision).toBeUndefined();
    expect(decodeHookOutput(0, JSON.stringify({ decision: "approve" }), "", "PreToolUse", { strictDialect: true }).decision).toBe("approve");
  });
});
