/**
 * pi-bridge/index.ts — IPC handler registration + public surface.
 *
 * Phase A.1 of OPENBUDDY_PI_NATIVE_PLAN.md. Centralizes the IPC surface that
 * exposes pi-coding-agent text / image / skill helpers to the renderer,
 * keeping the renderer from importing the Node-only pi bundle directly.
 *
 * Channel naming convention: `pi-bridge-<domain>:<verb>` (single colon to
 *   comply with the IPC contract regex /^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]+$/).
 *   - pi-bridge-text:parse-frontmatter
 *   - pi-bridge-text:strip-frontmatter
 *   - pi-bridge-text:truncate-head / -tail / -line
 *   - pi-bridge-text:generate-diff
 *   - pi-bridge-image:detect-mime
 *   - pi-bridge-image:resize
 *   - pi-bridge-image:resize-file
 *   - pi-bridge-image:convert-to-png
 *   - pi-bridge-skills:load
 *   - pi-bridge-skills:load-from-dir
 *   - pi-bridge-skills:format-for-prompt
 */
import { ipcMain } from "electron";

import * as textUtils from "./text-utils";
import * as imageUtils from "./image-utils";
import * as skillUtils from "./skill-utils";

export { textUtils, imageUtils, skillUtils };

/**
 * Register all pi-bridge IPC handlers. Idempotent: safe to call once during
 * microkernel boot.
 */
export function registerPiBridgeIpc(): void {
  // ---- text ----
  ipcMain.handle("pi-bridge-text:parse-frontmatter", async (_e, args: { content: string }) => {
    return textUtils.parseFrontmatter(args.content);
  });
  ipcMain.handle("pi-bridge-text:strip-frontmatter", async (_e, args: { content: string }) => {
    return textUtils.stripFrontmatter(args.content);
  });
  ipcMain.handle(
    "pi-bridge-text:truncate-head",
    async (_e, args: { content: string; maxLines?: number; maxBytes?: number }) =>
      textUtils.truncateHead(args.content, { maxLines: args.maxLines, maxBytes: args.maxBytes }),
  );
  ipcMain.handle(
    "pi-bridge-text:truncate-tail",
    async (_e, args: { content: string; maxLines?: number; maxBytes?: number }) =>
      textUtils.truncateTail(args.content, { maxLines: args.maxLines, maxBytes: args.maxBytes }),
  );
  ipcMain.handle(
    "pi-bridge-text:truncate-line",
    async (_e, args: { content: string; maxChars?: number }) =>
      textUtils.truncateLine(args.content, args.maxChars),
  );
  ipcMain.handle(
    "pi-bridge-text:generate-diff",
    async (_e, args: { oldStr: string; newStr: string; contextLines?: number }) =>
      textUtils.generateDiffString(args.oldStr, args.newStr, args.contextLines),
  );
  ipcMain.handle(
    "pi-bridge-text:generate-patch",
    async (_e, args: { path: string; oldStr: string; newStr: string; contextLines?: number }) =>
      textUtils.generateUnifiedPatch(args.path, args.oldStr, args.newStr, args.contextLines),
  );

  // ---- image ----
  ipcMain.handle(
    "pi-bridge-image:detect-mime",
    async (_e, args: { filePath: string }) => imageUtils.detectSupportedImageMimeTypeFromFile(args.filePath),
  );
  ipcMain.handle(
    "pi-bridge-image:resize",
    async (
      _e,
      args: { bytes: number[]; mimeType: string; maxWidth?: number; maxHeight?: number; maxBytes?: number; jpegQuality?: number },
    ) => {
      // IPC marshals Uint8Array as {0,1,2,...} plain object — convert back.
      const u8 = Uint8Array.from(args.bytes);
      return imageUtils.resizeImage(u8, args.mimeType, {
        maxWidth: args.maxWidth,
        maxHeight: args.maxHeight,
        maxBytes: args.maxBytes,
        jpegQuality: args.jpegQuality,
      });
    },
  );
  ipcMain.handle(
    "pi-bridge-image:resize-file",
    async (
      _e,
      args: { filePath: string; maxWidth?: number; maxHeight?: number; maxBytes?: number; jpegQuality?: number },
    ) => imageUtils.readAndResizeImage(args.filePath, {
      maxWidth: args.maxWidth,
      maxHeight: args.maxHeight,
      maxBytes: args.maxBytes,
      jpegQuality: args.jpegQuality,
    }),
  );
  ipcMain.handle(
    "pi-bridge-image:convert-to-png",
    async (_e, args: { base64Data: string; mimeType: string }) =>
      imageUtils.convertToPng(args.base64Data, args.mimeType),
  );

  // ---- skills ----
  ipcMain.handle(
    "pi-bridge-skills:load",
    async (_e, args?: { cwd?: string; agentDir?: string; skillPaths?: string[]; includeDefaults?: boolean }) =>
      skillUtils.loadSkills(args),
  );
  ipcMain.handle(
    "pi-bridge-skills:load-from-dir",
    async (_e, args: { dir: string; source: string }) => skillUtils.loadSkillsFromDir(args),
  );
  ipcMain.handle(
    "pi-bridge-skills:format-for-prompt",
    async (_e, args: { skills: skillUtils.Skill[]; fileReadTool?: "read" | "bash" }) =>
      skillUtils.formatSkillsForPrompt(args.skills, args.fileReadTool ?? "read"),
  );
}