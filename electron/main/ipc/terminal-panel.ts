/**
 * IPC surface — 用户终端面板(阶段 1:chat 侧终端)。
 *
 * 与 pi 扩展用的 TerminalRuntime(deepseek/terminal-runtime.ts)无关:那是
 * owner 作用域的 pi 会话基础设施。这里是**用户自己操作**的交互终端:
 *   - `terminal:create`  在信任工作区内起用户默认 shell,返回会话 id;
 *   - `terminal:input`   向会话写 stdin(字节直通,用户敲什么进什么);
 *   - `terminal:resize`  记录列/行(无真 PTY,仅保存给 xterm 回显对齐);
 *   - `terminal:kill`    结束会话;
 *   - 输出/退出经 webContents.send 推 `terminal:output` / `terminal:exit`。
 *
 * 已知限制(文档同步):spawn 管道非真 PTY——TERM 已设 xterm-256color,常规
 * 命令(颜色/进度条)正常,但全屏程序(vim/htop)与 TTY 探测(-t)会退化。
 * 引入 node-pty 原生依赖后可无缝升级,IPC 形状不变。
 *
 * 安全:cwd 必须落在信任工作区内(与 apply_patch 同一信任根),拒绝任意目录。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { ipcMain, type BrowserWindow } from "electron";

import { randomUUID } from "node:crypto";
import { basename, isAbsolute, relative, resolve } from "node:path";

interface TerminalSession {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  child: ChildProcess;
}

const sessions = new Map<string, TerminalSession>();
let broadcast: ((channel: string, payload: unknown) => void) | null = null;

const MAX_SESSIONS = 8;
const OUTPUT_CHUNK_CAP = 8 * 1024; // 单次事件最大字节(超大输出切片)

function shellCommand(): { file: string; args: string[] } {
  if (process.platform === "win32") return { file: "powershell.exe", args: ["-NoLogo"] };
  const shell = process.env.SHELL || "/bin/bash";
  return { file: shell, args: ["-i"] };
}

function sendTo(win: BrowserWindow | null | undefined, channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

export function registerTerminalPanelIpc(options: {
  getWindow: () => Electron.BrowserWindow | null;
  /**
   * 信任判定(审计 A1,2026-10-14):folder-trust 是真正的用户授权源
   * (首轮对话的信任提示写的就是它);此前用 agentHost.getCwd() 当信任根,
   * 会话 cwd 与 host cwd 不一致时按钮在但创建必失败。 containment 判定
   * (agentHost 根内)保留为兜底。
   */
  isTrustedCwd: (cwd: string) => Promise<boolean>;
  /** agentHost 的当前工作区(兜底 containment 判定)。 */
  getTrustedRoot: () => string | null;
}): void {
  broadcast = (channel, payload) => sendTo(options.getWindow(), channel, payload);

  ipcMain.handle("terminal:create", async (_e, args: unknown) => {
    const input = (args ?? {}) as { cwd?: unknown; cols?: unknown; rows?: unknown };
    const requested = typeof input.cwd === "string" && input.cwd.trim() ? input.cwd : options.getTrustedRoot() ?? "";
    if (!requested) throw new Error("terminal: cwd is required (no trusted workspace)");
    const cwd = resolve(isAbsolute(requested) ? requested : resolve(process.cwd(), requested));
    const trusted = options.getTrustedRoot();
    // 信任约束:folder-trust 明确授权,或落在 agentHost 工作区内(兜底)。
    const contained = trusted ? (() => {
      const rel = relative(trusted, cwd);
      return !rel.startsWith("..") && !isAbsolute(rel);
    })() : false;
    if (!contained && !(await options.isTrustedCwd(cwd))) {
      throw new Error(`terminal: cwd is not a trusted workspace (grant folder trust first): ${cwd}`);
    }
    if (sessions.size >= MAX_SESSIONS) {
      throw new Error(`terminal: too many sessions (max ${MAX_SESSIONS})`);
    }
    const { file, args: shellArgs } = shellCommand();
    const child = spawn(file, shellArgs, {
      cwd,
      env: { ...process.env, TERM: "xterm-256color" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const id = `term-${randomUUID().slice(0, 8)}`;
    const session: TerminalSession = {
      id,
      cwd,
      cols: Number(input.cols) || 120,
      rows: Number(input.rows) || 30,
      child,
    };
    sessions.set(id, session);

    const onOut = (chunk: Buffer) => {
      for (let i = 0; i < chunk.length; i += OUTPUT_CHUNK_CAP) {
        sendTo(options.getWindow(), "terminal:output", { id, data: chunk.subarray(i, i + OUTPUT_CHUNK_CAP).toString("utf8") });
      }
    };
    child.stdout?.on("data", onOut);
    child.stderr?.on("data", onOut);
    child.on("error", (err) => {
      sendTo(options.getWindow(), "terminal:output", { id, data: `\r\n[spawn error] ${String(err)}\r\n` });
    });
    child.on("exit", (code) => {
      sessions.delete(id);
      sendTo(options.getWindow(), "terminal:exit", { id, code });
    });

    return { id, pid: child.pid ?? 0, cwd, shell: file };
  });

  ipcMain.handle("terminal:input", (_e, args: unknown) => {
    const input = (args ?? {}) as { id?: unknown; data?: unknown };
    const session = sessions.get(String(input.id ?? ""));
    if (!session) throw new Error(`terminal: unknown session ${String(input.id)}`);
    session.child.stdin?.write(String(input.data ?? ""));
    return { ok: true };
  });

  ipcMain.handle("terminal:resize", (_e, args: unknown) => {
    const input = (args ?? {}) as { id?: unknown; cols?: unknown; rows?: unknown };
    const session = sessions.get(String(input.id ?? ""));
    if (!session) throw new Error(`terminal: unknown session ${String(input.id)}`);
    session.cols = Number(input.cols) || session.cols;
    session.rows = Number(input.rows) || session.rows;
    return { ok: true };
  });

  ipcMain.handle("terminal:kill", (_e, args: unknown) => {
    const input = (args ?? {}) as { id?: unknown };
    const session = sessions.get(String(input.id ?? ""));
    if (!session) return { ok: true };
    session.child.kill("SIGKILL");
    sessions.delete(session.id);
    return { ok: true };
  });
}

/** 应用退出时清掉全部终端子进程(避免孤儿 shell)。 */
export function killAllTerminalSessions(): void {
  for (const session of sessions.values()) {
    try {
      session.child.kill("SIGKILL");
    } catch {
      // 进程可能已退出。
    }
  }
  sessions.clear();
}
