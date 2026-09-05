import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  tryActivateSandbox,
  isSandboxActive,
  sandboxRulesToPolicy,
} from "../security/sandbox-init";
import {
  resetSandboxExecutor,
  getSandboxExecutor,
  DEFAULT_SANDBOX_RULES,
} from "../security/sandbox-guard";

describe("sandbox-init", () => {
  beforeEach(resetSandboxExecutor);
  afterEach(resetSandboxExecutor);

  it("包未安装(moduleResolver 抛错)→ not-installed,不激活", async () => {
    const status = await tryActivateSandbox(undefined, {
      moduleResolver: async () => {
        throw new Error("not found");
      },
    });
    expect(status.activated).toBe(false);
    if (!status.activated) expect(status.reason).toBe("not-installed");
    expect(isSandboxActive()).toBe(false);
    expect(getSandboxExecutor()).toBeNull();
  });

  it("运行时无 moduleResolver → 动态 import 失败 → not-installed(离线环境真实路径)", async () => {
    const status = await tryActivateSandbox();
    expect(status.activated).toBe(false);
    if (!status.activated) expect(status.reason).toBe("not-installed");
  });

  it("包已安装(default export 函数)→ 激活 OS 级沙箱", async () => {
    const fakeExec = vi.fn(async () => ({ stdout: "ok", stderr: "", exitCode: 0 }));
    const status = await tryActivateSandbox(undefined, {
      moduleResolver: async () => ({ default: (_p: unknown) => ({ exec: fakeExec }) }),
    });
    expect(status.activated).toBe(true);
    expect(isSandboxActive()).toBe(true);
    const executor = getSandboxExecutor();
    expect(executor?.isSandboxed).toBe(true);
    const result = await executor!.exec("ls");
    expect(result.stdout).toBe("ok");
    expect(result.sandboxed).toBe(true);
  });

  it("包已安装(named createSandbox)→ 激活", async () => {
    const fakeExec = vi.fn(async () => ({ stdout: "x", stderr: "", exitCode: 0 }));
    const status = await tryActivateSandbox(undefined, {
      moduleResolver: async () => ({ createSandbox: () => ({ exec: fakeExec }) }),
    });
    expect(status.activated).toBe(true);
  });

  it("包已安装(run 方法而非 exec)→ 适配为 exec", async () => {
    const fakeRun = vi.fn(async () => ({ stdout: "via-run", stderr: "", exitCode: 0 }));
    await tryActivateSandbox(undefined, {
      moduleResolver: async () => ({ createSandbox: () => ({ run: fakeRun }) }),
    });
    const executor = getSandboxExecutor();
    const result = await executor!.exec("pwd");
    expect(result.stdout).toBe("via-run");
    expect(fakeRun).toHaveBeenCalled();
  });

  it("已激活时重复调用 → already-active", async () => {
    await tryActivateSandbox(undefined, {
      moduleResolver: async () => ({
        default: () => ({ exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })) }),
      }),
    });
    const second = await tryActivateSandbox(undefined, {
      moduleResolver: async () => ({ default: () => ({ exec: vi.fn() }) }),
    });
    expect(second.activated).toBe(false);
    if (!second.activated) expect(second.reason).toBe("already-active");
  });

  it("模块无有效 API → import-failed", async () => {
    const status = await tryActivateSandbox(undefined, {
      moduleResolver: async () => ({ unrelated: true }),
    });
    expect(status.activated).toBe(false);
    if (!status.activated) expect(status.reason).toBe("import-failed");
  });

  it("带自定义 policy 传入", async () => {
    const customPolicy = { defaultAction: "deny", fileRules: [], networkPolicy: { enabled: true } };
    const status = await tryActivateSandbox(customPolicy, {
      moduleResolver: async () => ({ createSandbox: () => ({ exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })) }) }),
    });
    expect(status.activated).toBe(true);
  });
});

describe("sandboxRulesToPolicy", () => {
  it("转换规则为 policy 格式", () => {
    const policy = sandboxRulesToPolicy(DEFAULT_SANDBOX_RULES);
    expect(policy.defaultAction).toBe(DEFAULT_SANDBOX_RULES.defaultAction);
    expect(Array.isArray(policy.fileRules)).toBe(true);
    expect(policy.networkPolicy).toEqual({ enabled: true, default: "allow" });
  });
});

describe("isSandboxActive", () => {
  beforeEach(resetSandboxExecutor);

  it("未设置执行器 → false", () => {
    expect(isSandboxActive()).toBe(false);
  });
});
