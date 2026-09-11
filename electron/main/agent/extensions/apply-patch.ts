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
 *
 * Round 14 (G1 PR 2) — switched from `(params as { ... })` unsafe casts
 * + `String(p.x ?? "")` runtime guards to a typed schema + runtime
 * validator flow (defineTool + TypeBox + validateParams facade from
 * `@openbuddy/plugin-host/typed-tool`). Net effect: ~30 LOC of unsafe
 * casts removed, body now reads as ordinary typed code, and runtime
 * validation still defends against malformed LLM params.
 */
import { existsSync } from "node:fs";
import { writeFile, rename, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
  defineTool,
  validateParams,
  validateParamsSafe,
  type InferParams,
} from "@openbuddy/plugin-host/typed-tool";

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

// ─── Param schemas (TypeBox) ────────────────────────────────────────
// Round 14: schemas live next to the tool definition so adding a field
// is one place; runtime validation is via `validateParams(Schema, params)`.

const ApplyPatchParamsSchema = Type.Object({
  file_path: Type.String({ description: "Absolute path to the file to patch" }),
  patch: Type.String({ description: "Unified diff content" }),
  dry_run: Type.Optional(
    Type.Boolean({ description: "If true, return a preview without writing" }),
  ),
});
type ApplyPatchParams = InferParams<typeof ApplyPatchParamsSchema>;

const ApplyCommandParamsSchema = Type.Object({
  command: Type.String({ description: "Shell command to run" }),
  cwd: Type.Optional(
    Type.String({ description: "Working directory (defaults to trusted workspace)" }),
  ),
  timeout_ms: Type.Optional(
    Type.Number({ description: "Timeout in milliseconds (default 30000)" }),
  ),
});
type ApplyCommandParams = InferParams<typeof ApplyCommandParamsSchema>;

export interface OpenBuddyApplyPatchConfig {
  trustedCwd: string;
  dryRun?: boolean;
}

export default function openBuddyApplyPatch(
  config: OpenBuddyApplyPatchConfig,
): ExtensionFactory {
  const trustedRoot = resolve(config.trustedCwd);
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

  api.registerTool(defineTool({
    name: "apply_patch",
    label: "Apply patch",
    description:
      "Apply a unified diff to a file under the trusted workspace. " +
      "The patch must be a standard unified diff with @@ -X,Y +A,B @@ hunks. " +
      "Faster and safer than rewriting the whole file.",
    parameters: ApplyPatchParamsSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      // Round 16 (G1 PR 3): switch from `validateParams + as ApplyPatchParams`
      // to `validateParamsSafe` — a real TS user-defined type guard
      // (`params is ApplyPatchParams`) that narrows `unknown` to the
      // inferred schema type *inside the if-block* without an explicit
      // cast. The remaining "no-narrow" path is moved to a small `else`
      // branch that still surfaces a useful error message via the
      // existing `validateParams` helper (so the error string keeps
      // /count: Expected number style diagnostics).
      const fail = (msg: string) => ({
        content: [{ type: "text" as const, text: "apply_patch failed: " + msg }],
        details: { applied: false, hunks: 0, file: "", preview: undefined, error: msg },
      });
      if (!validateParamsSafe(ApplyPatchParamsSchema, params)) {
        return fail(validateParams(ApplyPatchParamsSchema, params) ?? "invalid params");
      }
      const p = params;
      const details = { applied: false, hunks: 0, file: p.file_path, preview: undefined as string | undefined, error: undefined as string | undefined };
      try {
        if (!p.file_path) return fail("file_path is required");
        if (!isPathTrusted(p.file_path)) return fail("path outside the trusted workspace " + trustedRoot);
        const parsed = parseUnifiedDiff(p.file_path, p.patch);
        const original = existsSync(p.file_path) ? await readFile(p.file_path, "utf8") : "";
        const next = applyHunks(original, parsed);
        const preview = next.split("\n").slice(0, 8).join("\n") +
          (next.split("\n").length > 8 ? "\n..." : "");
        if (p.dry_run || config.dryRun) {
          return {
            content: [{ type: "text" as const, text: "dry_run: " + parsed.hunks.length + " hunks ready for " + p.file_path }],
            details: { ...details, hunks: parsed.hunks.length, preview },
          };
        }
        const tmp = join(dirname(p.file_path), "." + randomUUID() + ".apply-patch.tmp");
        await writeFile(tmp, next, "utf8");
        try {
          await rename(tmp, p.file_path);
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
          content: [{ type: "text" as const, text: "applied " + parsed.hunks.length + " hunks to " + p.file_path }],
          details: { ...details, applied: true, hunks: parsed.hunks.length, preview },
        };
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  }));

  api.registerTool(defineTool({
    name: "apply_command",
    label: "Apply command",
    description:
      "Run a shell command and return its exit code, stdout, stderr, and " +
      "duration. Use for non-trivial shell operations; structured result is " +
      "easier to render in the UI than a free-form Bash tool call.",
    parameters: ApplyCommandParamsSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      // Round 16 (G1 PR 3): same pattern as apply_patch — `validateParamsSafe`
      // narrows `unknown` to `ApplyCommandParams` so the cast disappears.
      const fail = (msg: string) => ({
        content: [{ type: "text" as const, text: msg }],
        details: { exit_code: 1, stdout: "", stderr: "", duration_ms: 0, error: msg },
      });
      if (!validateParamsSafe(ApplyCommandParamsSchema, params)) {
        return fail(validateParams(ApplyCommandParamsSchema, params) ?? "invalid params");
      }
      const p = params;
      const command = p.command;
      const cwd = p.cwd ?? trustedRoot;
      const timeout = p.timeout_ms ?? 30000;
      const start = Date.now();
      try {
        const { stdout, stderr } = await execFileAsync("/bin/sh", ["-c", command], {
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
  }));
};
}