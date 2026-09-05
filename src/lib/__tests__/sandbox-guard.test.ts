import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DEFAULT_SANDBOX_RULES,
  globToRegex,
  matchGlob,
  checkFileAccess,
  checkProcessAccess,
  precheckCommand,
  serializeRules,
  deserializeRules,
  PassthroughExecutor,
  AnthropicSandboxExecutor,
  setSandboxExecutor,
  getSandboxExecutor,
  resetSandboxExecutor,
  safeExec,
  type SandboxRules,
  type ExecResult,
} from "../security/sandbox-guard";

describe("globToRegex / matchGlob", () => {
  it("** 匹配跨目录", () => {
    expect(matchGlob("/a/b/c.txt", "/a/**/*.txt")).toBe(true);
    expect(matchGlob("/a/b/c/d.txt", "/a/**/*.txt")).toBe(true);
  });
  it("* 匹配单段(不含分隔符)", () => {
    expect(matchGlob("/a/b.txt", "/a/*.txt")).toBe(true);
    expect(matchGlob("/a/b/c.txt", "/a/*.txt")).toBe(false);
  });
  it("大小写不敏感", () => {
    expect(matchGlob("/A/B.TXT", "/a/*.txt")).toBe(true);
  });
  it("反斜杠归一为正斜杠后匹配", () => {
    expect(matchGlob("C:\\a\\b.txt", "C:/a/*.txt")).toBe(true);
  });
  it("环境变量占位符 %X% 匹配单段", () => {
    expect(matchGlob("/home/u/.ssh/key", "%USERPROFILE%/.ssh/**")).toBe(false); // %USERPROFILE% → 单段,但 /home/u 是单段 → 匹配
    expect(matchGlob("u/.ssh/key", "%USERPROFILE%/.ssh/**")).toBe(true);
  });
  it("正则元字符被转义", () => {
    expect(() => globToRegex("a(b)c.json")).not.toThrow();
    expect(matchGlob("a(b)c.json", "a(b)c.json")).toBe(true);
  });
});

describe("checkFileAccess(默认规则)", () => {
  it(".ssh 目录 deny", () => {
    expect(checkFileAccess("/home/u/.ssh/id_rsa")).toBe("deny");
    expect(checkFileAccess("C:/Users/x/.ssh/config")).toBe("deny");
  });
  it(".gnupg deny", () => {
    expect(checkFileAccess("/home/u/.gnupg/gpg.conf")).toBe("deny");
  });
  it(".aws/credentials deny", () => {
    expect(checkFileAccess("/home/u/.aws/credentials")).toBe("deny");
  });
  it(".env deny", () => {
    expect(checkFileAccess("/proj/.env")).toBe("deny");
  });
  it("Temp 目录 allow", () => {
    expect(checkFileAccess("/tmp/Temp/x.log")).toBe("allow");
    expect(checkFileAccess("C:/Users/x/AppData/Local/Temp/y.json")).toBe("allow");
  });
  it("普通项目文件 ask(默认)", () => {
    expect(checkFileAccess("/proj/src/app.ts")).toBe("ask");
  });
  it("自定义规则集:首个命中生效", () => {
    const rules: SandboxRules = {
      defaultAction: "deny",
      fileRules: [
        { pattern: "/proj/**", action: "allow" },
        { pattern: "/proj/secret/**", action: "deny" },
      ],
      processRules: [],
    };
    expect(checkFileAccess("/proj/app.ts", rules)).toBe("allow");
    // /proj/secret 在 /proj/** 之后 → /proj/** 先命中 → allow(首个命中生效)。
    expect(checkFileAccess("/proj/secret/x", rules)).toBe("allow");
  });
});

describe("checkProcessAccess", () => {
  it("cmd/powershell/bash/sh allow", () => {
    expect(checkProcessAccess("C:/Windows/System32/cmd.exe")).toBe("allow");
    expect(checkProcessAccess("/usr/bin/bash")).toBe("allow");
    expect(checkProcessAccess("/bin/sh")).toBe("allow");
  });
  it("未知进程 ask(默认)", () => {
    expect(checkProcessAccess("/usr/bin/python3")).toBe("ask");
  });
});

describe("precheckCommand", () => {
  it("访问 .ssh 路径 → deny", () => {
    const r = precheckCommand("cat /home/u/.ssh/id_rsa");
    expect(r.action).toBe("deny");
    expect(r.target).toContain(".ssh");
  });
  it("访问 .env → deny", () => {
    const r = precheckCommand("cat /proj/.env");
    expect(r.action).toBe("deny");
  });
  it("普通命令无路径 → 默认 ask", () => {
    const r = precheckCommand("ls -la");
    expect(r.action).toBe(DEFAULT_SANDBOX_RULES.defaultAction);
  });
  it("多路径取最严格(deny 优先)", () => {
    const r = precheckCommand("cp /tmp/Temp/x.log /home/u/.ssh/key");
    expect(r.action).toBe("deny");
    expect(r.target).toContain(".ssh");
  });
  it("Temp 路径 → allow(命中 Temp 规则,覆盖默认 ask)", () => {
    // /tmp/Temp/build.log 命中 **/Temp/** → allow;虽默认 ask,但命中 allow 规则。
    const r = precheckCommand("cat /tmp/Temp/build.log");
    expect(r.action).toBe("allow");
    expect(r.matchedRule).toContain("Temp");
  });
  it("Windows 路径", () => {
    const r = precheckCommand("type C:\\Users\\x\\.ssh\\config");
    expect(r.action).toBe("deny");
  });
});

describe("serializeRules / deserializeRules", () => {
  it("往返序列化", () => {
    const json = serializeRules(DEFAULT_SANDBOX_RULES);
    const back = deserializeRules(json);
    expect(back.defaultAction).toBe(DEFAULT_SANDBOX_RULES.defaultAction);
    expect(back.fileRules).toHaveLength(DEFAULT_SANDBOX_RULES.fileRules.length);
  });
  it("非法 JSON → fallback", () => {
    expect(deserializeRules("not json")).toBe(DEFAULT_SANDBOX_RULES);
  });
  it("缺字段 → fallback", () => {
    expect(deserializeRules(JSON.stringify({ defaultAction: "allow" }))).toBe(DEFAULT_SANDBOX_RULES);
  });
});

describe("沙箱执行器适配层", () => {
  afterEach(resetSandboxExecutor);

  it("PassthroughExecutor 直通执行(无沙箱标记)", async () => {
    const exec = vi.fn(async (): Promise<ExecResult> => ({ stdout: "ok", stderr: "", exitCode: 0, sandboxed: false }));
    const ex = new PassthroughExecutor(exec);
    const r = await ex.exec("ls");
    expect(r.stdout).toBe("ok");
    expect(r.sandboxed).toBe(false);
    expect(exec).toHaveBeenCalledWith("ls", undefined);
  });

  it("AnthropicSandboxExecutor 包装 sandbox-runtime(sandboxed=true)", async () => {
    const fakeSandbox = {
      exec: vi.fn(async () => ({ stdout: "sandboxed-out", stderr: "", exitCode: 0 })),
    };
    const ex = new AnthropicSandboxExecutor(fakeSandbox);
    const r = await ex.exec("rm -rf /tmp/x", { cwd: "/tmp" });
    expect(r.stdout).toBe("sandboxed-out");
    expect(r.sandboxed).toBe(true);
    expect(fakeSandbox.exec).toHaveBeenCalledWith("rm -rf /tmp/x", { cwd: "/tmp" });
  });

  it("setSandboxExecutor / getSandboxExecutor / reset", () => {
    expect(getSandboxExecutor()).toBeNull();
    const ex = new PassthroughExecutor(async (): Promise<ExecResult> => ({ stdout: "", stderr: "", exitCode: 0, sandboxed: false }));
    setSandboxExecutor(ex);
    expect(getSandboxExecutor()?.id).toBe("passthrough");
    resetSandboxExecutor();
    expect(getSandboxExecutor()).toBeNull();
  });
});

describe("safeExec(预检 + 执行委托)", () => {
  afterEach(resetSandboxExecutor);

  const okExec = async (): Promise<ExecResult> => ({ stdout: "done", stderr: "", exitCode: 0, sandboxed: false });

  it("deny 路径(.ssh)→ 拒绝执行,不调用 fallback", async () => {
    const fallback = vi.fn(okExec);
    const r = await safeExec("cat /home/u/.ssh/id_rsa", DEFAULT_SANDBOX_RULES, fallback);
    expect(r.exitCode).toBeNull();
    expect(r.stderr).toContain("拒绝");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("allow/ask 命令 → 用 fallback 直通执行(passthrough)", async () => {
    const fallback = vi.fn(async () => ({ stdout: "out", stderr: "", exitCode: 0, sandboxed: false }));
    const r = await safeExec("ls -la", DEFAULT_SANDBOX_RULES, fallback);
    expect(r.stdout).toBe("out");
    expect(r.sandboxed).toBe(false);
    expect(fallback).toHaveBeenCalledWith("ls -la", undefined);
  });

  it("设置了 AnthropicSandboxExecutor → 委托给它(sandboxed=true)", async () => {
    const fakeSandbox = {
      exec: vi.fn(async () => ({ stdout: "sandbox", stderr: "", exitCode: 0 })),
    };
    setSandboxExecutor(new AnthropicSandboxExecutor(fakeSandbox));
    const fallback = vi.fn(okExec);
    const r = await safeExec("ls", DEFAULT_SANDBOX_RULES, fallback);
    expect(r.stdout).toBe("sandbox");
    expect(r.sandboxed).toBe(true);
    expect(fakeSandbox.exec).toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("deny 优先于沙箱执行器(不进沙箱直接拒绝)", async () => {
    const fakeSandbox = { exec: vi.fn(async () => ({ stdout: "x", stderr: "", exitCode: 0 })) };
    setSandboxExecutor(new AnthropicSandboxExecutor(fakeSandbox));
    const r = await safeExec("cat /proj/.env", DEFAULT_SANDBOX_RULES, okExec);
    expect(r.exitCode).toBeNull();
    expect(r.stderr).toContain("拒绝");
    expect(fakeSandbox.exec).not.toHaveBeenCalled();
  });
});
