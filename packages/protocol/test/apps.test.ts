import { describe, expect, it } from "vitest";
import { describeAppInstallError } from "../src/apps";

describe("describeAppInstallError (U3)", () => {
  it("网络不可达给可执行建议，并保留原文", () => {
    const text = describeAppInstallError(new Error("network unreachable"));
    expect(text).toContain("网络不可达");
    expect(text).toContain("network unreachable");
  });

  it("认证/仓库不存在单独分类", () => {
    expect(describeAppInstallError("fatal: Authentication failed for 'https://example.com/x.git'")).toContain("需要认证");
    expect(describeAppInstallError("repository not found")).toContain("需要认证");
  });

  it("磁盘不足与缺少 Git 有专门提示", () => {
    expect(describeAppInstallError("ENOSPC: no space left on device")).toContain("磁盘空间不足");
    expect(describeAppInstallError("spawn git ENOENT")).toContain("缺少 Git");
  });

  it("未知错误也保留原始信息", () => {
    expect(describeAppInstallError("boom")).toContain("原始信息：boom");
  });

  it("空值不抛错", () => {
    expect(describeAppInstallError(undefined)).toContain("未知错误");
  });
});
