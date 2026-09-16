import { describe, expect, it } from "vitest";

import { classifyCasdoorFailure, humanizeCasdoorError } from "../casdoor-error";

describe("humanizeCasdoorError", () => {
  it("未配置 → 明确告诉用户去哪儿填什么(而不是甩 issuer 术语)", () => {
    const raw =
      "Casdoor 配置无效：请检查 issuer、client ID、管理地址和 casdoor://localhost/callback";
    const message = humanizeCasdoorError(raw);
    expect(classifyCasdoorFailure(raw)).toBe("unconfigured");
    expect(message).toContain("设置 → 账户管理");
    expect(message).toContain("issuer");
    expect(message).toContain("client ID");
  });

  it("网络问题 → 保留原文,便于排障", () => {
    const raw = "Error: connect ECONNREFUSED 127.0.0.1:8000";
    const message = humanizeCasdoorError(raw);
    expect(classifyCasdoorFailure(raw)).toBe("network");
    expect(message).toContain("ECONNREFUSED");
    expect(message).toContain("网络");
  });

  it("授权被拒 → 单独文案", () => {
    expect(classifyCasdoorFailure("access_denied")).toBe("denied");
    expect(humanizeCasdoorError("access_denied")).toContain("拒绝");
  });

  it("未知错误 → 原样返回(不吞信息)", () => {
    expect(humanizeCasdoorError("something odd")).toBe("something odd");
  });

  it("空错误 → 兜底文案,不出现空白 toast", () => {
    expect(humanizeCasdoorError("")).toBe("登录失败,请稍后重试");
    expect(humanizeCasdoorError("Error: ")).toBe("登录失败,请稍后重试");
  });
});
