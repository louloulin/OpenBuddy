import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";

export type TerminalSignal = "SIGINT" | "SIGTERM" | "SIGKILL" | "SIGTSTP" | "SIGHUP";
export type TerminalStatus =
  | { kind: "running" }
  | { kind: "exited"; exitCode: number | null; signal: NodeJS.Signals | null };

export interface TerminalSnapshot {
  sessionId: string;
  name?: string;
  type: string;
  pid?: number;
  status: TerminalStatus;
}

export interface TerminalSendResult {
  kind: "foreground";
  viewport: string;
  waitReason: "stdin_read" | "inferred_idle" | "timeout" | "session_exit";
  sessionStatus: TerminalStatus;
  truncated: boolean;
}

export interface TerminalSendOperation {
  done: Promise<TerminalSendResult>;
  readOutput: () => { delta: string; truncated: boolean };
  cancel: () => boolean;
}

type Owner = object;
export type TerminalErrorCode =
  | "DUPLICATE_BACKEND"
  | "DUPLICATE_NAME"
  | "FOREIGN_SESSION"
  | "NO_BACKEND"
  | "NO_SESSION"
  | "SEND_ACTIVE"
  | "SERVICE_DISPOSING";

export class TerminalError extends Error {
  constructor(message: string, readonly code: TerminalErrorCode) {
    super(message);
    this.name = "TerminalError";
  }
}

export class TerminalBackendCleanupError extends AggregateError {
  constructor(readonly spawnError: unknown, readonly cleanupError: unknown) {
    super([spawnError, cleanupError], "PTY backend startup and cleanup both failed");
    this.name = "TerminalBackendCleanupError";
  }
}

export interface TerminalBackend {
  readonly type: string;
  readonly readyTimeoutMs?: number;
  spawn: (
    owner: Owner,
    request: { type: string; name?: string; cwd?: string },
    signal?: AbortSignal,
  ) => Promise<ChildProcessWithoutNullStreams>;
}

export interface ShellTerminalBackendOptions {
  shellPath?: string;
  shellArgs?: string[];
  env?: Record<string, string | undefined>;
  readyTimeoutMs?: number;
  spawnProcess?: (spec: {
    file: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  }) => ChildProcessWithoutNullStreams;
}

type TerminalRecord = {
  snapshot: TerminalSnapshot;
  owner: Owner;
  process: ChildProcessWithoutNullStreams;
  output: BoundedOutput;
  motd: string;
  sendActive: boolean;
  closePromise?: Promise<void>;
};

class BoundedOutput {
  private readonly chunks: string[] = [];
  private bytes = 0;
  private dropped = false;

  constructor(private readonly maxBytes = 256 * 1024, private readonly maxLines = 4000) {}

  append(value: string): void {
    if (!value) return;
    this.chunks.push(value);
    this.bytes += Buffer.byteLength(value);
    while (this.bytes > this.maxBytes || this.chunks.length > this.maxLines) {
      const removed = this.chunks.shift();
      if (removed === undefined) break;
      this.bytes -= Buffer.byteLength(removed);
      this.dropped = true;
    }
  }

  text(): string { return this.chunks.join(""); }

  page(offset = 0, count = 500): { text: string; totalLines: number; lineBegin: number; lineEnd: number; truncated: boolean } {
    const lines = this.text().split(/\r?\n/u);
    const safeOffset = Math.max(0, Math.floor(offset));
    const safeCount = Math.max(1, Math.min(2000, Math.floor(count)));
    const newestStart = Math.max(0, lines.length - safeOffset - safeCount);
    const newestEnd = Math.max(0, lines.length - safeOffset);
    return {
      text: lines.slice(newestStart, newestEnd).join("\n"),
      totalLines: lines.length,
      lineBegin: lines.length - newestEnd,
      lineEnd: lines.length - newestStart,
      truncated: this.dropped || safeCount < count,
    };
  }
}

const READY_MARKER = "\x1b]133;D;";

const PYTHON_PTY_BRIDGE = String.raw`
import errno, json, os, pty, select, signal, sys
shell = sys.argv[1]
shell_args = json.loads(sys.argv[2])
child, master = pty.fork()
if child == 0:
    os.execvpe(shell, [shell] + shell_args, os.environ)
def forward(signum, _frame):
    try:
        os.killpg(os.getpgid(child), signum)
    except ProcessLookupError:
        pass
for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGKILL, signal.SIGTSTP, signal.SIGHUP):
    try:
        signal.signal(signum, forward)
    except (AttributeError, OSError, ValueError):
        pass
while True:
    try:
        readable, _, _ = select.select([master, sys.stdin], [], [])
    except (InterruptedError, OSError):
        continue
    if master in readable:
        try:
            data = os.read(master, 65536)
        except OSError as error:
            if error.errno in (errno.EIO, errno.EBADF):
                break
            raise
        if not data:
            break
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
    if sys.stdin in readable:
        data = os.read(sys.stdin.fileno(), 65536)
        if not data:
            break
        os.write(master, data)
_, status = os.waitpid(child, 0)
sys.exit(os.waitstatus_to_exitcode(status))
`;

function shellCommand(options: ShellTerminalBackendOptions): { file: string; args: string[]; shell: string; shellArgs: string[] } {
  const shell = options.shellPath?.trim() || (process.platform === "win32" ? "cmd.exe" : "/bin/bash");
  const shellArgs = options.shellArgs?.length ? [...options.shellArgs] : ["--noprofile", "--norc", "-i"];
  if (process.platform !== "win32") {
    return { file: process.env.PYTHON ?? "/usr/bin/python3", args: ["-u", "-c", PYTHON_PTY_BRIDGE, shell, JSON.stringify(shellArgs)], shell, shellArgs };
  }
  return { file: shell, args: shellArgs, shell, shellArgs };
}

export function spawnPtyProcess(spec: {
  file: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}): ChildProcessWithoutNullStreams {
  const shellArgs = spec.args.length > 0 ? spec.args : ["--noprofile", "--norc", "-i"];
  const isBash = /(?:^|[/\\])bash$/u.test(spec.file);
  const markerCommand = `printf '\\033]133;D;%s\\007' \"$?\"`;
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/KEY|PASSWORD|SECRET|TOKEN/i.test(key) && !key.toUpperCase().startsWith("DSH_"))),
    ...spec.env,
    TERM: spec.env?.TERM ?? process.env.TERM ?? "xterm-256color",
    ...(isBash ? { PS1: "\\[\\e]133;P\\a\\]dsh> ", PROMPT_COMMAND: markerCommand } : {}),
  };
  const command = shellCommand({ shellPath: spec.file, shellArgs });
  const child = spawn(command.file, command.args, {
    cwd: resolve(spec.cwd),
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  }) as ChildProcessWithoutNullStreams;
  const abort = () => {
    if (!child.pid) return;
    try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGINT"); } catch {}
  };
  spec.signal?.addEventListener("abort", abort, { once: true });
  child.once("exit", () => spec.signal?.removeEventListener("abort", abort));
  return child;
}

export function createShellTerminalBackend(type = "shell", options: ShellTerminalBackendOptions = {}): TerminalBackend {
  if (!type.trim()) throw new Error("terminals: backend type must be non-empty");
  return {
    type,
    readyTimeoutMs: options.readyTimeoutMs,
    spawn: async (_owner, request, signal) => {
      const cwd = resolve(request.cwd || process.cwd());
      const command = shellCommand(options);
      const isBash = /(?:^|[/\\])bash$/u.test(command.shell);
      const markerCommand = `printf '\\033]133;D;%s\\007' \"$?\"`;
      const env: NodeJS.ProcessEnv = {
          ...process.env,
          ...options.env,
          TERM: process.env.TERM || "xterm-256color",
          ...(isBash ? { PS1: "\\[\\e]133;P\\a\\]dsh> ", PROMPT_COMMAND: markerCommand } : {}),
        };
      const child = options.spawnProcess
        ? options.spawnProcess({ file: command.file, args: command.args, cwd, env, ...(signal ? { signal } : {}) })
        : spawn(command.file, command.args, {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      const abort = () => {
        if (!child.pid) return;
        try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGINT"); } catch {}
      };
      signal?.addEventListener("abort", abort, { once: true });
      child.once("exit", () => signal?.removeEventListener("abort", abort));
      return child;
    },
  };
}

function statusOf(record: TerminalRecord): TerminalStatus {
  return record.snapshot.status;
}

export class TerminalRuntime {
  private readonly backends = new Map<string, TerminalBackend>();
  private readonly sessions = new Map<string, TerminalRecord>();
  private readonly names = new Map<Owner, Set<string>>();
  private nextId = 0;
  private disposed = false;

  registerBackend(backend: TerminalBackend): () => void {
    if (!backend.type.trim()) throw new TerminalError("terminals: backend type must be non-empty", "DUPLICATE_BACKEND");
    if (this.backends.has(backend.type)) throw new TerminalError(`terminals: duplicate backend ${backend.type}`, "DUPLICATE_BACKEND");
    this.backends.set(backend.type, backend);
    return () => {
      if (this.backends.get(backend.type) === backend) this.backends.delete(backend.type);
    };
  }

  listBackends(): string[] { return [...this.backends.keys()]; }

  get sessionCount(): number { return this.sessions.size; }

  async open(owner: Owner, request: { type: string; name?: string; cwd?: string }, signal?: AbortSignal): Promise<TerminalSnapshot & { motd: string }> {
    if (this.disposed) throw new TerminalError("terminals: service is disposing", "SERVICE_DISPOSING");
    const backend = this.backends.get(request.type);
    if (!backend) throw new TerminalError(`terminals: no backend registered for ${request.type}`, "NO_BACKEND");
    if (request.name !== undefined && !request.name.trim()) throw new TerminalError("terminals: name must be non-empty", "DUPLICATE_NAME");
    const existingNames = this.names.get(owner) ?? new Set<string>();
    if (request.name && existingNames.has(request.name)) throw new TerminalError(`terminals: duplicate name ${request.name}`, "DUPLICATE_NAME");
    let child: ChildProcessWithoutNullStreams;
    try {
      child = await backend.spawn(owner, request, signal);
    } catch (error) {
      throw error;
    }
    const id = `pty-${++this.nextId}`;
    const record: TerminalRecord = {
      owner,
      process: child,
      output: new BoundedOutput(),
      motd: "",
      sendActive: false,
      snapshot: { sessionId: id, ...(request.name ? { name: request.name } : {}), type: request.type, ...(child.pid ? { pid: child.pid } : {}), status: { kind: "running" } },
    };
    this.sessions.set(id, record);
    if (request.name) { existingNames.add(request.name); this.names.set(owner, existingNames); }
    const onData = (chunk: Buffer | string) => record.output.append(String(chunk));
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (exitCode, signalName) => { record.snapshot.status = { kind: "exited", exitCode, signal: signalName }; });
    const abort = () => { void this.close(owner, id, "spawn cancelled"); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await new Promise<void>((resolveReady, rejectReady) => {
        const timeout = backend.readyTimeoutMs ?? 750;
        const timer = setTimeout(resolveReady, timeout);
        child.once("error", (error) => { clearTimeout(timer); rejectReady(error); });
        child.once("exit", () => { clearTimeout(timer); resolveReady(); });
        const poll = () => {
          if (record.output.text().includes(READY_MARKER)) {
            clearTimeout(timer);
            resolveReady();
            return;
          }
          if (record.snapshot.status.kind === "running") setTimeout(poll, 25);
        };
        poll();
      });
      signal?.throwIfAborted();
      record.motd = record.output.text();
      return { ...record.snapshot, motd: record.motd };
    } catch (error) {
      try {
        await this.close(owner, id, "spawn failed");
      } catch (cleanupError) {
        throw new TerminalBackendCleanupError(error, cleanupError);
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  async spawn(owner: Owner, request: { type: string; name?: string; cwd?: string }, signal?: AbortSignal): Promise<TerminalSnapshot & { motd: string }> {
    return this.open(owner, request, signal);
  }

  list(owner: Owner): TerminalSnapshot[] { return [...this.sessions.values()].filter((record) => record.owner === owner).map((record) => ({ ...record.snapshot })); }

  async disposeOwner(owner: Owner): Promise<void> {
    const owned = [...this.sessions.values()]
      .filter((record) => record.owner === owner)
      .map((record) => record.snapshot.sessionId);
    await Promise.allSettled(owned.map((id) => this.close(owner, id, "owner disposed")));
  }

  async send(owner: Owner, id: string, text: string, submit = true, signal?: AbortSignal): Promise<TerminalSendResult> {
    const record = this.expect(owner, id);
    if (record.sendActive) throw new TerminalError("terminals: only one send may be active per session", "SEND_ACTIVE");
    if (record.snapshot.status.kind !== "running") return { kind: "foreground", viewport: "", waitReason: "session_exit", sessionStatus: statusOf(record), truncated: false };
    record.sendActive = true;
    const before = record.output.text().length;
    const started = Date.now();
    let waitReason: TerminalSendResult["waitReason"] = "inferred_idle";
    try {
      signal?.throwIfAborted();
      record.process.stdin.write(text + (submit ? "\n" : ""));
      await new Promise<void>((resolveWait, rejectWait) => {
        let lastLength = record.output.text().length;
        let quietTimer: NodeJS.Timeout | undefined;
        const finish = () => { if (quietTimer) clearTimeout(quietTimer); signal?.removeEventListener("abort", onAbort); resolveWait(); };
        const onAbort = () => { this.interrupt(record); finish(); rejectWait(signal?.reason ?? new Error("terminal send cancelled")); };
        const poll = () => {
          if (record.snapshot.status.kind !== "running") { waitReason = "session_exit"; return finish(); }
          const currentLength = record.output.text().length;
          if (currentLength !== lastLength) {
            lastLength = currentLength;
            if (record.output.text().slice(before).includes(READY_MARKER)) waitReason = "stdin_read";
            if (quietTimer) clearTimeout(quietTimer);
            quietTimer = setTimeout(finish, 250);
          } else if (Date.now() - started >= 10_000) {
            waitReason = "timeout";
            finish();
          }
          if (record.snapshot.status.kind === "running") setTimeout(poll, 50);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        quietTimer = setTimeout(finish, 350);
        poll();
      });
      const viewport = record.output.text().slice(before);
      return { kind: "foreground", viewport: viewport.replaceAll(READY_MARKER, ""), waitReason, sessionStatus: statusOf(record), truncated: false };
    } finally { record.sendActive = false; }
  }

  startSend(owner: Owner, id: string, request: { text: string; submit: boolean; signal?: AbortSignal }): TerminalSendOperation {
    const record = this.expect(owner, id);
    const controller = new AbortController();
    const onAbort = () => controller.abort(request.signal?.reason ?? "terminal send cancelled");
    request.signal?.addEventListener("abort", onAbort, { once: true });
    const before = record.output.text().length;
    const done = this.send(owner, id, request.text, request.submit, controller.signal)
      .finally(() => request.signal?.removeEventListener("abort", onAbort));
    let settled = false;
    void done.then(() => { settled = true; }, () => { settled = true; });
    return {
      done,
      readOutput: () => ({ delta: record.output.text().slice(before), truncated: false }),
      cancel: () => {
        if (settled) return false;
        controller.abort("terminal send cancelled");
        return true;
      },
    };
  }

  read(owner: Owner, id: string, request?: { offset?: number; count?: number } | number, count?: number) {
    if (typeof request === "number" || request === undefined) return this.expect(owner, id).output.page(request, count);
    return this.expect(owner, id).output.page(request.offset, request.count);
  }

  signal(owner: Owner, id: string, signalName: TerminalSignal): { delivered: true; targetPgid: number } {
    const record = this.expect(owner, id);
    if (record.snapshot.status.kind !== "running" || !record.process.pid) throw new Error("terminals: session is not running");
    if (process.platform === "win32") { record.process.kill(signalName); return { delivered: true, targetPgid: record.process.pid }; }
    process.kill(-record.process.pid, signalName);
    return { delivered: true, targetPgid: record.process.pid };
  }

  async close(owner: Owner, id: string, reason = "closed"): Promise<boolean> {
    const record = this.expect(owner, id);
    if (record.closePromise) { await record.closePromise; return false; }
    record.closePromise = (async () => {
      if (record.snapshot.status.kind === "running") this.interrupt(record);
      await new Promise<void>((resolveDone) => {
        if (record.snapshot.status.kind !== "running") return resolveDone();
        const timer = setTimeout(() => { if (record.process.pid) { try { process.kill(process.platform === "win32" ? record.process.pid : -record.process.pid, "SIGKILL"); } catch {} } resolveDone(); }, 1500);
        record.process.once("exit", () => { clearTimeout(timer); resolveDone(); });
      });
      this.sessions.delete(id);
      if (record.snapshot.name) { const names = this.names.get(owner); names?.delete(record.snapshot.name); if (names?.size === 0) this.names.delete(owner); }
      void reason;
    })();
    await record.closePromise;
    return true;
  }

  async kill(owner: Owner, id: string, reason = "model request"): Promise<boolean> {
    return this.close(owner, id, reason);
  }

  async dispose(): Promise<void> { this.disposed = true; await Promise.allSettled([...this.sessions.values()].map((record) => this.close(record.owner, record.snapshot.sessionId, "service disposed"))); this.sessions.clear(); this.names.clear(); this.backends.clear(); }

  private interrupt(record: TerminalRecord): void { if (!record.process.pid) return; try { process.kill(process.platform === "win32" ? record.process.pid : -record.process.pid, "SIGINT"); } catch {} }

  private expect(owner: Owner, id: string): TerminalRecord {
    const record = this.sessions.get(id);
    if (!record) throw new TerminalError(`terminals: unknown session ${id}`, "NO_SESSION");
    if (record.owner !== owner) throw new TerminalError(`terminals: session ${id} belongs to another owner`, "FOREIGN_SESSION");
    return record;
  }
}

export function createTerminalService(): TerminalRuntime { return new TerminalRuntime(); }

const ownerTokens = new WeakMap<object, Map<string, Owner>>();

export function terminalOwner(ctx: { get: (key: string) => unknown; root?: object }): Owner {
  const explicit = ctx.get("terminalOwner");
  if (explicit && typeof explicit === "object") return explicit as Owner;
  const sessionId = (ctx.get("piSession") as { sessionId?: unknown } | undefined)?.sessionId;
  if (typeof sessionId === "string" && sessionId) {
    const root = ctx.root ?? ctx;
    let tokens = ownerTokens.get(root);
    if (!tokens) { tokens = new Map(); ownerTokens.set(root, tokens); }
    let token = tokens.get(sessionId);
    if (!token) { token = {}; tokens.set(sessionId, token); }
    return token;
  }
  return (ctx.get("agentHost") ?? ctx) as Owner;
}

export function terminalCwd(ctx: { get: (key: string) => unknown }): string { const resources = ctx.get("mcpResources") as { getCwd?: () => unknown } | undefined; const cwd = resources?.getCwd?.(); return typeof cwd === "string" && cwd ? cwd : homedir(); }
