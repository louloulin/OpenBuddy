/**
 * @openbuddy/plugin-host — tests for the pi resource loader facade (G9 PR 1).
 *
 * The facade re-exports pi's `loadProjectContextFiles` + types. We assert
 * that the named-arg adapter correctly bridges the spec's vocabulary
 * (`projectRoot`, `agentDir`) to pi's canonical signature
 * (`{ cwd, agentDir }`), and that `DefaultResourceLoader` is the same
 * class pi exports (constructible with `{ cwd, agentDir }`).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  DefaultResourceLoader: class {
    constructor(public opts: { cwd: string; agentDir: string }) {}
    hello() {
      return `loader:${this.opts.cwd}`;
    }
  },
  loadProjectContextFiles: vi.fn((opts: { cwd: string; agentDir: string }) => [
    { path: `${opts.cwd}/AGENTS.md`, content: `# agents\n` },
  ]),
}));

import {
  DefaultResourceLoader,
  loadProjectContextFiles,
} from "../resource-pi";
import * as pi from "@earendil-works/pi-coding-agent";

const piMock = pi as unknown as {
  loadProjectContextFiles: ReturnType<typeof vi.fn>;
};

describe("@openbuddy/plugin-host/resource-pi — pi facade", () => {
  it("DefaultResourceLoader re-exports the pi class", () => {
    const loader = new (DefaultResourceLoader as unknown as new (opts: {
      cwd: string;
      agentDir: string;
    }) => { hello(): string; opts: { cwd: string; agentDir: string } })({
      cwd: "/tmp/proj",
      agentDir: "/tmp/proj/.agent",
    });
    expect(loader.hello()).toBe("loader:/tmp/proj");
  });

  it("loadProjectContextFiles maps projectRoot → cwd and forwards agentDir", async () => {
    piMock.loadProjectContextFiles.mockClear();
    const result = await loadProjectContextFiles("/tmp/proj", "/tmp/proj/.agent");
    expect(piMock.loadProjectContextFiles).toHaveBeenCalledOnce();
    expect(piMock.loadProjectContextFiles).toHaveBeenCalledWith({
      cwd: "/tmp/proj",
      agentDir: "/tmp/proj/.agent",
    });
    expect(result).toEqual([
      { path: "/tmp/proj/AGENTS.md", content: "# agents\n" },
    ]);
  });

  it("loadProjectContextFiles accepts independent cwd and agentDir", async () => {
    piMock.loadProjectContextFiles.mockClear();
    await loadProjectContextFiles("/work/repo", "/home/user/.pi/agent");
    expect(piMock.loadProjectContextFiles).toHaveBeenCalledWith({
      cwd: "/work/repo",
      agentDir: "/home/user/.pi/agent",
    });
  });
});