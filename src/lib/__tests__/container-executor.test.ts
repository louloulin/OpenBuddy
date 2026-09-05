import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildDockerRunCommand,
  formatBytes,
  isDockerAvailable,
  DockerExecutor,
  setContainerExecutor,
  getContainerExecutor,
  resetContainerExecutor,
  execInContainer,
  type ShellRunner,
} from "../security/container-executor";

function mockRunner(
  stdout = "",
  exitCode = 0,
): ShellRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    run: vi.fn(async (cmd: string) => {
      calls.push(cmd);
      return { stdout, stderr: "", exitCode };
    }),
  } as unknown as ShellRunner & { calls: string[] };
}

describe("formatBytes", () => {
  it("g/m/k 级别", () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2g");
    expect(formatBytes(128 * 1024 * 1024)).toBe("128m");
    expect(formatBytes(512 * 1024)).toBe("512k");
    expect(formatBytes(500)).toBe("500");
  });
});

describe("buildDockerRunCommand", () => {
  it("基本命令含 --rm + network none + workDir", () => {
    const cmd = buildDockerRunCommand(
      { image: "node:20-slim", workDir: "/ws", network: "none", autoRemove: true },
      "npm test",
    );
    expect(cmd).toContain("docker run");
    expect(cmd).toContain("--rm");
    expect(cmd).toContain("--network none");
    expect(cmd).toContain("-w /ws");
    expect(cmd).toContain("node:20-slim");
    expect(cmd).toContain("sh -c");
  });

  it("挂载卷(含只读)", () => {
    const cmd = buildDockerRunCommand(
      {
        image: "python:3.12",
        mounts: [
          { host: "/host/proj", container: "/workspace" },
          { host: "/host/secrets", container: "/secrets", readOnly: true },
        ],
      },
      "python script.py",
    );
    expect(cmd).toContain("-v /host/proj:/workspace");
    expect(cmd).toContain("-v /host/secrets:/secrets:ro");
  });

  it("环境变量", () => {
    const cmd = buildDockerRunCommand(
      { image: "node:20-slim", env: { NODE_ENV: "test", API_KEY: "xyz" } },
      "node app.js",
    );
    expect(cmd).toContain("-e NODE_ENV=test");
    expect(cmd).toContain("-e API_KEY=xyz");
  });

  it("资源限制(memory + cpu)", () => {
    const cmd = buildDockerRunCommand(
      { image: "node:20-slim", memoryLimit: 256 * 1024 * 1024, cpuLimit: 2 },
      "ls",
    );
    expect(cmd).toContain("--memory 256m");
    expect(cmd).toContain("--cpus 2");
  });

  it("命令被 shell 引用(含特殊字符安全)", () => {
    const cmd = buildDockerRunCommand({ image: "alpine" }, "echo 'hello world' && rm -rf /tmp/x");
    // sh -c 后是单引号包裹。
    expect(cmd).toMatch(/sh -c '/);
  });

  it("autoRemove=false 时不加 --rm(第二个)", () => {
    const cmd = buildDockerRunCommand(
      { image: "alpine", autoRemove: false },
      "ls",
    );
    // --rm 只应出现一次(基础参数里的);autoRemove=false 不追加额外 --rm。
    const rmCount = (cmd.match(/--rm/g) || []).length;
    expect(rmCount).toBe(1); // 基础 args 里的那个
  });
});

describe("isDockerAvailable", () => {
  it("docker --version exitCode=0 且含 'docker version' → true", async () => {
    const runner = mockRunner("Docker version 24.0.7", 0);
    expect(await isDockerAvailable(runner)).toBe(true);
  });
  it("exitCode≠0 → false", async () => {
    const runner = mockRunner("not found", 127);
    expect(await isDockerAvailable(runner)).toBe(false);
  });
  it("抛错 → false", async () => {
    const runner: ShellRunner = {
      run: async () => {
        throw new Error("no docker");
      },
    };
    expect(await isDockerAvailable(runner)).toBe(false);
  });
});

describe("DockerExecutor", () => {
  it("exec 构造 docker run 并委托 runner", async () => {
    const runner = mockRunner("test output\n", 0);
    const ex = new DockerExecutor(runner);
    const res = await ex.exec("npm test", { image: "node:20-slim" });
    expect(res.stdout).toBe("test output\n");
    expect(res.exitCode).toBe(0);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
    // 验证传给 runner 的命令是 docker run。
    expect(runner.calls[0]).toContain("docker run");
  });

  it("isAvailable 委托 isDockerAvailable", async () => {
    const runner = mockRunner("Docker version 25.0", 0);
    const ex = new DockerExecutor(runner);
    expect(await ex.isAvailable()).toBe(true);
  });
});

describe("容器执行器注册表 + execInContainer", () => {
  beforeEach(resetContainerExecutor);
  afterEach(resetContainerExecutor);

  it("set/get/reset", () => {
    expect(getContainerExecutor()).toBeNull();
    const runner = mockRunner();
    setContainerExecutor(new DockerExecutor(runner));
    expect(getContainerExecutor()?.id).toBe("docker");
    resetContainerExecutor();
    expect(getContainerExecutor()).toBeNull();
  });

  it("execInContainer:有可用 executor → 容器内执行", async () => {
    // isAvailable 也走 runner(返回 docker version)。
    const availRunner = mockRunner("Docker version 24", 0);
    const availEx = new DockerExecutor(availRunner);
    setContainerExecutor(availEx);
    const fallback = mockRunner("fallback", 0);
    const res = await execInContainer("ls", fallback);
    expect(res.containerized).toBe(true);
    expect(fallback.run).not.toHaveBeenCalled();
  });

  it("execInContainer:无 executor → 降级 fallback 直通", async () => {
    const fallback = mockRunner("direct out", 0);
    const res = await execInContainer("ls", fallback);
    expect(res.containerized).toBe(false);
    expect(res.stdout).toBe("direct out");
  });

  it("execInContainer:executor 不可用(docker 未装)→ 降级", async () => {
    const runner = mockRunner("not found", 127);
    setContainerExecutor(new DockerExecutor(runner));
    const fallback = mockRunner("fallback out", 0);
    const res = await execInContainer("ls", fallback);
    expect(res.containerized).toBe(false);
    expect(res.stdout).toBe("fallback out");
  });
});
