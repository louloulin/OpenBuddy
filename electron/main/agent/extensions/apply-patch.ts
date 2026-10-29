/**
 * R1 - openbuddy-apply-patch Pi extension.
 *
 * Registers two tools that align with the Codex App standard:
 *  - apply_patch: accepts a unified diff and applies it atomically
 *  - apply_command: runs a shell command with structured input
 *
 * The renderer side surfaces an Accept / Reject UI for each hunk in
 * ToolCallCard.tsx, so the LLM-side protocol is intentionally narrow:
 *   apply_patch({ file_path, patch, dry_run? })
 *     -> { applied, hunks, file, preview?, error? }
 *   apply_command({ command, cwd?, timeout_ms? })
 *     -> { exit_code, stdout, stderr, duration_ms, error? }
 *
 * Path-safety: the extension refuses any file_path that is outside the
 * currently-trusted cwd, and writes go through an atomic temp-rename so
 * a partial write can never corrupt the user's file.
 */
import { existsSync } from "node:fs";
import { writeFile, rename, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

interface ParsedHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  body: string;
}
interface ParsedDiff {
  filePath: string;
  hunks: ParsedHunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parseUnifiedDiff(filePath: string, patch: string): ParsedDiff {
  const lines = patch.split(/\r?\n/);
  const hunks: ParsedHunk[] = [];
  let i = 0;
  while (i < lines.length && !HUNK_RE.test(lines[i])) i++;
  while (i < lines.length) {
    const m = lines[i].match(HUNK_RE);
    if (!m) break;
    const oldStart = Number(m[1]);
    const oldLines = m[2] ? Number(m[2]) : 1;
    const newStart = Number(m[3]);
    const newLines = m[4] ? Number(m[4]) : 1;
    const bodyLines: string[] = [];
    i++;
    while (
      i < lines.length &&
      !HUNK_RE.test(lines[i]) &&
      !lines[i].startsWith("--- ") &&
      !lines[i].startsWith("+++ ")
    ) {
      bodyLines.push(lines[i]);
      i++;
    }
    hunks.push({ oldStart, oldLines, newStart, newLines, body: bodyLines.join("\n") });
  }
  if (hunks.length === 0) {
    throw new Error("apply_patch: patch did not contain any hunks for " + filePath);
  }
  return { filePath, hunks };
}

function applyHunks(original: string, parsed: ParsedDiff): string {
  const origLines = original.split("\n");
  // Work from the bottom up so earlier offsets stay valid after later edits.
  const hunks = [...parsed.hunks].sort((a, b) => b.oldStart - a.oldStart);
  for (const h of hunks) {
    const startIdx = h.oldStart - 1;
    const newLines: string[] = [];
    for (const raw of h.body.split("\n")) {
      // Skip empty lines (artifacts of trailing newlines in the patch text).
      if (raw === "") continue;
      const prefix = raw[0];
      if (prefix === "+" || prefix === " ") newLines.push(raw.slice(1));
      else if (prefix === "-") continue;
      else if (prefix === "\\") continue;
      else throw new Error("apply_patch: malformed hunk line '" + raw.slice(0, 20) + "'");
    }
    origLines.splice(startIdx, h.oldLines, ...newLines);
  }
  return origLines.join("\n");
}

/** 结构化沙箱接口(避免扩展直接依赖 deepseek 运行时;实现=SubprocessRuntime 侧 SandboxRuntime)。 */
export interface ApplyCommandSandbox {
  confine(
    argv: readonly string[],
    policy?: { mode?: "read-only" | "workspace-write" | "danger-full-access"; workspaceRoot?: string },
  ): { argv: readonly string[]; enforcement: string };
}

export interface OpenBuddyApplyPatchConfig {
  trustedCwd: string;
  dryRun?: boolean;
  /** OS 级沙箱(seatbelt/bwrap)。缺省时 apply_command 退回"仅权限弹窗"。 */
  sandbox?: ApplyCommandSandbox;
}

export default function openBuddyApplyPatch(
  config: OpenBuddyApplyPatchConfig,
): ExtensionFactory {
  const trustedRoot = resolve(config.trustedCwd);
  const sandbox = config.sandbox;
  return (pi) => {
  const api = pi;
  if (typeof api.registerTool !== "function") return;

  const isPathTrusted = (filePath: string): boolean => {
    if (!isAbsolute(filePath)) {
      throw new Error("apply_patch: file_path must be absolute, got '" + filePath + "'");
    }
    const resolved = resolve(filePath);
    const rel = relative(trustedRoot, resolved);
    return !rel.startsWith("..") && !isAbsolute(rel);
  };

  api.registerTool({
    name: "apply_patch",
    label: "Apply patch",
    description:
      "Apply a unified diff to a file under the trusted workspace. " +
      "The patch must be a standard unified diff with @@ -X,Y +A,B @@ hunks. " +
      "Faster and safer than rewriting the whole file.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to the file to patch" },
        patch: { type: "string", description: "Unified diff content" },
        dry_run: { type: "boolean", description: "If true, return a preview without writing" },
      },
      required: ["file_path", "patch"],
    },
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const p = (params ?? {}) as { file_path?: unknown; patch?: unknown; dry_run?: unknown };
      const filePath = String(p.file_path ?? "");
      const patch = String(p.patch ?? "");
      const dryRun = Boolean(p.dry_run) || config.dryRun;
      const details = { applied: false, hunks: 0, file: filePath, preview: undefined as string | undefined, error: undefined as string | undefined };
      const fail = (msg: string) => ({
        content: [{ type: "text" as const, text: "apply_patch failed: " + msg }],
        details: { ...details, error: msg },
      });
      try {
        if (!filePath) return fail("file_path is required");
        if (!isPathTrusted(filePath)) return fail("path outside the trusted workspace " + trustedRoot);
        const parsed = parseUnifiedDiff(filePath, patch);
        const original = existsSync(filePath) ? await readFile(filePath, "utf8") : "";
        const next = applyHunks(original, parsed);
        const preview = next.split("\n").slice(0, 8).join("\n") +
          (next.split("\n").length > 8 ? "\n..." : "");
        if (dryRun) {
          return {
            content: [{ type: "text" as const, text: "dry_run: " + parsed.hunks.length + " hunks ready for " + filePath }],
            details: { ...details, hunks: parsed.hunks.length, preview },
          };
        }
        const tmp = join(dirname(filePath), "." + randomUUID() + ".apply-patch.tmp");
        await writeFile(tmp, next, "utf8");
        try {
          await rename(tmp, filePath);
        } catch (renameErr) {
          try {
            const { unlink } = await import("node:fs/promises");
            await unlink(tmp);
          } catch {
            // best-effort cleanup
          }
          throw renameErr;
        }
        return {
          content: [{ type: "text" as const, text: "applied " + parsed.hunks.length + " hunks to " + filePath }],
          details: { ...details, applied: true, hunks: parsed.hunks.length, preview },
        };
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  });

  api.registerTool({
    name: "apply_command",
    label: "Apply command",
    description:
      "Run a shell command and return its exit code, stdout, stderr, and " +
      "duration. Use for non-trivial shell operations; structured result is " +
      "easier to render in the UI than a free-form Bash tool call.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run" },
        cwd: { type: "string", description: "Working directory (defaults to trusted workspace)" },
        timeout_ms: { type: "number", description: "Timeout in milliseconds (default 30000)" },
      },
      required: ["command"],
    },
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const p = (params ?? {}) as { command?: unknown; cwd?: unknown; timeout_ms?: unknown };
      const command = String(p.command ?? "");
      const cwd = String(p.cwd ?? trustedRoot);
      const timeout = Number(p.timeout_ms ?? 30000);
      const start = Date.now();
      // 执行任意 shell 前必须过权限闸(此前这里**直接 execFileAsync**,default
      // 模式下模型可以静默跑任意命令 —— 2026-10-12 真实启动验证发现)。
      // ctx.ui.confirm 接的是宿主的 requestHookPermission:规则 → 权限模式
      // (bypass 放行 / plan 强制问 / default 弹窗)→ 用户决议。
      if (ctx?.ui?.confirm && !(await ctx.ui.confirm(
        "执行命令",
        `${command}${cwd !== trustedRoot ? `（cwd: ${cwd}）` : ""}`,
      ))) {
        return {
          content: [{ type: "text" as const, text: "用户拒绝执行该命令。" }],
          details: { exit_code: 1, stdout: "", stderr: "permission denied by user", duration_ms: Date.now() - start, error: "permission denied by user" },
        };
      }
      // 阶段 3:OS 级沙箱(seatbelt/bwrap)包裹 —— workspace-write 只允许写信任
      // 工作区与 /tmp,其余路径写操作由内核拒绝。danger-full-access 直通。
      // 别写死 "/bin/sh":Windows 上没有这个文件,apply_command 在那里
      // 100% 失败,而且报的是一个跟命令内容毫无关系的 ENOENT。
      const isWindows = process.platform === "win32";
      let argv: readonly string[] = isWindows
        ? ["cmd", "/d", "/s", "/c", command]
        : ["/bin/sh", "-c", command];
      let sandboxed = false;
      if (sandbox) {
        try {
          const confined = sandbox.confine(argv, { mode: "workspace-write", workspaceRoot: trustedRoot });
          argv = confined.argv;
          sandboxed = confined.enforcement === "full";
        } catch {
          // 无可用 enforcing provider(如无 sandbox-exec/bwrap)→ 退回直跑。
        }
      }
      try {
        const { stdout, stderr } = await execFileAsync(argv[0], argv.slice(1) as string[], {
          cwd: resolve(cwd),
          timeout,
          maxBuffer: 16 * 1024 * 1024,
        });
        return {
      content: [{ type: "text" as const, text: stdout }],
      details: { exit_code: 0, stdout, stderr, duration_ms: Date.now() - start },
    };
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
        return {
      content: [{ type: "text" as const, text: err.stderr ?? (e instanceof Error ? e.message : String(e)) }],
      details: {
        exit_code: typeof err.code === "number" ? err.code : 1,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? (e instanceof Error ? e.message : String(e)),
        duration_ms: Date.now() - start,
        error: err.killed ? "command timed out" : undefined,
      },
    };
      }
    },
  });
};
}
