// @vitest-environment node
// 20261116-pii W1.1–W1.3 payload validation: agent_tree / agent_navigate, agent_bash / agent_bash_abort, files_search.
import { describe, expect, it } from "vitest";
import { COMMANDS, validateCommandPayload } from "../src/contract";
import { protocolError } from "../src/errors";
import { isUserBashRequest, USER_BASH_REQUEST_PREFIX } from "../src/bash";

const ok = (command: Parameters<typeof validateCommandPayload>[0], payload: unknown) => expect(() => validateCommandPayload(command, payload)).not.toThrow();
const bad = (command: Parameters<typeof validateCommandPayload>[0], payload: unknown) => expect(() => validateCommandPayload(command, payload)).toThrow("invalid_payload");

describe("W1 commands", () => {
  it("are in the contract", () => {
    expect(COMMANDS).toEqual(expect.arrayContaining(["agent_tree", "agent_navigate", "agent_bash", "agent_bash_abort", "files_search"]));
  });

  it("agent_tree / agent_navigate", () => {
    ok("agent_tree", { sessionId: "s1" });
    bad("agent_tree", {});
    ok("agent_navigate", { sessionId: "s1", entryId: "e1" });
    ok("agent_navigate", { sessionId: "s1", entryId: "e1", summarize: true, restoreFiles: true });
    ok("agent_navigate", { sessionId: "s1", entryId: "e1", restoreFiles: { force: true } });
    ok("agent_navigate", { sessionId: "s1", entryId: "e1", restoreFiles: { skip: ["/w/a.txt"] } });
    bad("agent_navigate", { sessionId: "s1" });
    bad("agent_navigate", { sessionId: "s1", entryId: "x".repeat(300) });
    bad("agent_navigate", { sessionId: "s1", entryId: "e1", summarize: "yes" });
    bad("agent_navigate", { sessionId: "s1", entryId: "e1", restoreFiles: "all" });
    bad("agent_navigate", { sessionId: "s1", entryId: "e1", restoreFiles: { force: 1 } });
    bad("agent_navigate", { sessionId: "s1", entryId: "e1", restoreFiles: { skip: [""] } });
    bad("agent_navigate", { sessionId: "s1", entryId: "e1", restoreFiles: { skip: "a" } });
    bad("agent_navigate", { sessionId: "s1", entryId: "e1", restoreFiles: { other: true } });
  });

  it("agent_bash / agent_bash_abort", () => {
    ok("agent_bash", { sessionId: "s1", command: "echo hi" });
    ok("agent_bash", { sessionId: "s1", command: "ls", excludeFromContext: true, risk: "high" });
    bad("agent_bash", { sessionId: "s1" });
    bad("agent_bash", { sessionId: "s1", command: "   " });
    bad("agent_bash", { sessionId: "s1", command: "a\0b" });
    bad("agent_bash", { sessionId: "s1", command: "x".repeat(64 * 1024 + 1) });
    bad("agent_bash", { sessionId: "s1", command: "ls", excludeFromContext: "true" });
    bad("agent_bash", { sessionId: "s1", command: "ls", risk: "none" });
    bad("agent_bash", { command: "ls" });
    ok("agent_bash_abort", { sessionId: "s1" });
    bad("agent_bash_abort", {});
  });

  it("files_search", () => {
    ok("files_search", { cwd: "/work", query: "" });
    ok("files_search", { cwd: "/work", query: "rep", limit: 50 });
    ok("files_search", { cwd: "/work" });
    bad("files_search", { query: "a" });
    bad("files_search", { cwd: "/work", query: "x".repeat(257) });
    bad("files_search", { cwd: "/work", query: 3 });
    bad("files_search", { cwd: "/work", query: "a", limit: 0 });
    bad("files_search", { cwd: "/work", query: "a", limit: 201 });
    bad("files_search", { cwd: "/work", query: "a", limit: 1.5 });
  });

  it("protocolError keeps the `code: message` wire format", () => {
    const error = protocolError("session_busy", "会话忙碌");
    expect(error.message).toBe("session_busy: 会话忙碌");
    expect(error.code).toBe("session_busy");
    expect(protocolError("entry_not_found").message).toBe("entry_not_found");
    expect(isUserBashRequest({ toolCallId: `${USER_BASH_REQUEST_PREFIX}1` })).toBe(true);
    expect(isUserBashRequest({ toolCallId: "call_1" })).toBe(false);
  });
});
