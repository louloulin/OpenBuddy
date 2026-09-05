import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants as fsConstants, existsSync, mkdtempSync, appendFileSync, realpathSync } from "node:fs";
import { delimiter, extname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { spawnPtyProcess } from "./terminal-runtime";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

export interface SandboxExecutionPolicy {
  mode: SandboxMode;
  workspaceRoot: string;
  sessionId?: string;
}

export interface SandboxPolicyRequest {
  session?: { sessionId?: string; cwd?: string };
  mode?: SandboxMode;
  cwd?: string;
}

export interface ConfinedArgv {
  argv: string[];
  enforcement: "full" | "partial";
  denialSignatures: readonly string[];
  runnerFailureRules: readonly { allowedExitCodes?: readonly number[]; fatalSignatures: readonly string[] }[];
}

export interface SubprocessCollectSpec {
  maxBytes: number;
  spill?: { maxBytes: number };
}

export type SubprocessOutputMode = "pipe" | "inherit" | SubprocessCollectSpec;
export type SubprocessStdinMode = "ignore" | "pipe" | { data: string };

export interface SubprocessSpawnSpec {
  argv: readonly string[];
  cwd: string;
  stdio: { stdin: SubprocessStdinMode; stdout: SubprocessOutputMode; stderr: SubprocessOutputMode };
  graceMs: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

export interface CollectedOutput {
  text: string;
  truncated: boolean;
  spillPath?: string;
}

export interface SubprocessOutputRead {
  text: string;
  nextOffset: number;
  lossy: boolean;
  spillPath?: string;
}

export type SubprocessOutputReader = ((offset?: number, count?: number) => CollectedOutput) & {
  readFrom: (fromByte: number) => SubprocessOutputRead;
};

export interface SubprocessHandle {
  readonly pid?: number;
  readonly stdin?: Writable;
  readonly stdout?: Readable;
  readonly stderr?: Readable;
  readonly done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  readonly collected: {
    stdout: SubprocessOutputReader;
    stderr: SubprocessOutputReader;
  };
  terminate: () => Promise<void>;
  waitForExit: () => Promise<void>;
}

export type SubprocessTerminalSignal = "SIGINT" | "SIGTERM" | "SIGKILL" | "SIGTSTP" | "SIGHUP";

export interface SubprocessTerminalSpawnSpec {
  argv: readonly string[];
  cwd: string;
  env?: Record<string, string>;
  rows: number;
  cols: number;
  graceMs: number;
  signal?: AbortSignal;
}

export interface SubprocessTerminalHandle {
  readonly pid: number;
  readonly output: Readable;
  readonly done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  write: (data: string) => Promise<void>;
  inspectForeground: () => Promise<{ processGroupId: number; inputWaiting: boolean } | undefined>;
  signalForeground: (signal: SubprocessTerminalSignal) => Promise<number>;
  terminate: () => Promise<void>;
}

const sensitiveEnvironment = /KEY|PASSWORD|SECRET|TOKEN/i;
const subprocessEnvironmentPrefix = "DSH_";

export function scrubbedParentEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) => (
    value !== undefined
      && !sensitiveEnvironment.test(key)
      && !key.toUpperCase().startsWith(subprocessEnvironmentPrefix)
  ))) as Record<string, string>;
}

function childEnvironment(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base = scrubbedParentEnv();
  if (process.platform !== "win32") return { ...base, ...extra };
  const entries = new Map(Object.entries(base));
  for (const [key, value] of Object.entries(extra ?? {})) {
    for (const inheritedKey of entries.keys()) {
      if (inheritedKey.toUpperCase() === key.toUpperCase()) entries.delete(inheritedKey);
    }
    if (value !== undefined) entries.set(key, value);
  }
  return Object.fromEntries(entries);
}

class OutputCollector {
  private chunks: string[] = [];
  private bytes = 0;
  private totalBytes = 0;
  private truncatedValue = false;
  private spillBytes = 0;
  private readonly spillPath?: string;

  constructor(private readonly spec: SubprocessCollectSpec, label: string) {
    if (spec.spill) {
      const directory = mkdtempSync(join(tmpdir(), "openbuddy-subprocess-"));
      this.spillPath = join(directory, `${label}.log`);
    }
  }

  append(value: string): void {
    if (!value) return;
    const valueBytes = Buffer.byteLength(value);
    this.totalBytes += valueBytes;
    if (this.spillPath && this.spillBytes + valueBytes <= (this.spec.spill?.maxBytes ?? 0)) {
      appendFileSync(this.spillPath, value);
      this.spillBytes += valueBytes;
    } else if (this.spillPath && this.spillBytes > 0) {
      this.truncatedValue = true;
    }
    this.chunks.push(value);
    this.bytes += valueBytes;
    while (this.bytes > Math.max(1, this.spec.maxBytes)) {
      const removed = this.chunks.shift();
      if (removed === undefined) break;
      this.bytes -= Buffer.byteLength(removed);
      this.truncatedValue = true;
    }
  }

  read(offset = 0, count = Number.MAX_SAFE_INTEGER): CollectedOutput {
    const text = this.chunks.join("");
    const safeOffset = Math.max(0, Math.floor(offset));
    const safeCount = Math.max(0, Math.floor(count));
    return {
      text: text.slice(safeOffset, safeOffset + safeCount),
      truncated: this.truncatedValue,
      ...(this.spillPath ? { spillPath: this.spillPath } : {}),
    };
  }

  readFrom(fromByte = 0): SubprocessOutputRead {
    const retained = this.chunks.join("");
    const retainedBytes = Buffer.byteLength(retained);
    const windowStart = this.totalBytes - retainedBytes;
    const requested = Math.max(0, Math.floor(fromByte));
    const lossy = requested < windowStart;
    const text = retained;
    const textBytes = Buffer.from(text);
    return {
      text: lossy ? text : textBytes.subarray(Math.max(0, requested - windowStart)).toString("utf8"),
      nextOffset: this.totalBytes,
      lossy,
      ...(this.spillPath ? { spillPath: this.spillPath } : {}),
    };
  }
}

function signalForExit(value: NodeJS.Signals | null | undefined): NodeJS.Signals | null {
  return value ?? null;
}

function killTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    process.kill(process.platform === "win32" ? child.pid : -child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* process already exited */ }
  }
}

function waitForChild(child: ChildProcessWithoutNullStreams, graceMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveDone) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolveDone();
    };
    const timer = setTimeout(finish, Math.max(1, graceMs));
    child.once("close", finish);
  });
}

function normalizeGrace(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 120_000) : 1_500;
}

function makeHandle(child: ChildProcessWithoutNullStreams, spec: SubprocessSpawnSpec): SubprocessHandle {
  const stdoutCollector = typeof spec.stdio.stdout === "object" ? new OutputCollector(spec.stdio.stdout, "stdout") : undefined;
  const stderrCollector = typeof spec.stdio.stderr === "object" ? new OutputCollector(spec.stdio.stderr, "stderr") : undefined;
  if (stdoutCollector && child.stdout) child.stdout.setEncoding("utf8").on("data", (value: string) => stdoutCollector.append(value));
  if (stderrCollector && child.stderr) child.stderr.setEncoding("utf8").on("data", (value: string) => stderrCollector.append(value));

  let terminatePromise: Promise<void> | undefined;
  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolveDone, rejectDone) => {
    child.once("error", rejectDone);
    child.once("close", (exitCode, signal) => resolveDone({ exitCode, signal: signalForExit(signal) }));
  });
  const terminate = async (): Promise<void> => {
    terminatePromise ??= (async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      killTree(child, "SIGTERM");
      await waitForChild(child, normalizeGrace(spec.graceMs));
      if (child.exitCode === null && child.signalCode === null) {
        killTree(child, "SIGKILL");
        await waitForChild(child, normalizeGrace(spec.graceMs));
      }
    })();
    await terminatePromise;
  };
  if (spec.signal) {
    if (spec.signal.aborted) void terminate();
    else spec.signal.addEventListener("abort", () => { void terminate(); }, { once: true });
  }
  return {
    pid: child.pid,
    stdin: spec.stdio.stdin === "pipe" ? child.stdin : undefined,
    stdout: spec.stdio.stdout === "pipe" ? child.stdout : undefined,
    stderr: spec.stdio.stderr === "pipe" ? child.stderr : undefined,
    done,
    collected: {
      stdout: Object.assign(
        (offset?: number, count?: number) => stdoutCollector?.read(offset, count) ?? { text: "", truncated: false },
        { readFrom: (fromByte: number) => stdoutCollector?.readFrom(fromByte) ?? { text: "", nextOffset: 0, lossy: false } },
      ),
      stderr: Object.assign(
        (offset?: number, count?: number) => stderrCollector?.read(offset, count) ?? { text: "", truncated: false },
        { readFrom: (fromByte: number) => stderrCollector?.readFrom(fromByte) ?? { text: "", nextOffset: 0, lossy: false } },
      ),
    },
    terminate,
    waitForExit: async () => { await done.catch(() => undefined); await waitForChild(child, normalizeGrace(spec.graceMs)); },
  };
}

export class SubprocessRuntime {
  private readonly live = new Set<SubprocessHandle>();
  private readonly liveTerminals = new Set<SubprocessTerminalHandle>();

  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string> {
    if (!command) return Promise.reject(new Error("subprocess: executable must be non-empty"));
    signal?.throwIfAborted();
    const environment = childEnvironment(env);
    const absolute = isAbsolute(command);
    if (!absolute && (command.includes("/") || (process.platform === "win32" && command.includes("\\")))) {
      return Promise.reject(new Error(`subprocess: relative executable is not allowed: ${command}`));
    }
    const directories = absolute ? [""] : (environment.PATH ?? "").split(delimiter);
    const extensions = process.platform === "win32" && !extname(command)
      ? (environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
      : [""];
    return (async () => {
      for (const directory of directories) {
        for (const extension of extensions) {
          signal?.throwIfAborted();
          const candidate = absolute ? command : resolve(directory || process.cwd(), command + extension);
          try {
            const info = await stat(candidate);
            await access(candidate, fsConstants.X_OK);
            if (info.isFile()) return candidate;
          } catch { /* try the next PATH entry */ }
        }
      }
      throw new Error(`subprocess: executable not found: ${command}`);
    })();
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const file = spec.argv[0];
    if (!file) throw new Error("subprocess: argv must contain a program");
    const child = spawn(file, [...spec.argv.slice(1)], {
      cwd: resolve(spec.cwd),
      env: childEnvironment(spec.env),
      detached: process.platform !== "win32",
      stdio: [spec.stdio.stdin === "pipe" || typeof spec.stdio.stdin === "object" ? "pipe" : "ignore", spec.stdio.stdout === "inherit" ? "inherit" : "pipe", spec.stdio.stderr === "inherit" ? "inherit" : "pipe"],
    }) as ChildProcessWithoutNullStreams;
    if (typeof spec.stdio.stdin === "object") {
      child.stdin.end(spec.stdio.stdin.data);
    }
    const handle = makeHandle(child, spec);
    this.live.add(handle);
    void handle.done.then(() => this.live.delete(handle), () => this.live.delete(handle));
    return handle;
  }

  async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    const file = spec.argv[0];
    if (!file) throw new Error("subprocess: terminal argv must contain a program");
    spec.signal?.throwIfAborted();
    const child = spawnPtyProcess({ file, args: [...spec.argv.slice(1)], cwd: spec.cwd, env: spec.env, signal: spec.signal });
    const output = new PassThrough();
    child.stdout.on("data", (value) => output.write(value));
    child.stderr.on("data", (value) => output.write(value));
    child.once("close", () => output.end());
    const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolveDone, rejectDone) => {
      child.once("error", rejectDone);
      child.once("close", (exitCode, signal) => resolveDone({ exitCode, signal: signalForExit(signal) }));
    });
    let terminatePromise: Promise<void> | undefined;
    const terminate = async (): Promise<void> => {
      terminatePromise ??= (async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        killTree(child, "SIGTERM");
        await waitForChild(child, normalizeGrace(spec.graceMs));
        if (child.exitCode === null && child.signalCode === null) {
          killTree(child, "SIGKILL");
          await waitForChild(child, normalizeGrace(spec.graceMs));
        }
      })();
      await terminatePromise;
    };
    if (spec.signal) {
      if (spec.signal.aborted) void terminate();
      else spec.signal.addEventListener("abort", () => { void terminate(); }, { once: true });
    }
    const handle: SubprocessTerminalHandle = {
      pid: child.pid ?? -1,
      output,
      done,
      write: async (data: string) => { if (child.stdin.destroyed) throw new Error("subprocess: terminal stdin is closed"); child.stdin.write(data); },
      inspectForeground: async () => child.pid ? { processGroupId: child.pid, inputWaiting: true } : undefined,
      signalForeground: async (signal: SubprocessTerminalSignal) => { if (!child.pid) throw new Error("subprocess: terminal has no pid"); killTree(child, signal); return child.pid; },
      terminate,
    };
    this.liveTerminals.add(handle);
    void done.then(() => this.liveTerminals.delete(handle), () => this.liveTerminals.delete(handle));
    return handle;
  }

  spawnTerminalProcess(spec: { file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal }): ChildProcessWithoutNullStreams {
    return spawn(spec.file, spec.args, {
      cwd: resolve(spec.cwd),
      env: childEnvironment(spec.env),
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    }) as ChildProcessWithoutNullStreams;
  }

  async dispose(): Promise<void> {
    const handles = [...this.live];
    const terminals = [...this.liveTerminals];
    await Promise.allSettled([
      ...handles.map(async (handle) => { await handle.terminate(); await handle.waitForExit(); }),
      ...terminals.map((terminal) => terminal.terminate()),
    ]);
    this.live.clear();
    this.liveTerminals.clear();
  }
}

export class SandboxPolicyService {
  readonly defaultMode: SandboxMode;
  readonly workspaceRoot: string;
  private readonly sessionModes = new Map<string, SandboxMode>();

  constructor(options: { mode?: SandboxMode; workspaceRoot?: string } = {}) {
    const configuredMode = options.mode ?? process.env.DSH_PERMISSION_MODE;
    this.defaultMode = configuredMode === "read-only" || configuredMode === "danger-full-access" || configuredMode === "workspace-write"
      ? configuredMode
      : "workspace-write";
    this.workspaceRoot = canonicalPath(resolve(options.workspaceRoot ?? process.cwd()));
  }

  setSessionMode(sessionId: string, mode: SandboxMode): void { this.sessionModes.set(sessionId, mode); }

  overrideOf(session?: { sessionId?: string }): SandboxMode | undefined {
    return session?.sessionId ? this.sessionModes.get(session.sessionId) : undefined;
  }

  resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy {
    const sessionId = request.session?.sessionId;
    return {
      mode: request.mode ?? (sessionId ? this.sessionModes.get(sessionId) : undefined) ?? this.defaultMode,
      workspaceRoot: canonicalPath(resolve(request.session?.cwd ?? request.cwd ?? this.workspaceRoot)),
      ...(sessionId ? { sessionId } : {}),
    };
  }
}

function seatbeltPath(path: string): string {
  return path.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

function writableRoots(policy: SandboxExecutionPolicy): string[] {
  if (policy.mode !== "workspace-write") return [];
  return [...new Set([policy.workspaceRoot, "/tmp", tmpdir()].map((root) => canonicalPath(resolve(root))))];
}

function bwrapProfileArgs(policy: SandboxExecutionPolicy): string[] {
  const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--unshare-pid", "--proc", "/proc", "--die-with-parent"];
  if (policy.mode === "workspace-write") args.push("--tmpfs", "/tmp", "--bind", policy.workspaceRoot, policy.workspaceRoot);
  return args;
}

function seatbeltProfileArgs(policy: SandboxExecutionPolicy): string[] {
  const forms = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* (literal "${seatbeltPath("/dev/null")}"))`,
  ];
  const roots = writableRoots(policy);
  if (roots.length > 0) forms.push(`(allow file-write* ${roots.map((root) => `(subpath "${seatbeltPath(root)}")`).join(" ")})`);
  return ["-p", forms.join(" ")];
}

function usableBwrap(): boolean {
  const probe = spawnSync("bwrap", [...bwrapProfileArgs({ mode: "read-only", workspaceRoot: "/" }), "--", "true"], {
    stdio: "ignore",
    timeout: 5_000,
  });
  return probe.status === 0;
}

export class SandboxRuntime {
  constructor(private readonly policy = new SandboxPolicyService()) {}
  private selectedRunner: "bwrap" | "seatbelt" | "unavailable" | undefined;

  confine(argv: readonly string[], requestedPolicy?: Partial<SandboxExecutionPolicy>): ConfinedArgv {
    if (argv.length === 0 || !argv[0]) throw new Error("sandbox: argv must contain a program");
    const resolved = this.policy.resolve(requestedPolicy ? { mode: requestedPolicy.mode, cwd: requestedPolicy.workspaceRoot } : {});
    if (resolved.mode === "danger-full-access") {
      return { argv: [...argv], enforcement: "full", denialSignatures: [], runnerFailureRules: [] };
    }
    const runner = this.selectRunner();
    if (runner === "bwrap") {
      return {
        argv: ["bwrap", ...bwrapProfileArgs(resolved), "--", ...argv],
        enforcement: "full",
        denialSignatures: ["read-only file system"],
        runnerFailureRules: [{ fatalSignatures: ["bwrap:"] }],
      };
    }
    if (runner === "seatbelt") {
      return {
        argv: ["/usr/bin/sandbox-exec", ...seatbeltProfileArgs(resolved), "--", ...argv],
        enforcement: "full",
        denialSignatures: ["operation not permitted"],
        runnerFailureRules: [{ fatalSignatures: ["sandbox-exec:"] }],
      };
    }
    throw new Error(`sandbox: no enforcing provider is available for ${resolved.mode}`);
  }

  private selectRunner(): "bwrap" | "seatbelt" | "unavailable" {
    if (this.selectedRunner !== undefined) return this.selectedRunner;
    if (process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec")) {
      this.selectedRunner = "seatbelt";
      return this.selectedRunner;
    }
    if (process.platform === "linux" && usableBwrap()) {
      this.selectedRunner = "bwrap";
      return this.selectedRunner;
    }
    this.selectedRunner = "unavailable";
    return this.selectedRunner;
  }

  resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy { return this.policy.resolve(request); }

  dispose(): void { /* policy state is session-scoped and released with the plugin fiber */ }
}
