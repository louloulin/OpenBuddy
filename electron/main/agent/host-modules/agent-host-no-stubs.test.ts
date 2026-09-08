import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("agent-host composition root", () => {
  it("does not contain runtime stub factories", () => {
    const source = readFileSync(join(process.cwd(), "electron/main/agent/agent-host.ts"), "utf8");
    expect(source).not.toMatch(/\b_stub\s*\(/);
  });
});
