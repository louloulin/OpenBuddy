import { beforeEach, describe, expect, it } from "vitest";
import { parseArtifactRoute, rememberArtifactRoute, takePendingArtifact } from "../artifact-window-route";

describe("产物独立窗口路由 (G3-3)", () => {
  beforeEach(() => rememberArtifactRoute("#/"));

  it("解析 #/artifact/<sessionId>?path=…", () => {
    expect(parseArtifactRoute("#/artifact/abc?path=%2Fwork%2Freport.md")).toEqual({ sessionId: "abc", path: "/work/report.md" });
  });

  it("缺少 path 或不是产物路由时不解析", () => {
    expect(parseArtifactRoute("#/artifact/abc")).toBeNull();
    expect(parseArtifactRoute("#/session/abc")).toBeNull();
    expect(parseArtifactRoute("#/")).toBeNull();
  });

  it("待打开目标只对匹配的会话消费一次", () => {
    rememberArtifactRoute("#/artifact/s1?path=%2Fwork%2Fa.md");
    expect(takePendingArtifact("s2")).toBeNull();
    expect(takePendingArtifact("s1")).toBe("/work/a.md");
    expect(takePendingArtifact("s1")).toBeNull();
  });
});
