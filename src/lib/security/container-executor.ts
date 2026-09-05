/**
 * 容器执行器抽象 —— WorkBuddy E2B 云沙箱 + cloud-agent 的本地可移植替代。
 *
 * WorkBuddy 用 E2B(e2b.dev)做远程代码执行(云端沙箱);OpenBuddy 是 BYOK 桌面应用,
 * 用本地 Docker 容器替代:在隔离的容器内执行命令/脚本,文件系统与宿主隔离。
 *
 * 纯函数核心(容器配置 + 命令构造 + 结果归一),ShellRunner 依赖注入便于单测。
 * 运行时:ShellRunner 实现 = Electron-compatible shell 命令(child_process)。
 */

/** 容器执行结果。 */
export interface ContainerExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** 容器 id(若创建了临时容器)。 */
  containerId?: string;
  /** 执行耗时(ms)。 */
  durationMs: number;
}

/** 容器配置(镜像、资源限制、挂载、环境变量)。 */
export interface ContainerConfig {
  /** Docker 镜像(如 "node:20-slim"、"python:3.12")。 */
  image: string;
  /** 工作目录(容器内)。 */
  workDir?: string;
  /** 挂载卷(host:container)。 */
  mounts?: Array<{ host: string; container: string; readOnly?: boolean }>;
  /** 环境变量。 */
  env?: Record<string, string>;
  /** 内存上限(字节;0=不限)。 */
  memoryLimit?: number;
  /** CPU 配额(核数;0=不限)。 */
  cpuLimit?: number;
  /** 网络模式(默认 none=禁网,隔离)。 */
  network?: "none" | "bridge" | "host";
  /** 执行后自动删除容器。 */
  autoRemove?: boolean;
}

/** 默认配置:禁网、自动删除、128MB 内存。 */
export const DEFAULT_CONTAINER_CONFIG: ContainerConfig = {
  image: "node:20-slim",
  workDir: "/workspace",
  network: "none",
  autoRemove: true,
  memoryLimit: 128 * 1024 * 1024,
};

/** Shell 命令执行器(注入:运行时=Electron-compatible shell,测试=mock)。 */
export interface ShellRunner {
  /** 执行一条 shell 命令,返回 stdout/stderr/exitCode。 */
  run(command: string, opts?: { cwd?: string; timeout?: number }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
  }>;
}

/**
 * 把 ContainerConfig + 命令 构造成 `docker run` 命令行(纯函数)。
 * 这是核心逻辑:镜像选择、挂载、环境变量、资源限制、网络隔离 → docker run 参数。
 */
export function buildDockerRunCommand(
  config: ContainerConfig,
  command: string,
): string {
  const args: string[] = ["docker", "run", "--rm"];

  // 工作目录。
  if (config.workDir) args.push("-w", config.workDir);

  // 网络隔离(默认 none,禁止网络访问)。
  args.push("--network", config.network ?? "none");

  // 内存限制。
  if (config.memoryLimit && config.memoryLimit > 0) {
    args.push("--memory", formatBytes(config.memoryLimit));
  }

  // CPU 限制。
  if (config.cpuLimit && config.cpuLimit > 0) {
    args.push("--cpus", String(config.cpuLimit));
  }

  // 自动删除。
  if (config.autoRemove) args.push("--rm");

  // 挂载卷。
  for (const m of config.mounts ?? []) {
    const vol = m.readOnly ? `${m.host}:${m.container}:ro` : `${m.host}:${m.container}`;
    args.push("-v", vol);
  }

  // 环境变量。
  for (const [k, v] of Object.entries(config.env ?? {})) {
    args.push("-e", `${k}=${v}`);
  }

  // 镜像。
  args.push(config.image);

  // 执行命令(用 sh -c 包裹以支持管道/重定向)。
  args.push("sh", "-c", quoteShell(command));

  return args.join(" ");
}

/** 格式化字节为 Docker 可读格式(如 134217728 → "128m")。 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${Math.floor(bytes / (1024 * 1024 * 1024))}g`;
  if (bytes >= 1024 * 1024) return `${Math.floor(bytes / (1024 * 1024))}m`;
  if (bytes >= 1024) return `${Math.floor(bytes / 1024)}k`;
  return String(bytes);
}

/** shell 引用(单引号包裹,转义内部单引号)。 */
function quoteShell(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * 检查 Docker 是否可用(运行时探测)。纯函数:委托注入的 ShellRunner 执行 `docker --version`。
 */
export async function isDockerAvailable(runner: ShellRunner): Promise<boolean> {
  try {
    const res = await runner.run("docker --version");
    return res.exitCode === 0 && /docker version/i.test(res.stdout);
  } catch {
    return false;
  }
}

/** 容器执行器接口(可插拔:Docker / Podman / 远程 API)。 */
export interface ContainerExecutor {
  readonly id: string;
  /** 是否可用(Docker 未安装时返回 false)。 */
  isAvailable(): Promise<boolean>;
  /** 在容器内执行命令,返回结果。 */
  exec(command: string, config?: Partial<ContainerConfig>): Promise<ContainerExecResult>;
}

/**
 * Docker 容器执行器:用 `docker run` 在隔离容器内执行命令。
 * ShellRunner 依赖注入(运行时=Electron-compatible shell,测试=mock)。
 */
export class DockerExecutor implements ContainerExecutor {
  readonly id = "docker";
  constructor(
    private readonly runner: ShellRunner,
    private readonly defaultConfig: ContainerConfig = DEFAULT_CONTAINER_CONFIG,
  ) {}

  async isAvailable(): Promise<boolean> {
    return isDockerAvailable(this.runner);
  }

  async exec(command: string, config?: Partial<ContainerConfig>): Promise<ContainerExecResult> {
    const merged: ContainerConfig = { ...this.defaultConfig, ...config };
    const dockerCmd = buildDockerRunCommand(merged, command);
    const start = Date.now();
    const res = await this.runner.run(dockerCmd, { timeout: 30_000 });
    return {
      stdout: res.stdout,
      stderr: res.stderr,
      exitCode: res.exitCode,
      durationMs: Date.now() - start,
    };
  }
}

// ---------- 注册表(与 SandboxExecutor 模式一致)----------

let activeExecutor: ContainerExecutor | null = null;

/** 设置全局容器执行器。 */
export function setContainerExecutor(ex: ContainerExecutor): void {
  activeExecutor = ex;
}

/** 取当前执行器(未设置返回 null)。 */
export function getContainerExecutor(): ContainerExecutor | null {
  return activeExecutor;
}

/** 重置(测试用)。 */
export function resetContainerExecutor(): void {
  activeExecutor = null;
}

/**
 * 安全在容器内执行命令:若设置了 ContainerExecutor 且可用 → 容器内执行;
 * 否则降级为直接执行(fallback)。返回结果带标识是否容器化。
 */
export async function execInContainer(
  command: string,
  fallback: ShellRunner,
  config?: Partial<ContainerConfig>,
): Promise<ContainerExecResult & { containerized: boolean }> {
  const executor = activeExecutor;
  if (executor && (await executor.isAvailable())) {
    const res = await executor.exec(command, config);
    return { ...res, containerized: true };
  }
  // 降级:直接在宿主执行(无容器隔离)。
  const start = Date.now();
  const res = await fallback.run(command);
  return {
    stdout: res.stdout,
    stderr: res.stderr,
    exitCode: res.exitCode,
    durationMs: Date.now() - start,
    containerized: false,
  };
}
