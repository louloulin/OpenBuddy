/**
 * Tests for the G10 PR 1 hello-world scaffold.
 *
 * What we verify here:
 *   1. The default export is a function (the ExtensionFactory)
 *   2. Calling the factory returns a function that accepts a pi-like
 *      object with `registerTool`
 *   3. The registered tool name is exactly `hello` (so the LLM can
 *      discover it by name)
 *   4. The schema rejects malformed params (negative path)
 *   5. The execute body produces a correct greeting for both `loud`
 *      values
 *
 * Like `typed-tool.test.ts`, we do not exercise a live pi agent session
 * (that requires a real `AgentSession`); we test the factory's behaviour
 * with a minimal mock `pi` object.
 */
import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import helloWorldExtension from "../_scaffolds/hello-world";

interface RegisteredTool {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: unknown,
    signal: unknown,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{ content: [{ type: "text"; text: string }]; details: unknown }>;
}

function makeMockPi(): { api: ExtensionAPI; tools: RegisteredTool[] } {
  const tools: RegisteredTool[] = [];
  const api = {
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI;
  return { api, tools };
}

describe("G10 PR 1 — hello-world scaffold", () => {
  it("default export is an ExtensionFactory function", () => {
    expect(typeof helloWorldExtension).toBe("function");
  });

  it("registers exactly one tool named `hello`", () => {
    const factory = helloWorldExtension();
    const { api, tools } = makeMockPi();
    factory(api);
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("hello");
    expect(tools[0].label).toBe("Hello");
  });

  it("execute returns 'hello, world' for default params", async () => {
    const factory = helloWorldExtension();
    const { api, tools } = makeMockPi();
    factory(api);
    const out = await tools[0].execute("call-1", { who: "world" }, undefined, undefined, undefined);
    expect(out.content[0].text).toBe("hello, world");
    expect((out.details as { greeting: string }).greeting).toBe("hello, world");
  });

  it("execute returns upper-cased greeting when loud=true", async () => {
    const factory = helloWorldExtension();
    const { api, tools } = makeMockPi();
    factory(api);
    const out = await tools[0].execute("call-2", { who: "OpenBuddy", loud: true }, undefined, undefined, undefined);
    expect(out.content[0].text).toBe("HELLO, OpenBuddy");
    expect((out.details as { loud: boolean }).loud).toBe(true);
  });

  it("execute fails gracefully when params fail schema validation", async () => {
    const factory = helloWorldExtension();
    const { api, tools } = makeMockPi();
    factory(api);
    // `who` missing → schema rejects; fail() returns the error message
    const out = await tools[0].execute("call-3", { loud: true }, undefined, undefined, undefined);
    expect(out.content[0].text).toMatch(/invalid params/);
    expect((out.details as { error: string }).error).toMatch(/invalid params/);
  });

  it("execute fails gracefully when params is null/undefined", async () => {
    const factory = helloWorldExtension();
    const { api, tools } = makeMockPi();
    factory(api);
    const outNull = await tools[0].execute("call-4", null, undefined, undefined, undefined);
    expect(outNull.content[0].text).toMatch(/invalid params/);
    const outUndef = await tools[0].execute("call-5", undefined, undefined, undefined, undefined);
    expect(outUndef.content[0].text).toMatch(/invalid params/);
  });
});