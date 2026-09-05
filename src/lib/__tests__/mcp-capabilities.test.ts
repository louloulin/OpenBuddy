import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DEFAULT_CAPABILITIES,
  CAPABILITY_NAMES,
  hasCapability,
  serializeCapabilities,
  registerElicitHandler,
  registerSamplingHandler,
  registerRootsHandler,
  resetCapabilityHandlers,
  handleElicit,
  handleSampling,
  handleRoots,
  dispatchCapabilityRequest,
  type ClientCapabilities,
  type ElicitRequest,
  type SamplingRequest,
} from "../security/mcp-capabilities";

describe("能力声明", () => {
  it("DEFAULT_CAPABILITIES 全部启用", () => {
    expect(DEFAULT_CAPABILITIES.elicitation).toBe(true);
    expect(DEFAULT_CAPABILITIES.sampling).toBe(true);
    expect(DEFAULT_CAPABILITIES.roots).toBe(true);
  });
  it("CAPABILITY_NAMES 含三项", () => {
    expect(CAPABILITY_NAMES).toEqual(["elicitation", "sampling", "roots"]);
  });
  it("hasCapability", () => {
    const caps: ClientCapabilities = { elicitation: true, sampling: false, roots: true };
    expect(hasCapability(caps, "elicitation")).toBe(true);
    expect(hasCapability(caps, "sampling")).toBe(false);
  });
  it("serializeCapabilities 格式(启用的含 {},roots 含 listChanged)", () => {
    const s = serializeCapabilities(DEFAULT_CAPABILITIES);
    expect(s.elicitation).toEqual({});
    expect(s.sampling).toEqual({});
    expect(s.roots).toEqual({ listChanged: true });
  });
  it("serializeCapabilities 禁用的为 undefined", () => {
    const s = serializeCapabilities({ elicitation: false, sampling: false, roots: false });
    expect(s.elicitation).toBeUndefined();
    expect(s.sampling).toBeUndefined();
  });
});

describe("能力处理器注册表 + 兜底", () => {
  beforeEach(resetCapabilityHandlers);

  it("handleElicit 无处理器 → cancelled 兜底", async () => {
    const r = await handleElicit({ message: "问题?" });
    expect(r.cancelled).toBe(true);
  });
  it("handleElict 有注册处理器 → 调用并返回", async () => {
    const h = vi.fn(async (req: ElicitRequest) => ({ fields: { answer: req.message } }));
    registerElicitHandler(h);
    const r = await handleElicit({ message: "x" });
    expect(h).toHaveBeenCalled();
    expect(r.fields).toEqual({ answer: "x" });
  });
  it("handleElicit 注入 fallback 优先于兜底", async () => {
    const fb = vi.fn(async () => ({ fields: { fb: true } }));
    const r = await handleElicit({ message: "y" }, { fallback: fb });
    expect(r.fields).toEqual({ fb: true });
  });
  it("注册处理器优先于 fallback", async () => {
    registerElicitHandler(async () => ({ fields: { registered: true } }));
    const fb = vi.fn(async () => ({ fields: { fb: true } }));
    const r = await handleElicit({ message: "z" }, { fallback: fb });
    expect(r.fields).toEqual({ registered: true });
    expect(fb).not.toHaveBeenCalled();
  });

  it("handleSampling 无处理器 → cancelled 兜底", async () => {
    const r = await handleSampling({ messages: [] });
    expect(r.cancelled).toBe(true);
    expect(r.text).toBe("");
  });
  it("handleSampling 有处理器 → 返回补全", async () => {
    registerSamplingHandler(async (req: SamplingRequest) => ({
      text: `echo:${req.messages[0]?.content.text ?? ""}`,
    }));
    const r = await handleSampling({
      messages: [{ role: "user", content: { type: "text", text: "hi" } }],
    });
    expect(r.text).toBe("echo:hi");
  });

  it("handleRoots 无处理器 → 空列表兜底", async () => {
    const r = await handleRoots();
    expect(r.roots).toEqual([]);
  });
  it("handleRoots 有处理器 → 返回根列表", async () => {
    registerRootsHandler(async () => ({ roots: [{ uri: "file:///proj", name: "proj" }] }));
    const r = await handleRoots();
    expect(r.roots[0].uri).toBe("file:///proj");
  });

  it("resetCapabilityHandlers 清空", async () => {
    registerElicitHandler(async () => ({ fields: {} }));
    resetCapabilityHandlers();
    const r = await handleElicit({ message: "x" });
    expect(r.cancelled).toBe(true);
  });
});

describe("dispatchCapabilityRequest", () => {
  beforeEach(resetCapabilityHandlers);

  it("按 method 分发到 elicitation", async () => {
    const fb = vi.fn(async () => ({ fields: { ok: 1 } }));
    const r = await dispatchCapabilityRequest("elicitation", { message: "m" }, { fallbackElicit: fb });
    expect((r as { fields: { ok: number } }).fields.ok).toBe(1);
  });
  it("按 method 分发到 sampling", async () => {
    const fb = vi.fn(async () => ({ text: "t" }));
    const r = await dispatchCapabilityRequest("sampling", { messages: [] }, { fallbackSampling: fb });
    expect((r as { text: string }).text).toBe("t");
  });
  it("按 method 分发到 roots", async () => {
    const fb = vi.fn(async () => ({ roots: [{ uri: "file:///x" }] }));
    const r = await dispatchCapabilityRequest("roots", undefined, { fallbackRoots: fb });
    expect((r as { roots: Array<{ uri: string }> }).roots[0].uri).toBe("file:///x");
  });
  it("未注册且无 fallback → 各自兜底", async () => {
    const e = (await dispatchCapabilityRequest("elicitation", { message: "x" })) as { cancelled?: boolean };
    expect(e.cancelled).toBe(true);
    const s = (await dispatchCapabilityRequest("sampling", { messages: [] })) as { cancelled?: boolean };
    expect(s.cancelled).toBe(true);
    const r = (await dispatchCapabilityRequest("roots", undefined)) as { roots: unknown[] };
    expect(r.roots).toEqual([]);
  });
});
