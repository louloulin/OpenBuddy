/**
 * deepseek-agent-factory.test.ts — smoke tests for createDeepSeekAgentRuntime.
 */
import { afterEach, describe, it, expect, vi } from "vitest";

import {
  installDeepSeekAgentFactory,
  createDeepSeekAgentRuntime,
  createDeepSeekAgent,
  resumeDeepSeekAgent,
  __resetDeepSeekAgentFactoryForTest,
} from "./deepseek-agent-factory";

afterEach(() => {
  __resetDeepSeekAgentFactoryForTest();
});

describe("deepseek-agent-factory", () => {
  it("createDeepSeekAgentRuntime dispatches to resume when options.resume=true", async () => {
    const create = vi.fn(async () => ({ kind: "create-result" }));
    const resume = vi.fn(async () => ({ kind: "resume-result" }));
    installDeepSeekAgentFactory({ createDeepSeekAgent: create as any, resumeDeepSeekAgent: resume as any });
    const r = await createDeepSeekAgentRuntime({ sessionId: "x", resume: true });
    expect(resume).toHaveBeenCalledWith({ sessionId: "x", resume: true });
    expect(create).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: "resume-result" });
  });

  it("createDeepSeekAgentRuntime dispatches to create when options.resume=false/undefined", async () => {
    const create = vi.fn(async () => ({ kind: "create-result" }));
    const resume = vi.fn(async () => ({ kind: "resume-result" }));
    installDeepSeekAgentFactory({ createDeepSeekAgent: create as any, resumeDeepSeekAgent: resume as any });
    const r = await createDeepSeekAgentRuntime({ sessionId: "x" });
    expect(create).toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: "create-result" });
  });

  it("createDeepSeekAgent always uses create path", async () => {
    const create = vi.fn(async () => ({ kind: "create" }));
    const resume = vi.fn(async () => ({ kind: "resume" }));
    installDeepSeekAgentFactory({ createDeepSeekAgent: create as any, resumeDeepSeekAgent: resume as any });
    const r = await createDeepSeekAgent({ sessionId: "y", resume: true } as any);
    expect(create).toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: "create" });
  });

  it("resumeDeepSeekAgent always uses resume path", async () => {
    const create = vi.fn(async () => ({ kind: "create" }));
    const resume = vi.fn(async () => ({ kind: "resume" }));
    installDeepSeekAgentFactory({ createDeepSeekAgent: create as any, resumeDeepSeekAgent: resume as any });
    const r = await resumeDeepSeekAgent({ sessionId: "z" });
    expect(resume).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: "resume" });
  });
});
