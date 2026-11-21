// @vitest-environment node
// 20261116-pii W1.3: `files_search` through the assembled host (workspace guard + payload validation).
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateCommandPayload } from "@openbuddy/protocol/validate";
import { sdkFixture } from "./helpers/sdk-fixture";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("files_search (W1.3)", () => {
  it("searches the workspace of a live task and nothing else", async () => {
    const f = await sdkFixture(() => ({ text: "ok" }), cleanups);
    await mkdir(join(f.root, "docs"), { recursive: true });
    await writeFile(join(f.root, "docs", "report.md"), "# r");
    const result = (await f.call("files_search", validateCommandPayload("files_search", { cwd: f.root, query: "report" }))) as any;
    expect(result.hits.map((h: any) => h.path)).toContain("docs/report.md");
    await expect(f.call("files_search", { cwd: tmpdir(), query: "" })).rejects.toThrow("workspace_not_authorized");
    await expect(f.call("files_search", { cwd: join(f.root, "docs"), query: "" })).rejects.toThrow("workspace_not_authorized");
    await expect(f.call("files_search", { cwd: join(f.root, "missing"), query: "" })).rejects.toThrow("workspace_not_authorized");
  });
});
