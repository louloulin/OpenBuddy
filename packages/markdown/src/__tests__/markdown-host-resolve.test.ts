import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@openbuddy/client/ipc", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { createMarkdownHostConfig } from "../markdown-host";

describe("inline code links", () => {
  it("keeps a bare identifier as plain code unless it names a real path", async () => {
    const config = createMarkdownHostConfig({ cwd: "/w", sessionId: "s" });
    invoke.mockResolvedValueOnce({ exists: false });
    expect(await config.resolveCode!("s", "useEffect")).toBe("unknown");
    expect(invoke).toHaveBeenCalledWith("path_stat", { path: "useEffect", cwd: "/w" });
    invoke.mockResolvedValueOnce({ exists: true, kind: "directory" });
    expect(await config.resolveCode!("s", "src")).toBe("directory");
    expect(await config.resolveCode!("s", "npm run build")).toBe("unknown");
  });
});
