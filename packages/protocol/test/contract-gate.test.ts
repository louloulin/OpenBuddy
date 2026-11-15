// @vitest-environment node
/**
 * IPC contract gate (plan 8.1). The preload bridge rejects anything outside
 * COMMANDS / EVENTS, so a renderer call to an unknown command is a dead button.
 * Pending lists document the Phase 5 commands whose main-process side is not
 * built yet; they may only shrink.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { COMMANDS, EVENTS, validateCommandPayload } from "../src/contract";

const ROOT = join(import.meta.dirname, "..", "..", "..");
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") sources(path, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}
const read = (files: string[]) => files.map((file) => ({ file, text: readFileSync(file, "utf8") }));
// Same scan before, during and after the mv-first migration (20261115-md §6): use whichever roots exist.
const roots = (dirs: string[]) => dirs.map((dir) => join(ROOT, dir)).filter((dir) => existsSync(dir));
/** Renderer DTOs (src/lib/types.ts) live in the protocol package after M7 but remain renderer code. */
const DTO = join(ROOT, "packages", "protocol", "src", "dto.ts");
const renderer = read([
  ...roots(["src", "apps/web/src", "packages/client/src", "packages/chat-core/src", "packages/platform/src", "packages/ui/src", "packages/markdown/src"]).flatMap((dir) => sources(dir)),
  ...(existsSync(DTO) ? [DTO] : []),
]);
const main = read(
  roots(["electron", "apps/desktop/src", "packages/protocol/src", "packages/services/src", "packages/engine/src", "packages/host/src"])
    .flatMap((dir) => sources(dir))
    .filter((file) => file !== DTO),
);

/** Renderer wrappers whose main-process side is still pending (plan §10.1 / Phase 5). Remove entries as they land. */
const PENDING_COMMANDS = [
  "automation_records_archive", "automation_records_delete", "automations_delete", "automations_run", "automations_save", "automations_set_status", "automations_snapshot",
  "connectors_cli_auth", "connectors_cli_auth_cancel", "connectors_cli_skills_dir", "connectors_cli_status", "connectors_cli_unauth", "connectors_default_root",
  "connectors_icon", "connectors_list_roots", "connectors_load", "connectors_read_mcp_config",
  "inspiration_generate", "internal_reload", "marketplace_action", "marketplace_list",
  "memory_delete", "memory_flush", "memory_get", "memory_list", "memory_rewrite", "memory_save",
  "plugins_action", "plugins_list", "prompt_history", "session_fork",
  "skills_catalog_default_root", "skills_catalog_list_roots", "skills_catalog_load", "skills_catalog_read_skill",
  "subagents_config_get", "subagents_config_save", "toggle_plan_mode", "web_search_config_get", "web_search_config_save",
];
/** Events the renderer subscribes to that the main process does not emit yet (CLI connector auth, Phase 5). */
const PENDING_EVENTS = ["connector://cli-auth-done", "connector://cli-auth-log", "connector://cli-auth-url"];
/** Legacy contract events from the pre-Pi engine; nothing emits them. Remove from EVENTS together with their last listener. */
const UNEMITTED_EVENTS = ["agent://compaction", "agent://complete", "agent://queue", "agent://retry", "agent://session-info", "agent://tool", "agent://update"];

const commands = new Set<string>(COMMANDS);
const events = new Set<string>(EVENTS);

function rendererCommands(): Map<string, string> {
  const used = new Map<string, string>();
  for (const { file, text } of renderer)
    for (const match of text.matchAll(/invoke(?:<[^>]*>)?\(\s*"([a-z_]+)"/g)) if (!used.has(match[1])) used.set(match[1], file);
  return used;
}
function rendererEvents(): Set<string> {
  const used = new Set<string>();
  for (const { text } of renderer) for (const match of text.matchAll(/"([a-z]+:\/\/[a-z-]+)"/g)) used.add(match[1]);
  return used;
}
function emitted(): Set<string> {
  const found = new Set<string>();
  for (const { text } of main) for (const match of text.matchAll(/(?:emit|send)\(\s*['"]([a-z]+:\/\/[a-z-]+)['"]/g)) found.add(match[1]);
  return found;
}

describe("IPC contract gate", () => {
  it("renderer only invokes contract commands or explicitly pending ones", () => {
    const unknown = [...rendererCommands()].filter(([name]) => !commands.has(name) && !PENDING_COMMANDS.includes(name));
    expect(unknown.map(([name, file]) => `${name} (${file.slice(ROOT.length + 1)})`)).toEqual([]);
  });

  it("pending lists only shrink: nothing pending is already in the contract, and every entry is still referenced", () => {
    expect(PENDING_COMMANDS.filter((name) => commands.has(name))).toEqual([]);
    const used = rendererCommands();
    expect(PENDING_COMMANDS.filter((name) => !used.has(name))).toEqual([]);
    expect(PENDING_COMMANDS.length).toBeLessThanOrEqual(55);
    expect(PENDING_EVENTS.filter((name) => events.has(name))).toEqual([]);
  });

  it("every contract command has a main-process handler", () => {
    const keys = new Set<string>();
    for (const { text } of main) {
      for (const match of text.matchAll(/(?:^|[\s,{])([a-z][a-z0-9_]*)\s*:\s*(?:async\s*)?(?:\([^)]*\)|[a-z_]+)\s*=>/gm)) keys.add(match[1]);
      for (const match of text.matchAll(/(?:^|[\s,{])(?:async\s+)?([a-z][a-z0-9_]*)\s*\([^)]*\)\s*\{/gm)) keys.add(match[1]);
    }
    expect(COMMANDS.filter((name) => !keys.has(name))).toEqual([]);
  });

  it("every contract event is emitted by the main process (legacy exceptions listed)", () => {
    const sent = emitted();
    expect(EVENTS.filter((name) => !sent.has(name) && !UNEMITTED_EVENTS.includes(name))).toEqual([]);
    // Once something emits a legacy event again it must leave the exception list.
    expect(UNEMITTED_EVENTS.filter((name) => sent.has(name))).toEqual([]);
  });

  it("renderer subscribes only to contract events or explicitly pending ones", () => {
    const unknown = [...rendererEvents()].filter((name) => !events.has(name) && !PENDING_EVENTS.includes(name));
    expect(unknown).toEqual([]);
  });
});

describe("payload validation for new commands", () => {
  it("experts commands (pii W2.1–W2.3): ids are never paths, drafts and lists are bounded", () => {
    const ok = (command: Parameters<typeof validateCommandPayload>[0], payload: Record<string, unknown>) => expect(() => validateCommandPayload(command, payload)).not.toThrow();
    const bad = (command: Parameters<typeof validateCommandPayload>[0], payload: Record<string, unknown>) => expect(() => validateCommandPayload(command, payload)).toThrow("invalid_payload");
    const expert = { name: "数据分析师", avatar: "📊", category: "data", thinking: "high", tools: ["read", "mcp__*"], examples: ["分析 sales.csv"], prompt: "你是一名数据分析师。" };
    ok("agents_list", {});
    ok("agents_list", { cwd: null });
    ok("agents_get", { id: "data-analyst" });
    ok("agents_get", { path: "/home/u/.pi/agents/x.md" });
    bad("agents_get", { id: "../etc/passwd" });
    bad("agents_get", { id: "Data Analyst" });
    bad("agents_get", {});
    ok("agents_save", { expert, mode: "create" });
    ok("agents_save", { expert: { ...expert, id: "my-analyst" }, mode: "update" });
    ok("agents_save", { name: "legacy", raw: "---\nname: legacy\n---\nbody" });
    bad("agents_save", { expert: { ...expert, id: "../x" } });
    bad("agents_save", { expert: { ...expert, name: " " } });
    bad("agents_save", { expert: { ...expert, prompt: "" } });
    bad("agents_save", { expert: { ...expert, thinking: "huge" } });
    bad("agents_save", { expert: { ...expert, tools: ["rm -rf /"] } });
    bad("agents_save", { expert: { ...expert, examples: Array.from({ length: 9 }, () => "x") } });
    bad("agents_save", { expert, mode: "replace" });
    bad("agents_save", { expert: "nope" });
    ok("agents_delete", { id: "my-analyst" });
    bad("agents_delete", { id: "a/b" });
    ok("agents_template", { expert: { name: "草稿" } });
    ok("agents_template", { name: "legacy", description: "d", systemPrompt: "p" });
    bad("agents_template", { name: "" });
    ok("agent_set_session_expert", { sessionId: "s1", expertId: "data-analyst", expertName: "数据分析师", source: "builtin", avatarLocal: null });
    bad("agent_set_session_expert", { sessionId: "s1", expertId: "../../x" });
    bad("agent_set_session_expert", { expertId: "data-analyst" });
    ok("agent_clear_session_expert", { sessionId: "s1" });
    bad("agent_clear_session_expert", {});
    ok("experts_set_roots", { roots: ["/data/experts"] });
    ok("experts_set_roots", { roots: [] });
    bad("experts_set_roots", { roots: "/data" });
    bad("experts_set_roots", { roots: Array.from({ length: 21 }, (_, i) => `/r${i}`) });
    ok("experts_read_agent_prompt", { id: "translator" });
    bad("experts_read_agent_prompt", { root: "/x", plugin: "p", agentName: "a" });
    ok("experts_thumbnail", { path: "/x/a.png" });
    bad("experts_image_bytes", { path: "" });
    ok("experts_link_agents", { root: "/data/experts", ids: ["a", "b-2"] });
    bad("experts_link_agents", { root: "/data/experts", ids: ["../a"] });
    bad("experts_load", { cwd: 42 });
    ok("experts_load", { cwd: "/work" });
    // agents_defaults_* are not expert commands and keep their own rules.
    ok("agents_defaults_save", { defaults: {}, cwd: 1 });
  });

  it("agent_compact needs a session id and bounds optional instructions", () => {
    expect(() => validateCommandPayload("agent_compact", { sessionId: "s1" })).not.toThrow();
    expect(() => validateCommandPayload("agent_compact", { sessionId: "s1", instructions: "keep decisions" })).not.toThrow();
    expect(() => validateCommandPayload("agent_compact", {})).toThrow("invalid_payload");
    expect(() => validateCommandPayload("agent_compact", { sessionId: "s1", instructions: "x".repeat(5000) })).toThrow("invalid_payload");
  });

  it("session_search needs a query and bounds the optional cwd and limit (pii W1.4)", () => {
    expect(() => validateCommandPayload("session_search", { query: "季度报告" })).not.toThrow();
    expect(() => validateCommandPayload("session_search", { query: "report", cwd: "/work", limit: 30 })).not.toThrow();
    expect(() => validateCommandPayload("session_search", { query: "report", cwd: null, limit: null })).not.toThrow();
    expect(() => validateCommandPayload("session_search", {})).toThrow("invalid_payload: query");
    expect(() => validateCommandPayload("session_search", { query: "   " })).toThrow("invalid_payload: query");
    expect(() => validateCommandPayload("session_search", { query: "x".repeat(501) })).toThrow("invalid_payload: query");
    expect(() => validateCommandPayload("session_search", { query: "a\0b" })).toThrow("invalid_payload: query");
    expect(() => validateCommandPayload("session_search", { query: "report", cwd: 3 })).toThrow("invalid_payload: cwd");
    for (const limit of [0, 101, 2.5, "10", true]) expect(() => validateCommandPayload("session_search", { query: "report", limit })).toThrow("invalid_payload: limit");
  });
});
