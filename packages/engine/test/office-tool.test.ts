// @vitest-environment node
// B2b: ob_xlsx is a normal Pi tool — permission gate, checkpoint snapshot, file on disk.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sdkFixture, until, type FixtureRequest } from "./helpers/sdk-fixture.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const lastUser = (request: FixtureRequest) => {
  const last = [...request.messages].reverse().find((message) => message.role === "user");
  const content = last?.content;
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
};
const hasToolResult = (request: FixtureRequest) => request.messages.some((message) => message.role === "tool");

describe("办公产物工具 (B2b)", () => {
  it("writes a real xlsx through the permission gate and refreshes artifacts", async () => {
    const f = await sdkFixture((request) => {
      if (hasToolResult(request)) return { text: "表格已生成" };
      if (!lastUser(request).includes("季度表")) return { text: "ok" };
      return {
        toolCalls: [{
          id: "office-1",
          name: "ob_xlsx",
          arguments: {
            path: "reports/q3.xlsx",
            sheets: [{ name: "销售", columns: ["月份", "销量"], rows: [["1月", 10], ["2月", 20]] }],
          },
        }],
      };
    }, cleanups);

    const turn = f.call("agent_send", { sessionId: f.sid, text: "生成一张季度表" });
    await until(() => f.events.some((event) => event.name === "agent://permission" && event.payload.toolKind === "ob_xlsx"));
    const request = f.events.find((event) => event.name === "agent://permission" && event.payload.toolKind === "ob_xlsx")!.payload;
    await f.call("agent_resolve_permission", { requestId: request.requestId, optionId: "allow" });
    await turn;

    const file = join(f.root, "reports", "q3.xlsx");
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(1000);
    // OOXML is a ZIP: PK header.
    expect(readFileSync(file).subarray(0, 2).toString()).toBe("PK");
    expect(f.events.some((event) => event.name === "agent://artifacts")).toBe(true);
    // The workbench lists generated office files like any other artifact (B2b).
    const artifacts = (await f.call("artifacts_list", { sessionId: f.sid })) as Array<{ path: string; status: string; size?: number }>;
    const expected = realpathSync(file);
    expect(artifacts.find((artifact) => realpathSync(artifact.path) === expected)).toMatchObject({ status: "created" });
    expect(JSON.stringify(f.events)).toContain("表格已生成");
  });
});
