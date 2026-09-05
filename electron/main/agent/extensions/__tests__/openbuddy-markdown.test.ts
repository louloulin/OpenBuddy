/**
 * openbuddy-markdown tests — Phase R3.0.
 *
 * Pins:
 *   - registers registerMarkdownTransformer when the API exposes it
 *   - no-ops safely when the API omits it (older Pi versions)
 *   - registers registerMessageRenderer with a no-op renderer
 *   - never throws on either call
 */
import { describe, expect, it, vi } from "vitest";
import openbuddyMarkdown from "../openbuddy-markdown";

function makeApi(opts: {
  registerMarkdownTransformer?: ReturnType<typeof vi.fn>;
  registerMessageRenderer?: ReturnType<typeof vi.fn>;
} = {}) {
  const registerMarkdownTransformer =
    opts.registerMarkdownTransformer ?? vi.fn();
  const registerMessageRenderer = opts.registerMessageRenderer ?? vi.fn();
  return {
    api: { registerMarkdownTransformer, registerMessageRenderer },
    registerMarkdownTransformer,
    registerMessageRenderer,
  };
}

describe("openbuddy-markdown extension", () => {
  it("registers a markdown transformer when the API exposes it", () => {
    const { api, registerMarkdownTransformer } = makeApi();
    openbuddyMarkdown(api as never);
    expect(registerMarkdownTransformer).toHaveBeenCalledTimes(1);
    const arg = registerMarkdownTransformer.mock.calls[0]?.[0];
    expect(typeof arg?.transformAssistant).toBe("function");
    expect(typeof arg?.transformUser).toBe("function");
  });

  it("registers a message renderer with a no-op body when the API exposes it", () => {
    const { api, registerMessageRenderer } = makeApi();
    openbuddyMarkdown(api as never);
    expect(registerMessageRenderer).toHaveBeenCalledTimes(1);
    expect(registerMessageRenderer.mock.calls[0]?.[0]).toBe("openbuddy_markdown");
  });

  it("does not throw when registerMarkdownTransformer is missing (older Pi)", () => {
    const { api } = makeApi({ registerMarkdownTransformer: undefined });
    // Provide an api without the method to simulate older Pi.
    const emptyApi = {
      registerMessageRenderer: vi.fn(),
    };
    expect(() => openbuddyMarkdown(emptyApi as never)).not.toThrow();
    // And explicitly assert the originally-provided mocks were untouched.
    expect(api.registerMarkdownTransformer).not.toHaveBeenCalled();
  });

  it("does not throw when registerMessageRenderer is missing", () => {
    const emptyApi = {
      registerMarkdownTransformer: vi.fn(),
    };
    expect(() => openbuddyMarkdown(emptyApi as never)).not.toThrow();
  });

  it("does not throw when both methods are missing", () => {
    expect(() => openbuddyMarkdown({} as never)).not.toThrow();
  });

  it("transformAssistant/transformUser are no-op pass-throughs today", () => {
    const { api, registerMarkdownTransformer } = makeApi();
    openbuddyMarkdown(api as never);
    const arg = registerMarkdownTransformer.mock.calls[0]?.[0] as {
      transformAssistant: (s: string) => string;
      transformUser: (s: string) => string;
    };
    expect(arg.transformAssistant("# hello")).toBe("# hello");
    expect(arg.transformUser("user input")).toBe("user input");
  });
});