import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIGINAL = {
  OPENBUDDY_AGENT_DIR: process.env.OPENBUDDY_AGENT_DIR,
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  PI_SUBAGENT_EXTRA_AGENT_DIRS: process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS,
  PI_HOME: process.env.PI_HOME,
};

function restore(): void {
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("ensurePiSubagentAgentDirs", () => {
  beforeEach(() => {
    delete process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS;
    delete process.env.OPENBUDDY_AGENT_DIR;
    delete process.env.PI_CODING_AGENT_DIR;
    delete process.env.PI_HOME;
    vi_reset();
  });
  afterEach(restore);

  it("auto-injects <agentHome>/agents on first import", async () => {
    const home = mkdtempSync(join(tmpdir(), "ob-hostpaths-"));
    process.env.OPENBUDDY_AGENT_DIR = home;
    delete process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS;
    // Re-import to trigger the module-load side-effect under the new env.
    vi_reset();
    await import("./_host-paths");
    expect(process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS).toBe(join(home, "agents"));
  });

  it("does not duplicate when called multiple times", async () => {
    const home = mkdtempSync(join(tmpdir(), "ob-hostpaths-"));
    process.env.OPENBUDDY_AGENT_DIR = home;
    delete process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS;
    vi_reset();
    const mod = await import("./_host-paths");
    mod.ensurePiSubagentAgentDirs();
    mod.ensurePiSubagentAgentDirs();
    expect(process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS).toBe(join(home, "agents"));
  });

  it("preserves user-set value and appends", async () => {
    const home = mkdtempSync(join(tmpdir(), "ob-hostpaths-"));
    process.env.OPENBUDDY_AGENT_DIR = home;
    process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS = "/opt/shared-agents";
    vi_reset();
    const mod = await import("./_host-paths");
    mod.ensurePiSubagentAgentDirs();
    const delim = process.platform === "win32" ? ";" : ":";
    expect(process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS).toBe(`/opt/shared-agents${delim}${join(home, "agents")}`);
  });
});

function vi_reset() {
  // vitest helper — clear module cache so the module-load side-effect re-runs.
  vi.resetModules();
}
